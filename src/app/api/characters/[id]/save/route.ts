import { ctx } from "@/server/app";
import { saveCharacter } from "@/server/characters";
import { assertSameOrigin, handle } from "@/server/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const { db, me } = await ctx();
    const c = await saveCharacter(db, me, id);
    return Response.json({ character: { id: c.id, slug: c.slug, number: c.number, status: c.status } });
  });
}
