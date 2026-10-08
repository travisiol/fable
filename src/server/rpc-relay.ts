/**
 * Same-origin JSON-RPC relay: the browser posts to /api/rpc, the server forwards to RPC_URL.
 * Only read methods pass; a keyed RPC URL never reaches the client. A 429 from upstream is passed
 * through as a 429 so the client can back off.
 */
export const READ_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getEpochInfo",
  "getHealth",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getMultipleAccountsInfo",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTokenLargestAccounts",
  "getTokenSupply",
  "getTransaction",
  "getVersion",
]);

export const RELAY_TIMEOUT_MS = 10_000;
const MAX_BATCH = 20;

type RpcCall = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

export function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

/** Returns the refused method name, or null if every call is allowed. */
export function refusedMethod(body: unknown): string | null {
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) return "batch";
  for (const call of calls as RpcCall[]) {
    if (!call || typeof call !== "object" || typeof call.method !== "string" || !READ_METHODS.has(call.method)) {
      return typeof call?.method === "string" ? call.method : "invalid";
    }
  }
  return null;
}

export async function relay(body: unknown, upstream: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const refused = refusedMethod(body);
  if (refused) {
    const id = Array.isArray(body) ? null : (body as RpcCall | null)?.id;
    return Response.json(rpcError(id, -32601, `Method not allowed through this relay: ${refused}`), { status: 403 });
  }
  let response: Response;
  try {
    response = await fetchImpl(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
  } catch {
    return Response.json(rpcError(null, -32000, "The Solana RPC did not answer in time."), { status: 504 });
  }
  if (response.status === 429) {
    return Response.json(rpcError(null, 429, "Too many requests. Try again in a moment."), {
      status: 429,
      headers: { "retry-after": response.headers.get("retry-after") ?? "2" },
    });
  }
  const text = await response.text();
  return new Response(text, { status: response.ok ? 200 : 502, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
