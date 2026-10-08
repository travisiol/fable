/**
 * Page-level reads: what a wallet sees (balances, eligibility, next allocation), the creator
 * overview, the configuration status. Pages and route handlers call these; nothing here writes.
 */
import { COSTS, ENV, allocationRules, serverFableMint } from "../config/fable.ts";
import { serverCluster } from "../config/solana.ts";
import { tokenBalance } from "./chain.ts";
import { listOwned } from "./characters.ts";
import type { Q } from "./db.ts";
import { jobsFor } from "./jobs.ts";
import { characterAccount, ledgerFor, readBalance, totalsFor, walletAccount } from "./ledger.ts";
import { launchAvailability } from "./launch.ts";
import { operatorAddress } from "./operator.ts";
import { allocationHistory, currentAverage, nextAllocationAt, poolStatus, receipts } from "./pool.ts";
import { mediaUrl } from "./media.ts";

export interface WalletSummary {
  address: string;
  fable: { configured: boolean; balance: string | null; decimals: number; error: string | null };
  eligibility: { status: "eligible" | "not-eligible" | "not-measured"; average: string; minimum: string; daysMeasured: number };
  credits: { balance: number; reserved: number; available: number };
  nextAllocationAt: number;
  history: { week: string; credits: number; average: string }[];
  spending: { spent: number; refunded: number; allocated: number; granted: number };
  ledger: { id: number; kind: string; amount: number; jobId: string | null; ref: string | null; note: string | null; createdAt: number }[];
}

export async function walletSummary(q: Q, address: string, now = Date.now()): Promise<WalletSummary> {
  const rules = allocationRules();
  const mint = serverFableMint();
  let balance: string | null = null;
  let error: string | null = null;
  if (mint) {
    try {
      balance = (await tokenBalance(address, mint)).amount.toString();
    } catch {
      error = "Balance unavailable right now.";
    }
  }
  const { average, days } = await currentAverage(q, address, now);
  const min = BigInt(rules.minAverageTokens) * BigInt(10) ** BigInt(rules.decimals);
  const credits = await readBalance(q, walletAccount(address));
  const totals = await totalsFor(q, walletAccount(address));
  return {
    address,
    fable: { configured: Boolean(mint), balance, decimals: rules.decimals, error },
    eligibility: { status: days === 0 ? "not-measured" : average >= min ? "eligible" : "not-eligible", average: average.toString(), minimum: min.toString(), daysMeasured: days },
    credits: { balance: credits.balance, reserved: credits.reserved, available: credits.available },
    nextAllocationAt: nextAllocationAt(now),
    history: await allocationHistory(q, address),
    spending: { spent: totals.spend ?? 0, refunded: totals.release ?? 0, allocated: totals.allocation ?? 0, granted: totals.grant ?? 0 },
    ledger: await ledgerFor(q, walletAccount(address), 25),
  };
}

export async function creatorOverview(q: Q, owner: string) {
  const characters = await listOwned(q, owner);
  const budgets = await Promise.all(
    characters
      .filter((c) => c.status === "saved")
      .map(async (c) => {
        const b = await readBalance(q, characterAccount(c.id));
        const t = await totalsFor(q, characterAccount(c.id));
        return { id: c.id, funded: t.funding ?? 0, spent: t.spend ?? 0, available: b.available, reserved: b.reserved };
      }),
  );
  const rec = await receipts(q, { owner, limit: 30 });
  const creatorLamports = rec.reduce((a, r) => a + BigInt(r.creatorLamports), BigInt(0));
  return {
    characters: characters.map((c) => ({
      id: c.id,
      slug: c.slug,
      number: c.number,
      name: c.name || "Untitled draft",
      status: c.status,
      idea: c.idea,
      portrait: mediaUrl(c.portraitMediaId),
      launchStatus: c.launchStatus,
      ticker: c.ticker,
      mint: c.mint,
      sharingStatus: c.sharingStatus,
      updatedAt: c.updatedAt,
    })),
    budgets,
    receipts: rec,
    creatorFeesConfirmedLamports: creatorLamports.toString(),
    jobs: await jobsFor(q, owner, { limit: 20 }),
  };
}

