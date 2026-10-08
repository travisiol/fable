/**
 * Server chain reads. Every read is cached 15–60 s in memory (per serverless instance) and nothing
 * loops in the background. Account layouts and PDA seeds come from the owner's pump.fun engine
 * (see src/config/solana.ts).
 */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ATA_PROGRAM,
  LAMPORTS_PER_SOL,
  PUMP_AMM_PROGRAM,
  PUMP_PROGRAM,
  SEEDS,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  VAULT_RENT_LAMPORTS,
  WSOL_MINT,
  rpcUrl,
} from "../config/solana.ts";

// ───────────────────────────── cache

const cache = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();

/** Memoise a read for `ttlMs`. A failed read is not kept. */
export function cached<T>(key: string, ttlMs: number, read: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as Promise<T>;
  const value = read();
  cache.set(key, { at: Date.now(), ttl: ttlMs, value });
  value.catch(() => cache.delete(key));
  return value;
}

export function clearChainCache() {
  cache.clear();
  connections.clear();
}

// ───────────────────────────── connection

const connections = new Map<string, Connection>();

/** One Connection per RPC URL. A 429 fails fast instead of retrying into a rate-limit storm. */
export function connection(): Connection {
  const url = rpcUrl();
  let conn = connections.get(url);
  if (!conn) {
    conn = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
    connections.set(url, conn);
  }
  return conn;
}

// ───────────────────────────── helpers

export function ataAddress(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], new PublicKey(ATA_PROGRAM))[0];
}

/** SPL token account layout: mint (0..32), owner (32..64), amount u64 LE at offset 64. */
export function parseTokenAmount(data: Uint8Array | Buffer | null | undefined): bigint {
  if (!data || data.length < 72) return BigInt(0);
  return Buffer.from(data).readBigUInt64LE(64);
}

export function parseTokenOwner(data: Uint8Array | Buffer | null | undefined): string | null {
  if (!data || data.length < 64) return null;
  return new PublicKey(Buffer.from(data).subarray(32, 64)).toBase58();
}

/** Mint layout: decimals at offset 44. */
export function parseMintDecimals(data: Uint8Array | Buffer | null | undefined): number {
  if (!data || data.length < 45) return 0;
  return Buffer.from(data)[44];
}

// ───────────────────────────── reads

export async function solBalance(pubkey: string): Promise<bigint> {
  return cached(`sol:${pubkey}`, 15_000, async () => BigInt(await connection().getBalance(new PublicKey(pubkey), "confirmed")));
}

export interface TokenBalance {
  amount: bigint;
  program: "token" | "token-2022" | null;
}

/** Balance of `owner` in `mint`: both ATAs (Token and Token-2022) read in one call, amount at offset 64. */
export async function tokenBalance(owner: string, mint: string): Promise<TokenBalance> {
  return cached(`tok:${owner}:${mint}`, 15_000, async () => {
    const o = new PublicKey(owner);
    const m = new PublicKey(mint);
    const ataClassic = ataAddress(o, m, new PublicKey(TOKEN_PROGRAM));
    const ata2022 = ataAddress(o, m, new PublicKey(TOKEN_2022_PROGRAM));
    const [classic, t22] = await connection().getMultipleAccountsInfo([ataClassic, ata2022], "confirmed");
    if (classic?.data) return { amount: parseTokenAmount(classic.data), program: "token" };
    if (t22?.data) return { amount: parseTokenAmount(t22.data), program: "token-2022" };
    return { amount: BigInt(0), program: null };
  });
}

export interface Supply {
  amount: bigint;
  decimals: number;
}

export async function tokenSupply(mint: string): Promise<Supply> {
  return cached(`supply:${mint}`, 60_000, async () => {
    const { value } = await connection().getTokenSupply(new PublicKey(mint), "confirmed");
    return { amount: BigInt(value.amount), decimals: value.decimals };
  });
}

