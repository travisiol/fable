/**
 * FABLE product configuration: economics, generation costs, allocation rules and the env names the
 * server reads. Imported by server modules, pages and node tests (relative imports only).
 *
 * Every number a visitor sees on the "Rules" page comes from here. Change them here (or through the
 * env overrides noted below) and the published rules change with them.
 */

// ───────────────────────────── units

/**
 * One Studio credit is worth CREDIT_LAMPORTS of SOL received by a pool. Credits are integers; SOL
 * amounts are integer lamports. 50 000 lamports = 0.00005 SOL ≈ $0.01 at $200 / SOL: re-set it when
 * the SOL price moves a lot (env `FABLE_CREDIT_LAMPORTS`), it only applies to receipts ingested after.
 */
export function creditLamports(): bigint {
  const raw = process.env["FABLE_CREDIT_LAMPORTS"]?.trim();
  const n = raw && /^\d+$/.test(raw) ? BigInt(raw) : BigInt(50_000);
  return n > BigInt(0) ? n : BigInt(50_000);
}

export const lamportsToCredits = (lamports: bigint, per = creditLamports()): number => Number(lamports / per);

// ───────────────────────────── fee allocation (proposed model, spec §3)

/** Basis points of creator fees received. Sum = 10 000. */
export const FEE_SPLIT_BPS = { holderPool: 3000, characterBudget: 4000, creator: 3000 } as const;

/** Splits an amount by FEE_SPLIT_BPS; any rounding dust goes to the character budget so nothing is lost. */
export function splitReceipt(lamports: bigint): { holderPool: bigint; characterBudget: bigint; creator: bigint } {
  const holderPool = (lamports * BigInt(FEE_SPLIT_BPS.holderPool)) / BigInt(10_000);
  const creator = (lamports * BigInt(FEE_SPLIT_BPS.creator)) / BigInt(10_000);
  return { holderPool, creator, characterBudget: lamports - holderPool - creator };
}

// ───────────────────────────── generation costs (spec §4, §7, §11)

export type Preset = "portrait" | "outfit" | "scene" | "talking";
export type JobKind = "character" | "portrait" | "image" | "video";

/**
 * Estimated provider cost of each generation, in credits, shown before every submission and
 * reserved when the job starts. Basis (OpenAI pricing page, 2026-10-08): gpt-image-2 at $30 / 1M
 * output image tokens (a medium 1024² image ≈ 1 100 tokens ≈ $0.035), image inputs $8 / 1M
 * (a reference portrait ≈ $0.01), plus a structured-output text call for the character sheet.
 * Video: Google Veo (Gemini API) — price not published on the guide page, estimated conservatively.
 */
export const COSTS = {
  /** Character sheet (text) + first portrait. */
  character: 6,
  /** A new portrait for an existing draft. */
  portrait: 5,
  /** A Studio image with the portrait as reference (portrait, outfit, scene). */
  image: 7,
  /** A Studio talking clip (video, 8 s). */
  video: 160,
} as const;

export function costOf(kind: JobKind): number {
  return COSTS[kind];
}

export const PRESETS: { id: Preset; label: string; mode: "image" | "video"; hint: string }[] = [
  { id: "portrait", label: "Portrait", mode: "image", hint: "A fresh head-and-shoulders portrait in a new light or mood." },
  { id: "outfit", label: "New outfit", mode: "image", hint: "The same character wearing something new." },
  { id: "scene", label: "Scene", mode: "image", hint: "The character placed in a setting, doing something." },
  { id: "talking", label: "Talking clip", mode: "video", hint: "A short vertical clip of the character speaking to camera." },
];

export const FORMATS = {
  image: [
    { id: "1024x1024", label: "Square 1:1" },
    { id: "1024x1536", label: "Portrait 2:3" },
    { id: "1536x1024", label: "Landscape 3:2" },
  ],
  video: [
    { id: "9:16", label: "Vertical 9:16, 8 s" },
    { id: "16:9", label: "Landscape 16:9, 8 s" },
  ],
} as const;

/** A failed attempt is retried this many times before the job fails and its credits are released. */
export const MAX_JOB_ATTEMPTS = 2;
/** A running job whose worker vanished (function timeout) is picked up again after this lease. */
export const JOB_LEASE_MS = 6 * 60_000;
/** Per-wallet guard against runaway submissions (independent of the balance). */
export const MAX_ACTIVE_JOBS_PER_WALLET = 3;

