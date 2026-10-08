/** Route/page glue: the database, the signed-in wallet, providers, and the after() job kick. */
import "server-only";
import { after } from "next/server";
import { providers } from "./ai.ts";
import { db } from "./db.ts";
import type { Db } from "./db.ts";
import { tickJobs } from "./jobs.ts";
import { currentAddress } from "./session.ts";
import { ENV } from "../config/fable.ts";
import { HttpError } from "./errors.ts";

export async function ctx(): Promise<{ db: Db; me: string | null }> {
  const [d, me] = await Promise.all([db(), currentAddress()]);
  return { db: d, me };
}

/** Advance due jobs after the response is sent (serverless-safe: bounded by the route's maxDuration). */
export function kickJobs(d: Db, limit = 2) {
  after(async () => {
    try {
      await tickJobs(d, providers(), limit);
    } catch {
      // the next poll or cron retries
    }
  });
}

/** Cron routes: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends it). */
export function assertCron(request: Request) {
  const secret = ENV.cronSecret();
  const got = request.headers.get("authorization") ?? "";
  if (!secret || got !== `Bearer ${secret}`) throw new HttpError(401, "Unauthorised.");
}

export function assertAdmin(me: string | null): string {
  if (!me) throw new HttpError(401, "Sign in with your wallet first.");
  if (!ENV.adminWallets().includes(me)) throw new HttpError(403, "Only the owner's wallets can do this.");
  return me;
}
