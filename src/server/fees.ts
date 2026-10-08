/**
 * Fee receipts. For every launched coin whose pump.fun fee split is active:
 *  crank():  when fees wait (on the curve or in the sharing config's creator vault), the operator
 *            sends sweep_creator_fee + distribute_creator_fees_v2 (permissionless; it pays only the
 *            network fee). pump.fun then pays each shareholder its bps directly.
 *  scan():   reads the sharing config's transactions, and for each confirmed one records what the
 *            holder-pool wallet, the budget wallet and the creator actually received (balance deltas
 *            from the transaction meta), once per signature (pool.ts ingestReceipt). Anyone's
 *            distribution counts, not only ours.
 * Nothing loops: `/api/cron/fees` (cron) and an after() on page views call syncFees().
 */
import { PublicKey } from "@solana/web3.js";
import { ENV } from "../config/fable.ts";
import { VAULT_RENT_LAMPORTS } from "../config/solana.ts";
import type { Db } from "./db.ts";
import type { ChainPort, LaunchRow } from "./launch.ts";
import { expectedShareholders, rpcChain, toLaunch } from "./launch.ts";
import { operatorKeypair, sendAsOperator } from "./operator.ts";
import { ingestReceipt } from "./pool.ts";
import { bondingCurvePda, creatorVaultPda, distributeCreatorFeesV2Ix, parseBondingCurve, parseSharingConfig, sharingConfigPda, sweepCreatorFeeIx } from "./pump.ts";

/** Below this, a crank would cost more in network fees than it moves. */
export const MIN_DISTRIBUTE_LAMPORTS = BigInt(5_000_000);

export async function activeLaunches(db: Db): Promise<LaunchRow[]> {
  return (await db.query("SELECT * FROM launches WHERE status = 'confirmed' AND sharing_status = 'active' ORDER BY confirmed_at ASC LIMIT 100")).map(toLaunch);
}

export interface Delta {
  pool: bigint;
  budget: bigint;
  creator: bigint;
}

/** What each shareholder received in a transaction (fee paid back if it was also the fee payer). */
export function deltas(tx: { accountKeys: string[]; preBalances: number[]; postBalances: number[]; fee: number }, wallets: { pool: string; budget: string; creator: string }): Delta {
  const d = (address: string) => {
    const i = tx.accountKeys.indexOf(address);
    if (i < 0) return BigInt(0);
    const v = BigInt(tx.postBalances[i] ?? 0) - BigInt(tx.preBalances[i] ?? 0) + (i === 0 ? BigInt(tx.fee) : BigInt(0));
    return v > BigInt(0) ? v : BigInt(0);
  };
  return { pool: d(wallets.pool), budget: d(wallets.budget), creator: d(wallets.creator) };
}

