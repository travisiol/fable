/**
 * pump.fun instructions and account layouts FABLE uses. Verified 2026-10-08 against pump.fun's
 * official public docs and IDLs, https://github.com/pump-fun/pump-public-docs :
 *   docs/instructions/COIN_CREATION.md        create_v2: 16 accounts; name ≤ 32, symbol ≤ 13, uri ≤ 200;
 *                                             trailing OptionBool / OptionU64 args may be omitted
 *   docs/instructions/CREATOR_FEE_SHARING.md  create_fee_sharing_config → update_fee_shares_v2 (≤ 10
 *                                             shareholders, Σ bps = 10 000, once: admin revoked after) →
 *                                             distribute_creator_fees_v2 (permissionless)
 *   docs/instructions/SWEEP_FEES.md           creator fees from v3 trades wait on the curve until
 *                                             sweep_creator_fee; distribute and the creator change
 *                                             refuse to run while a fee is waiting (6095)
 *   idl/pump.json, idl/pump_fees.json          discriminators, account order, BondingCurve / Global /
 *                                             SharingConfig layouts
 * The legacy `buy` (initial purchase) uses the 18-account order proven by simulation on mainnet and
 * devnet on 2026-10-06 (GitHub/trench REPORT-DEVNET.md); pump.fun docs keep `buy` working unchanged.
 */
import { ComputeBudgetProgram, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { ATA_PROGRAM, PUMP_AMM_PROGRAM, PUMP_FEE_PROGRAM, PUMP_PROGRAM, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WSOL_MINT } from "../config/solana.ts";

export const PUMP_MAYHEM_PROGRAM = "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e";

const PUMP = new PublicKey(PUMP_PROGRAM);
const FEES = new PublicKey(PUMP_FEE_PROGRAM);
const AMM = new PublicKey(PUMP_AMM_PROGRAM);
const MAYHEM = new PublicKey(PUMP_MAYHEM_PROGRAM);
const T22 = new PublicKey(TOKEN_2022_PROGRAM);
const TOKEN = new PublicKey(TOKEN_PROGRAM);
const ATA = new PublicKey(ATA_PROGRAM);
const SYS = new PublicKey(SYSTEM_PROGRAM);
const WSOL = new PublicKey(WSOL_MINT);

const DISC = {
  createV2: [214, 144, 76, 236, 95, 139, 49, 180],
  buy: [102, 6, 61, 18, 1, 218, 235, 234],
  sweepCreatorFee: [32, 246, 191, 52, 8, 201, 73, 186],
  distributeCreatorFeesV2: [255, 203, 19, 79, 244, 68, 8, 159],
  createFeeSharingConfig: [195, 78, 86, 76, 111, 52, 251, 213],
  updateFeeSharesV2: [111, 251, 49, 6, 78, 78, 106, 18],
} as const;
export const BONDING_CURVE_DISC = [23, 183, 248, 55, 96, 216, 172, 96];

const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });
const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const str = (s: string) => {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([u32(b.length), b]);
};

// ───────────────────────────── PDAs

