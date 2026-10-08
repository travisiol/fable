/**
 * Character coin launch on pump.fun, signed by the creator's own wallet (never a key we hold).
 *
 *  1. prepare: a launch row (character + mint pubkey, UNIQUE) is written BEFORE anything is signed;
 *     the server builds create_v2 (+ optional initial buy) with the user as payer and creator; the
 *     mint keypair is generated in the browser, which co-signs. A second prepare for the same
 *     character returns 409 while a launch is pending or live: no duplicate deployment on retries.
 *  2. submitted → confirm: success only after getSignatureStatuses says confirmed AND getTransaction
 *     shows the mint created by the pump program AND the mint account carries the name/ticker.
 *     A rejected signature marks the launch `rejected`; a failed transaction `failed`; a blockhash
 *     that expired without the transaction landing `expired` — each frees the character to retry.
 *  3. fee sharing (pump.fun native, see pump.ts): sweep_creator_fee + create_fee_sharing_config +
 *     update_fee_shares_v2 [holder pool 30 %, character budget 40 %, creator 30 %], signed by the
 *     creator (the coin's creator of record). Active only once the on-chain SharingConfig is read
 *     back with exactly those shareholders and the admin revoked.
 */
import { randomUUID } from "node:crypto";
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { ENV, FEE_SPLIT_BPS, MAX_INITIAL_BUY_LAMPORTS, TICKER_RE, TOKEN_LIMITS } from "../config/fable.ts";
import { SITE } from "../config/site.ts";
import { PUMP_PROGRAM, TOKEN_2022_PROGRAM, serverCluster } from "../config/solana.ts";
import { isBase58Address } from "../lib/format.ts";
import { connection } from "./chain.ts";
import { getCharacter } from "./characters.ts";
import type { Db, Q } from "./db.ts";
import { big, num } from "./db.ts";
import { HttpError } from "./errors.ts";
import {
  bondingCurvePda,
  buyIx,
  computeBudget,
  createAtaIdempotentIx,
  createFeeSharingConfigIx,
  createV2Ix,
  globalPda,
  parseBondingCurve,
  parseGlobal,
  parseSharingConfig,
  quoteInitialBuy,
  sharingConfigPda,
  sweepCreatorFeeIx,
  updateFeeSharesV2Ix,
} from "./pump.ts";

export type LaunchStatus = "prepared" | "submitted" | "confirmed" | "failed" | "rejected" | "expired";
export type SharingStatus = "none" | "prepared" | "submitted" | "active" | "failed";

export interface LaunchRow {
  id: string;
  characterId: string;
  owner: string;
  mint: string;
  cluster: string;
  status: LaunchStatus;
  name: string;
  ticker: string;
  description: string;
  links: { x?: string; telegram?: string; website?: string };
  uri: string;
  initialBuyLamports: bigint;
  lastValidBlockHeight: number | null;
  createSig: string | null;
  sharingStatus: SharingStatus;
  sharingSig: string | null;
  sharingLastValidBlockHeight: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  confirmedAt: number | null;
}

export function toLaunch(r: Record<string, unknown>): LaunchRow {
  let links = {};
  try {
    links = JSON.parse(String(r.links ?? "{}"));
  } catch {
    links = {};
  }
  const n = (v: unknown) => (v === null || v === undefined ? null : num(v));
  return {
    id: String(r.id),
    characterId: String(r.character_id),
    owner: String(r.owner),
    mint: String(r.mint),
    cluster: String(r.cluster),
    status: r.status as LaunchStatus,
    name: String(r.name),
    ticker: String(r.ticker),
    description: String(r.description ?? ""),
    links,
    uri: String(r.uri),
    initialBuyLamports: big(r.initial_buy_lamports),
    lastValidBlockHeight: n(r.last_valid_block_height),
    createSig: (r.create_sig as string) ?? null,
    sharingStatus: r.sharing_status as SharingStatus,
    sharingSig: (r.sharing_sig as string) ?? null,
    sharingLastValidBlockHeight: n(r.sharing_last_valid_block_height),
    error: (r.error as string) ?? null,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    confirmedAt: n(r.confirmed_at),
  };
}

export async function getLaunch(q: Q, id: string): Promise<LaunchRow | null> {
  const rows = await q.query("SELECT * FROM launches WHERE id = $1", [id]);
  return rows[0] ? toLaunch(rows[0]) : null;
}

