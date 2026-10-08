import { ctx, kickJobs } from "@/server/app";
import { providers } from "@/server/ai";
import { HttpError } from "@/server/errors";
import { handle } from "@/server/http";
import { getJob, jobView, runJob } from "@/server/jobs";
import { JOB_LEASE_MS } from "@/config/fable";

export const maxDuration = 300;

/**
 * Job status for the owner. Polling also advances the job: a video operation is polled at the
 * provider, and a job whose worker vanished (lease expired) is picked up again — so a job survives
 * page refreshes and function timeouts without a background loop.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const { db, me } = await ctx();
    let job = await getJob(db, id);
    if (!job || job.owner !== me) throw new HttpError(404, "Job not found.");
    const now = Date.now();
    if (job.kind === "video" && job.status === "running" && job.providerJobId) job = (await runJob(db, id, providers(), now)) ?? job;
    else if (job.status === "queued" && now - job.updatedAt > 4000) kickJobs(db, 1);
    else if (job.status === "running" && job.leaseUntil !== null && job.leaseUntil < now) kickJobs(db, 1);
    return Response.json({ job: jobView(job), leaseMs: JOB_LEASE_MS }, { headers: { "cache-control": "no-store" } });
  });
}
