/**
 * Generation jobs: queued → running → succeeded | failed | cancelled.
 *
 * submitJob():  one transaction — idempotency key lookup, payer account locked (FOR UPDATE), balance
 *               check, job row, reservation. A job is paid by exactly one source (schema CHECK).
 * runJob():     claims the job with a lease (a vanished worker's lease expires and the next tick
 *               picks the job up again), calls the provider, stores the result, then settles:
 *               spend on success, release on final failure — each at most once (ledger.ts).
 *               Video is asynchronous at the provider: the operation id is stored on the job and
 *               every later tick polls it, so a clip survives page refreshes and function timeouts.
 * tickJobs():   advances due jobs (cron route + client polling + after() right after submit).
 * cancelJob():  only while queued (a running provider call is already being paid for).
 */
import { randomUUID } from "node:crypto";
import { COSTS, JOB_LEASE_MS, MAX_ACTIVE_JOBS_PER_WALLET, MAX_JOB_ATTEMPTS, PRESETS } from "../config/fable.ts";
import type { JobKind } from "../config/fable.ts";
import type { Img, Providers } from "./ai.ts";
import { ProviderError, clipPrompt, portraitPrompt, studioPrompt } from "./ai.ts";
import { getCharacter } from "./characters.ts";
import type { CharacterRow } from "./characters.ts";
import type { Db, Q } from "./db.ts";
import { num } from "./db.ts";
import { HttpError } from "./errors.ts";
import { characterAccount, ensureAccount, reserve, settle, walletAccount } from "./ledger.ts";
import { getMedia, mediaBytes, mediaUrl, putMedia } from "./media.ts";

export type Payer = "holder_credits" | "character_budget";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobRow {
  id: string;
  owner: string;
  characterId: string;
  kind: JobKind;
  preset: string | null;
  prompt: string;
  format: string;
  payer: Payer;
  payerAccount: string;
  cost: number;
  status: JobStatus;
  attempts: number;
  provider: string | null;
  providerJobId: string | null;
  error: string | null;
  resultMediaId: string | null;
  resultJson: string | null;
  idempotencyKey: string;
  leaseUntil: number | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export function toJob(r: Record<string, unknown>): JobRow {
  return {
    id: String(r.id),
    owner: String(r.owner),
    characterId: String(r.character_id),
    kind: r.kind as JobKind,
    preset: (r.preset as string) ?? null,
    prompt: String(r.prompt ?? ""),
    format: String(r.format ?? ""),
    payer: r.payer as Payer,
    payerAccount: String(r.payer_account),
    cost: num(r.cost),
    status: r.status as JobStatus,
    attempts: num(r.attempts),
    provider: (r.provider as string) ?? null,
    providerJobId: (r.provider_job_id as string) ?? null,
    error: (r.error as string) ?? null,
    resultMediaId: (r.result_media_id as string) ?? null,
    resultJson: (r.result_json as string) ?? null,
    idempotencyKey: String(r.idempotency_key),
    leaseUntil: r.lease_until === null || r.lease_until === undefined ? null : num(r.lease_until),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    finishedAt: r.finished_at === null || r.finished_at === undefined ? null : num(r.finished_at),
  };
}

export async function getJob(q: Q, id: string): Promise<JobRow | null> {
  const rows = await q.query("SELECT * FROM jobs WHERE id = $1", [id]);
  return rows[0] ? toJob(rows[0]) : null;
}

export interface SubmitInput {
  characterId: string;
  kind: JobKind;
  preset?: string | null;
  prompt?: string;
  format?: string;
  payer: Payer;
  idempotencyKey: string;
}

const clip = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function validate(input: SubmitInput, c: CharacterRow) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey ?? "")) throw new HttpError(400, "Missing request key.");
  if (input.payer !== "holder_credits" && input.payer !== "character_budget") throw new HttpError(400, "Choose which balance pays for this job.");
  if (input.kind === "image" || input.kind === "video") {
    if (c.status !== "saved") throw new HttpError(409, "Save the character before creating content with it.");
    if (!c.portraitMediaId) throw new HttpError(409, "This character has no portrait to use as a reference.");
    const preset = PRESETS.find((p) => p.id === input.preset);
    if (!preset) throw new HttpError(400, "Choose a preset.");
    if ((preset.mode === "video") !== (input.kind === "video")) throw new HttpError(400, "That preset does not match the mode.");
    if (clip(input.prompt, 600).length < 3) throw new HttpError(400, "Describe what you want in a few words.");
  }
  if (input.payer === "character_budget" && c.status !== "saved") throw new HttpError(409, "Only a saved character has a content budget.");
  if (input.kind === "character" && input.payer !== "holder_credits") throw new HttpError(400, "A new character is paid from your Studio credits.");
}

