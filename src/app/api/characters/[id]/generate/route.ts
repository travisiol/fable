import { ctx, kickJobs } from "@/server/app";
import { ownedCharacter } from "@/server/characters";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { jobView, submitJob } from "@/server/jobs";

export const maxDuration = 300;

/** Regenerate a draft: the whole identity (sheet + portrait) or only the portrait. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const { db, me } = await ctx();
    const c = await ownedCharacter(db, me, id);
    if (c.status !== "draft") throw new HttpError(409, "A saved character keeps its identity. Use the Studio for new images.");
    const body = await readJson<{ what?: string; idempotencyKey?: string }>(request);
    const kind = body.what === "portrait" ? "portrait" : "character";
    const { job } = await submitJob(db, me!, { characterId: c.id, kind, payer: "holder_credits", idempotencyKey: String(body.idempotencyKey ?? "") });
    kickJobs(db, 1);
    return Response.json({ job: jobView(job) });
  });
}
