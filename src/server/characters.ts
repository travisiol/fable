/**
 * Characters: drafts (private to their owner) and saved characters (public creator pages).
 * Editing text fields is free; generating a sheet or a portrait is a paid job (jobs.ts).
 */
import { randomUUID } from "node:crypto";
import type { Db, Q } from "./db.ts";
import { num } from "./db.ts";
import { HttpError } from "./errors.ts";
import { mediaUrl } from "./media.ts";

export interface CharacterRow {
  id: string;
  slug: string | null;
  number: number | null;
  owner: string;
  status: "draft" | "saved" | "discarded";
  idea: string;
  name: string;
  bio: string;
  personality: string;
  style: string;
  niche: string;
  look: string;
  portraitMediaId: string | null;
  createdAt: number;
  updatedAt: number;
  savedAt: number | null;
}

export function toCharacter(r: Record<string, unknown>): CharacterRow {
  return {
    id: String(r.id),
    slug: (r.slug as string) ?? null,
    number: r.number === null || r.number === undefined ? null : num(r.number),
    owner: String(r.owner),
    status: r.status as CharacterRow["status"],
    idea: String(r.idea ?? ""),
    name: String(r.name ?? ""),
    bio: String(r.bio ?? ""),
    personality: String(r.personality ?? ""),
    style: String(r.style ?? ""),
    niche: String(r.niche ?? ""),
    look: String(r.look ?? ""),
    portraitMediaId: (r.portrait_media_id as string) ?? null,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    savedAt: r.saved_at === null || r.saved_at === undefined ? null : num(r.saved_at),
  };
}

const clip = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export interface DraftInput {
  idea?: unknown;
  name?: unknown;
  personality?: unknown;
  style?: unknown;
  niche?: unknown;
}

export function cleanDraftInput(input: DraftInput) {
  const idea = clip(input.idea, 400);
  if (idea.length < 8) throw new HttpError(400, "Describe your character in a sentence (at least 8 characters).");
  return { idea, name: clip(input.name, 28), personality: clip(input.personality, 200), style: clip(input.style, 60), niche: clip(input.niche, 100) };
}

