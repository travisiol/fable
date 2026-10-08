/**
 * Sign-in by signed message: nonce (10 min, single use) → the wallet signs a server-built text →
 * ed25519 check → session cookie (session.ts). Private creator controls require it (spec §12).
 */
import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { signInMessage } from "../lib/signin-message.ts";
import { isBase58Address } from "../lib/format.ts";
import type { Q } from "./db.ts";
import { num } from "./db.ts";
import { HttpError } from "./errors.ts";

export const NONCE_TTL_MS = 10 * 60_000;

export async function issueNonce(q: Q, now = Date.now()): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  await q.query("DELETE FROM nonces WHERE created_at < $1", [now - NONCE_TTL_MS]);
  await q.query("INSERT INTO nonces (nonce, created_at) VALUES ($1, $2)", [nonce, now]);
  return nonce;
}

/** Deletes the nonce; true only if it existed and was fresh. A nonce can never be used twice. */
export async function consumeNonce(q: Q, nonce: string, now = Date.now()): Promise<boolean> {
  const rows = await q.query("DELETE FROM nonces WHERE nonce = $1 RETURNING created_at", [nonce]);
  return Boolean(rows[0] && num(rows[0].created_at) >= now - NONCE_TTL_MS);
}

export function verifySignature(address: string, message: string, signatureB58: string): boolean {
  try {
    const signature = bs58.decode(signatureB58);
    const publicKey = bs58.decode(address);
    if (signature.length !== 64 || publicKey.length !== 32) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), signature, publicKey);
  } catch {
    return false;
  }
}

export interface SignInRequest {
  host: string;
  address?: string;
  nonce?: string;
  issuedAt?: string;
  signature?: string;
}

export async function verifySignIn(q: Q, input: SignInRequest): Promise<string> {
  const { address, nonce, issuedAt, signature, host } = input;
  if (!isBase58Address(address)) throw new HttpError(400, "Invalid wallet address.");
  if (!nonce || !issuedAt || !signature) throw new HttpError(400, "Incomplete sign-in request.");
  if (!(await consumeNonce(q, nonce))) throw new HttpError(401, "That sign-in request expired. Try again.");
  const message = signInMessage({ host, address, nonce, issuedAt });
  if (!verifySignature(address, message, signature)) throw new HttpError(401, "The signature does not match this wallet.");
  return address;
}