export async function scanLaunch(db: Db, l: LaunchRow, chain: ChainPort): Promise<number> {
  const pool = ENV.poolWallet();
  const budget = ENV.budgetWallet();
  if (!pool || !budget) return 0;
  const sc = sharingConfigPda(new PublicKey(l.mint)).toBase58();
  const cursorKey = `fees_cursor:${l.mint}`;
  const cursor = ((await db.query("SELECT value FROM kv WHERE key = $1", [cursorKey]))[0]?.value as string) ?? null;
  const sigs = await chain.signaturesFor(sc, cursor);
  let added = 0;
  for (const s of [...sigs].reverse()) {
    if (s.err) continue;
    const tx = await chain.transaction(s.signature);
    if (!tx || tx.err) continue;
    const d = deltas(tx, { pool, budget, creator: l.owner });
    const total = d.pool + d.budget + d.creator;
    if (total <= BigInt(0) || (d.pool === BigInt(0) && d.budget === BigInt(0))) continue;
    const r = await ingestReceipt(db, {
      signature: s.signature,
      mint: l.mint,
      characterId: l.characterId,
      source: "distribution",
      totalLamports: total,
      poolLamports: d.pool,
      budgetLamports: d.budget,
      creatorLamports: d.creator,
      slot: tx.slot,
      blockTime: tx.blockTime,
    });
    if (r.inserted) added++;
  }
  if (sigs[0]) await db.query("INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [cursorKey, sigs[0].signature]);
  return added;
}

/** Sends a sweep + distribute for one coin when enough fees wait. */
export async function crankLaunch(l: LaunchRow, chain: ChainPort): Promise<{ sent?: string; skipped?: string; error?: string }> {
  const op = operatorKeypair();
  if (!op) return { skipped: "no operator key" };
  const mint = new PublicKey(l.mint);
  const sc = sharingConfigPda(mint);
  const [curveAcc, vaultAcc, scAcc] = [await chain.account(bondingCurvePda(mint).toBase58()), await chain.account(creatorVaultPda(sc).toBase58()), await chain.account(sc.toBase58())];
  if (!curveAcc || !scAcc) return { skipped: "coin or sharing config not found" };
  const curve = parseBondingCurve(curveAcc.data);
  const inVault = BigInt(vaultAcc?.lamports ?? 0) > VAULT_RENT_LAMPORTS ? BigInt(vaultAcc!.lamports) - VAULT_RENT_LAMPORTS : BigInt(0);
  const waiting = curve.creatorFeeWaiting + inVault;
  if (waiting < MIN_DISTRIBUTE_LAMPORTS) return { skipped: `only ${waiting} lamports waiting` };
  const config = parseSharingConfig(scAcc.data);
  const want = expectedShareholders(l.owner).map((h) => h.address);
  if (config.shareholders.map((s) => s.address).sort().join() !== [...want].sort().join()) return { skipped: "shareholders differ from FABLE's" };
  const r = await sendAsOperator([
    sweepCreatorFeeIx({ payer: op.publicKey, mint, creator: sc }),
    distributeCreatorFeesV2Ix({ payer: op.publicKey, mint, shareholders: config.shareholders.map((s) => new PublicKey(s.address)) }),
  ]);
  return "sig" in r ? { sent: r.sig } : { error: r.error };
}

export async function syncFees(db: Db, chain: ChainPort = rpcChain(), opts: { crank?: boolean } = {}): Promise<{ coins: number; receipts: number; cranks: string[] }> {
  const lock = Number(((await db.query("SELECT value FROM kv WHERE key = 'fees_lock'"))[0]?.value as string) ?? 0);
  if (Date.now() - lock < 90_000) return { coins: 0, receipts: 0, cranks: ["skipped: a sync is running"] };
  await db.query("INSERT INTO kv (key, value) VALUES ('fees_lock', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [String(Date.now())]);
  const out = { coins: 0, receipts: 0, cranks: [] as string[] };
  try {
    for (const l of await activeLaunches(db)) {
      out.coins++;
      try {
        if (opts.crank !== false) {
          const c = await crankLaunch(l, chain);
          if (c.sent) out.cranks.push(`${l.ticker}: ${c.sent}`);
          else if (c.error) out.cranks.push(`${l.ticker}: ${c.error}`);
        }
        out.receipts += await scanLaunch(db, l, chain);
      } catch {
        // RPC refused this coin; its cursor is unchanged and the next sync retries
      }
    }
    await db.query("INSERT INTO kv (key, value) VALUES ('fees_last', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [String(Date.now())]);
  } finally {
    await db.query("UPDATE kv SET value = '0' WHERE key = 'fees_lock'");
  }
  return out;
}

/** Owner bootstrap: a confirmed SOL transfer into the holder-pool wallet becomes a pool receipt (once). */
export async function ingestDeposit(db: Db, signature: string, chain: ChainPort = rpcChain()): Promise<{ inserted: boolean; lamports: string }> {
  const pool = ENV.poolWallet();
  if (!pool) throw new Error("FABLE_POOL_WALLET is not set.");
  const st = await chain.signatureStatus(signature);
  if (!st || st.err || (st.confirmationStatus !== "confirmed" && st.confirmationStatus !== "finalized")) throw new Error("That transaction is not confirmed.");
  const tx = await chain.transaction(signature);
  if (!tx || tx.err) throw new Error("That transaction is not readable or failed.");
  const d = deltas(tx, { pool, budget: "-", creator: "-" });
  if (d.pool <= BigInt(0)) throw new Error("That transaction did not pay the holder-pool wallet.");
  const r = await ingestReceipt(db, { signature, mint: "SOL", characterId: null, source: "deposit", totalLamports: d.pool, poolLamports: d.pool, budgetLamports: BigInt(0), creatorLamports: BigInt(0), slot: tx.slot, blockTime: tx.blockTime });
  return { inserted: r.inserted, lamports: d.pool.toString() };
}