export async function activeLaunchFor(q: Q, characterId: string): Promise<LaunchRow | null> {
  const rows = await q.query("SELECT * FROM launches WHERE character_id = $1 AND status IN ('prepared','submitted','confirmed') LIMIT 1", [characterId]);
  return rows[0] ? toLaunch(rows[0]) : null;
}

export async function launchesFor(q: Q, characterId: string): Promise<LaunchRow[]> {
  const rows = await q.query("SELECT * FROM launches WHERE character_id = $1 ORDER BY created_at DESC LIMIT 10", [characterId]);
  return rows.map(toLaunch);
}

// ───────────────────────────── availability

export interface Availability {
  ok: boolean;
  missing: string[];
  cluster: string;
}

export function launchAvailability(): Availability {
  const missing: string[] = [];
  if (!ENV.launchEnabled()) missing.push("FABLE_LAUNCH_ENABLED=1 (the owner turns launching on)");
  const pool = ENV.poolWallet();
  const budget = ENV.budgetWallet();
  if (!isBase58Address(pool)) missing.push("FABLE_POOL_WALLET (holder pool fee recipient)");
  if (!isBase58Address(budget)) missing.push("FABLE_BUDGET_WALLET (character budget fee recipient)");
  if (pool && budget && pool === budget) missing.push("FABLE_POOL_WALLET and FABLE_BUDGET_WALLET must differ (pump.fun refuses duplicate shareholders)");
  if (!process.env["NEXT_PUBLIC_SITE_URL"]?.trim()) missing.push("NEXT_PUBLIC_SITE_URL (public address that serves the token metadata)");
  return { ok: missing.length === 0, missing, cluster: serverCluster() };
}

export function expectedShareholders(creator: string): { address: string; bps: number }[] {
  return [
    { address: ENV.poolWallet()!, bps: FEE_SPLIT_BPS.holderPool },
    { address: ENV.budgetWallet()!, bps: FEE_SPLIT_BPS.characterBudget },
    { address: creator, bps: FEE_SPLIT_BPS.creator },
  ];
}

// ───────────────────────────── input

export interface LaunchInput {
  characterId?: unknown;
  mint?: unknown;
  ticker?: unknown;
  description?: unknown;
  x?: unknown;
  telegram?: unknown;
  website?: unknown;
  initialBuySol?: unknown;
}

const clip = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function cleanUrl(v: unknown, label: string, host?: RegExp): string | undefined {
  const s = clip(v, 200);
  if (!s) return undefined;
  let u: URL;
  try {
    u = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    throw new HttpError(400, `${label} is not a valid link.`);
  }
  if (u.protocol !== "https:") throw new HttpError(400, `${label} must start with https://`);
  if (host && !host.test(u.hostname)) throw new HttpError(400, `${label} must be a ${label} link.`);
  return u.toString();
}

export function validateLaunchInput(input: LaunchInput, characterName: string) {
  const ticker = clip(input.ticker, 16).replace(/^\$/, "").toUpperCase();
  if (!TICKER_RE.test(ticker)) throw new HttpError(400, "The ticker must be 2 to 10 letters or digits.");
  const name = characterName.slice(0, TOKEN_LIMITS.name);
  if (name.length < 2) throw new HttpError(400, "The character needs a name first.");
  const description = clip(input.description, TOKEN_LIMITS.description);
  if (description.length < 10) throw new HttpError(400, "Write a token description (at least 10 characters).");
  const links = {
    x: cleanUrl(input.x, "X", /(^|\.)(x|twitter)\.com$/),
    telegram: cleanUrl(input.telegram, "Telegram", /(^|\.)t\.me$/),
    website: cleanUrl(input.website, "Website"),
  };
  const solText = clip(input.initialBuySol, 20) || "0";
  if (!/^\d+(\.\d{1,9})?$/.test(solText)) throw new HttpError(400, "The initial purchase must be an amount of SOL, like 0.1.");
  const [w, f = ""] = solText.split(".");
  const initialBuyLamports = BigInt(w) * BigInt(1_000_000_000) + BigInt(f.padEnd(9, "0"));
  if (initialBuyLamports > MAX_INITIAL_BUY_LAMPORTS) throw new HttpError(400, "The initial purchase is capped at 5 SOL.");
  if (initialBuyLamports > BigInt(0) && initialBuyLamports < BigInt(1_000_000)) throw new HttpError(400, "An initial purchase must be at least 0.001 SOL, or 0.");
  return { ticker, name, description, links, initialBuyLamports };
}

