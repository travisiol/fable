import { ctx, kickJobs } from "@/server/app";
import { createDraft, listOwned } from "@/server/characters";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { jobView, submitJob } from "@/server/jobs";
import { mediaUrl } from "@/server/media";

export const maxDuration = 300;

/** The signed-in creator's characters (drafts and saved). */
export async function GET() {
  return handle(async () => {
    const { db, me } = await ctx();
    if (!me) throw new HttpError(401, "Sign in with your wallet first.");
    const list = await listOwned(db, me);
    return Response.json({ characters: list.map((c) => ({ ...c, portrait: mediaUrl(c.portraitMediaId) })) }, { headers: { "cache-control": "no-store" } });
  });
}

/** Describe → Generate: creates the draft and its paid generation job in one step. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { db, me } = await ctx();
    if (!me) throw new HttpError(401, "Sign in with your wallet first.");
    const body = await readJson<{ idea?: string; name?: string; personality?: string; style?: string; niche?: string; idempotencyKey?: string }>(request);
    const key = String(body.idempotencyKey ?? "");
    const prior = await db.query("SELECT character_id FROM jobs WHERE owner = $1 AND idempotency_key = $2", [me, key]);
    const character = prior[0] ? { id: String(prior[0].character_id) } : await createDraft(db, me, body);
    try {
      const { job } = await submitJob(db, me, { characterId: character.id, kind: "character", payer: "holder_credits", idempotencyKey: key });
      kickJobs(db, 1);
      return Response.json({ characterId: character.id, job: jobView(job) });
    } catch (e) {
      // keep the draft (inputs preserved) even when the balance is short
      if (e instanceof HttpError) return Response.json({ characterId: character.id, error: e.message }, { status: e.status });
      throw e;
    }
  });
}
