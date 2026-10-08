import { assertSameOrigin, handle } from "@/server/http";
import { endSession } from "@/server/session";

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await endSession();
    return Response.json({ ok: true });
  });
}