export function metadataUri(launchId: string): string {
  return `${SITE.url.replace(/\/+$/, "")}/api/launch/${launchId}/metadata`;
}

// ───────────────────────────── chain access (injectable for tests)

export interface ChainPort {
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  blockHeight(): Promise<number>;
  account(address: string): Promise<{ owner: string; data: Buffer; lamports: number } | null>;
  signatureStatus(sig: string): Promise<{ err: unknown; confirmationStatus?: string | null } | null>;
  transaction(sig: string): Promise<{ err: unknown; accountKeys: string[]; logMessages: string[]; preBalances: number[]; postBalances: number[]; fee: number; slot: number; blockTime: number | null } | null>;
  signaturesFor(address: string, until: string | null): Promise<{ signature: string; err: unknown; slot: number }[]>;
}

export function rpcChain(): ChainPort {
  const conn = () => connection();
  return {
    latestBlockhash: () => conn().getLatestBlockhash("confirmed"),
    blockHeight: () => conn().getBlockHeight("confirmed"),
    async account(address) {
      const a = await conn().getAccountInfo(new PublicKey(address), "confirmed");
      return a ? { owner: a.owner.toBase58(), data: Buffer.from(a.data), lamports: a.lamports } : null;
    },
    async signatureStatus(sig) {
      const s = (await conn().getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
      return s ? { err: s.err, confirmationStatus: s.confirmationStatus ?? null } : null;
    },
    async transaction(sig) {
      const t = await conn().getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      if (!t) return null;
      const keys = t.transaction.message.getAccountKeys({ accountKeysFromLookups: t.meta?.loadedAddresses ?? undefined });
      return {
        err: t.meta?.err ?? null,
        accountKeys: keys.keySegments().flat().map((k) => k.toBase58()),
        logMessages: t.meta?.logMessages ?? [],
        preBalances: t.meta?.preBalances ?? [],
        postBalances: t.meta?.postBalances ?? [],
        fee: t.meta?.fee ?? 0,
        slot: t.slot,
        blockTime: t.blockTime ?? null,
      };
    },
    async signaturesFor(address, until) {
      const list = await conn().getSignaturesForAddress(new PublicKey(address), { limit: 50, until: until ?? undefined }, "confirmed");
      return list.map((s) => ({ signature: s.signature, err: s.err, slot: s.slot }));
    },
  };
}

// ───────────────────────────── 1. prepare

export interface Prepared {
  launch: LaunchRow;
  transaction: string;
  summary: {
    network: string;
    payer: string;
    mint: string;
    creatorOfRecord: string;
    instructions: string[];
    initialBuyLamports: string;
    expectedTokens: string;
    estimatedNetworkFeeLamports: string;
    estimatedRentLamports: string;
  };
}

/** Rent the program charges for a coin, measured on devnet + mainnet simulations (2026-10-06): ≈ 0.022 SOL. */
const CREATE_RENT_LAMPORTS = BigInt(22_000_000);

export async function prepareLaunch(db: Db, owner: string | null, input: LaunchInput, chain: ChainPort = rpcChain(), now = Date.now()): Promise<Prepared> {
  if (!owner) throw new HttpError(401, "Sign in with your wallet first.");
  const avail = launchAvailability();
  if (!avail.ok) throw new HttpError(503, "Launching is unavailable: deployment is not configured.");
  const characterId = clip(input.characterId, 64);
  const c = await getCharacter(db, characterId);
  if (!c || c.status === "discarded") throw new HttpError(404, "Character not found.");
  if (c.owner !== owner) throw new HttpError(403, "Only this character's creator can launch its coin.");
  if (c.status !== "saved" || !c.portraitMediaId) throw new HttpError(409, "Save the character before launching its coin.");
  if (owner === ENV.poolWallet() || owner === ENV.budgetWallet()) throw new HttpError(409, "This wallet is one of FABLE's fee wallets and cannot be a creator.");
  const mint = clip(input.mint, 64);
  if (!isBase58Address(mint)) throw new HttpError(400, "Missing mint address.");
  const v = validateLaunchInput(input, c.name);

  // duplicate protection: one active launch per character (also enforced by a partial unique index)
  const active = await activeLaunchFor(db, c.id);
  let reuse: string | null = null;
  if (active && active.status === "prepared" && active.mint === mint) reuse = active.id;
  else if (active) {
    if (active.status === "confirmed") throw new HttpError(409, "This character's coin is already launched.");
    if (active.status === "submitted") throw new HttpError(409, "A launch for this character is waiting for confirmation.");
    // prepared: still signable? If its coin exists on chain, it was sent without being reported.
    const curve = await chain.account(bondingCurvePda(new PublicKey(active.mint)).toBase58());
    if (curve) {
      await db.query("UPDATE launches SET status = 'submitted', updated_at = $2 WHERE id = $1 AND status = 'prepared'", [active.id, now]);
      throw new HttpError(409, "A launch for this character is waiting for confirmation.");
    }
    const height = await chain.blockHeight();
    if (active.mint !== mint && active.lastValidBlockHeight !== null && height <= active.lastValidBlockHeight) {
      throw new HttpError(409, "A launch transaction for this character can still be signed. Wait about a minute, then try again.");
    }
    await db.query("UPDATE launches SET status = 'expired', error = 'Replaced by a new attempt before it was sent.', updated_at = $2 WHERE id = $1 AND status = 'prepared'", [active.id, now]);
  }
  if (!reuse && (await db.query("SELECT 1 FROM launches WHERE mint = $1", [mint])).length) throw new HttpError(409, "This mint address was already used. Start again.");

  const id = reuse ?? `l_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const uri = metadataUri(id);
  if (Buffer.byteLength(uri) > TOKEN_LIMITS.uri) throw new HttpError(500, "The metadata address is too long for pump.fun.");
  const user = new PublicKey(owner);
  const mintKey = new PublicKey(mint);
  const ixs = [...computeBudget(v.initialBuyLamports > BigInt(0) ? 280_000 : 160_000, 200_000), createV2Ix({ mint: mintKey, user, creator: user, name: v.name, symbol: v.ticker, uri })];
  const names = ["Set compute budget", "Create the coin on pump.fun (create_v2)"];
  let expectedTokens = BigInt(0);
  if (v.initialBuyLamports > BigInt(0)) {
    const g = await chain.account(globalPda().toBase58());
    if (!g) throw new HttpError(503, "pump.fun is not available on this network.");
    const global = parseGlobal(g.data);
    const q = quoteInitialBuy(global, v.initialBuyLamports);
    expectedTokens = q.tokens;
    const pick = (list: string[]) => new PublicKey(list[Math.floor(Math.random() * list.length)]);
    ixs.push(
      createAtaIdempotentIx(user, user, mintKey, new PublicKey(TOKEN_2022_PROGRAM)),
      buyIx({ mint: mintKey, user, creator: user, feeRecipient: pick(global.feeRecipients), buybackFeeRecipient: pick(global.buybackFeeRecipients), tokens: q.tokens, maxSolCost: q.maxSolCost }),
    );
    names.push("Open your token account", `Initial purchase: up to ${q.maxSolCost} lamports for ${q.tokens} base units`);
  }
  const { blockhash, lastValidBlockHeight } = await chain.latestBlockhash();
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  let wire: Uint8Array;
  try {
    wire = tx.serialize();
  } catch {
    throw new HttpError(400, "This launch does not fit in one transaction. Shorten the name or skip the initial purchase.");
  }
  if (wire.length > 1232) throw new HttpError(400, "This launch does not fit in one transaction. Shorten the name or skip the initial purchase.");

  try {
    if (reuse) {
      await db.query("UPDATE launches SET name = $2, ticker = $3, description = $4, links = $5, initial_buy_lamports = $6, last_valid_block_height = $7, updated_at = $8 WHERE id = $1 AND status = 'prepared'", [id, v.name, v.ticker, v.description, JSON.stringify(v.links), v.initialBuyLamports, lastValidBlockHeight, now]);
    } else await db.query(
      `INSERT INTO launches (id, character_id, owner, mint, cluster, status, name, ticker, description, links, uri, initial_buy_lamports, last_valid_block_height, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'prepared',$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
      [id, c.id, owner, mint, serverCluster(), v.name, v.ticker, v.description, JSON.stringify(v.links), uri, v.initialBuyLamports, lastValidBlockHeight, now],
    );
  } catch {
    throw new HttpError(409, "Another launch for this character started at the same time.");
  }
  return {
    launch: (await getLaunch(db, id))!,
    transaction: Buffer.from(wire).toString("base64"),
    summary: {
      network: serverCluster() === "devnet" ? "Solana devnet" : "Solana mainnet",
      payer: owner,
      mint,
      creatorOfRecord: owner,
      instructions: names,
      initialBuyLamports: v.initialBuyLamports.toString(),
      expectedTokens: expectedTokens.toString(),
      estimatedNetworkFeeLamports: String(5000 * 2 + Math.ceil((200_000 * (v.initialBuyLamports > BigInt(0) ? 280_000 : 160_000)) / 1_000_000)),
      estimatedRentLamports: CREATE_RENT_LAMPORTS.toString(),
    },
  };
}

