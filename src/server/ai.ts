/**
 * AI providers, server-side only. Keys are read from the env at call time; `fetcher` lets tests
 * and the local rig answer instead of the real APIs (OPENAI_BASE_URL / GEMINI_BASE_URL also point
 * the same code at a local stub).
 *
 *  OpenAI (OPENAI_API_KEY)
 *   - sheet():  chat completions with a strict JSON schema (structured outputs) → character sheet
 *   - image():  images/generations, or images/edits with the character portrait as reference image
 *               (identity preserved as closely as the model allows — the model does not guarantee it)
 *  Google Gemini API, Veo (GEMINI_API_KEY) — OpenAI shut its Videos API (Sora 2) down on 2026-09-24
 *   - videoStart(): models/<veo>:predictLongRunning with the portrait as an "asset" reference image
 *   - videoPoll():  GET the long-running operation by name (survives request timeouts: the id is stored)
 *   - videoDownload(): the generated sample's uri, with the API key header
 */
import { ENV } from "../config/fable.ts";

export type Fetcher = typeof fetch;

export interface SheetInput {
  idea: string;
  name: string;
  personality: string;
  style: string;
  niche: string;
}

export interface Sheet {
  name: string;
  bio: string;
  personality: string;
  niche: string;
  look: string;
}

export interface Img {
  mime: string;
  bytes: Buffer;
}

export type VideoPoll = { status: "pending" } | { status: "done"; uri: string } | { status: "failed"; error: string };

export interface Providers {
  images: boolean;
  video: boolean;
  sheet(input: SheetInput): Promise<Sheet>;
  image(prompt: string, refs: Img[], size: string): Promise<Img>;
  videoStart(prompt: string, ref: Img | null, aspect: string): Promise<string>;
  videoPoll(id: string): Promise<VideoPoll>;
  videoDownload(uri: string): Promise<Buffer>;
}

/** A provider refused or failed. `retryable` = worth another attempt (timeouts, 5xx, 429). */
export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ProviderError";
    this.retryable = retryable;
  }
}

const SHEET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "bio", "personality", "niche", "look"],
  properties: {
    name: { type: "string", description: "Display name, 2-28 characters, original: never a real person, celebrity, brand or existing fictional character." },
    bio: { type: "string", description: "Short biography, two sentences, under 260 characters, written in the third person." },
    personality: { type: "string", description: "Personality summary: three or four traits and how they talk, under 200 characters." },
    niche: { type: "string", description: "What their content is about, under 90 characters." },
    look: { type: "string", description: "Visual description for a portrait: face, age range, hair, wardrobe, colours, setting. Under 300 characters." },
  },
} as const;

const SHEET_SYSTEM =
  "You design original virtual characters for a creator studio. From the brief, write a character sheet. The character must be fictional and original: never a real person, celebrity, brand, or an existing character. No sexual content, no hate, no real-world harm. Keep the user's chosen name if one is given. Reply with the JSON only.";

const clip = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function validateSheet(raw: unknown, input: SheetInput): Sheet {
  if (!raw || typeof raw !== "object") throw new ProviderError("The model returned an unreadable character sheet.", true);
  const o = raw as Record<string, unknown>;
  const sheet: Sheet = {
    name: clip(input.name || o.name, 28),
    bio: clip(o.bio, 300),
    personality: clip(o.personality, 220),
    niche: clip(input.niche || o.niche, 100),
    look: clip(o.look, 320),
  };
  for (const k of ["name", "bio", "personality", "look"] as const) if (sheet[k].length < 2) throw new ProviderError(`The model left the ${k} empty.`, true);
  return sheet;
}

