import { db } from "@/server/db";
import { getMedia, mediaBytes } from "@/server/media";

/** Serves a generated image or clip (local disk) or redirects to its Blob URL. Ids are unguessable. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{8,40}$/.test(id)) return new Response("Not found", { status: 404 });
  const m = await getMedia(await db(), id);
  if (!m) return new Response("Not found", { status: 404 });
  if (m.storage === "blob") return Response.redirect(m.location, 302);
  const bytes = await mediaBytes(m);
  if (!bytes) return new Response("This file is no longer stored on this server.", { status: 410 });
  return new Response(new Uint8Array(bytes), { headers: { "content-type": m.mime, "cache-control": "public, max-age=31536000, immutable", "content-length": String(bytes.length) } });
}