// ───────────────────────────── 2. submitted / rejected / confirm

export async function owned(db: Db, owner: string | null, id: string): Promise<LaunchRow> {
  if (!owner) throw new HttpError(401, "Sign in with your wallet first.");
  const l = await getLaunch(db, id);
  if (!l) throw new HttpError(404, "Launch not found.");
  if (l.owner !== owner) throw new HttpError(403, "This is not your launch.");
  return l;
}

const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export async function markSubmitted(db: Db, owner: string | null, id: string, signature: unknown, now = Date.now()): Promise<LaunchRow> {
  const l = await owned(db, owner, id);
  const sig = String(signature ?? "");
  if (!SIG_RE.test(sig)) throw new HttpError(400, "Invalid transaction signature.");
  if (l.status === "submitted" && l.createSig === sig) return l;
  if (l.status !== "prepared") throw new HttpError(409, `This launch is already ${l.status}.`);
  await db.query("UPDATE launches SET status = 'submitted', create_sig = $2, error = NULL, updated_at = $3 WHERE id = $1 AND status = 'prepared'", [id, sig, now]);
  return (await getLaunch(db, id))!;
}

/** The wallet refused to sign (or the user closed it): nothing was sent, the character can retry. */
export async function markRejected(db: Db, owner: string | null, id: string, reason: unknown, now = Date.now()): Promise<LaunchRow> {
  const l = await owned(db, owner, id);
  if (l.status !== "prepared") return l;
  await db.query("UPDATE launches SET status = 'rejected', error = $2, updated_at = $3 WHERE id = $1 AND status = 'prepared'", [id, clip(reason, 200) || "The signature request was declined in the wallet.", now]);
  return (await getLaunch(db, id))!;
}