// ───────────────────────────── weekly allocation (spec §4)

export interface AllocationRules {
  /** Minimum average FABLE balance over the previous 7 daily snapshots (whole tokens). */
  minAverageTokens: number;
  /** Max credits one wallet can receive in one weekly allocation. */
  maxCreditsPerWallet: number;
  /** Share of the allocatable pool distributed each week, in basis points. */
  weeklyShareBps: number;
  /** Share of all funds received by the holder pool kept back for operating costs, in basis points. */
  operatingReserveBps: number;
  /** FABLE token decimals (pump.fun coins use 6). */
  decimals: number;
}

const envInt = (name: string, fallback: number) => {
  const raw = process.env[name]?.trim();
  return raw && /^\d+$/.test(raw) ? Number(raw) : fallback;
};

export function allocationRules(): AllocationRules {
  return {
    minAverageTokens: envInt("FABLE_MIN_AVERAGE_TOKENS", 100_000),
    maxCreditsPerWallet: envInt("FABLE_MAX_CREDITS_PER_WALLET", 300),
    weeklyShareBps: Math.min(10_000, envInt("FABLE_WEEKLY_SHARE_BPS", 5_000)),
    operatingReserveBps: Math.min(10_000, envInt("FABLE_OPERATING_RESERVE_BPS", 1_500)),
    decimals: 6,
  };
}

/** Snapshots are daily (UTC); the allocation for week W uses the 7 days before W's Monday. */
export const SNAPSHOT_DAYS = 7;

// ───────────────────────────── env presence (for the configuration screen)

export const ENV = {
  openaiKey: () => process.env["OPENAI_API_KEY"]?.trim() || null,
  openaiBase: () => (process.env["OPENAI_BASE_URL"]?.trim() || "https://api.openai.com/v1").replace(/\/+$/, ""),
  textModel: () => process.env["OPENAI_TEXT_MODEL"]?.trim() || "gpt-5.5",
  imageModel: () => process.env["OPENAI_IMAGE_MODEL"]?.trim() || "gpt-image-2",
  imageQuality: () => process.env["OPENAI_IMAGE_QUALITY"]?.trim() || "medium",
  geminiKey: () => process.env["GEMINI_API_KEY"]?.trim() || null,
  geminiBase: () => (process.env["GEMINI_BASE_URL"]?.trim() || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, ""),
  videoModel: () => process.env["FABLE_VIDEO_MODEL"]?.trim() || "veo-3.1-generate-preview",
  poolWallet: () => process.env["FABLE_POOL_WALLET"]?.trim() || null,
  budgetWallet: () => process.env["FABLE_BUDGET_WALLET"]?.trim() || null,
  launchEnabled: () => process.env["FABLE_LAUNCH_ENABLED"]?.trim() === "1",
  feeSharingVerified: () => process.env["FABLE_FEE_SHARING_VERIFIED"]?.trim() === "1",
  cronSecret: () => process.env["CRON_SECRET"]?.trim() || null,
  blobToken: () => process.env["BLOB_READ_WRITE_TOKEN"]?.trim() || null,
  databaseUrl: () => process.env["DATABASE_URL"]?.trim() || null,
  adminWallets: () =>
    (process.env["FABLE_ADMIN_WALLETS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
};

/** Public: the FABLE mint, never invented. Null until the owner sets it. */
export const FABLE_MINT: string | null = process.env.NEXT_PUBLIC_FABLE_MINT?.trim() || null;
export function serverFableMint(): string | null {
  return process.env["NEXT_PUBLIC_FABLE_MINT"]?.trim() || null;
}

/** Character token limits from pump.fun's create_v2 docs (name ≤ 32, symbol ≤ 13, uri ≤ 200). */
export const TOKEN_LIMITS = { name: 32, symbol: 13, uri: 200, description: 500 } as const;
/** Our own ticker rule inside pump.fun's limit: 2–10 letters/digits, stored uppercase. */
export const TICKER_RE = /^[A-Z0-9]{2,10}$/;
/** Optional first buy, capped so a typo cannot drain a wallet. */
export const MAX_INITIAL_BUY_LAMPORTS = BigInt(5_000_000_000);

/** Visual styles offered in the creation flow. */
export const STYLES = ["Photographic portrait", "Editorial illustration", "Soft 3D animation", "Painterly", "Graphic comic"] as const;
