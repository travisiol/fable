/**
 * Launch flow against an in-memory chain port: duplicate prevention, rejected / failed / expired /
 * confirmed paths, the fee-split transaction and its on-chain verification, receipt deltas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { memoryDb } from "../src/server/db.ts";
import type { Db } from "../src/server/db.ts";
import { createDraft, saveCharacter } from "../src/server/characters.ts";
import { credit, ensureAccount, walletAccount } from "../src/server/ledger.ts";
import { runJob, submitJob } from "../src/server/jobs.ts";
import type { ChainPort } from "../src/server/launch.ts";
import { confirmLaunch, confirmSharing, getLaunch, markRejected, markSharingSubmitted, markSubmitted, prepareLaunch, prepareSharing } from "../src/server/launch.ts";
import { BONDING_CURVE_DISC, bondingCurvePda, globalPda, sharingConfigPda } from "../src/server/pump.ts";
import { deltas, scanLaunch } from "../src/server/fees.ts";
import { PUMP_PROGRAM, TOKEN_2022_PROGRAM } from "../src/config/solana.ts";
import type { Providers } from "../src/server/ai.ts";

process.env.FABLE_MEDIA_DIR = `${process.env.TEMP ?? "/tmp"}/fable-test-media`;
process.env.FABLE_LAUNCH_ENABLED = "1";
const POOL = Keypair.generate().publicKey.toBase58();
const BUDGET = Keypair.generate().publicKey.toBase58();
process.env.FABLE_POOL_WALLET = POOL;
process.env.FABLE_BUDGET_WALLET = BUDGET;
process.env.NEXT_PUBLIC_SITE_URL = "https://fable.example";

const user = Keypair.generate();
const OWNER = user.publicKey.toBase58();
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

const prov: Providers = {
  images: true,
  video: false,
  sheet: async () => ({ name: "Tinpan Kowalski", bio: "A robot comedian.", personality: "Dry.", niche: "comedy", look: "chrome" }),
  image: async () => ({ mime: "image/png", bytes: PNG }),
  videoStart: async () => "x",
  videoPoll: async () => ({ status: "pending" }),
  videoDownload: async () => Buffer.alloc(0),
};

class FakeChain implements ChainPort {
  height = 100;
  accounts = new Map<string, { owner: string; data: Buffer; lamports: number }>();
  statuses = new Map<string, { err: unknown; confirmationStatus?: string | null }>();
  txs = new Map<string, Awaited<ReturnType<ChainPort["transaction"]>>>();
  sigs = new Map<string, { signature: string; err: unknown; slot: number }[]>();
  async latestBlockhash() {
    return { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: this.height + 150 };
  }
  async blockHeight() {
    return this.height;
  }
  async account(a: string) {
    return this.accounts.get(a) ?? null;
  }
  async signatureStatus(s: string) {
    return this.statuses.get(s) ?? null;
  }
  async transaction(s: string) {
    return this.txs.get(s) ?? null;
  }
  async signaturesFor(a: string) {
    return this.sigs.get(a) ?? [];
  }
  /** What the pump program leaves behind after a create. */
  landCoin(mint: string, name: string, ticker: string, creator: string) {
    const curve = Buffer.alloc(151);
    Buffer.from(BONDING_CURVE_DISC).copy(curve, 0);
    curve.writeBigUInt64LE(BigInt(1_073_000_000_000_000), 8);
    curve.writeBigUInt64LE(BigInt(30_000_000_000), 16);
    new PublicKey(creator).toBuffer().copy(curve, 49);
    this.accounts.set(bondingCurvePda(new PublicKey(mint)).toBase58(), { owner: PUMP_PROGRAM, data: curve, lamports: 1 });
    this.accounts.set(mint, { owner: TOKEN_2022_PROGRAM, data: Buffer.concat([Buffer.alloc(200), Buffer.from(name), Buffer.from(ticker)]), lamports: 1 });
  }
}