function mintCarries(data: Buffer, name: string, ticker: string): boolean {
  return data.includes(Buffer.from(name, "utf8")) && data.includes(Buffer.from(ticker, "utf8"));
}

/** Advances a submitted launch. Success only after confirmation + the mint and its metadata are seen on chain. */
export async function confirmLaunch(db: Db, owner: string | null, id: string, chain: ChainPort = rpcChain(), now = Date.now()): Promise<LaunchRow> {
  const l = await owned(db, owner, id);
  if (l.status === "prepared") {
    // a client that lost its signature: the coin may exist anyway
    const curve = await chain.account(bondingCurvePda(new PublicKey(l.mint)).toBase58());
    if (!curve) {
      const height = await chain.blockHeight();
      if (l.lastValidBlockHeight !== null && height > l.lastValidBlockHeight) {
        await db.query("UPDATE launches SET status = 'expired', error = 'The transaction was never sent before it expired.', updated_at = $2 WHERE id = $1 AND status = 'prepared'", [id, now]);
      }
      return (await getLaunch(db, id))!;
    }
  }
  if (l.status !== "submitted" && l.status !== "prepared") return l;
  if (l.createSig) {
    const st = await chain.signatureStatus(l.createSig);
    if (st?.err) {
      await db.query("UPDATE launches SET status = 'failed', error = $2, updated_at = $3 WHERE id = $1 AND status = 'submitted'", [id, `The transaction failed on chain: ${JSON.stringify(st.err).slice(0, 160)}`, now]);
      return (await getLaunch(db, id))!;
    }
    if (!st || (st.confirmationStatus !== "confirmed" && st.confirmationStatus !== "finalized")) {
      if (!st) {
        const height = await chain.blockHeight();
        if (l.lastValidBlockHeight !== null && height > l.lastValidBlockHeight) {
          const curve = await chain.account(bondingCurvePda(new PublicKey(l.mint)).toBase58());
          if (!curve) {
            await db.query("UPDATE launches SET status = 'expired', error = 'The transaction did not land before its blockhash expired. Nothing was created.', updated_at = $2 WHERE id = $1 AND status = 'submitted'", [id, now]);
            return (await getLaunch(db, id))!;
          }
        }
      }
      return l;
    }
    const tx = await chain.transaction(l.createSig);
    if (!tx) return l;
    if (tx.err) {
      await db.query("UPDATE launches SET status = 'failed', error = 'The transaction failed on chain.', updated_at = $2 WHERE id = $1", [id, now]);
      return (await getLaunch(db, id))!;
    }
    if (!tx.accountKeys.includes(l.mint) || !tx.accountKeys.includes(PUMP_PROGRAM)) {
      await db.query("UPDATE launches SET status = 'failed', error = 'That signature is not this launch.', updated_at = $2 WHERE id = $1", [id, now]);
      return (await getLaunch(db, id))!;
    }
  }
  const [mintAcc, curveAcc] = [await chain.account(l.mint), await chain.account(bondingCurvePda(new PublicKey(l.mint)).toBase58())];
  if (!mintAcc || mintAcc.owner !== TOKEN_2022_PROGRAM || !curveAcc) return l;
  if (!mintCarries(mintAcc.data, l.name, l.ticker)) {
    await db.query("UPDATE launches SET status = 'failed', error = 'The mint on chain does not carry this name and ticker.', updated_at = $2 WHERE id = $1", [id, now]);
    return (await getLaunch(db, id))!;
  }
  const curve = parseBondingCurve(curveAcc.data);
  if (curve.creator !== l.owner && curve.creator !== sharingConfigPda(new PublicKey(l.mint)).toBase58()) {
    await db.query("UPDATE launches SET status = 'failed', error = 'The coin on chain has another creator.', updated_at = $2 WHERE id = $1", [id, now]);
    return (await getLaunch(db, id))!;
  }
  await db.query("UPDATE launches SET status = 'confirmed', confirmed_at = $2, updated_at = $2, error = NULL WHERE id = $1 AND status IN ('prepared','submitted')", [id, now]);
  return (await getLaunch(db, id))!;
}