export const globalPda = () => pda([Buffer.from("global")], PUMP);
export const mintAuthorityPda = () => pda([Buffer.from("mint-authority")], PUMP);
export const pumpEventAuthority = () => pda([Buffer.from("__event_authority")], PUMP);
export const feesEventAuthority = () => pda([Buffer.from("__event_authority")], FEES);
export const ammEventAuthority = () => pda([Buffer.from("__event_authority")], AMM);
export const bondingCurvePda = (mint: PublicKey) => pda([Buffer.from("bonding-curve"), mint.toBuffer()], PUMP);
export const bondingCurveV2Pda = (mint: PublicKey) => pda([Buffer.from("bonding-curve-v2"), mint.toBuffer()], PUMP);
export const creatorVaultPda = (creator: PublicKey) => pda([Buffer.from("creator-vault"), creator.toBuffer()], PUMP);
export const ammCreatorVaultPda = (creator: PublicKey) => pda([Buffer.from("creator_vault"), creator.toBuffer()], AMM);
export const sharingConfigPda = (mint: PublicKey) => pda([Buffer.from("sharing-config"), mint.toBuffer()], FEES);
export const globalVolumePda = () => pda([Buffer.from("global_volume_accumulator")], PUMP);
export const userVolumePda = (user: PublicKey) => pda([Buffer.from("user_volume_accumulator"), user.toBuffer()], PUMP);
export const feeConfigPda = () => pda([Buffer.from("fee_config"), PUMP.toBuffer()], FEES);
export const mayhemGlobalParams = () => pda([Buffer.from("global-params")], MAYHEM);
export const mayhemSolVault = () => pda([Buffer.from("sol-vault")], MAYHEM);
export const mayhemState = (mint: PublicKey) => pda([Buffer.from("mayhem-state"), mint.toBuffer()], MAYHEM);
export const ata = (owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey) => pda([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA);

// ───────────────────────────── instructions

/** create_v2 with a SOL quote, no mayhem mode; the optional trailing args are omitted (= false / 0). */
export function createV2Ix(p: { mint: PublicKey; user: PublicKey; creator: PublicKey; name: string; symbol: string; uri: string }): TransactionInstruction {
  const curve = bondingCurvePda(p.mint);
  const solVault = mayhemSolVault();
  return new TransactionInstruction({
    programId: PUMP,
    keys: [
      meta(p.mint, true, true),
      meta(mintAuthorityPda(), false, false),
      meta(curve, false, true),
      meta(ata(curve, p.mint, T22), false, true),
      meta(globalPda(), false, false),
      meta(p.user, true, true),
      meta(SYS, false, false),
      meta(T22, false, false),
      meta(ATA, false, false),
      meta(MAYHEM, false, true),
      meta(mayhemGlobalParams(), false, false),
      meta(solVault, false, true),
      meta(mayhemState(p.mint), false, true),
      meta(ata(solVault, p.mint, T22), false, true),
      meta(pumpEventAuthority(), false, false),
      meta(PUMP, false, false),
    ],
    data: Buffer.concat([Buffer.from(DISC.createV2), str(p.name), str(p.symbol), str(p.uri), p.creator.toBuffer(), Buffer.from([0])]),
  });
}

/** Associated token account, created idempotently (ATA program instruction 1). */
export function createAtaIdempotentIx(payer: PublicKey, owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ATA,
    keys: [meta(payer, true, true), meta(ata(owner, mint, tokenProgram), false, true), meta(owner, false, false), meta(mint, false, false), meta(SYS, false, false), meta(tokenProgram, false, false)],
    data: Buffer.from([1]),
  });
}

/** Legacy `buy` (fees paid in the trade). `feeRecipient` from Global list 1, `buybackFeeRecipient` from list 2. */
export function buyIx(p: { mint: PublicKey; user: PublicKey; creator: PublicKey; feeRecipient: PublicKey; buybackFeeRecipient: PublicKey; tokens: bigint; maxSolCost: bigint }): TransactionInstruction {
  const curve = bondingCurvePda(p.mint);
  return new TransactionInstruction({
    programId: PUMP,
    keys: [
      meta(globalPda(), false, false),
      meta(p.feeRecipient, false, true),
      meta(p.mint, false, false),
      meta(curve, false, true),
      meta(ata(curve, p.mint, T22), false, true),
      meta(ata(p.user, p.mint, T22), false, true),
      meta(p.user, true, true),
      meta(SYS, false, false),
      meta(T22, false, false),
      meta(creatorVaultPda(p.creator), false, true),
      meta(pumpEventAuthority(), false, false),
      meta(PUMP, false, false),
      meta(globalVolumePda(), false, true),
      meta(userVolumePda(p.user), false, true),
      meta(feeConfigPda(), false, false),
      meta(FEES, false, false),
      meta(bondingCurveV2Pda(p.mint), false, false),
      meta(p.buybackFeeRecipient, false, true),
    ],
    data: Buffer.concat([Buffer.from(DISC.buy), u64(p.tokens), u64(p.maxSolCost), Buffer.from([1])]),
  });
}

/** Pays the curve's waiting creator fee into the creator vault of `creator` (= bonding_curve.creator). Permissionless. */
export function sweepCreatorFeeIx(p: { payer: PublicKey; mint: PublicKey; creator: PublicKey }): TransactionInstruction {
  const curve = bondingCurvePda(p.mint);
  const vault = creatorVaultPda(p.creator);
  return new TransactionInstruction({
    programId: PUMP,
    keys: [
      meta(p.payer, true, true),
      meta(globalPda(), false, false),
      meta(p.mint, false, false),
      meta(WSOL, false, false),
      meta(TOKEN, false, false),
      meta(ATA, false, false),
      meta(SYS, false, false),
      meta(curve, false, true),
      meta(ata(curve, WSOL, TOKEN), false, true),
      meta(vault, false, true),
      meta(ata(vault, WSOL, TOKEN), false, true),
      meta(pumpEventAuthority(), false, false),
      meta(PUMP, false, false),
    ],
    data: Buffer.from(DISC.sweepCreatorFee),
  });
}

