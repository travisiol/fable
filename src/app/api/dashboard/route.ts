import { ctx } from "@/server/app";
import { HttpError } from "@/server/errors";
import { handle } from "@/server/http";
import { creatorOverview, walletSummary } from "@/server/views";

/** Private: the signed-in wallet's overview and creator controls (signed sign-in required). */
export async function GET() {
  return handle(async () => {
    const { db, me } = await ctx();
    if (!me) throw new HttpError(401, "Sign in with your wallet first.");
    const [wallet, creator] = await Promise.all([walletSummary(db, me), creatorOverview(db, me)]);
    return Response.json({ wallet, creator }, { headers: { "cache-control": "no-store" } });
  });
}