/** Mint account: its token program (Token or Token-2022) and decimals. */
export async function mintInfo(mint: string): Promise<{ program: string; decimals: number }> {
  return cached(`mint:${mint}`, 60_000, async () => {
    const info = await connection().getAccountInfo(new PublicKey(mint), "confirmed");
    if (!info) throw new Error("Mint account not found.");
    return { program: info.owner.toBase58(), decimals: parseMintDecimals(info.data) };
  });
}

export interface Holder {
  account: string;
  owner: string | null;
  amount: bigint;
}

/** The `n` largest token accounts (RPC caps at 20) and their owners. */
export async function largestHolders(mint: string, n = 20): Promise<Holder[]> {
  return cached(`holders:${mint}:${n}`, 60_000, async () => {
    const conn = connection();
    const { value } = await conn.getTokenLargestAccounts(new PublicKey(mint), "confirmed");
    const top = value.slice(0, n);
    if (top.length === 0) return [];
    const infos = await conn.getMultipleAccountsInfo(top.map((a) => a.address), "confirmed");
    return top.map((a, i) => ({
      account: a.address.toBase58(),
      owner: parseTokenOwner(infos[i]?.data),
      amount: BigInt(a.amount),
    }));
  });
}

// ───────────────────────────── pump.fun

export interface PumpCoin {
  mint: string;
  name: string | null;
  symbol: string | null;
  creator: string | null;
  complete: boolean;
  marketCapUsd: number;
  priceUsd: number | null;
  image: string | null;
  source: "pump.fun" | "dexscreener";
}

const PUMP_API = () => process.env["PUMP_API_URL"] || "https://frontend-api-v3.pump.fun";
const DEX_API = () => process.env["DEXSCREENER_API_URL"] || "https://api.dexscreener.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const PUMP_PACE_MS = 1500;
let lastPumpCall = 0;

async function getJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const response = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function normalizePumpCoin(c: Record<string, unknown>): PumpCoin {
  return {
    mint: String(c.mint),
    name: (c.name as string) ?? null,
    symbol: (c.symbol as string) ?? null,
    creator: (c.creator as string) ?? null,
    complete: Boolean(c.complete),
    marketCapUsd: Number(c.usd_market_cap ?? c.market_cap ?? 0) || 0,
    priceUsd: null,
    image: (c.image_uri as string) || null,
    source: "pump.fun",
  };
}

export function normalizeDexPairs(mint: string, pairs: unknown): PumpCoin | null {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  type Pair = { liquidity?: { usd?: number }; priceUsd?: string; marketCap?: number; fdv?: number; baseToken?: { name?: string; symbol?: string }; info?: { imageUrl?: string } };
  const best = [...(pairs as Pair[])].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  return {
    mint,
    name: best.baseToken?.name ?? null,
    symbol: best.baseToken?.symbol ?? null,
    creator: null,
    complete: true,
    marketCapUsd: Number(best.marketCap ?? best.fdv ?? 0) || 0,
    priceUsd: Number(best.priceUsd ?? 0) || null,
    image: best.info?.imageUrl ?? null,
    source: "dexscreener",
  };
}

/** pump.fun's own JSON (paced: it answers 429 when called too fast), DexScreener as fallback. */
export async function pumpCoin(mint: string): Promise<PumpCoin | null> {
  return cached(`pump:${mint}`, 60_000, async () => {
    try {
      const wait = lastPumpCall + PUMP_PACE_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastPumpCall = Date.now();
      const coin = (await getJson(`${PUMP_API()}/coins/${mint}`)) as Record<string, unknown> | null;
      if (coin && typeof coin === "object" && coin.mint) return normalizePumpCoin(coin);
    } catch {
      // fall back to DexScreener
    }
    try {
      return normalizeDexPairs(mint, await getJson(`${DEX_API()}/token-pairs/v1/solana/${mint}`));
    } catch {
      return null;
    }
  });
}

export function curveCreatorVault(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.creatorVault), creator.toBuffer()], new PublicKey(PUMP_PROGRAM))[0];
}

export function ammCreatorVaultAta(creator: PublicKey): PublicKey {
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from(SEEDS.ammCreatorVault), creator.toBuffer()], new PublicKey(PUMP_AMM_PROGRAM));
  return ataAddress(vault, new PublicKey(WSOL_MINT), new PublicKey(TOKEN_PROGRAM));
}

