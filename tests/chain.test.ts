import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { PUMP_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "../src/config/solana.ts";
import {
  ammCreatorVaultAta,
  ataAddress,
  clearChainCache,
  confirmTx,
  creatorClaimable,
  curveCreatorVault,
  largestHolders,
  normalizeDexPairs,
  parseTokenAmount,
  solBalance,
  tokenBalance,
  tokenSupply,
} from "../src/server/chain.ts";
import { SYSTEM, mintData, startFakeRpc, tokenAccountData } from "./fake-rpc.ts";

const rpc = await startFakeRpc();
const MINT = Keypair.generate().publicKey.toBase58();
const MINT22 = Keypair.generate().publicKey.toBase58();
const ALICE = Keypair.generate().publicKey.toBase58();
const BOB = Keypair.generate().publicKey.toBase58();
const CREATOR = Keypair.generate().publicKey.toBase58();

before(() => {
  process.env.SOLANA_RPC_URL = rpc.url;
  const s = rpc.state;
  s.accounts.set(ALICE, { lamports: 1_234_000_000, owner: SYSTEM });
  s.accounts.set(MINT, { lamports: 1_461_600, owner: TOKEN_PROGRAM, data: mintData(6, BigInt(1e15)) });
  s.supply.set(MINT, { amount: BigInt(1e15), decimals: 6 });
  const aliceAta = ataAddress(new PublicKey(ALICE), new PublicKey(MINT), new PublicKey(TOKEN_PROGRAM)).toBase58();
  s.accounts.set(aliceAta, { lamports: 2_039_280, owner: TOKEN_PROGRAM, data: tokenAccountData(MINT, ALICE, BigInt(5_000_000)) });
  const bobAta22 = ataAddress(new PublicKey(BOB), new PublicKey(MINT22), new PublicKey(TOKEN_2022_PROGRAM)).toBase58();
  s.accounts.set(bobAta22, { lamports: 2_039_280, owner: TOKEN_2022_PROGRAM, data: tokenAccountData(MINT22, BOB, BigInt(777)) });
  const bobAta = ataAddress(new PublicKey(BOB), new PublicKey(MINT), new PublicKey(TOKEN_PROGRAM)).toBase58();
  s.accounts.set(bobAta, { lamports: 2_039_280, owner: TOKEN_PROGRAM, data: tokenAccountData(MINT, BOB, BigInt(1)) });
  s.largest.set(MINT, [
    { address: aliceAta, amount: BigInt(5_000_000), decimals: 6 },
    { address: bobAta, amount: BigInt(1), decimals: 6 },
  ]);
  // Creator: curve vault holds rent + 0.5 SOL, PumpSwap WSOL vault ATA holds 0.25 SOL.
  const c = new PublicKey(CREATOR);
  s.accounts.set(curveCreatorVault(c).toBase58(), { lamports: 890_880 + 500_000_000, owner: SYSTEM });
  const wsolAta = ammCreatorVaultAta(c).toBase58();
  s.accounts.set(wsolAta, { lamports: 2_039_280, owner: TOKEN_PROGRAM, data: tokenAccountData("So11111111111111111111111111111111111111112", CREATOR, BigInt(250_000_000)) });
});
beforeEach(() => clearChainCache());
after(() => rpc.close());

test("parseTokenAmount reads u64 LE at offset 64 and tolerates short data", () => {
  const data = tokenAccountData(MINT, ALICE, BigInt("18446744073709551615"));
  assert.equal(parseTokenAmount(data), BigInt("18446744073709551615"));
  assert.equal(parseTokenAmount(Buffer.alloc(10)), BigInt(0));
  assert.equal(parseTokenAmount(null), BigInt(0));
});

test("solBalance returns lamports from getBalance (0 for an unknown account)", async () => {
  assert.equal(await solBalance(ALICE), BigInt(1_234_000_000));
  assert.equal(await solBalance(Keypair.generate().publicKey.toBase58()), BigInt(0));
});

test("tokenBalance finds the classic ATA and the Token-2022 ATA", async () => {
  assert.deepEqual(await tokenBalance(ALICE, MINT), { amount: BigInt(5_000_000), program: "token" });
  assert.deepEqual(await tokenBalance(BOB, MINT22), { amount: BigInt(777), program: "token-2022" });
  assert.deepEqual(await tokenBalance(ALICE, MINT22), { amount: BigInt(0), program: null });
});

test("tokenSupply and largestHolders resolve owners from the token accounts", async () => {
  assert.deepEqual(await tokenSupply(MINT), { amount: BigInt(1e15), decimals: 6 });
  const holders = await largestHolders(MINT, 10);
  assert.deepEqual(holders.map((h) => [h.owner, h.amount]), [
    [ALICE, BigInt(5_000_000)],
    [BOB, BigInt(1)],
  ]);
});

test("creatorClaimable = curve vault minus rent + PumpSwap WSOL amount", async () => {
  const fees = await creatorClaimable(CREATOR);
  assert.equal(fees.curveLamports, BigInt(500_000_000));
  assert.equal(fees.ammLamports, BigInt(250_000_000));
  assert.equal(fees.totalLamports, BigInt(750_000_000));
  const none = await creatorClaimable(Keypair.generate().publicKey.toBase58());
  assert.equal(none.totalLamports, BigInt(0));
  // The curve vault PDA uses the pump program and the "creator-vault" seed.
  const [expected] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), new PublicKey(CREATOR).toBuffer()], new PublicKey(PUMP_PROGRAM));
  assert.equal(curveCreatorVault(new PublicKey(CREATOR)).toBase58(), expected.toBase58());
});

test("reads are cached: a second read makes no RPC call", async () => {
  rpc.state.calls.length = 0;
  await solBalance(ALICE);
  await solBalance(ALICE);
  assert.equal(rpc.state.calls.filter((m) => m === "getBalance").length, 1);
});

test("normalizeDexPairs keeps the deepest pair; confirmTx reports pending for an unknown signature", async () => {
  const coin = normalizeDexPairs(MINT, [
    { liquidity: { usd: 10 }, priceUsd: "1", marketCap: 5, baseToken: { symbol: "A" } },
    { liquidity: { usd: 900 }, priceUsd: "0.002", marketCap: 42000, baseToken: { symbol: "B" } },
  ]);
  assert.equal(coin?.symbol, "B");
  assert.equal(coin?.marketCapUsd, 42000);
  assert.equal(normalizeDexPairs(MINT, []), null);
  assert.equal(await confirmTx("1".repeat(64), 300, 100), "pending");
});