async function readyCharacter(db: Db) {
  await db.tx(async (q) => {
    await ensureAccount(q, walletAccount(OWNER), "holder_credits", OWNER);
    await credit(q, walletAccount(OWNER), 50, `seed-${Math.random()}`, "grant", null, null);
  });
  const c = await createDraft(db, OWNER, { idea: "A washed-up robot comedian" });
  const { job } = await submitJob(db, OWNER, { characterId: c.id, kind: "character", payer: "holder_credits", idempotencyKey: `k-${c.id}` });
  await runJob(db, job.id, prov);
  return saveCharacter(db, OWNER, c.id);
}

const input = (characterId: string, mint: string, extra: Record<string, unknown> = {}) => ({ characterId, mint, ticker: "tinpan", description: "A washed-up robot comedian broadcasting from Tokyo.", ...extra });
const SIG = "5".repeat(88);

test("prepare builds a create_v2 transaction for the user's wallet; duplicates are refused", async () => {
  const db = await memoryDb();
  const chain = new FakeChain();
  const c = await readyCharacter(db);
  const mint = Keypair.generate();
  const p = await prepareLaunch(db, OWNER, input(c.id, mint.publicKey.toBase58()), chain);
  assert.equal(p.launch.status, "prepared");
  assert.equal(p.launch.ticker, "TINPAN");
  const tx = VersionedTransaction.deserialize(Buffer.from(p.transaction, "base64"));
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  assert.equal(keys[0], OWNER, "the user pays");
  assert.ok(keys.includes(mint.publicKey.toBase58()));
  assert.equal(tx.message.header.numRequiredSignatures, 2, "user + mint sign");
  // a retry with the same mint returns the same launch row; a different mint is refused while signable
  const again = await prepareLaunch(db, OWNER, input(c.id, mint.publicKey.toBase58()), chain);
  assert.equal(again.launch.id, p.launch.id);
  await assert.rejects(prepareLaunch(db, OWNER, input(c.id, Keypair.generate().publicKey.toBase58()), chain), /can still be signed/);
  // after submission: no second launch at all
  await markSubmitted(db, OWNER, p.launch.id, SIG);
  await assert.rejects(prepareLaunch(db, OWNER, input(c.id, Keypair.generate().publicKey.toBase58()), chain), /waiting for confirmation/);
  // other wallets cannot launch someone else's character
  await assert.rejects(prepareLaunch(db, Keypair.generate().publicKey.toBase58(), input(c.id, Keypair.generate().publicKey.toBase58()), chain), /Only this character's creator/);
});

test("a rejected signature frees the character; a failed transaction is reported as failed", async () => {
  const db = await memoryDb();
  const chain = new FakeChain();
  const c = await readyCharacter(db);
  const p1 = await prepareLaunch(db, OWNER, input(c.id, Keypair.generate().publicKey.toBase58()), chain);
  const r = await markRejected(db, OWNER, p1.launch.id, "User rejected the request.");
  assert.equal(r.status, "rejected");
  const p2 = await prepareLaunch(db, OWNER, input(c.id, Keypair.generate().publicKey.toBase58()), chain);
  await markSubmitted(db, OWNER, p2.launch.id, SIG);
  chain.statuses.set(SIG, { err: { InstructionError: [2, { Custom: 6000 }] }, confirmationStatus: "confirmed" });
  const f = await confirmLaunch(db, OWNER, p2.launch.id, chain);
  assert.equal(f.status, "failed");
  assert.match(f.error ?? "", /failed on chain/);
  // and the character can try again
  const p3 = await prepareLaunch(db, OWNER, input(c.id, Keypair.generate().publicKey.toBase58()), chain);
  assert.equal(p3.launch.status, "prepared");
});

test("an expired blockhash with nothing on chain ends as expired", async () => {
  const db = await memoryDb();
  const chain = new FakeChain();
  const c = await readyCharacter(db);
  const p = await prepareLaunch(db, OWNER, input(c.id, Keypair.generate().publicKey.toBase58()), chain);
  await markSubmitted(db, OWNER, p.launch.id, SIG);
  chain.height += 1000;
  const e = await confirmLaunch(db, OWNER, p.launch.id, chain);
  assert.equal(e.status, "expired");
});

test("success only after confirmation, the mint, its metadata and the creator are seen on chain", async () => {
  const db = await memoryDb();
  const chain = new FakeChain();
  const c = await readyCharacter(db);
  const mint = Keypair.generate().publicKey.toBase58();
  const p = await prepareLaunch(db, OWNER, input(c.id, mint), chain);
  await markSubmitted(db, OWNER, p.launch.id, SIG);
  // processed but not confirmed: still submitted
  chain.statuses.set(SIG, { err: null, confirmationStatus: "processed" });
  assert.equal((await confirmLaunch(db, OWNER, p.launch.id, chain)).status, "submitted");
  // confirmed but the transaction is not readable yet: still submitted
  chain.statuses.set(SIG, { err: null, confirmationStatus: "confirmed" });
  assert.equal((await confirmLaunch(db, OWNER, p.launch.id, chain)).status, "submitted");
  chain.txs.set(SIG, { err: null, accountKeys: [OWNER, mint, PUMP_PROGRAM], logMessages: [], preBalances: [], postBalances: [], fee: 5000, slot: 1, blockTime: 1 });
  // the mint is not there yet: still submitted, never a premature success
  assert.equal((await confirmLaunch(db, OWNER, p.launch.id, chain)).status, "submitted");
  chain.landCoin(mint, "Tinpan Kowalski", "TINPAN", OWNER);
  const ok = await confirmLaunch(db, OWNER, p.launch.id, chain);
  assert.equal(ok.status, "confirmed");
  await assert.rejects(prepareLaunch(db, OWNER, input(c.id, Keypair.generate().publicKey.toBase58()), chain), /already launched/);
});

test("a launch with an initial purchase reads pump.fun's Global and still fits in one transaction", async () => {
  const db = await memoryDb();
  const chain = new FakeChain();
  const g = Buffer.alloc(1100);
  for (let i = 0; i < 8; i++) Keypair.generate().publicKey.toBuffer().copy(g, i === 0 ? 41 : 162 + 32 * (i - 1));
  for (let i = 0; i < 8; i++) Keypair.generate().publicKey.toBuffer().copy(g, 741 + 32 * i);
  g.writeBigUInt64LE(BigInt(1_073_000_000_000_000), 73);
  g.writeBigUInt64LE(BigInt(30_000_000_000), 81);
  g.writeBigUInt64LE(BigInt(793_100_000_000_000), 89);
  g.writeBigUInt64LE(BigInt(95), 105);
  g.writeBigUInt64LE(BigInt(30), 154);
  chain.accounts.set(globalPda().toBase58(), { owner: PUMP_PROGRAM, data: g, lamports: 1 });
  const c = await readyCharacter(db);
  const p = await prepareLaunch(db, OWNER, input(c.id, Keypair.generate().publicKey.toBase58(), { initialBuySol: "0.25", x: "https://x.com/tinpan", website: "https://tinpan.example" }), chain);
  assert.equal(p.summary.initialBuyLamports, "250000000");
  assert.ok(BigInt(p.summary.expectedTokens) > BigInt(0));
  assert.ok(Buffer.from(p.transaction, "base64").length <= 1232);
  await assert.rejects(prepareLaunch(db, OWNER, input(c.id, Keypair.generate().publicKey.toBase58(), { initialBuySol: "9" }), chain), /capped/);
});

test("the fee split is active only when the on-chain SharingConfig matches 30/40/30 and is locked", async () => {
  const db = await memoryDb();
  const chain = new FakeChain();
  const c = await readyCharacter(db);
  const mint = Keypair.generate().publicKey.toBase58();
  const p = await prepareLaunch(db, OWNER, input(c.id, mint), chain);
  await markSubmitted(db, OWNER, p.launch.id, SIG);
  chain.statuses.set(SIG, { err: null, confirmationStatus: "finalized" });
  chain.txs.set(SIG, { err: null, accountKeys: [OWNER, mint, PUMP_PROGRAM], logMessages: [], preBalances: [], postBalances: [], fee: 5000, slot: 1, blockTime: 1 });
  chain.landCoin(mint, "Tinpan Kowalski", "TINPAN", OWNER);
  await confirmLaunch(db, OWNER, p.launch.id, chain);
  const s = await prepareSharing(db, OWNER, p.launch.id, chain);
  const tx = VersionedTransaction.deserialize(Buffer.from(s.transaction, "base64"));
  assert.ok(Buffer.from(s.transaction, "base64").length <= 1232, "fee split fits one transaction");
  assert.equal(tx.message.header.numRequiredSignatures, 1);
  assert.deepEqual(s.shareholders.map((h) => h.bps), [3000, 4000, 3000]);
  const SIG2 = "6".repeat(88);
  await markSharingSubmitted(db, OWNER, p.launch.id, SIG2);
  chain.statuses.set(SIG2, { err: null, confirmationStatus: "confirmed" });
  // the config on chain, first with a wrong split, then the right one
  const sc = (holders: [string, number][], revoked: boolean) => {
    const b = Buffer.alloc(8 + 3 + 64 + 1 + 4 + holders.length * 34);
    let o = 8;
    b[o++] = 255;
    b[o++] = 2;
    b[o++] = 1;
    new PublicKey(mint).toBuffer().copy(b, o);
    o += 32;
    new PublicKey(OWNER).toBuffer().copy(b, o);
    o += 32;
    b[o++] = revoked ? 1 : 0;
    b.writeUInt32LE(holders.length, o);
    o += 4;
    for (const [a, bps] of holders) {
      new PublicKey(a).toBuffer().copy(b, o);
      b.writeUInt16LE(bps, o + 32);
      o += 34;
    }
    return b;
  };
  const key = sharingConfigPda(new PublicKey(mint)).toBase58();
  chain.accounts.set(key, { owner: "pfee", data: sc([[OWNER, 10_000]], false), lamports: 1 });
  assert.equal((await confirmSharing(db, OWNER, p.launch.id, chain)).sharingStatus, "failed");
  chain.accounts.set(key, { owner: "pfee", data: sc([[POOL, 3000], [BUDGET, 4000], [OWNER, 3000]], true), lamports: 1 });
  await db.query("UPDATE launches SET sharing_status = 'submitted' WHERE id = $1", [p.launch.id]);
  assert.equal((await confirmSharing(db, OWNER, p.launch.id, chain)).sharingStatus, "active");

  // a distribution transaction becomes one receipt: 30 % pool credits, 40 % character budget
  const DIST = "7".repeat(88);
  chain.sigs.set(key, [{ signature: DIST, err: null, slot: 9 }]);
  chain.txs.set(DIST, { err: null, accountKeys: ["payer", POOL, BUDGET, OWNER], preBalances: [10, 0, 0, 0], postBalances: [5, 30_000_000, 40_000_000, 30_000_000], fee: 5, logMessages: [], slot: 9, blockTime: 1_760_000_000 });
  const l = (await getLaunch(db, p.launch.id))!;
  assert.equal(await scanLaunch(db, l, chain), 1);
  assert.equal(await scanLaunch(db, l, chain), 0, "the same transaction is never counted twice");
  const r = await db.query("SELECT * FROM fee_receipts");
  assert.equal(r.length, 1);
  assert.equal(String(r[0].pool_lamports), "30000000");
  assert.equal(String(r[0].budget_lamports), "40000000");
});

test("receipt deltas add back the fee when a shareholder paid the transaction", () => {
  const d = deltas({ accountKeys: ["A", "B", "C"], preBalances: [1000, 0, 0], postBalances: [1300 - 5, 400, 300], fee: 5 }, { pool: "A", budget: "B", creator: "C" });
  assert.deepEqual([d.pool, d.budget, d.creator], [BigInt(300), BigInt(400), BigInt(300)]);
});