export async function createDraft(q: Q, owner: string, input: DraftInput, now = Date.now()): Promise<CharacterRow> {
  const c = cleanDraftInput(input);
  const id = `c_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await q.query(
    "INSERT INTO characters (id, owner, status, idea, name, personality, style, niche, created_at, updated_at) VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$8)",
    [id, owner, c.idea, c.name, c.personality, c.style, c.niche, now],
  );
  return (await getCharacter(q, id))!;
}

export async function getCharacter(q: Q, idOrSlug: string): Promise<CharacterRow | null> {
  const rows = await q.query("SELECT * FROM characters WHERE id = $1 OR slug = $1 LIMIT 1", [idOrSlug]);
  return rows[0] ? toCharacter(rows[0]) : null;
}

export async function ownedCharacter(q: Q, owner: string | null, id: string): Promise<CharacterRow> {
  if (!owner) throw new HttpError(401, "Sign in with your wallet first.");
  const c = await getCharacter(q, id);
  if (!c) throw new HttpError(404, "Character not found.");
  if (c.owner !== owner) throw new HttpError(403, "Only this character's creator can do this.");
  return c;
}

export interface EditInput {
  idea?: unknown;
  name?: unknown;
  bio?: unknown;
  personality?: unknown;
  style?: unknown;
  niche?: unknown;
  look?: unknown;
}

const LIMITS: Record<keyof EditInput, number> = { idea: 400, name: 28, bio: 300, personality: 220, style: 60, niche: 100, look: 320 };

/** Free text edits by the owner. The name is frozen once the character's coin is launched. */
export async function editCharacter(db: Db, owner: string | null, id: string, input: EditInput, now = Date.now()): Promise<CharacterRow> {
  const c = await ownedCharacter(db, owner, id);
  const sets: string[] = [];
  const vals: unknown[] = [id];
  for (const key of Object.keys(LIMITS) as (keyof EditInput)[]) {
    if (input[key] === undefined) continue;
    const v = clip(input[key], LIMITS[key]);
    if (key === "name") {
      if (v.length < 2) throw new HttpError(400, "A name needs at least 2 characters.");
      const launched = await db.query("SELECT 1 FROM launches WHERE character_id = $1 AND status IN ('submitted','confirmed')", [id]);
      if (launched.length && v !== c.name) throw new HttpError(409, "The name is fixed once the coin is launched.");
    }
    vals.push(v);
    sets.push(`${key} = $${vals.length}`);
  }
  if (!sets.length) return c;
  vals.push(now);
  await db.query(`UPDATE characters SET ${sets.join(", ")}, updated_at = $${vals.length} WHERE id = $1`, vals);
  return (await getCharacter(db, id))!;
}

export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "character"
  );
}

/** Draft → saved: gets a public page (slug) and a catalogue number. Idempotent. */
export async function saveCharacter(db: Db, owner: string | null, id: string, now = Date.now()): Promise<CharacterRow> {
  const c = await ownedCharacter(db, owner, id);
  if (c.status === "saved") return c;
  if (!c.portraitMediaId || c.name.length < 2 || c.bio.length < 2) throw new HttpError(400, "Generate the portrait and identity before saving.");
  return db.tx(async (q) => {
    const fresh = toCharacter((await q.query("SELECT * FROM characters WHERE id = $1 FOR UPDATE", [id]))[0]);
    if (fresh.status === "saved") return fresh;
    const base = slugify(fresh.name);
    let slug = base;
    for (let i = 2; (await q.query("SELECT 1 FROM characters WHERE slug = $1", [slug])).length; i++) slug = `${base}-${i}`;
    const next = num((await q.query("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM characters"))[0]?.n);
    await q.query("UPDATE characters SET status = 'saved', slug = $2, number = $3, saved_at = $4, updated_at = $4 WHERE id = $1", [id, slug, next, now]);
    return toCharacter((await q.query("SELECT * FROM characters WHERE id = $1", [id]))[0]);
  });
}

/** Deletes a draft (never a saved character). Its jobs and media stay in the history. */
export async function discardDraft(db: Db, owner: string | null, id: string): Promise<void> {
  const c = await ownedCharacter(db, owner, id);
  if (c.status !== "draft") throw new HttpError(409, "Saved characters cannot be discarded.");
  const open = await db.query("SELECT 1 FROM jobs WHERE character_id = $1 AND status IN ('queued','running')", [id]);
  if (open.length) throw new HttpError(409, "Wait for the generation to finish first.");
  await db.query("UPDATE characters SET status = 'discarded', updated_at = $2 WHERE id = $1", [id, Date.now()]);
}

// ───────────────────────────── public views

export interface CharacterCard {
  id: string;
  slug: string;
  number: number;
  name: string;
  bio: string;
  niche: string;
  portrait: string | null;
  ticker: string | null;
  mint: string | null;
  tokenStatus: "none" | "pending" | "live";
  savedAt: number;
}

export type ExploreFilter = "all" | "token" | "new";

export async function listPublic(q: Q, opts: { filter?: ExploreFilter; search?: string; limit?: number } = {}): Promise<CharacterCard[]> {
  const where: string[] = ["c.status = 'saved'"];
  const vals: unknown[] = [];
  if (opts.filter === "token") where.push("l.status = 'confirmed'");
  if (opts.filter === "new") {
    vals.push(Date.now() - 14 * 86_400_000);
    where.push(`c.saved_at >= $${vals.length}`);
  }
  const s = clip(opts.search, 40).replace(/^\$/, "");
  if (s) {
    vals.push(`%${s.toLowerCase()}%`);
    where.push(`(LOWER(c.name) LIKE $${vals.length} OR (l.status = 'confirmed' AND LOWER(l.ticker) LIKE $${vals.length}))`);
  }
  vals.push(Math.min(200, opts.limit ?? 60));
  const rows = await q.query(
    `SELECT c.*, l.ticker, l.mint, l.status AS launch_status FROM characters c
     LEFT JOIN launches l ON l.character_id = c.id AND l.status IN ('prepared','submitted','confirmed')
     WHERE ${where.join(" AND ")} ORDER BY c.saved_at DESC LIMIT $${vals.length}`,
    vals,
  );
  return rows.map(toCard);
}

export function toCard(r: Record<string, unknown>): CharacterCard {
  const c = toCharacter(r);
  const ls = r.launch_status as string | null;
  return {
    id: c.id,
    slug: c.slug ?? c.id,
    number: c.number ?? 0,
    name: c.name,
    bio: c.bio,
    niche: c.niche,
    portrait: mediaUrl(c.portraitMediaId),
    ticker: ls === "confirmed" ? ((r.ticker as string) ?? null) : null,
    mint: ls === "confirmed" ? ((r.mint as string) ?? null) : null,
    tokenStatus: ls === "confirmed" ? "live" : ls === "prepared" || ls === "submitted" ? "pending" : "none",
    savedAt: c.savedAt ?? c.createdAt,
  };
}

export async function listOwned(q: Q, owner: string): Promise<(CharacterRow & { launchStatus: string | null; ticker: string | null; mint: string | null; sharingStatus: string | null })[]> {
  const rows = await q.query(
    `SELECT c.*, l.status AS launch_status, l.ticker, l.mint, l.sharing_status FROM characters c
     LEFT JOIN launches l ON l.character_id = c.id AND l.status IN ('prepared','submitted','confirmed')
     WHERE c.owner = $1 AND c.status <> 'discarded' ORDER BY c.updated_at DESC LIMIT 100`,
    [owner],
  );
  return rows.map((r) => ({
    ...toCharacter(r),
    launchStatus: (r.launch_status as string) ?? null,
    ticker: (r.ticker as string) ?? null,
    mint: (r.mint as string) ?? null,
    sharingStatus: (r.sharing_status as string) ?? null,
  }));
}

export async function galleryFor(q: Q, characterId: string, limit = 48): Promise<{ id: string; kind: "image" | "video"; url: string; createdAt: number; prompt: string; preset: string | null }[]> {
  const rows = await q.query(
    `SELECT m.id, m.kind, m.created_at, j.prompt, j.preset FROM media m JOIN jobs j ON j.result_media_id = m.id
     WHERE m.character_id = $1 AND j.status = 'succeeded' AND j.kind IN ('image','video') ORDER BY m.created_at DESC LIMIT $2`,
    [characterId, limit],
  );
  return rows.map((r) => ({ id: String(r.id), kind: r.kind as "image" | "video", url: `/api/media/${r.id}`, createdAt: num(r.created_at), prompt: String(r.prompt ?? ""), preset: (r.preset as string) ?? null }));
}
