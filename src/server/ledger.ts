/**
 * The credit ledger. Integer credits; every movement is a row in `ledger_entries` with an
 * idempotency key, and the account's `balance` / `reserved` columns move in the same transaction.
 *
 *   holder_credits   one per wallet       — weekly allocations land here; Studio jobs reserve from it
 *   character_budget one per character    — the character's share of its coin's creator fees
 *   holder_pool      one (pool:holders)   — the shared pool's share of creator fees, not yet allocated
 *
 * A job's life on its payer account:  reserve (reserved += c)  →  spend (balance −= c, reserved −= c)
 *                                                               or release (reserved −= c)
 * spend and release share the idempotency key `settle:<job>`, so whichever lands first wins and the
 * other is a no-op: a refund can never happen twice, nor after a spend. Balance checks and the
 * reservation run inside one transaction with the account row locked (SELECT … FOR UPDATE).
 */
import type { Q } from "./db.ts";
import { num } from "./db.ts";
import { HttpError } from "./errors.ts";

export type AccountKind = "holder_credits" | "character_budget" | "holder_pool";

export const POOL_ACCOUNT = "pool:holders";
export const walletAccount = (wallet: string) => `wallet:${wallet}`;
export const characterAccount = (characterId: string) => `character:${characterId}`;

export interface Balance {
  id: string;
  balance: number;
  reserved: number;
  available: number;
}

export async function ensureAccount(q: Q, id: string, kind: AccountKind, owner: string | null, now = Date.now()) {
  await q.query("INSERT INTO credit_accounts (id, kind, owner, balance, reserved, updated_at) VALUES ($1, $2, $3, 0, 0, $4) ON CONFLICT (id) DO NOTHING", [id, kind, owner, now]);
}