// ───────────────────────────── 3. fee sharing

export async function prepareSharing(db: Db, owner: string | null, id: string, chain: ChainPort = rpcChain(), now = Date.now()): Promise<{ launch: LaunchRow; transaction: string; shareholders: { address: string; bps: number }[] }> {
  const l = await owned(db, owner, id);
  if (l.status !== "confirmed") throw new HttpError(409, "The coin must be confirmed first.");
  if (l.sharingStatus === "active") throw new HttpError(409, "The fee split is already active.");
  if (l.sharingStatus === "submitted") throw new HttpError(409, "The fee split transaction is waiting for confirmation.");
  if (!launchAvailability().ok) throw new HttpError(503, "Fee sharing is unavailable: deployment is not configured.");
  const mint = new PublicKey(l.mint);
  const user = new PublicKey(l.owner);
  const holders = expectedShareholders(l.owner);
  const ixs = [
    ...computeBudget(300_000, 100_000),
    sweepCreatorFeeIx({ payer: user, mint, creator: user }),
    createFeeSharingConfigIx({ payer: user, mint }),
    updateFeeSharesV2Ix({ authority: user, mint, current: [user], shareholders: holders.map((h) => ({ address: new PublicKey(h.address), bps: h.bps })) }),
  ];
  const { blockhash, lastValidBlockHeight } = await chain.latestBlockhash();
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  const wire = tx.serialize();
  if (wire.length > 1232) throw new HttpError(500, "The fee split transaction is too large.");
  await db.query("UPDATE launches SET sharing_status = 'prepared', sharing_last_valid_block_height = $2, updated_at = $3 WHERE id = $1", [id, lastValidBlockHeight, now]);
  return { launch: (await getLaunch(db, id))!, transaction: Buffer.from(wire).toString("base64"), shareholders: holders };
}

