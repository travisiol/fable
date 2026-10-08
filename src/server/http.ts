import { HttpError } from "./errors.ts";

/** Run a handler; turn HttpError into JSON, never echo internals. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    // Matched by name too: after a dev hot reload an older copy of the class can be thrown.
    if (error instanceof HttpError || (error instanceof Error && error.name === "HttpError")) {
      const status = (error as HttpError).status;
      return Response.json({ error: error.message }, { status: typeof status === "number" ? status : 400 });
    }
    console.error("[fable] request failed:", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Something went wrong on our side." }, { status: 500 });
  }
}

/** Mutations must come from this site's own pages. */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) throw new HttpError(403, "Cross-site request refused.");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Cross-site request refused.");
  }
  if (originHost !== host) throw new HttpError(403, "Cross-site request refused.");
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid request body.");
  }
}