/**
 * Creates a job and reserves its cost on exactly one balance, atomically. Repeating the same
 * idempotency key returns the first job (no second reservation).
 */
export async function submitJob(db: Db, owner: string, input: SubmitInput, now = Date.now()): Promise<{ job: JobRow; created: boolean }> {
  const existing = await db.query("SELECT * FROM jobs WHERE owner = $1 AND idempotency_key = $2", [owner, input.idempotencyKey ?? ""]);
  if (existing[0]) return { job: toJob(existing[0]), created: false };
  const c = await getCharacter(db, input.characterId);
  if (!c || c.status === "discarded") throw new HttpError(404, "Character not found.");
  if (c.owner !== owner) throw new HttpError(403, "Only this character's creator can generate with it.");
  validate(input, c);
  const cost = COSTS[input.kind];
  const account = input.payer === "holder_credits" ? walletAccount(owner) : characterAccount(c.id);
  const id = `j_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  try {
    const job = await db.tx(async (q) => {
      await ensureAccount(q, account, input.payer, input.payer === "holder_credits" ? owner : c.id, now);
      // the account row lock serialises every reservation on this balance
      await q.query("SELECT id FROM credit_accounts WHERE id = $1 FOR UPDATE", [account]);
      const dup = await q.query("SELECT * FROM jobs WHERE owner = $1 AND idempotency_key = $2", [owner, input.idempotencyKey]);
      if (dup[0]) return toJob(dup[0]);
      const active = num((await q.query("SELECT COUNT(*) AS n FROM jobs WHERE owner = $1 AND status IN ('queued','running')", [owner]))[0]?.n);
      if (active >= MAX_ACTIVE_JOBS_PER_WALLET) throw new HttpError(429, `Up to ${MAX_ACTIVE_JOBS_PER_WALLET} jobs at a time. Wait for one to finish.`);
      await q.query(
        `INSERT INTO jobs (id, owner, character_id, kind, preset, prompt, format, payer, payer_account, cost, status, idempotency_key, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12,$12)`,
        [id, owner, c.id, input.kind, input.preset ?? null, clip(input.prompt, 600), clip(input.format, 20), input.payer, account, cost, input.idempotencyKey, now],
      );
      await reserve(q, account, id, cost, now);
      return toJob((await q.query("SELECT * FROM jobs WHERE id = $1", [id]))[0]);
    });
    return { job, created: job.id === id };
  } catch (e) {
    // two concurrent submits with the same key: the loser hits the unique index and gets the winner
    if (e instanceof HttpError) throw e;
    const again = await db.query("SELECT * FROM jobs WHERE owner = $1 AND idempotency_key = $2", [owner, input.idempotencyKey]);
    if (again[0]) return { job: toJob(again[0]), created: false };
    throw e;
  }
}

// ───────────────────────────── running

async function claim(db: Db, id: string, now: number): Promise<JobRow | null> {
  const rows = await db.query(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_until = $2, updated_at = $3
     WHERE id = $1 AND (status = 'queued' OR (status = 'running' AND provider_job_id IS NULL AND lease_until < $3))
     RETURNING *`,
    [id, now + JOB_LEASE_MS, now],
  );
  return rows[0] ? toJob(rows[0]) : null;
}

/** Marks the job succeeded and charges its reservation, once. */
export async function succeed(db: Db, id: string, patch: { mediaId?: string | null; json?: string | null }, now = Date.now()): Promise<boolean> {
  return db.tx(async (q) => {
    const rows = await q.query(
      "UPDATE jobs SET status = 'succeeded', result_media_id = COALESCE($2, result_media_id), result_json = COALESCE($3, result_json), error = NULL, lease_until = NULL, finished_at = $4, updated_at = $4 WHERE id = $1 AND status = 'running' RETURNING id",
      [id, patch.mediaId ?? null, patch.json ?? null, now],
    );
    if (!rows.length) return false;
    await settle(q, id, "spend", now);
    return true;
  });
}

