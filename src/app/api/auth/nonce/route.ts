import { isBase58Address } from "@/lib/format";
import { signInMessage } from "@/lib/signin-message";
import { issueNonce } from "@/server/auth";
import { db } from "@/server/db";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, handle, readJson } from "@/server/http";

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { address } = await readJson<{ address?: string }>(request);
    if (!isBase58Address(address)) throw new HttpError(400, "Invalid wallet address.");
    const issuedAt = new Date().toISOString();
    const nonce = await issueNonce(await db());
    const host = request.headers.get("host") ?? "";
    return Response.json({ nonce, issuedAt, message: signInMessage({ host, address, nonce, issuedAt }) });
  });
}
