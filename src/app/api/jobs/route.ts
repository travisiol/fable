import { ctx, kickJobs } from "@/server/app";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { jobView, jobsFor, submitJob } from "@/server/jobs";
import type { Payer } from "@/server/jobs";

export const maxDuration = 300;

export async function GET(request: Request) {
  return handle(async () => {
    const { db, me } = await ctx();
    if (!me) throw new HttpError(401, "Sign in with your wallet first.");
    const characterId = new URL(request.url).searchParams.get("characterId") ?? undefined;
    return Response.json({ jobs: await jobsFor(db, me, { characterId, limit: 30 }) }, { headers: { "cache-control": "no-store" } });
  });
}

/** Studio submit: reserves the cost on exactly one balance, then the job runs after the response. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { db, me } = await ctx();
    if (!me) throw new HttpError(401, "Sign in with your wallet first.");
    const b = await readJson<{ characterId?: string; mode?: string; preset?: string; prompt?: string; format?: string; payer?: string; idempotencyKey?: string }>(request);
    const kind = b.mode === "video" ? "video" : "image";
    const { job, created } = await submitJob(db, me, {
      characterId: String(b.characterId ?? ""),
      kind,
      preset: b.preset ?? null,
      prompt: b.prompt ?? "",
      format: b.format ?? "",
      payer: b.payer as Payer,
      idempotencyKey: String(b.idempotencyKey ?? ""),
    });
    kickJobs(db, 1);
    return Response.json({ job: jobView(job), created });
  });
}