export async function markSharingSubmitted(db: Db, owner: string | null, id: string, signature: unknown, now = Date.now()): Promise<LaunchRow> {
  const l = await owned(db, owner, id);
  const sig = String(signature ?? "");
  if (!SIG_RE.test(sig)) throw new HttpError(400, "Invalid transaction signature.");
  if (l.sharingStatus === "active") return l;
  await db.query("UPDATE launches SET sharing_status = 'submitted', sharing_sig = $2, updated_at = $3 WHERE id = $1", [id, sig, now]);
  return (await getLaunch(db, id))!;
}

export async function markSharingRejected(db: Db, owner: string | null, id: string, now = Date.now()): Promise<LaunchRow> {
  const l = await owned(db, owner, id);
  if (l.sharingStatus === "prepared") await db.query("UPDATE launches SET sharing_status = 'none', updated_at = $2 WHERE id = $1", [id, now]);
  return (await getLaunch(db, id))!;
}

/** Reads the SharingConfig back: active only with exactly the expected shareholders and the admin revoked. */
export async function verifySharing(l: LaunchRow, chain: ChainPort): Promise<"active" | "missing" | "mismatch"> {
  const acc = await chain.account(sharingConfigPda(new PublicKey(l.mint)).toBase58());
  if (!acc) return "missing";
  let sc;
  try {
    sc = parseSharingConfig(acc.data);
  } catch {
    return "mismatch";
  }
  const want = expectedShareholders(l.owner);
  const same = sc.shareholders.length === want.length && want.every((w) => sc.shareholders.some((s) => s.address === w.address && s.bps === w.bps));
  return sc.active && sc.adminRevoked && sc.mint === l.mint && same ? "active" : "mismatch";
}

export async function confirmSharing(db: Db, owner: string | null, id: string, chain: ChainPort = rpcChain(), now = Date.now()): Promise<LaunchRow> {
  const l = await owned(db, owner, id);
  if (l.sharingStatus === "active") return l;
  if (l.sharingSig) {
    const st = await chain.signatureStatus(l.sharingSig);
    if (st?.err) {
      await db.query("UPDATE launches SET sharing_status = 'failed', error = $2, updated_at = $3 WHERE id = $1", [id, `The fee split transaction failed: ${JSON.stringify(st.err).slice(0, 160)}`, now]);
      return (await getLaunch(db, id))!;
    }
  }
  const v = await verifySharing(l, chain);
  if (v === "active") {
    await db.query("UPDATE launches SET sharing_status = 'active', error = NULL, updated_at = $2 WHERE id = $1", [id, now]);
  } else if (v === "mismatch") {
    await db.query("UPDATE launches SET sharing_status = 'failed', error = 'The fee split on chain does not match the FABLE allocation.', updated_at = $2 WHERE id = $1", [id, now]);
  } else if (l.sharingStatus === "submitted" && l.sharingLastValidBlockHeight !== null && (await chain.blockHeight()) > l.sharingLastValidBlockHeight && !(l.sharingSig && (await chain.signatureStatus(l.sharingSig)))) {
    await db.query("UPDATE launches SET sharing_status = 'none', error = 'The fee split transaction expired before it landed. Sign it again.', updated_at = $2 WHERE id = $1", [id, now]);
  }
  return (await getLaunch(db, id))!;
}

// ───────────────────────────── views

export interface LaunchView {
  id: string;
  status: LaunchStatus;
  mint: string;
  ticker: string;
  name: string;
  description: string;
  links: LaunchRow["links"];
  cluster: string;
  createSig: string | null;
  sharingStatus: SharingStatus;
  sharingSig: string | null;
  error: string | null;
  confirmedAt: number | null;
  initialBuyLamports: string;
}

export function launchView(l: LaunchRow): LaunchView {
  return {
    id: l.id,
    status: l.status,
    mint: l.mint,
    ticker: l.ticker,
    name: l.name,
    description: l.description,
    links: l.links,
    cluster: l.cluster,
    createSig: l.createSig,
    sharingStatus: l.sharingStatus,
    sharingSig: l.sharingSig,
    error: l.error,
    confirmedAt: l.confirmedAt,
    initialBuyLamports: l.initialBuyLamports.toString(),
  };
}
