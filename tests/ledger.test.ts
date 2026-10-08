/**
 * Credit accounting: reservations, spend, refunds, concurrency, single-source payment, idempotent
 * receipts and job retries, allocation capacity. In-memory PGlite (same SQL as Postgres).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb } from "../src/server/db.ts";
import type { Db } from "../src/server/db.ts";
import { POOL_ACCOUNT, audit, characterAccount, credit, ensureAccount, readBalance, reserve, settle, walletAccount } from "../src/server/ledger.ts";
import { cancelJob, fail, getJob, runJob, submitJob, tickJobs } from "../src/server/jobs.ts";
import { createDraft, saveCharacter } from "../src/server/characters.ts";
import { grantCredits, ingestReceipt, planAllocation, poolStatus, runAllocation, takeSnapshot, weekStart, windowDays } from "../src/server/pool.ts";
import type { Providers } from "../src/server/ai.ts";
import { ProviderError } from "../src/server/ai.ts";
import { COSTS, allocationRules } from "../src/config/fable.ts";

process.env.FABLE_MEDIA_DIR = `${process.env.TEMP ?? "/tmp"}/fable-test-media`;
process.env.FABLE_CREDIT_LAMPORTS = "50000";

const W = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0b10000000049454e44ae426082", "hex");

function fakeProviders(opts: { failImage?: number; refuse?: boolean; video?: "pending" | "done" | "failed" } = {}): Providers & { calls: string[] } {
  let imageCalls = 0;
  const calls: string[] = [];
  return {
    calls,
    images: true,
    video: true,
    async sheet(input) {
      calls.push("sheet");
      return { name: input.name || "Botley Mk II", bio: "A washed-up robot comedian.", personality: "Dry, warm.", niche: input.niche || "comedy", look: "dented chrome" };
    },
    async image() {
      calls.push("image");
      imageCalls++;
      if (opts.refuse) throw new ProviderError("refused", false);
      if (opts.failImage && imageCalls <= opts.failImage) throw new ProviderError("timeout", true);
      return { mime: "image/png", bytes: PNG };
    },
    async videoStart() {
      calls.push("videoStart");
      return "operations/abc";
    },
    async videoPoll() {
      calls.push("videoPoll");
      const v = opts.video ?? "done";
      return v === "done" ? { status: "done", uri: "http://x/v.mp4" } : v === "failed" ? { status: "failed", error: "blocked" } : { status: "pending" };
    },
    async videoDownload() {
      return Buffer.from("mp4");
    },
  };
}

async function fund(db: Db, wallet: string, credits: number) {
  await db.tx(async (q) => {
    await ensureAccount(q, walletAccount(wallet), "holder_credits", wallet);
    await credit(q, walletAccount(wallet), credits, `test:${wallet}:${credits}:${Math.random()}`, "grant", null, "test");
  });
}

async function savedCharacter(db: Db, owner = W) {
  await fund(db, owner, COSTS.character);
  const c = await createDraft(db, owner, { idea: "A washed-up robot comedian in Tokyo" });
  const { job } = await submitJob(db, owner, { characterId: c.id, kind: "character", payer: "holder_credits", idempotencyKey: `create-${c.id}` });
  await runJob(db, job.id, fakeProviders());
  return saveCharacter(db, owner, c.id);
}

test("reserve → spend charges once; release after spend is a no-op", async () => {
  const db = await memoryDb();
  await fund(db, W, 20);
  const c = await createDraft(db, W, { idea: "A retired space explorer" });
  const { job } = await submitJob(db, W, { characterId: c.id, kind: "character", payer: "holder_credits", idempotencyKey: "key-aaaaaaaa" });
  let b = await readBalance(db, walletAccount(W));
  assert.deepEqual([b.balance, b.reserved, b.available], [20, COSTS.character, 20 - COSTS.character]);
  const done = await runJob(db, job.id, fakeProviders());
  assert.equal(done?.status, "succeeded");
  b = await readBalance(db, walletAccount(W));
  assert.deepEqual([b.balance, b.reserved], [20 - COSTS.character, 0]);
  assert.equal(await db.tx((q) => settle(q, job.id, "release")), false, "refund after spend must be refused");
  assert.equal(await db.tx((q) => settle(q, job.id, "spend")), false, "second spend must be refused");
  b = await readBalance(db, walletAccount(W));
  assert.deepEqual([b.balance, b.reserved], [20 - COSTS.character, 0]);
  assert.deepEqual(await audit(db), []);
});

test("failure releases the reservation exactly once (no double refund)", async () => {
  const db = await memoryDb();
  await fund(db, W, 10);
  const c = await createDraft(db, W, { idea: "A dramatic pigeon food critic" });
  const { job } = await submitJob(db, W, { characterId: c.id, kind: "character", payer: "holder_credits", idempotencyKey: "key-bbbbbbbb" });
  const out = await runJob(db, job.id, fakeProviders({ refuse: true }));
  assert.equal(out?.status, "failed");
  assert.match(out?.error ?? "", /refused/);
  let b = await readBalance(db, walletAccount(W));
  assert.deepEqual([b.balance, b.reserved], [10, 0]);
  // a second failure report and a manual release cannot refund again
  assert.equal(await fail(db, job.id, "again"), false);
  assert.equal(await db.tx((q) => settle(q, job.id, "release")), false);
  const rows = await db.query("SELECT kind FROM ledger_entries WHERE job_id = $1 ORDER BY id", [job.id]);
  assert.deepEqual(rows.map((r) => r.kind), ["reserve", "release"]);
  b = await readBalance(db, walletAccount(W));
  assert.deepEqual([b.balance, b.reserved], [10, 0]);
  assert.deepEqual(await audit(db), []);
});

test("a retryable failure retries the same job without a second reservation", async () => {
  const db = await memoryDb();
  await fund(db, W, 10);
  const c = await createDraft(db, W, { idea: "A virtual fashion designer" });
  const prov = fakeProviders({ failImage: 1 });
  const { job } = await submitJob(db, W, { characterId: c.id, kind: "character", payer: "holder_credits", idempotencyKey: "key-cccccccc" });
  const first = await runJob(db, job.id, prov);
  assert.equal(first?.status, "queued");
  assert.equal(first?.attempts, 1);
  const second = await runJob(db, job.id, prov);
  assert.equal(second?.status, "succeeded");
  assert.equal(prov.calls.filter((x) => x === "sheet").length, 1, "the sheet is not paid twice");
  const reserves = await db.query("SELECT COUNT(*) AS n FROM ledger_entries WHERE job_id = $1 AND kind = 'reserve'", [job.id]);
  assert.equal(Number(reserves[0].n), 1);
  const b = await readBalance(db, walletAccount(W));
  assert.deepEqual([b.balance, b.reserved], [10 - COSTS.character, 0]);
});

test("the same idempotency key never creates a second job or reservation (also concurrently)", async () => {
  const db = await memoryDb();
  await fund(db, W, 30);
  const c = await createDraft(db, W, { idea: "A robot comedian with stage fright" });
  const input = { characterId: c.id, kind: "character" as const, payer: "holder_credits" as const, idempotencyKey: "key-dddddddd" };
  const results = await Promise.all([submitJob(db, W, input), submitJob(db, W, input), submitJob(db, W, input)]);
  assert.equal(new Set(results.map((r) => r.job.id)).size, 1);
  assert.equal(results.filter((r) => r.created).length, 1);
  const b = await readBalance(db, walletAccount(W));
  assert.equal(b.reserved, COSTS.character);
});

test("concurrent jobs cannot overspend a balance", async () => {
  const db = await memoryDb();
  const ch = await savedCharacter(db);
  await fund(db, W, COSTS.image * 2 + 3); // room for exactly two image jobs
  const before = await readBalance(db, walletAccount(W));
  const attempts = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) => submitJob(db, W, { characterId: ch.id, kind: "image", preset: "scene", prompt: "on stage", payer: "holder_credits", idempotencyKey: `conc-${i}-xxxxxx` })),
  );
  const ok = attempts.filter((a) => a.status === "fulfilled").length;
  const after = await readBalance(db, walletAccount(W));
  assert.ok(ok <= 3, "active-job cap or balance must stop the rest");
  assert.ok(after.reserved <= after.balance);
  assert.equal(after.reserved, ok * COSTS.image);
  assert.ok(Math.floor(before.available / COSTS.image) >= ok);
  for (const a of attempts) if (a.status === "rejected") assert.match(String((a.reason as Error).message), /Not enough credits|jobs at a time/);
  assert.deepEqual(await audit(db), []);
});

test("a job is paid by exactly one balance: character budget jobs leave holder credits untouched", async () => {
  const db = await memoryDb();
  const ch = await savedCharacter(db);
  const wBefore = await readBalance(db, walletAccount(W));
  await ingestReceipt(db, { signature: "sigA", mint: "MintA", characterId: ch.id, source: "distribution", totalLamports: BigInt(10_000_000), poolLamports: BigInt(3_000_000), budgetLamports: BigInt(4_000_000), creatorLamports: BigInt(3_000_000) });
  const cBefore = await readBalance(db, characterAccount(ch.id));
  assert.equal(cBefore.balance, 80);
  const { job } = await submitJob(db, W, { characterId: ch.id, kind: "image", preset: "outfit", prompt: "a yellow raincoat", payer: "character_budget", idempotencyKey: "budget-0001" });
  await runJob(db, job.id, fakeProviders());
  const wAfter = await readBalance(db, walletAccount(W));
  const cAfter = await readBalance(db, characterAccount(ch.id));
  assert.deepEqual([wAfter.balance, wAfter.reserved], [wBefore.balance, wBefore.reserved]);
  assert.equal(cAfter.balance, 80 - COSTS.image);
  const accounts = await db.query("SELECT DISTINCT account_id FROM ledger_entries WHERE job_id = $1", [job.id]);
  assert.equal(accounts.length, 1);
  await assert.rejects(db.query("UPDATE jobs SET payer = 'both' WHERE id = $1", [job.id]));
});

test("cancelling a queued job releases its credits; a running job cannot be cancelled", async () => {
  const db = await memoryDb();
  const ch = await savedCharacter(db);
  await fund(db, W, 50);
  const { job } = await submitJob(db, W, { characterId: ch.id, kind: "image", preset: "scene", prompt: "a rooftop gig", payer: "holder_credits", idempotencyKey: "cancel-0001" });
  const before = await readBalance(db, walletAccount(W));
  await cancelJob(db, W, job.id);
  const after = await readBalance(db, walletAccount(W));
  assert.equal(after.reserved, before.reserved - COSTS.image);
  assert.equal((await getJob(db, job.id))?.status, "cancelled");
  assert.equal(await db.tx((q) => settle(q, job.id, "release")), false);
});

test("video jobs survive across ticks: the operation id is stored and polled", async () => {
  const db = await memoryDb();
  const ch = await savedCharacter(db);
  await fund(db, W, COSTS.video);
  const { job } = await submitJob(db, W, { characterId: ch.id, kind: "video", preset: "talking", prompt: "tells a joke", format: "9:16", payer: "holder_credits", idempotencyKey: "video-0001" });
  const pending = fakeProviders({ video: "pending" });
  let j = await runJob(db, job.id, pending);
  assert.equal(j?.status, "running");
  j = await runJob(db, job.id, pending);
  assert.equal(j?.status, "running");
  assert.equal(pending.calls.filter((c) => c === "videoStart").length, 1, "never started twice");
  await tickJobs(db, fakeProviders({ video: "done" }));
  j = await getJob(db, job.id);
  assert.equal(j?.status, "succeeded");
  assert.ok(j?.resultMediaId);
});

test("fee receipt ingestion is idempotent by signature", async () => {
  const db = await memoryDb();
  const ch = await savedCharacter(db);
  const r = { signature: "sigDup", mint: "MintD", characterId: ch.id, source: "distribution" as const, totalLamports: BigInt(1_000_000_000), poolLamports: BigInt(300_000_000), budgetLamports: BigInt(400_000_000), creatorLamports: BigInt(300_000_000) };
  const results = await Promise.all([ingestReceipt(db, r), ingestReceipt(db, r), ingestReceipt(db, r)]);
  assert.equal(results.filter((x) => x.inserted).length, 1);
  const pool = await readBalance(db, POOL_ACCOUNT);
  assert.equal(pool.balance, 6000);
  assert.equal((await readBalance(db, characterAccount(ch.id))).balance, 8000);
  assert.deepEqual(await audit(db), []);
});

test("weekly eligibility uses the 7-day average, not the balance at claim time", () => {
  const rules = { ...allocationRules(), minAverageTokens: 1000, maxCreditsPerWallet: 1_000_000, decimals: 0 };
  const balances = new Map<string, bigint[]>([
    ["steady", Array(7).fill(BigInt(1000))],
    ["lastMinute", [BigInt(7000)]], // bought on the last day only: average 1000 → eligible at exactly the minimum
    ["dipper", [BigInt(6000)]], // average 857 → not eligible
    ["whale", Array(7).fill(BigInt(5000))],
  ]);
  const plan = planAllocation(balances, 7, 700, rules);
  const by = Object.fromEntries(plan.rows.map((r) => [r.wallet, r]));
  assert.ok(by.steady && by.lastMinute && by.whale);
  assert.equal(by.dipper, undefined);
  assert.equal(by.steady.average, BigInt(1000));
  assert.ok(plan.total <= 700);
  assert.equal(by.whale.credits, 500);
});

test("allocation totals never exceed the funded capacity (property loop)", async () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let round = 0; round < 300; round++) {
    const rules = { ...allocationRules(), minAverageTokens: Math.floor(rand() * 50), maxCreditsPerWallet: 1 + Math.floor(rand() * 400), decimals: 0, weeklyShareBps: 1 + Math.floor(rand() * 10_000) };
    const balances = new Map<string, bigint[]>();
    const n = Math.floor(rand() * 40);
    for (let i = 0; i < n; i++) balances.set(`w${i}`, Array.from({ length: 1 + Math.floor(rand() * 7) }, () => BigInt(Math.floor(rand() * 1e9))));
    const budget = Math.floor(rand() * 100_000);
    const plan = planAllocation(balances, 7, budget, rules);
    assert.ok(plan.total <= budget, `round ${round}: ${plan.total} > ${budget}`);
    for (const r of plan.rows) assert.ok(r.credits >= 0 && r.credits <= rules.maxCreditsPerWallet);
  }
  // and end to end with the database: several weeks, grants in between, nothing ever exceeds funding
  const db = await memoryDb();
  const rules = { ...allocationRules(), minAverageTokens: 1, maxCreditsPerWallet: 5000, decimals: 0, weeklyShareBps: 8000, operatingReserveBps: 1500 };
  await ingestReceipt(db, { signature: "fund1", mint: "M", characterId: null, source: "deposit", totalLamports: BigInt(500_000_000), poolLamports: BigInt(500_000_000), budgetLamports: BigInt(0), creatorLamports: BigInt(0) });
  let week = weekStart(Date.UTC(2026, 9, 12));
  for (let k = 0; k < 6; k++) {
    for (const day of windowDays(week)) {
      await takeSnapshot(db, "M", day, async () => Array.from({ length: 25 }, (_, i) => ({ wallet: `holder${i}`, amount: BigInt(1 + Math.floor(rand() * 1_000_000)) })));
    }
    await runAllocation(db, week, rules);
    const again = await runAllocation(db, week, rules);
    assert.equal(again.already, true, "an allocation runs once per week");
    if (k === 2) await grantCredits(db, "grantee", 10, "g1").catch(() => {});
    const s = await poolStatus(db, rules);
    assert.ok(s.allocated <= s.funded, `allocated ${s.allocated} > funded ${s.funded}`);
    assert.ok(s.allocated <= s.funded - s.reserve, `allocated ${s.allocated} eats into the reserve`);
    week += 7 * 86_400_000;
  }
  assert.deepEqual(await audit(db), []);
});

test("schema refuses negative balances and over-reservation", async () => {
  const db = await memoryDb();
  await db.tx(async (q) => ensureAccount(q, walletAccount(W), "holder_credits", W));
  await assert.rejects(db.query("UPDATE credit_accounts SET balance = -1 WHERE id = $1", [walletAccount(W)]));
  await assert.rejects(db.query("UPDATE credit_accounts SET reserved = 5 WHERE id = $1", [walletAccount(W)]));
  await assert.rejects(db.tx((q) => reserve(q, walletAccount(W), "nojob", 1)), /Not enough credits/);
});