/** Final failure: the job fails and its reservation is released, once. */
export async function fail(db: Db, id: string, message: string, now = Date.now()): Promise<boolean> {
  return db.tx(async (q) => {
    const rows = await q.query(
      "UPDATE jobs SET status = 'failed', error = $2, lease_until = NULL, finished_at = $3, updated_at = $3 WHERE id = $1 AND status IN ('queued','running') RETURNING id",
      [id, message.slice(0, 300), now],
    );
    if (!rows.length) return false;
    await settle(q, id, "release", now);
    return true;
  });
}

async function retryOrFail(db: Db, job: JobRow, e: unknown, now: number) {
  const message = e instanceof ProviderError || e instanceof HttpError ? e.message : "The generation failed unexpectedly.";
  const retryable = e instanceof ProviderError ? e.retryable : !(e instanceof HttpError);
  if (retryable && job.attempts < MAX_JOB_ATTEMPTS) {
    await db.query("UPDATE jobs SET status = 'queued', error = $2, lease_until = NULL, provider_job_id = NULL, updated_at = $3 WHERE id = $1 AND status = 'running'", [job.id, `Attempt ${job.attempts} failed: ${message} Retrying.`, now]);
  } else {
    await fail(db, job.id, message, now);
  }
}

async function portraitRef(db: Db, c: CharacterRow): Promise<Img> {
  const m = c.portraitMediaId ? await getMedia(db, c.portraitMediaId) : null;
  const bytes = m ? await mediaBytes(m) : null;
  if (!m || !bytes) throw new ProviderError("The character's portrait file is missing.", false);
  return { mime: m.mime, bytes };
}

/** One step of a job. Safe to call concurrently and repeatedly. */
export async function runJob(db: Db, id: string, prov: Providers, now = Date.now()): Promise<JobRow | null> {
  let job = await getJob(db, id);
  if (!job) return null;
  if (job.kind === "video" && job.status === "running" && job.providerJobId) return pollVideo(db, job, prov);
  job = await claim(db, id, now);
  if (!job) return getJob(db, id);
  const c = await getCharacter(db, job.characterId);
  if (!c) {
    await fail(db, job.id, "The character no longer exists.", now);
    return getJob(db, id);
  }
  try {
    if (job.kind === "character") {
      if (!prov.images) throw new ProviderError("Character design is not configured.", false);
      // the sheet is kept between attempts so a portrait retry does not pay for a second sheet
      let sheet = job.resultJson ? (JSON.parse(job.resultJson) as Awaited<ReturnType<Providers["sheet"]>>) : null;
      if (!sheet) {
        sheet = await prov.sheet({ idea: c.idea, name: c.name, personality: c.personality, style: c.style, niche: c.niche });
        await db.query("UPDATE jobs SET result_json = $2, provider = 'openai' WHERE id = $1", [job.id, JSON.stringify(sheet)]);
      }
      const img = await prov.image(portraitPrompt({ ...sheet, style: c.style }), [], "1024x1024");
      const media = await putMedia(db, { bytes: img.bytes, mime: img.mime, kind: "image", characterId: c.id, jobId: job.id });
      if (await succeed(db, job.id, { mediaId: media.id, json: JSON.stringify(sheet) })) {
        await db.query(
          "UPDATE characters SET name = $2, bio = $3, personality = $4, niche = $5, look = $6, portrait_media_id = $7, updated_at = $8 WHERE id = $1 AND status = 'draft'",
          [c.id, sheet.name, sheet.bio, sheet.personality, sheet.niche, sheet.look, media.id, Date.now()],
        );
      }
    } else if (job.kind === "portrait") {
      if (!prov.images) throw new ProviderError("Image generation is not configured.", false);
      const img = await prov.image(portraitPrompt(c), [], "1024x1024");
      const media = await putMedia(db, { bytes: img.bytes, mime: img.mime, kind: "image", characterId: c.id, jobId: job.id });
      if (await succeed(db, job.id, { mediaId: media.id })) {
        await db.query("UPDATE characters SET portrait_media_id = $2, updated_at = $3 WHERE id = $1 AND status = 'draft'", [c.id, media.id, Date.now()]);
      }
    } else if (job.kind === "image") {
      if (!prov.images) throw new ProviderError("Image generation is not configured.", false);
      const ref = await portraitRef(db, c);
      const img = await prov.image(studioPrompt(c, job.preset ?? "scene", job.prompt), [ref], job.format || "1024x1024");
      const media = await putMedia(db, { bytes: img.bytes, mime: img.mime, kind: "image", characterId: c.id, jobId: job.id });
      await db.query("UPDATE jobs SET provider = 'openai' WHERE id = $1", [job.id]);
      await succeed(db, job.id, { mediaId: media.id });
    } else {
      if (!prov.video) throw new ProviderError("Video generation is not configured.", false);
      const ref = await portraitRef(db, c);
      const opId = await prov.videoStart(clipPrompt(c, job.prompt), ref, job.format || "9:16");
      await db.query("UPDATE jobs SET provider = 'veo', provider_job_id = $2, lease_until = NULL, updated_at = $3 WHERE id = $1 AND status = 'running'", [job.id, opId, Date.now()]);
    }
  } catch (e) {
    await retryOrFail(db, job, e, Date.now());
  }
  return getJob(db, id);
}

