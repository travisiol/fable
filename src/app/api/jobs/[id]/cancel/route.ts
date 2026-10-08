import { ctx } from "@/server/app";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, handle } from "@/server/http";
import { cancelJob, jobView } from "@/server/jobs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const { db, me } = await ctx();
    if (!me) throw new HttpError(401, "Sign in with your wallet first.");
    return Response.json({ job: jobView(await cancelJob(db, me, id)) });
  });
}
