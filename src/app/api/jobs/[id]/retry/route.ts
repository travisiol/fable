import { ctx, kickJobs } from "@/server/app";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { getJob, jobView, submitJob } from "@/server/jobs";

export const maxDuration = 300;

/** A failed or cancelled job is retried as a new job with a fresh reservation (the old one was released). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const { db, me } = await ctx();
    const old = await getJob(db, id);
    if (!old || old.owner !== me) throw new HttpError(404, "Job not found.");
    if (old.status !== "failed" && old.status !== "cancelled") throw new HttpError(409, "Only a failed or cancelled job can be retried.");
    const { idempotencyKey } = await readJson<{ idempotencyKey?: string }>(request);
    const { job } = await submitJob(db, me!, { characterId: old.characterId, kind: old.kind, preset: old.preset, prompt: old.prompt, format: old.format, payer: old.payer, idempotencyKey: String(idempotencyKey ?? "") });
    kickJobs(db, 1);
    return Response.json({ job: jobView(job) });
  });
}
