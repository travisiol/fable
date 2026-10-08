import { assertAdmin, ctx } from "@/server/app";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { isBase58Address } from "@/lib/format";
import { grantCredits } from "@/server/pool";

/** Owner: grants credits to a wallet from the pool, within the same capacity as allocations. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { db, me } = await ctx();
    assertAdmin(me);
    const b = await readJson<{ wallet?: string; credits?: number; key?: string }>(request);
    if (!isBase58Address(b.wallet)) throw new HttpError(400, "Invalid wallet.");
    const key = String(b.key ?? "");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new HttpError(400, "Missing request key.");
    const done = await grantCredits(db, b.wallet, Number(b.credits), key);
    return Response.json({ granted: done });
  });
}
