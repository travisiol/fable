/**
 * Generated media: Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set (durable, public URL), else the
 * local disk (`FABLE_MEDIA_DIR`, default ./data/media; the OS temp dir on a read-only disk). The
 * `media` row keeps where each file lives; `/api/media/<id>` serves local files and redirects to
 * Blob URLs, so pages never care which store holds a file.
 */
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ENV } from "../config/fable.ts";
import type { Q } from "./db.ts";
import { num } from "./db.ts";

export interface MediaRow {
  id: string;
  kind: "image" | "video";
  mime: string;
  size: number;
  storage: "blob" | "local";
  location: string;
  characterId: string | null;
  jobId: string | null;
  createdAt: number;
}

export function mediaDir(): string {
  const dir = process.env["FABLE_MEDIA_DIR"]?.trim() || join(process.cwd(), "data", "media");
  try {
    mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
    accessSync(/* turbopackIgnore: true */ dir, constants.W_OK);
    return dir;
  } catch {
    const t = join(tmpdir(), "fable-media");
    mkdirSync(t, { recursive: true });
    return t;
  }
}

const ext = (mime: string) => (mime === "video/mp4" ? "mp4" : mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png");

export async function putMedia(q: Q, input: { bytes: Buffer; mime: string; kind: "image" | "video"; characterId?: string | null; jobId?: string | null }, now = Date.now()): Promise<MediaRow> {
  const id = randomUUID().replace(/-/g, "").slice(0, 20);
  const file = `${id}.${ext(input.mime)}`;
  let storage: "blob" | "local" = "local";
  let location = file;
  const token = ENV.blobToken();
  if (token) {
    const { put } = await import("@vercel/blob");
    const res = await put(`fable/${file}`, input.bytes, { access: "public", contentType: input.mime, token, addRandomSuffix: false });
    storage = "blob";
    location = res.url;
  } else {
    writeFileSync(join(/* turbopackIgnore: true */ mediaDir(), file), input.bytes);
  }
  await q.query("INSERT INTO media (id, kind, mime, size, storage, location, character_id, job_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
    id,
    input.kind,
    input.mime,
    input.bytes.length,
    storage,
    location,
    input.characterId ?? null,
    input.jobId ?? null,
    now,
  ]);
  return { id, kind: input.kind, mime: input.mime, size: input.bytes.length, storage, location, characterId: input.characterId ?? null, jobId: input.jobId ?? null, createdAt: now };
}

export function toMedia(r: Record<string, unknown>): MediaRow {
  return {
    id: String(r.id),
    kind: r.kind as "image" | "video",
    mime: String(r.mime),
    size: num(r.size),
    storage: r.storage as "blob" | "local",
    location: String(r.location),
    characterId: (r.character_id as string) ?? null,
    jobId: (r.job_id as string) ?? null,
    createdAt: num(r.created_at),
  };
}

export async function getMedia(q: Q, id: string): Promise<MediaRow | null> {
  const rows = await q.query("SELECT * FROM media WHERE id = $1", [id]);
  return rows[0] ? toMedia(rows[0]) : null;
}

/** Bytes of a media row: local file, or fetched from Blob. Null when the file is gone. */
export async function mediaBytes(m: MediaRow): Promise<Buffer | null> {
  if (m.storage === "blob") {
    try {
      const r = await fetch(m.location, { signal: AbortSignal.timeout(20_000) });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }
  const path = join(/* turbopackIgnore: true */ mediaDir(), m.location);
  return existsSync(/* turbopackIgnore: true */ path) ? readFileSync(/* turbopackIgnore: true */ path) : null;
}

export const mediaUrl = (id: string | null | undefined) => (id ? `/api/media/${id}` : null);
