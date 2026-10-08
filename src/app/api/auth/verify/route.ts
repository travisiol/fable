import { verifySignIn } from "@/server/auth";
import { db } from "@/server/db";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { startSession } from "@/server/session";

interface Body {
  address?: string;
  nonce?: string;
  issuedAt?: string;
  signature?: string;
}

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const body = await readJson<Body>(request);
    // The message is rebuilt on the server: the client cannot choose what was signed.
    const address = await verifySignIn(await db(), { ...body, host: request.headers.get("host") ?? "" });
    await startSession(address);
    return Response.json({ address });
  });
}
