import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db.ts";
import { HttpError } from "./errors.ts";

const COOKIE = "fable_session";
const TTL_MS = 7 * 86_400_000;
let memo: string | null = null;

/**
 * Cookie signing key: SESSION_SECRET (≥ 32 chars). Without it a key is generated once and kept in
 * the database (kv), so every instance sharing the database signs with the same key.
 */
async function secret(): Promise<string> {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (memo) return memo;
  const d = await db();
  await d.query("INSERT INTO kv (key, value) VALUES ('session_secret', $1) ON CONFLICT (key) DO NOTHING", [randomBytes(32).toString("hex")]);
  memo = String((await d.query("SELECT value FROM kv WHERE key = 'session_secret'"))[0].value);
  return memo;
}

export function signToken(payload: object, key: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyToken<T extends { exp: number }>(token: string | undefined, key: string): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export async function startSession(address: string) {
  const jar = await cookies();
  jar.set(COOKIE, signToken({ sub: address, exp: Date.now() + TTL_MS }, await secret()), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/** The signed-in address (base58), or null. */
export async function currentAddress(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return verifyToken<{ sub: string; exp: number }>(token, await secret())?.sub ?? null;
}

export async function requireSession(): Promise<string> {
  const address = await currentAddress();
  if (!address) throw new HttpError(401, "Sign in with your wallet first.");
  return address;
}
