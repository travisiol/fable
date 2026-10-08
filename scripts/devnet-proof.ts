/**
 * Proves FABLE's pump.fun transactions against the REAL pump.fun programs on Solana devnet.
 *
 *   node --disable-warning=ExperimentalWarning scripts/devnet-proof.ts [--send]
 *
 * 1. Tries a devnet airdrop to a throwaway keypair. With SOL (or DEVNET_SECRET, base58, a throwaway
 *    devnet key) and --send it SENDS: create_v2 (+ initial buy) → confirm → fee split → read back.
 * 2. Without SOL it SIMULATES on the real devnet RPC (sigVerify off): the payer is a devnet wallet
 *    that recently created a pump.fun coin (it has SOL and is a valid creator), so:
 *      - create_v2 for a fresh mint, with and without an initial buy;
 *      - sweep + create_fee_sharing_config + update_fee_shares_v2 [30/40/30] on that wallet's own
 *        existing coin (only its creator can opt it in).
 * Never touches mainnet.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
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
} from "../src/server/pump.ts";
import { PUMP_PROGRAM, TOKEN_2022_PROGRAM } from "../src/config/solana.ts";

const RPC = process.env.DEVNET_RPC_URL || "https://api.devnet.solana.com";
const conn = new Connection(RPC, { commitment: "confirmed", disableRetryOnRateLimit: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SEND = process.argv.includes("--send");
const POOL = Keypair.generate().publicKey;
const BUDGET = Keypair.generate().publicKey;
const log = (...a: unknown[]) => console.log(...a);

async function simulate(label: string, payer: PublicKey, ixs: Parameters<typeof txOf>[1], signers: Keypair[] = []) {
  const tx = await txOf(payer, ixs);
  if (signers.length) tx.sign(signers);
  const size = tx.serialize().length;
  const r = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  const ok = !r.value.err;
  log(`${ok ? "OK  " : "FAIL"} simulate ${label} — ${size} bytes, ${r.value.unitsConsumed ?? "?"} CU${ok ? "" : ` — ${JSON.stringify(r.value.err)}`}`);
  if (!ok) log((r.value.logs ?? []).slice(-8).join("\n"));
  return ok;
}

async function txOf(payer: PublicKey, ixs: ReturnType<typeof createV2Ix>[]) {
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
}

async function findCreator(): Promise<{ creator: PublicKey; mint: PublicKey } | null> {
  const sigs = await conn.getSignaturesForAddress(new PublicKey(PUMP_PROGRAM), { limit: 100 });
  for (const s of sigs) {
    if (s.err) continue;
    await sleep(400);
    const t = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (!t) continue;
    const keys = t.transaction.message.getAccountKeys({ accountKeysFromLookups: t.meta?.loadedAddresses ?? undefined });
    const all = keys.keySegments().flat();
    const payer = all[0];
    const logs = (t.meta?.logMessages ?? []).join("\n");
    if (!/Instruction: CreateV2|Instruction: Create\b/.test(logs)) continue;
    // create / create_v2: the mint is the first account of the pump instruction
    const ix = t.transaction.message.compiledInstructions.find((c) => all[c.programIdIndex]?.toBase58() === PUMP_PROGRAM);
    const candidates = ix ? [all[ix.accountKeyIndexes[0]]] : [];
    for (const k of candidates) {
      await sleep(400);
      const acc = await conn.getAccountInfo(bondingCurvePda(k)).catch(() => null);
      if (!acc) continue;
      try {
        const c = parseBondingCurve(acc.data);
        if (c.creator !== payer.toBase58() || c.complete) continue;
        if (await conn.getAccountInfo(sharingConfigPda(k))) continue;
        if ((await conn.getBalance(payer)) < 0.05 * LAMPORTS_PER_SOL) continue;
        return { creator: payer, mint: k };
      } catch {
        // not a curve
      }
    }
  }
  return null;
}

async function main() {
  log(`devnet RPC: ${RPC}`);
  const g = await conn.getAccountInfo(globalPda());
  if (!g) throw new Error("pump.fun Global not found on devnet");
  const global = parseGlobal(g.data);
  log(`pump.fun Global on devnet: fee ${global.feeBps} bps, creator fee ${global.creatorFeeBps} bps, virtual SOL ${Number(global.initialVirtualSol) / 1e9}`);

  let funded: Keypair | null = process.env.DEVNET_SECRET ? Keypair.fromSecretKey(bs58.decode(process.env.DEVNET_SECRET)) : null;
  if (!funded) {
    const k = Keypair.generate();
    try {
      const sig = await conn.requestAirdrop(k.publicKey, LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
      funded = k;
      log(`airdrop OK to throwaway ${k.publicKey.toBase58()}`);
    } catch (e) {
      log(`airdrop refused: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  const name = "Fable Proof";
  const symbol = "FPROOF";
  const uri = "https://fable.example/api/launch/l_proof/metadata";

  if (funded && SEND) {
    const user = funded;
    const mint = Keypair.generate();
    const q = quoteInitialBuy(global, BigInt(10_000_000));
    const pick = (l: string[]) => new PublicKey(l[0]);
    const tx = await txOf(user.publicKey, [
      ...computeBudget(280_000, 100_000),
      createV2Ix({ mint: mint.publicKey, user: user.publicKey, creator: user.publicKey, name, symbol, uri }),
      createAtaIdempotentIx(user.publicKey, user.publicKey, mint.publicKey, new PublicKey(TOKEN_2022_PROGRAM)),
      buyIx({ mint: mint.publicKey, user: user.publicKey, creator: user.publicKey, feeRecipient: pick(global.feeRecipients), buybackFeeRecipient: pick(global.buybackFeeRecipients), tokens: q.tokens, maxSolCost: q.maxSolCost }),
    ]);
    tx.sign([user, mint]);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, "confirmed");
    log(`SENT create_v2 + buy: https://solscan.io/tx/${sig}?cluster=devnet  mint ${mint.publicKey.toBase58()}`);
    const tx2 = await txOf(user.publicKey, [
      ...computeBudget(300_000, 100_000),
      sweepCreatorFeeIx({ payer: user.publicKey, mint: mint.publicKey, creator: user.publicKey }),
      createFeeSharingConfigIx({ payer: user.publicKey, mint: mint.publicKey }),
      updateFeeSharesV2Ix({ authority: user.publicKey, mint: mint.publicKey, current: [user.publicKey], shareholders: [{ address: POOL, bps: 3000 }, { address: BUDGET, bps: 4000 }, { address: user.publicKey, bps: 3000 }] }),
    ]);
    tx2.sign([user]);
    const sig2 = await conn.sendRawTransaction(tx2.serialize());
    await conn.confirmTransaction(sig2, "confirmed");
    log(`SENT fee split: https://solscan.io/tx/${sig2}?cluster=devnet`);
    const sc = await conn.getAccountInfo(sharingConfigPda(mint.publicKey));
    log("SharingConfig read back:", sc ? JSON.stringify(parseSharingConfig(sc.data)) : "missing");
    return;
  }

  const found = await findCreator();
  if (!found) throw new Error("no funded devnet creator found to simulate with");
  const payer = found.creator;
  log(`simulating as devnet creator ${payer.toBase58()} (balance ${(await conn.getBalance(payer)) / 1e9} SOL), its coin ${found.mint.toBase58()}`);
  const mint = Keypair.generate();
  const results: boolean[] = [];
  results.push(await simulate("create_v2 (FABLE launch, no initial buy)", payer, [...computeBudget(160_000, 200_000), createV2Ix({ mint: mint.publicKey, user: payer, creator: payer, name, symbol, uri })], [mint]));
  const q = quoteInitialBuy(global, BigInt(10_000_000));
  results.push(
    await simulate(
      "create_v2 + ATA + initial buy 0.01 SOL",
      payer,
      [
        ...computeBudget(280_000, 200_000),
        createV2Ix({ mint: mint.publicKey, user: payer, creator: payer, name, symbol, uri }),
        createAtaIdempotentIx(payer, payer, mint.publicKey, new PublicKey(TOKEN_2022_PROGRAM)),
        buyIx({ mint: mint.publicKey, user: payer, creator: payer, feeRecipient: new PublicKey(global.feeRecipients[1]), buybackFeeRecipient: new PublicKey(global.buybackFeeRecipients[1]), tokens: q.tokens, maxSolCost: q.maxSolCost }),
      ],
      [mint],
    ),
  );
  results.push(
    await simulate("sweep + create_fee_sharing_config + update_fee_shares_v2 [30/40/30]", payer, [
      ...computeBudget(300_000, 100_000),
      sweepCreatorFeeIx({ payer, mint: found.mint, creator: payer }),
      createFeeSharingConfigIx({ payer, mint: found.mint }),
      updateFeeSharesV2Ix({ authority: payer, mint: found.mint, current: [payer], shareholders: [{ address: POOL, bps: 3000 }, { address: BUDGET, bps: 4000 }, { address: payer, bps: 3000 }] }),
    ]),
  );
  log(results.every(Boolean) ? "ALL SIMULATIONS OK" : "SOME SIMULATIONS FAILED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