/** Opts the coin into fee sharing: bonding_curve.creator becomes the sharing_config PDA. Signed by the current creator. */
export function createFeeSharingConfigIx(p: { payer: PublicKey; mint: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: FEES,
    keys: [
      meta(feesEventAuthority(), false, false),
      meta(FEES, false, false),
      meta(p.payer, true, true),
      meta(globalPda(), false, false),
      meta(p.mint, false, false),
      meta(sharingConfigPda(p.mint), false, true),
      meta(SYS, false, false),
      meta(bondingCurvePda(p.mint), false, true),
      meta(PUMP, false, false),
      meta(pumpEventAuthority(), false, false),
      // optional pool accounts (coin not graduated): Anchor's "None" is the program's own id
      meta(FEES, false, false),
      meta(FEES, false, false),
      meta(FEES, false, false),
    ],
    data: Buffer.from(DISC.createFeeSharingConfig),
  });
}

export interface Shareholder {
  address: PublicKey;
  bps: number;
}

/** Sets the final shareholders (once). `current` = the shareholders before (the creator alone). */
export function updateFeeSharesV2Ix(p: { authority: PublicKey; mint: PublicKey; current: PublicKey[]; shareholders: Shareholder[] }): TransactionInstruction {
  const sc = sharingConfigPda(p.mint);
  const vault = creatorVaultPda(sc);
  const ammVault = ammCreatorVaultPda(sc);
  const holders = Buffer.concat([u32(p.shareholders.length), ...p.shareholders.map((s) => Buffer.concat([s.address.toBuffer(), u16(s.bps)]))]);
  return new TransactionInstruction({
    programId: FEES,
    keys: [
      meta(feesEventAuthority(), false, false),
      meta(FEES, false, false),
      meta(p.authority, true, true),
      meta(globalPda(), false, false),
      meta(p.mint, false, false),
      meta(sc, false, true),
      meta(bondingCurvePda(p.mint), false, false),
      meta(vault, false, true),
      meta(ata(vault, WSOL, TOKEN), false, true),
      meta(SYS, false, false),
      meta(PUMP, false, false),
      meta(pumpEventAuthority(), false, false),
      meta(AMM, false, false),
      meta(ammEventAuthority(), false, false),
      meta(WSOL, false, false),
      meta(TOKEN, false, false),
      meta(ATA, false, false),
      meta(ammVault, false, true),
      meta(ata(ammVault, WSOL, TOKEN), false, true),
      ...p.current.map((k) => meta(k, false, true)),
    ],
    data: Buffer.concat([Buffer.from(DISC.updateFeeSharesV2), holders]),
  });
}

/** Pays the sharing config's creator vault out to its shareholders by bps. Permissionless. */
export function distributeCreatorFeesV2Ix(p: { payer: PublicKey; mint: PublicKey; shareholders: PublicKey[] }): TransactionInstruction {
  const sc = sharingConfigPda(p.mint);
  const vault = creatorVaultPda(sc);
  return new TransactionInstruction({
    programId: PUMP,
    keys: [
      meta(p.payer, true, true),
      meta(p.mint, false, false),
      meta(bondingCurvePda(p.mint), false, false),
      meta(sc, false, false),
      meta(vault, false, true),
      meta(SYS, false, false),
      meta(pumpEventAuthority(), false, false),
      meta(PUMP, false, false),
      meta(ata(vault, WSOL, TOKEN), false, true),
      meta(WSOL, false, false),
      meta(TOKEN, false, false),
      meta(ATA, false, false),
      ...p.shareholders.map((k) => meta(k, false, true)),
    ],
    data: Buffer.concat([Buffer.from(DISC.distributeCreatorFeesV2), Buffer.from([0])]),
  });
}

