import { assertAdmin, ctx } from "@/server/app";
import { HttpError } from "@/server/errors";
import { ingestDeposit } from "@/server/fees";
import { assertSameOrigin, handle, readJson } from "@/server/http";

export const maxDuration = 30;

/** Owner: records a confirmed SOL transfer into the holder-pool wallet as pool funding (once per signature). */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { db, me } = await ctx();
    assertAdmin(me);
    const { signature } = await readJson<{ signature?: string }>(request);
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(String(signature ?? ""))) throw new HttpError(400, "Paste a transaction signature.");
    try {
      return Response.json(await ingestDeposit(db, String(signature)));
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Deposit not recorded.");
    }
  });
}