export interface CreatorClaimable {
  curveLamports: bigint;
  ammLamports: bigint;
  totalLamports: bigint;
}

/** Creator fees not yet claimed: curve vault lamports − rent (890 880) + PumpSwap creator vault WSOL amount (offset 64). */
export async function creatorClaimable(creator: string): Promise<CreatorClaimable> {
  return cached(`fees:${creator}`, 30_000, async () => {
    const c = new PublicKey(creator);
    const [vault, ammAta] = await connection().getMultipleAccountsInfo([curveCreatorVault(c), ammCreatorVaultAta(c)], "confirmed");
    const lamports = BigInt(vault?.lamports ?? 0);
    const curveLamports = lamports > VAULT_RENT_LAMPORTS ? lamports - VAULT_RENT_LAMPORTS : BigInt(0);
    const ammLamports = parseTokenAmount(ammAta?.data);
    return { curveLamports, ammLamports, totalLamports: curveLamports + ammLamports };
  });
}

// ───────────────────────────── transactions

export type TxStatus = "confirmed" | "finalized" | "failed" | "pending";

/** Poll a signature until it is confirmed, fails, or `timeoutMs` passes (no websocket: serverless-safe). */
export async function confirmTx(sig: string, timeoutMs = 45_000, pollMs = 800): Promise<TxStatus> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = (await connection().getSignatureStatuses([sig]).catch(() => null))?.value?.[0];
    if (status?.err) return "failed";
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return status.confirmationStatus;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return "pending";
}

// ───────────────────────────── prices

/** SOL/USD spot from Coinbase, cached 60 s. `null` when unreachable (the tile shows a dash, never a made-up price). */
export async function solUsd(): Promise<number | null> {
  return cached("sol-usd", 60_000, async () => {
    try {
      const j = (await getJson("https://api.coinbase.com/v2/prices/SOL-USD/spot", 6000)) as { data?: { amount?: string } };
      return Number(j?.data?.amount) || null;
    } catch {
      return null;
    }
  });
}

export const lamportsToSol = (lamports: bigint) => Number(lamports) / LAMPORTS_PER_SOL;

// ───────────────────────────── holders (daily snapshot for the weekly allocation)

/** True for a program-derived owner (off the ed25519 curve): bonding curve, pool, vault. */
export function isProgramOwned(owner: string): boolean {
  try {
    return !PublicKey.isOnCurve(new PublicKey(owner).toBytes());
  } catch {
    return true;
  }
}

/**
 * Every token account of `mint` on Token (165-byte accounts) and Token-2022 (mint at offset 0),
 * summed per owner; program-owned owners (curve, pools) and `exclude` dropped. Needs an RPC that
 * allows getProgramAccounts (the public endpoints often refuse it: set SOLANA_RPC_URL).
 */
export async function snapshotHolders(mint: string, exclude: string[] = []): Promise<{ wallet: string; amount: bigint }[]> {
  const conn = connection();
  const m = new PublicKey(mint);
  const reads = await Promise.all([
    conn.getProgramAccounts(new PublicKey(TOKEN_PROGRAM), { commitment: "confirmed", dataSlice: { offset: 32, length: 40 }, filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: m.toBase58() } }] }),
    conn.getProgramAccounts(new PublicKey(TOKEN_2022_PROGRAM), { commitment: "confirmed", dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: m.toBase58() } }] }),
  ]);
  const byOwner = new Map<string, bigint>();
  for (const list of reads) {
    for (const { account } of list) {
      const d = Buffer.from(account.data);
      if (d.length < 40) continue;
      const owner = new PublicKey(d.subarray(0, 32)).toBase58();
      const amount = d.readBigUInt64LE(32);
      if (amount === BigInt(0) || exclude.includes(owner) || isProgramOwned(owner)) continue;
      byOwner.set(owner, (byOwner.get(owner) ?? BigInt(0)) + amount);
    }
  }
  return [...byOwner.entries()].map(([wallet, amount]) => ({ wallet, amount }));
}
