import { ctx } from "@/server/app";
import { handle } from "@/server/http";
import { walletSummary } from "@/server/views";

export async function GET() {
  return handle(async () => {
    const { db, me } = await ctx();
    if (!me) return Response.json({ signedIn: false }, { headers: { "cache-control": "no-store" } });
    return Response.json({ signedIn: true, wallet: await walletSummary(db, me) }, { headers: { "cache-control": "no-store" } });
  });
}