export function sheetPrompt(input: SheetInput): string {
  return [
    `Character idea: ${input.idea}`,
    input.name ? `Name (keep it): ${input.name}` : "Name: suggest one",
    input.personality ? `Personality: ${input.personality}` : "",
    input.style ? `Visual style: ${input.style}` : "",
    input.niche ? `Content niche: ${input.niche}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function failFrom(r: Response, what: string): Promise<never> {
  let detail = "";
  try {
    const j = (await r.json()) as { error?: { message?: string; code?: string } };
    detail = j.error?.code === "moderation_blocked" || /safety|moderation/i.test(j.error?.message ?? "") ? " The request was refused by the provider's safety system." : "";
  } catch {
    // body unreadable
  }
  const retryable = r.status === 429 || r.status >= 500;
  throw new ProviderError(`${what} failed (HTTP ${r.status}).${detail}`, retryable);
}

export function providers(fetcher: Fetcher = fetch): Providers {
  const key = ENV.openaiKey();
  const gkey = ENV.geminiKey();
  const base = ENV.openaiBase();
  const gbase = ENV.geminiBase();
  const auth = { authorization: `Bearer ${key ?? ""}` };
  const gauth = { "x-goog-api-key": gkey ?? "" };

  const guard = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(`${what} did not answer in time.`, true);
    }
  };

  return {
    images: Boolean(key),
    video: Boolean(gkey),

    sheet: (input) =>
      guard("Character design", async () => {
        if (!key) throw new ProviderError("Character design is not configured.", false);
        const r = await fetcher(`${base}/chat/completions`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({
            model: ENV.textModel(),
            messages: [
              { role: "system", content: SHEET_SYSTEM },
              { role: "user", content: sheetPrompt(input) },
            ],
            response_format: { type: "json_schema", json_schema: { name: "character_sheet", strict: true, schema: SHEET_SCHEMA } },
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!r.ok) await failFrom(r, "Character design");
        const j = (await r.json()) as { choices?: { message?: { content?: string; refusal?: string } }[] };
        const msg = j.choices?.[0]?.message;
        if (msg?.refusal) throw new ProviderError("The model declined this character idea. Try describing it differently.", false);
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(msg?.content ?? ""));
        } catch {
          throw new ProviderError("The model returned an unreadable character sheet.", true);
        }
        return validateSheet(parsed, input);
      }),

    image: (prompt, refs, size) =>
      guard("Image generation", async () => {
        if (!key) throw new ProviderError("Image generation is not configured.", false);
        let r: Response;
        if (refs.length) {
          const form = new FormData();
          form.set("model", ENV.imageModel());
          form.set("prompt", prompt);
          form.set("size", size);
          form.set("quality", ENV.imageQuality());
          refs.forEach((ref, i) => form.append("image[]", new Blob([new Uint8Array(ref.bytes)], { type: ref.mime }), `reference-${i}.png`));
          r = await fetcher(`${base}/images/edits`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(170_000) });
        } else {
          r = await fetcher(`${base}/images/generations`, {
            method: "POST",
            headers: { ...auth, "content-type": "application/json" },
            body: JSON.stringify({ model: ENV.imageModel(), prompt, size, quality: ENV.imageQuality(), n: 1 }),
            signal: AbortSignal.timeout(170_000),
          });
        }
        if (!r.ok) await failFrom(r, "Image generation");
        const j = (await r.json()) as { data?: { b64_json?: string }[]; output_format?: string };
        const b64 = j.data?.[0]?.b64_json;
        if (!b64) throw new ProviderError("Image generation returned no image.", true);
        const fmt = j.output_format === "jpeg" ? "image/jpeg" : j.output_format === "webp" ? "image/webp" : "image/png";
        return { mime: fmt, bytes: Buffer.from(b64, "base64") };
      }),

    videoStart: (prompt, ref, aspect) =>
      guard("Video generation", async () => {
        if (!gkey) throw new ProviderError("Video generation is not configured.", false);
        const instance: Record<string, unknown> = { prompt };
        if (ref) instance.referenceImages = [{ image: { inlineData: { mimeType: ref.mime, data: ref.bytes.toString("base64") } }, referenceType: "asset" }];
        const r = await fetcher(`${gbase}/models/${ENV.videoModel()}:predictLongRunning`, {
          method: "POST",
          headers: { ...gauth, "content-type": "application/json" },
          body: JSON.stringify({ instances: [instance], parameters: { aspectRatio: aspect === "16:9" ? "16:9" : "9:16", durationSeconds: 8, resolution: "720p", personGeneration: "allow_adult" } }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!r.ok) await failFrom(r, "Video generation");
        const j = (await r.json()) as { name?: string };
        if (!j.name) throw new ProviderError("Video generation returned no operation id.", true);
        return j.name;
      }),

    videoPoll: (id) =>
      guard("Video status", async () => {
        if (!gkey) throw new ProviderError("Video generation is not configured.", false);
        const r = await fetcher(`${gbase}/${id}`, { headers: gauth, signal: AbortSignal.timeout(30_000) });
        if (!r.ok) await failFrom(r, "Video status");
        type Op = { done?: boolean; error?: { message?: string }; response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredReasons?: string[] } } };
        const j = (await r.json()) as Op;
        if (!j.done) return { status: "pending" };
        if (j.error) return { status: "failed", error: "The video model could not finish this clip." };
        const uri = j.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) return { status: "failed", error: j.response?.generateVideoResponse?.raiMediaFilteredReasons?.length ? "The clip was blocked by the provider's safety filter." : "The video model returned no clip." };
        return { status: "done", uri };
      }),

    videoDownload: (uri) =>
      guard("Video download", async () => {
        const r = await fetcher(uri, { headers: gauth, redirect: "follow", signal: AbortSignal.timeout(120_000) });
        if (!r.ok) await failFrom(r, "Video download");
        return Buffer.from(await r.arrayBuffer());
      }),
  };
}

// ───────────────────────────── prompts


export function portraitPrompt(c: { name: string; look: string; bio: string; style: string }): string {
  return `${c.style || "Photographic portrait"} of an original fictional character called ${c.name}. ${c.bio} Look: ${c.look}. Head and shoulders, expressive, looking at the camera, soft studio light on a plain warm ivory backdrop, casting-catalogue photo. No text, no logos, no watermark.`;
}

export function studioPrompt(c: { name: string; look: string; style: string }, preset: string, prompt: string): string {
  const keep = `Keep the same character as the reference image (${c.name}): same face, hair and overall look (${c.look}).`;
  const style = c.style ? ` Style: ${c.style}.` : "";
  switch (preset) {
    case "portrait":
      return `${keep} A new head-and-shoulders portrait. ${prompt}.${style} No text, no logos, no watermark.`;
    case "outfit":
      return `${keep} Same person, new outfit: ${prompt}. Three-quarter view.${style} No text, no logos, no watermark.`;
    default:
      return `${keep} Scene: ${prompt}.${style} No text, no logos, no watermark.`;
  }
}

export function clipPrompt(c: { name: string; look: string; personality: string }, prompt: string): string {
  return `An 8-second vertical clip of ${c.name}, an original AI-generated character (${c.look}), speaking to camera. Personality: ${c.personality}. What they say or do: ${prompt}. Natural motion, no on-screen text, no logos, no watermark.`;
}
