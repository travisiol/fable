/**
 * The operator key (`OPERATOR_SECRET_KEY`, base58 or a JSON byte array). FABLE's operator never
 * holds user funds: it only pays network fees for permissionless pump.fun cranks (sweep + distribute
 * the creator fees of a coin to its shareholders). Each send is simulated first, then sent and
 * confirmed by polling (no websocket: works in a serverless function).
 */
import bs58 from "bs58";
import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import type { TransactionInstruction } from "@solana/web3.js";
import { confirmTx, connection } from "./chain.ts";

/** Parses base58 or a JSON array. Returns null when unset or malformed; never logs the value. */
export function parseSecretKey(raw: string | undefined | null): Keypair | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const bytes = value.startsWith("[") ? Uint8Array.from(JSON.parse(value) as number[]) : bs58.decode(value);
    if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
    if (bytes.length === 32) return Keypair.fromSeed(bytes);
    return null;
  } catch {
    return null;
  }
}

export function operatorKeypair(): Keypair | null {
  return parseSecretKey(process.env["OPERATOR_SECRET_KEY"]);
}

export function operatorAddress(): string | null {
  return operatorKeypair()?.publicKey.toBase58() ?? null;
}

export type SendResult = { sig: string; status: string } | { error: string };

/** Simulate → send → confirm. Nothing is sent when the simulation fails. */
export async function sendAsOperator(instructions: TransactionInstruction[]): Promise<SendResult> {
  const operator = operatorKeypair();
  if (!operator) return { error: "No operator key is configured." };
  const conn = connection();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: operator.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message());
  tx.sign([operator]);
  const sim = await conn.simulateTransaction(tx, { commitment: "confirmed", sigVerify: false });
  if (sim.value.err) return { error: `Simulation failed: ${JSON.stringify(sim.value.err).slice(0, 120)}` };
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  const status = await confirmTx(sig);
  if (status === "failed") return { error: "The transaction failed on chain." };
  return { sig, status };
}