export async function readBalance(q: Q, id: string, lock = false): Promise<Balance> {
  const rows = await q.query(`SELECT balance, reserved FROM credit_accounts WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  const balance = num(rows[0]?.balance);
  const reserved = num(rows[0]?.reserved);
  return { id, balance, reserved, available: balance - reserved };
}

async function entry(q: Q, e: { account: string; kind: string; amount: number; key: string; jobId?: string | null; ref?: string | null; note?: string | null; now: number }): Promise<boolean> {
  const rows = await q.query(
    "INSERT INTO ledger_entries (account_id, kind, amount, job_id, ref, note, idempotency_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id",
    [e.account, e.kind, e.amount, e.jobId ?? null, e.ref ?? null, e.note ?? null, e.key, e.now],
  );
  return rows.length === 1;
}

/** Adds credits to an account once per key (fee receipt share, allocation, grant). Returns false when already applied. */
export async function credit(q: Q, account: string, amount: number, key: string, kind: "funding" | "allocation" | "grant", ref: string | null, note: string | null, now = Date.now()): Promise<boolean> {
  if (amount <= 0) return false;
  if (!(await entry(q, { account, kind, amount, key, ref, note, now }))) return false;
  await q.query("UPDATE credit_accounts SET balance = balance + $2, updated_at = $3 WHERE id = $1", [account, amount, now]);
  return true;
}

/** Removes unreserved credits from an account once per key (pool → wallet allocations). The CHECKs refuse an overdraft. */
export async function debit(q: Q, account: string, amount: number, key: string, kind: "allocation_out" | "grant_out", ref: string | null, now = Date.now()): Promise<boolean> {
  if (amount <= 0) return false;
  const b = await readBalance(q, account, true);
  if (b.available < amount) throw new HttpError(409, "The pool does not hold enough unallocated credits.");
  if (!(await entry(q, { account, kind, amount, key, ref, now }))) return false;
  await q.query("UPDATE credit_accounts SET balance = balance - $2, updated_at = $3 WHERE id = $1", [account, amount, now]);
  return true;
}

/** Reserves `amount` for a job. Must run inside a transaction; throws 402 when the balance is short. */
export async function reserve(q: Q, account: string, jobId: string, amount: number, now = Date.now()): Promise<void> {
  const b = await readBalance(q, account, true);
  if (b.available < amount) throw new HttpError(402, `Not enough credits: this needs ${amount}, ${b.available} available.`);
  if (!(await entry(q, { account, kind: "reserve", amount, key: `reserve:${jobId}`, jobId, now }))) throw new HttpError(409, "This job already holds a reservation.");
  await q.query("UPDATE credit_accounts SET reserved = reserved + $2, updated_at = $3 WHERE id = $1", [account, amount, now]);
}

/**
 * Settles a job's reservation exactly once: `spend` charges it, `release` gives it back.
 * Returns false when the job was already settled (by either outcome).
 */
export async function settle(q: Q, jobId: string, outcome: "spend" | "release", now = Date.now()): Promise<boolean> {
  const res = await q.query("SELECT account_id, amount FROM ledger_entries WHERE job_id = $1 AND kind = 'reserve'", [jobId]);
  if (!res[0]) return false;
  const account = String(res[0].account_id);
  const amount = num(res[0].amount);
  await readBalance(q, account, true);
  if (!(await entry(q, { account, kind: outcome, amount, key: `settle:${jobId}`, jobId, now }))) return false;
  if (outcome === "spend") await q.query("UPDATE credit_accounts SET balance = balance - $2, reserved = reserved - $2, updated_at = $3 WHERE id = $1", [account, amount, now]);
  else await q.query("UPDATE credit_accounts SET reserved = reserved - $2, updated_at = $3 WHERE id = $1", [account, amount, now]);
  return true;
}

export interface LedgerRow {
  id: number;
  accountId: string;
  kind: string;
  amount: number;
  jobId: string | null;
  ref: string | null;
  note: string | null;
  createdAt: number;
}

export async function ledgerFor(q: Q, account: string, limit = 50): Promise<LedgerRow[]> {
  const rows = await q.query("SELECT * FROM ledger_entries WHERE account_id = $1 ORDER BY id DESC LIMIT $2", [account, limit]);
  return rows.map((r) => ({
    id: num(r.id),
    accountId: String(r.account_id),
    kind: String(r.kind),
    amount: num(r.amount),
    jobId: (r.job_id as string) ?? null,
    ref: (r.ref as string) ?? null,
    note: (r.note as string) ?? null,
    createdAt: num(r.created_at),
  }));
}

/** Sum of an account's entries by kind (for the dashboard). */
export async function totalsFor(q: Q, account: string): Promise<Record<string, number>> {
  const rows = await q.query("SELECT kind, SUM(amount) AS total FROM ledger_entries WHERE account_id = $1 GROUP BY kind", [account]);
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.kind)] = num(r.total);
  return out;
}

/** Ledger self-check: balance and reserved recomputed from entries must equal the stored columns. */
export async function audit(q: Q): Promise<{ account: string; stored: [number, number]; derived: [number, number] }[]> {
  const rows = await q.query(`
    SELECT a.id, a.balance, a.reserved,
      COALESCE(SUM(CASE WHEN e.kind IN ('funding','allocation','grant') THEN e.amount WHEN e.kind IN ('spend','allocation_out','grant_out') THEN -e.amount ELSE 0 END), 0) AS derived_balance,
      COALESCE(SUM(CASE WHEN e.kind = 'reserve' THEN e.amount WHEN e.kind IN ('spend','release') THEN -e.amount ELSE 0 END), 0) AS derived_reserved
    FROM credit_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
    GROUP BY a.id, a.balance, a.reserved`);
  return rows
    .map((r) => ({ account: String(r.id), stored: [num(r.balance), num(r.reserved)] as [number, number], derived: [num(r.derived_balance), num(r.derived_reserved)] as [number, number] }))
    .filter((r) => r.stored[0] !== r.derived[0] || r.stored[1] !== r.derived[1]);
}
