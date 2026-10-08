import { rpcUrl } from "@/config/solana";
import { relay, rpcError } from "@/server/rpc-relay";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  return relay(body, rpcUrl());
}
