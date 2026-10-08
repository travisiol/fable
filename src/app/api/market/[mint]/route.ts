import { isBase58Address } from "@/lib/format";
import { db } from "@/server/db";
import { HttpError } from "@/server/errors";
import { handle } from "@/server/http";
import { marketFor } from "@/server/market";

/** Market data for a FABLE-launched coin only (no open proxy). */
export async function GET(_: Request, { params }: { params: Promise<{ mint: string }> }) {
  return handle(async () => {
    const { mint } = await params;
    if (!isBase58Address(mint)) throw new HttpError(400, "Invalid mint.");
    const known = await (await db()).query("SELECT 1 FROM launches WHERE mint = $1 AND status = 'confirmed'", [mint]);
    if (!known.length) throw new HttpError(404, "Not a FABLE coin.");
    return Response.json({ market: await marketFor(mint) }, { headers: { "cache-control": "no-store" } });
  });
}
