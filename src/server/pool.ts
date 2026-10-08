/**
 * Funding and the weekly Studio credit allocation.
 *
 * ingestReceipt(): records one confirmed fee receipt (keyed on signature + mint, so ingesting the
 *   same transaction twice is a no-op) and credits the holder pool and the character's budget in the
 *   same transaction. The creator's share is paid on-chain by pump.fun's fee sharing and only recorded.
 *
 * Weekly allocation (spec §4): daily holder snapshots of the FABLE mint → average over the 7 days
 *   before the allocation Monday (a missing day counts as 0) → wallets whose average ≥ the minimum →
 *   pro-rata credits, floored, capped per wallet. Budget = weeklyShareBps of the allocatable pool,
 *   where allocatable = unallocated pool credits − the operating reserve (operatingReserveBps of all
 *   pool credits ever funded). Credits already allocated (spent or outstanding) have left the pool
 *   account, so the total allocated can never exceed what was funded.
 */
import { allocationRules, creditLamports } from "../config/fable.ts";
import type { AllocationRules } from "../config/fable.ts";
import type { Db, Q } from "./db.ts";
import { big, num } from "./db.ts";
import { HttpError } from "./errors.ts";
import { POOL_ACCOUNT, characterAccount, credit, debit, ensureAccount, readBalance, walletAccount } from "./ledger.ts";

// ───────────────────────────── receipts

export interface ReceiptInput {
  signature: string;
  mint: string;
  characterId: string | null;
  source: "distribution" | "deposit";
  totalLamports: bigint;
  poolLamports: bigint;
  budgetLamports: bigint;
  creatorLamports: bigint;
  slot?: number | null;
  blockTime?: number | null;
}

export async function ingestReceipt(db: Db, r: ReceiptInput, now = Date.now()): Promise<{ inserted: boolean; poolCredits: number; budgetCredits: number }> {
  const per = creditLamports();
  const poolCredits = Number(r.poolLamports / per);
  const budgetCredits = Number(r.budgetLamports / per);
  return db.tx(async (q) => {
    const rows = await q.query(
      `INSERT INTO fee_receipts (signature, mint, character_id, source, total_lamports, pool_lamports, budget_lamports, creator_lamports, pool_credits, budget_credits, credit_lamports, slot, block_time, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING RETURNING signature`,
      [r.signature, r.mint, r.characterId, r.source, r.totalLamports, r.poolLamports, r.budgetLamports, r.creatorLamports, poolCredits, budgetCredits, per, r.slot ?? null, r.blockTime ?? null, now],
    );
    if (!rows.length) return { inserted: false, poolCredits: 0, budgetCredits: 0 };
    await ensureAccount(q, POOL_ACCOUNT, "holder_pool", null, now);
    await credit(q, POOL_ACCOUNT, poolCredits, `receipt:${r.signature}:${r.mint}:pool`, "funding", r.signature, `${r.source} ${r.mint.slice(0, 6)}`, now);
    if (r.characterId && budgetCredits > 0) {
      const acc = characterAccount(r.characterId);
      await ensureAccount(q, acc, "character_budget", r.characterId, now);
      await credit(q, acc, budgetCredits, `receipt:${r.signature}:${r.mint}:budget`, "funding", r.signature, "creator fee share", now);
    }
    return { inserted: true, poolCredits, budgetCredits };
  });
}

export interface ReceiptView {
  signature: string;
  mint: string;
  characterId: string | null;
  source: string;
  totalLamports: string;
  poolLamports: string;
  budgetLamports: string;
  creatorLamports: string;
  poolCredits: number;
  budgetCredits: number;
  at: number;
}

