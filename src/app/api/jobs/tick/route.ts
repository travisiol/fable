import { assertCron } from "@/server/app";
import { providers } from "@/server/ai";
import { db } from "@/server/db";
import { handle } from "@/server/http";
import { tickJobs } from "@/server/jobs";

export const maxDuration = 300;

/** Cron: advances up to 4 due jobs (queued, expired leases, video operations). */
export async function GET(request: Request) {
  return handle(async () => {
    assertCron(request);
    const n = await tickJobs(await db(), providers(), 4);
    return Response.json({ advanced: n });
  });
}