export const computeBudget = (units: number, microLamports: number) => [
  ComputeBudgetProgram.setComputeUnitLimit({ units }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
];

// ───────────────────────────── layouts

export interface BondingCurve {
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  realTokenReserves: bigint;
  realQuoteReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: string;
  creatorFeeWaiting: bigint;
}

export function parseBondingCurve(data: Uint8Array): BondingCurve {
  const b = Buffer.from(data);
  if (b.length < 81 || !BONDING_CURVE_DISC.every((v, i) => b[i] === v)) throw new Error("Not a pump.fun bonding curve.");
  return {
    virtualTokenReserves: b.readBigUInt64LE(8),
    virtualQuoteReserves: b.readBigUInt64LE(16),
    realTokenReserves: b.readBigUInt64LE(24),
    realQuoteReserves: b.readBigUInt64LE(32),
    tokenTotalSupply: b.readBigUInt64LE(40),
    complete: b[48] === 1,
    creator: new PublicKey(b.subarray(49, 81)).toBase58(),
    creatorFeeWaiting: b.length >= 133 ? b.readBigUInt64LE(125) : BigInt(0),
  };
}

export interface SharingConfig {
  version: number;
  active: boolean;
  mint: string;
  admin: string;
  adminRevoked: boolean;
  shareholders: { address: string; bps: number }[];
}

/** SharingConfig: disc 8 · bump u8 · version u8 · status u8 (0 Paused, 1 Active) · mint · admin · admin_revoked · Vec<Shareholder>. */
export function parseSharingConfig(data: Uint8Array): SharingConfig {
  const b = Buffer.from(data);
  let o = 8;
  o += 1; // bump
  const version = b[o++];
  const status = b[o++];
  const mint = new PublicKey(b.subarray(o, o + 32)).toBase58();
  o += 32;
  const admin = new PublicKey(b.subarray(o, o + 32)).toBase58();
  o += 32;
  const adminRevoked = b[o++] === 1;
  const n = b.readUInt32LE(o);
  o += 4;
  const shareholders: { address: string; bps: number }[] = [];
  for (let i = 0; i < n && i < 10; i++) {
    shareholders.push({ address: new PublicKey(b.subarray(o, o + 32)).toBase58(), bps: b.readUInt16LE(o + 32) });
    o += 34;
  }
  return { version, active: status === 1, mint, admin, adminRevoked, shareholders };
}

export interface GlobalInfo {
  feeRecipient: string;
  feeRecipients: string[];
  buybackFeeRecipients: string[];
  initialVirtualTokens: bigint;
  initialVirtualSol: bigint;
  initialRealTokens: bigint;
  feeBps: bigint;
  creatorFeeBps: bigint;
}

/** Global: offsets from the IDL field order (fee_recipient @41, reserves @73/81/89, fee bps @105, creator bps @154, fee_recipients[7] @162, buyback list @741). */
export function parseGlobal(data: Uint8Array): GlobalInfo {
  const b = Buffer.from(data);
  if (b.length < 1000) throw new Error("Unexpected pump.fun Global layout.");
  const pk = (o: number) => new PublicKey(b.subarray(o, o + 32)).toBase58();
  return {
    feeRecipient: pk(41),
    feeRecipients: [pk(41), ...Array.from({ length: 7 }, (_, i) => pk(162 + 32 * i))],
    buybackFeeRecipients: Array.from({ length: 8 }, (_, i) => pk(741 + 32 * i)),
    initialVirtualTokens: b.readBigUInt64LE(73),
    initialVirtualSol: b.readBigUInt64LE(81),
    initialRealTokens: b.readBigUInt64LE(89),
    feeBps: b.readBigUInt64LE(105),
    creatorFeeBps: b.readBigUInt64LE(154),
  };
}

/**
 * Tokens out for an initial buy on a fresh curve, net of fees (with a 1 % margin so the program's
 * own fee rounding never pushes the cost above `maxSolCost`).
 */
export function quoteInitialBuy(g: Pick<GlobalInfo, "initialVirtualTokens" | "initialVirtualSol" | "initialRealTokens" | "feeBps" | "creatorFeeBps">, solIn: bigint, slippageBps = 300): { tokens: bigint; maxSolCost: bigint } {
  const feeBps = g.feeBps + g.creatorFeeBps + BigInt(100);
  const net = (solIn * BigInt(10_000)) / (BigInt(10_000) + feeBps);
  const k = g.initialVirtualSol * g.initialVirtualTokens;
  let tokens = g.initialVirtualTokens - k / (g.initialVirtualSol + net) - BigInt(1);
  if (tokens > g.initialRealTokens) tokens = g.initialRealTokens;
  if (tokens < BigInt(0)) tokens = BigInt(0);
  return { tokens, maxSolCost: (solIn * BigInt(10_000 + slippageBps)) / BigInt(10_000) };
}
