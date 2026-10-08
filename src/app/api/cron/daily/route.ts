import { assertCron } from "@/server/app";
import { providers } from "@/server/ai";
import { snapshotHolders } from "@/server/chain";
import { db } from "@/server/db";
import { syncFees } from "@/server/fees";
import { handle } from "@/server/http";
import { tickJobs } from "@/server/jobs";
import { dayKey, runAllocation, takeSnapshot, weekStart } from "@/server/pool";
import { ENV, serverFableMint } from "@/config/fable";

export const maxDuration = 300;

/**
 * Daily cron (Vercel Hobby runs daily crons): today's FABLE holder snapshot, this week's allocation
 * (idempotent: runs once per week, on the first call on or after Monday 00:00 UTC), fee receipts,
 * and a job tick. Each step reports its own result; one failing step does not stop the others.
 */
export async function GET(request: Request) {
  return handle(async () => {
    assertCron(request);
    const d = await db();
    const now = Date.now();
    const out: Record<string, unknown> = {};
    const mint = serverFableMint();
    if (mint) {
      try {
        const exclude = [ENV.poolWallet(), ENV.budgetWallet()].filter(Boolean) as string[];
        out.snapshot = await takeSnapshot(d, mint, dayKey(now), (m) => snapshotHolders(m, exclude));
      } catch (e) {
        out.snapshot = { error: e instanceof Error ? e.message.slice(0, 160) : "snapshot failed" };
      }
    } else out.snapshot = { skipped: "NEXT_PUBLIC_FABLE_MINT is not set" };
    try {
      out.allocation = await runAllocation(d, weekStart(now));
    } catch (e) {
      out.allocation = { error: e instanceof Error ? e.message.slice(0, 160) : "allocation failed" };
    }
    try {
      out.fees = await syncFees(d);
    } catch (e) {
      out.fees = { error: e instanceof Error ? e.message.slice(0, 160) : "fee sync failed" };
    }
    out.jobs = await tickJobs(d, providers(), 3).catch(() => 0);
    return Response.json(out);
  });
}
