import { ctx } from "@/server/app";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { launchView, prepareLaunch } from "@/server/launch";

export const maxDuration = 30;

/** Builds the create transaction for the creator's wallet to sign. The launch row exists before signing. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { db, me } = await ctx();
    const p = await prepareLaunch(db, me, await readJson(request));
    return Response.json({ launch: launchView(p.launch), transaction: p.transaction, summary: p.summary });
  });
}
