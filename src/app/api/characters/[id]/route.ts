import { ctx } from "@/server/app";
import { discardDraft, editCharacter, ownedCharacter } from "@/server/characters";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { jobsFor } from "@/server/jobs";
import { activeLaunchFor, launchView } from "@/server/launch";
import { mediaUrl } from "@/server/media";
import type { CharacterRow } from "@/server/characters";
import { characterAccount, readBalance } from "@/server/ledger";

type P = { params: Promise<{ id: string }> };

const view = (c: CharacterRow) => ({ ...c, portrait: mediaUrl(c.portraitMediaId) });

export async function GET(_: Request, { params }: P) {
  return handle(async () => {
    const { id } = await params;
    const { db, me } = await ctx();
    const c = await ownedCharacter(db, me, id);
    const launch = await activeLaunchFor(db, c.id);
    const budget = await readBalance(db, characterAccount(c.id));
    return Response.json({ character: view(c), budget: { available: budget.available, reserved: budget.reserved }, jobs: await jobsFor(db, me!, { characterId: c.id, limit: 10 }), launch: launch ? launchView(launch) : null }, { headers: { "cache-control": "no-store" } });
  });
}

export async function PATCH(request: Request, { params }: P) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const { db, me } = await ctx();
    const c = await editCharacter(db, me, id, await readJson(request));
    return Response.json({ character: view(c) });
  });
}

export async function DELETE(request: Request, { params }: P) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const { db, me } = await ctx();
    await discardDraft(db, me, id);
    return Response.json({ ok: true });
  });
}