export async function receipts(q: Q, opts: { characterId?: string; owner?: string; limit?: number } = {}): Promise<ReceiptView[]> {
  const vals: unknown[] = [];
  let where = "1=1";
  if (opts.characterId) {
    vals.push(opts.characterId);
    where += ` AND r.character_id = $${vals.length}`;
  }
  if (opts.owner) {
    vals.push(opts.owner);
    where += ` AND c.owner = $${vals.length}`;
  }
  vals.push(opts.limit ?? 30);
  const rows = await q.query(`SELECT r.* FROM fee_receipts r LEFT JOIN characters c ON c.id = r.character_id WHERE ${where} ORDER BY r.created_at DESC LIMIT $${vals.length}`, vals);
  return rows.map((r) => ({
    signature: String(r.signature),
    mint: String(r.mint),
    characterId: (r.character_id as string) ?? null,
    source: String(r.source),
    totalLamports: big(r.total_lamports).toString(),
    poolLamports: big(r.pool_lamports).toString(),
    budgetLamports: big(r.budget_lamports).toString(),
    creatorLamports: big(r.creator_lamports).toString(),
    poolCredits: num(r.pool_credits),
    budgetCredits: num(r.budget_credits),
    at: num(r.block_time) ? num(r.block_time) * 1000 : num(r.created_at),
  }));
}

// ───────────────────────────── pool status

export interface PoolStatus {
  funded: number;
  allocated: number;
  unallocated: number;
  reserve: number;
  allocatable: number;
  outstanding: number;
  spent: number;
  receipts: number;
  fundedLamports: string;
}

export async function poolStatus(q: Q, rules: AllocationRules = allocationRules()): Promise<PoolStatus> {
  const b = await readBalance(q, POOL_ACCOUNT);
  const t = await q.query(
    `SELECT
      COALESCE(SUM(CASE WHEN kind = 'funding' THEN amount END), 0) AS funded,
      COALESCE(SUM(CASE WHEN kind IN ('allocation_out','grant_out') THEN amount END), 0) AS allocated
     FROM ledger_entries WHERE account_id = $1`,
    [POOL_ACCOUNT],
  );
  const funded = num(t[0]?.funded);
  const allocated = num(t[0]?.allocated);
  const w = await q.query(
    `SELECT COALESCE(SUM(a.balance - a.reserved), 0) AS outstanding FROM credit_accounts a WHERE a.kind = 'holder_credits'`,
  );
  const s = await q.query(`SELECT COALESCE(SUM(e.amount), 0) AS spent FROM ledger_entries e JOIN credit_accounts a ON a.id = e.account_id WHERE a.kind = 'holder_credits' AND e.kind = 'spend'`);
  const r = await q.query("SELECT COUNT(*) AS n, COALESCE(SUM(pool_lamports), 0) AS l FROM fee_receipts");
  const reserve = Math.ceil((funded * rules.operatingReserveBps) / 10_000);
  return {
    funded,
    allocated,
    unallocated: b.balance,
    reserve,
    allocatable: Math.max(0, b.available - reserve),
    outstanding: num(w[0]?.outstanding),
    spent: num(s[0]?.spent),
    receipts: num(r[0]?.n),
    fundedLamports: big(r[0]?.l).toString(),
  };
}

// ───────────────────────────── dates