async function pollVideo(db: Db, job: JobRow, prov: Providers): Promise<JobRow | null> {
  try {
    const st = await prov.videoPoll(job.providerJobId!);
    if (st.status === "pending") {
      await db.query("UPDATE jobs SET updated_at = $2 WHERE id = $1", [job.id, Date.now()]);
    } else if (st.status === "failed") {
      await fail(db, job.id, st.error);
    } else {
      const fresh = await getJob(db, job.id);
      if (fresh?.status !== "running") return fresh;
      const bytes = await prov.videoDownload(st.uri);
      const media = await putMedia(db, { bytes, mime: "video/mp4", kind: "video", characterId: job.characterId, jobId: job.id });
      await succeed(db, job.id, { mediaId: media.id });
    }
  } catch (e) {
    // provider unreachable: the next poll retries; a hard refusal ends the job
    if (e instanceof ProviderError && !e.retryable) await fail(db, job.id, e.message);
  }
  return getJob(db, job.id);
}

/** Advances due jobs: queued, expired leases, and video operations waiting at the provider. */
export async function tickJobs(db: Db, prov: Providers, limit = 4, now = Date.now()): Promise<number> {
  const rows = await db.query(
    `SELECT id FROM jobs WHERE status = 'queued' OR (status = 'running' AND (provider_job_id IS NOT NULL OR lease_until < $1))
     ORDER BY updated_at ASC LIMIT $2`,
    [now, limit],
  );
  for (const r of rows) await runJob(db, String(r.id), prov, now);
  return rows.length;
}

export async function cancelJob(db: Db, owner: string, id: string, now = Date.now()): Promise<JobRow> {
  const job = await getJob(db, id);
  if (!job || job.owner !== owner) throw new HttpError(404, "Job not found.");
  if (job.status !== "queued") throw new HttpError(409, job.status === "running" ? "This job has already started at the provider and cannot be cancelled." : "This job has already finished.");
  await db.tx(async (q) => {
    const rows = await q.query("UPDATE jobs SET status = 'cancelled', finished_at = $2, updated_at = $2, lease_until = NULL WHERE id = $1 AND status = 'queued' RETURNING id", [id, now]);
    if (rows.length) await settle(q, id, "release", now);
  });
  return (await getJob(db, id))!;
}

// ───────────────────────────── views

export interface JobView {
  id: string;
  characterId: string;
  kind: JobKind;
  preset: string | null;
  prompt: string;
  format: string;
  payer: Payer;
  cost: number;
  status: JobStatus;
  attempts: number;
  error: string | null;
  result: string | null;
  resultKind: "image" | "video" | null;
  createdAt: number;
  finishedAt: number | null;
}

export function jobView(j: JobRow): JobView {
  return {
    id: j.id,
    characterId: j.characterId,
    kind: j.kind,
    preset: j.preset,
    prompt: j.prompt,
    format: j.format,
    payer: j.payer,
    cost: j.cost,
    status: j.status,
    attempts: j.attempts,
    error: j.error,
    result: mediaUrl(j.resultMediaId),
    resultKind: j.resultMediaId ? (j.kind === "video" ? "video" : "image") : null,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt,
  };
}

export async function jobsFor(q: Q, owner: string, opts: { characterId?: string; limit?: number } = {}): Promise<JobView[]> {
  const vals: unknown[] = [owner];
  let where = "owner = $1";
  if (opts.characterId) {
    vals.push(opts.characterId);
    where += ` AND character_id = $${vals.length}`;
  }
  vals.push(opts.limit ?? 30);
  const rows = await q.query(`SELECT * FROM jobs WHERE ${where} ORDER BY created_at DESC LIMIT $${vals.length}`, vals);
  return rows.map((r) => jobView(toJob(r)));
}