export interface ConfigItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export async function configStatus(q: Q): Promise<{ items: ConfigItem[]; pool: Awaited<ReturnType<typeof poolStatus>>; storage: string }> {
  const launch = launchAvailability();
  const items: ConfigItem[] = [
    { key: "OPENAI_API_KEY", label: "Character design and images (OpenAI)", ok: Boolean(ENV.openaiKey()), detail: `Models: ${ENV.textModel()} (sheet), ${ENV.imageModel()} (images, quality ${ENV.imageQuality()}).` },
    { key: "GEMINI_API_KEY", label: "Talking clips (Google Veo)", ok: Boolean(ENV.geminiKey()), detail: `Model: ${ENV.videoModel()}. OpenAI's video API (Sora 2) was shut down on 2026-09-24.` },
    { key: "DATABASE_URL", label: "Durable database (Postgres)", ok: Boolean(ENV.databaseUrl()), detail: ENV.databaseUrl() ? "Postgres." : "Not set: PGlite on local disk (ephemeral on Vercel)." },
    { key: "BLOB_READ_WRITE_TOKEN", label: "Durable media storage (Vercel Blob)", ok: Boolean(ENV.blobToken()), detail: ENV.blobToken() ? "Vercel Blob." : "Not set: local disk (ephemeral on Vercel)." },
    { key: "SESSION_SECRET", label: "Session signing key", ok: (process.env.SESSION_SECRET ?? "").length >= 32, detail: "Without it, a key is generated and stored in the database." },
    { key: "NEXT_PUBLIC_FABLE_MINT", label: "FABLE token mint", ok: Boolean(serverFableMint()), detail: serverFableMint() ?? "Not set: no balances are read, no snapshots are taken." },
    { key: "SOLANA_RPC_URL", label: "Solana RPC (keyed provider)", ok: Boolean(process.env.SOLANA_RPC_URL?.trim()), detail: `Cluster: ${serverCluster()}. Holder snapshots need getProgramAccounts, which public RPCs often refuse.` },
    { key: "FABLE_LAUNCH_ENABLED + wallets", label: "Character coin launch (pump.fun)", ok: launch.ok, detail: launch.ok ? `On (${launch.cluster}).` : `Missing: ${launch.missing.join("; ")}.` },
    { key: "FABLE_FEE_SHARING_VERIFIED", label: "Fee split shown as verified", ok: ENV.feeSharingVerified(), detail: ENV.feeSharingVerified() ? "The 30 / 40 / 30 split is presented as active where it is verified on chain." : "The split is presented as proposed until you set this after a verified launch." },
    { key: "OPERATOR_SECRET_KEY", label: "Fee distribution crank (operator)", ok: Boolean(operatorAddress()), detail: operatorAddress() ? `Operator ${operatorAddress()} pays network fees for permissionless distributions.` : "Not set: distributions still count when anyone else triggers them." },
    { key: "CRON_SECRET", label: "Scheduled jobs (cron)", ok: Boolean(ENV.cronSecret()), detail: "Authorises /api/cron/daily and /api/jobs/tick." },
    { key: "FABLE_ADMIN_WALLETS", label: "Owner wallets", ok: ENV.adminWallets().length > 0, detail: "Wallets allowed to record deposits and grant credits from this page." },
  ];
  return { items, pool: await poolStatus(q), storage: "" };
}

export const COST_TABLE = [
  { kind: "character", label: "New character (sheet + portrait)", credits: COSTS.character },
  { kind: "portrait", label: "New portrait for a draft", credits: COSTS.portrait },
  { kind: "image", label: "Studio image (portrait, outfit, scene)", credits: COSTS.image },
  { kind: "video", label: "Talking clip, 8 s", credits: COSTS.video },
] as const;