export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday 00:00 UTC of the week containing `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

export const nextAllocationAt = (ms: number) => weekStart(ms) + 7 * 86_400_000;

/** The 7 snapshot days (YYYY-MM-DD) averaged by the allocation of the week starting at `week`. */
export function windowDays(week: number): string[] {
  return Array.from({ length: 7 }, (_, i) => dayKey(week - (7 - i) * 86_400_000));
}

// ───────────────────────────── snapshots

export interface HolderAmount {
  wallet: string;
  amount: bigint;
}

/** Records today's holder balances once (idempotent per day). */
export async function takeSnapshot(db: Db, mint: string, day: string, read: (mint: string) => Promise<HolderAmount[]>, now = Date.now()): Promise<{ day: string; holders: number; already: boolean }> {
  const done = await db.query("SELECT holders FROM snapshot_runs WHERE day = $1", [day]);
  if (done[0]) return { day, holders: num(done[0].holders), already: true };
  const holders = await read(mint);
  return db.tx(async (q) => {
    const again = await q.query("SELECT holders FROM snapshot_runs WHERE day = $1 FOR UPDATE", [day]);
    if (again[0]) return { day, holders: num(again[0].holders), already: true };
    for (const h of holders) {
      if (h.amount <= BigInt(0)) continue;
      await q.query("INSERT INTO holder_snapshots (day, wallet, amount) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [day, h.wallet, h.amount]);
    }
    await q.query("INSERT INTO snapshot_runs (day, mint, holders, taken_at) VALUES ($1,$2,$3,$4)", [day, mint, holders.length, now]);
    return { day, holders: holders.length, already: false };
  });
}

// ───────────────────────────── allocation (pure)

export interface AllocationPlan {
  budget: number;
  total: number;
  rows: { wallet: string; average: bigint; credits: number }[];
}

/**
 * Pure: average holdings over `days` days (missing = 0) → eligibility → floored pro-rata credits,
 * capped per wallet. Σ credits ≤ budget always (each share is floored, then capped).
 */
export function planAllocation(balances: Map<string, bigint[]>, days: number, budget: number, rules: AllocationRules): AllocationPlan {
  const min = BigInt(rules.minAverageTokens) * BigInt(10) ** BigInt(rules.decimals);
  const eligible: { wallet: string; average: bigint }[] = [];
  for (const [wallet, list] of balances) {
    const sum = list.reduce((a, b) => a + b, BigInt(0));
    const average = sum / BigInt(days);
    if (average >= min && average > BigInt(0)) eligible.push({ wallet, average });
  }
  const total = eligible.reduce((a, e) => a + e.average, BigInt(0));
  const B = BigInt(Math.max(0, Math.floor(budget)));
  const rows = eligible
    .map((e) => {
      const share = total > BigInt(0) ? (B * e.average) / total : BigInt(0);
      return { wallet: e.wallet, average: e.average, credits: Math.min(rules.maxCreditsPerWallet, Number(share)) };
    })
    .sort((a, b) => (b.average > a.average ? 1 : b.average < a.average ? -1 : a.wallet < b.wallet ? -1 : 1));
  return { budget: Number(B), total: rows.reduce((a, r) => a + r.credits, 0), rows };
}

export interface AllocationResult {
  week: string;
  already: boolean;
  allocatable: number;
  budget: number;
  allocated: number;
  eligible: number;
  snapshotDays: number;
}

/** Runs the allocation of the week starting at `week` (ms, a Monday 00:00 UTC). Idempotent per week. */
export async function runAllocation(db: Db, week: number, rules: AllocationRules = allocationRules(), now = Date.now()): Promise<AllocationResult> {
  const weekId = dayKey(week);
  const days = windowDays(week);
  const prior = await db.query("SELECT * FROM allocation_runs WHERE week = $1", [weekId]);
  if (prior[0]) return runResult(prior[0], true);
  const snaps = await db.query("SELECT day, wallet, amount FROM holder_snapshots WHERE day = ANY($1::text[])", [days]);
  const taken = num((await db.query("SELECT COUNT(*) AS n FROM snapshot_runs WHERE day = ANY($1::text[])", [days]))[0]?.n);
  const balances = new Map<string, bigint[]>();
  for (const s of snaps) {
    const list = balances.get(String(s.wallet)) ?? [];
    list.push(big(s.amount));
    balances.set(String(s.wallet), list);
  }
  return db.tx(async (q) => {
    const again = await q.query("SELECT * FROM allocation_runs WHERE week = $1 FOR UPDATE", [weekId]);
    if (again[0]) return runResult(again[0], true);
    await ensureAccount(q, POOL_ACCOUNT, "holder_pool", null, now);
    await readBalance(q, POOL_ACCOUNT, true); // lock the pool for the whole allocation
    const status = await poolStatus(q, rules);
    const budget = Math.floor((status.allocatable * rules.weeklyShareBps) / 10_000);
    const plan = taken > 0 ? planAllocation(balances, 7, budget, rules) : { budget, total: 0, rows: [] };
    if (plan.total > status.allocatable) throw new HttpError(500, "Allocation exceeds the funded pool.");
    for (const row of plan.rows) {
      if (row.credits <= 0) continue;
      const acc = walletAccount(row.wallet);
      await ensureAccount(q, acc, "holder_credits", row.wallet, now);
      await debit(q, POOL_ACCOUNT, row.credits, `alloc:${weekId}:${row.wallet}:out`, "allocation_out", weekId, now);
      await credit(q, acc, row.credits, `alloc:${weekId}:${row.wallet}`, "allocation", weekId, `week of ${weekId}`, now);
      await q.query("INSERT INTO allocations (week, wallet, average_amount, credits) VALUES ($1,$2,$3,$4)", [weekId, row.wallet, row.average, row.credits]);
    }
    await q.query("INSERT INTO allocation_runs (week, pool_available, budget, allocated, eligible, snapshot_days, rules, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [
      weekId,
      status.allocatable,
      budget,
      plan.total,
      plan.rows.length,
      taken,
      JSON.stringify(rules),
      now,
    ]);
    return { week: weekId, already: false, allocatable: status.allocatable, budget, allocated: plan.total, eligible: plan.rows.length, snapshotDays: taken };
  });
}

function runResult(r: Record<string, unknown>, already: boolean): AllocationResult {
  return {
    week: String(r.week),
    already,
    allocatable: num(r.pool_available),
    budget: num(r.budget),
    allocated: num(r.allocated),
    eligible: num(r.eligible),
    snapshotDays: num(r.snapshot_days),
  };
}

/** Owner grant from the pool (bootstrap, support). Counts against the same capacity as allocations. */
export async function grantCredits(db: Db, wallet: string, credits: number, key: string, now = Date.now()): Promise<boolean> {
  if (!Number.isInteger(credits) || credits <= 0) throw new HttpError(400, "Credits must be a positive integer.");
  return db.tx(async (q) => {
    await ensureAccount(q, POOL_ACCOUNT, "holder_pool", null, now);
    await readBalance(q, POOL_ACCOUNT, true);
    const status = await poolStatus(q);
    if (credits > status.allocatable) throw new HttpError(409, `The pool can allocate ${status.allocatable} credits right now.`);
    const acc = walletAccount(wallet);
    await ensureAccount(q, acc, "holder_credits", wallet, now);
    if (!(await debit(q, POOL_ACCOUNT, credits, `grant:${key}:out`, "grant_out", key, now))) return false;
    await credit(q, acc, credits, `grant:${key}`, "grant", key, "grant from the pool", now);
    return true;
  });
}

export async function allocationHistory(q: Q, wallet: string, limit = 12): Promise<{ week: string; credits: number; average: string }[]> {
  const rows = await q.query("SELECT week, credits, average_amount FROM allocations WHERE wallet = $1 ORDER BY week DESC LIMIT $2", [wallet, limit]);
  return rows.map((r) => ({ week: String(r.week), credits: num(r.credits), average: big(r.average_amount).toString() }));
}

/** The wallet's average over the window of the next allocation, from snapshots taken so far. */
export async function currentAverage(q: Q, wallet: string, now = Date.now()): Promise<{ average: bigint; days: number }> {
  const days = windowDays(nextAllocationAt(now));
  const rows = await q.query("SELECT amount FROM holder_snapshots WHERE wallet = $1 AND day = ANY($2::text[])", [wallet, days]);
  const sum = rows.reduce((a, r) => a + big(r.amount), BigInt(0));
  const taken = num((await q.query("SELECT COUNT(*) AS n FROM snapshot_runs WHERE day = ANY($1::text[])", [days]))[0]?.n);
  return { average: sum / BigInt(7), days: taken };
}
