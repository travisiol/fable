/**
 * Demo fixtures. Used ONLY by /demo pages, which carry a fixed "Demo" ribbon. Never written to the
 * database, never mixed into live pages. Addresses below are obviously fake placeholders.
 */
import { EXAMPLES, exampleBySlug } from "../config/examples.ts";
import type { DashboardData } from "../components/DashboardView.tsx";
import type { ProfileData } from "../components/Profile.tsx";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 28, 9, 0);
export const DEMO_WALLET = "DEMo1111111111111111111111111111111111111111";
const fakeMint = (slug: string) => `DEMO${slug.replace(/[^a-z]/g, "").slice(0, 8).toUpperCase()}mint11111111111111111111111`.slice(0, 44);

export function demoDashboard(): DashboardData {
  return {
    wallet: {
      address: DEMO_WALLET,
      fable: { configured: true, balance: "2450000000000", decimals: 6, error: null },
      eligibility: { status: "eligible", average: "2310000000000", minimum: "100000000000", daysMeasured: 7 },
      credits: { balance: 214, reserved: 7, available: 207 },
      nextAllocationAt: T0 + 14 * DAY,
      history: [
        { week: "2026-10-05", credits: 160, average: "2310000000000" },
        { week: "2026-09-28", credits: 140, average: "2050000000000" },
      ],
      spending: { spent: 86, refunded: 7, allocated: 300, granted: 0 },
      ledger: [
        { id: 6, kind: "reserve", amount: 7, jobId: "demo-j6", ref: null, note: null, createdAt: T0 + 9 * DAY },
        { id: 5, kind: "allocation", amount: 160, jobId: null, ref: "2026-10-05", note: null, createdAt: T0 + 7 * DAY },
        { id: 4, kind: "release", amount: 7, jobId: "demo-j3", ref: null, note: null, createdAt: T0 + 3 * DAY },
        { id: 3, kind: "spend", amount: 6, jobId: "demo-j1", ref: null, note: null, createdAt: T0 + 1 * DAY },
        { id: 1, kind: "allocation", amount: 140, jobId: null, ref: "2026-09-28", note: null, createdAt: T0 },
      ],
    },
    creator: {
      characters: EXAMPLES.slice(0, 3).map((e, i) => ({
        id: `demo-${e.slug}`,
        slug: e.slug,
        number: i + 1,
        name: e.name,
        status: "saved",
        idea: e.idea,
        portrait: e.portrait,
        launchStatus: i === 0 ? "confirmed" : null,
        ticker: i === 0 ? e.demoTicker : null,
        mint: i === 0 ? fakeMint(e.slug) : null,
        sharingStatus: i === 0 ? "active" : null,
        updatedAt: T0 + i * DAY,
      })),
      budgets: [
        { id: "demo-robot-comedian", funded: 1240, spent: 98, available: 1142, reserved: 0 },
        { id: "demo-space-explorer", funded: 0, spent: 0, available: 0, reserved: 0 },
        { id: "demo-pigeon-critic", funded: 0, spent: 0, available: 0, reserved: 0 },
      ],
      receipts: [
        { signature: "DEMOsig2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", mint: fakeMint("robot-comedian"), characterId: "demo-robot-comedian", source: "distribution", totalLamports: "93000000", poolLamports: "27900000", budgetLamports: "37200000", creatorLamports: "27900000", poolCredits: 558, budgetCredits: 744, at: T0 + 8 * DAY },
        { signature: "DEMOsig1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", mint: fakeMint("robot-comedian"), characterId: "demo-robot-comedian", source: "distribution", totalLamports: "62000000", poolLamports: "18600000", budgetLamports: "24800000", creatorLamports: "18600000", poolCredits: 372, budgetCredits: 496, at: T0 + 4 * DAY },
      ],
      creatorFeesConfirmedLamports: "46500000",
      jobs: [
        { id: "demo-j6", kind: "image", preset: "scene", status: "running", cost: 7, payer: "holder_credits", createdAt: T0 + 9 * DAY, error: null },
        { id: "demo-j5", kind: "image", preset: "outfit", status: "succeeded", cost: 7, payer: "character_budget", createdAt: T0 + 8 * DAY, error: null },
        { id: "demo-j3", kind: "image", preset: "scene", status: "failed", cost: 7, payer: "holder_credits", createdAt: T0 + 3 * DAY, error: "The request was refused by the provider's safety system." },
        { id: "demo-j1", kind: "character", preset: null, status: "succeeded", cost: 6, payer: "holder_credits", createdAt: T0 + DAY, error: null },
      ],
    },
  };
}

export function demoProfile(slug: string): ProfileData | null {
  const e = exampleBySlug(slug);
  if (!e) return null;
  const launched = slug === "robot-comedian";
  return {
    numberLabel: e.number,
    name: e.name,
    bio: e.bio,
    personality: e.personality,
    niche: e.niche,
    style: e.style,
    portrait: e.portrait,
    kind: "example",
    isOwner: false,
    characterId: `demo-${slug}`,
    gallery: [{ id: `${slug}-p`, kind: "image", url: e.portrait, createdAt: T0, prompt: `Portrait · ${e.idea}`, preset: "portrait" }],
    token: launched
      ? { status: "live", ticker: e.demoTicker, mint: fakeMint(slug), cluster: "devnet", createSig: null, sharingStatus: "active", tradeUrl: "#demo", explorerUrl: "#demo", demo: true }
      : null,
    budget: launched ? { funded: 1240, spent: 98, available: 1142 } : null,
    receipts: launched
      ? demoDashboard().creator.receipts.map((r) => ({ signature: r.signature, at: r.at, totalLamports: r.totalLamports, budgetCredits: r.budgetCredits, poolCredits: r.poolCredits, creatorLamports: r.creatorLamports, url: "#demo" }))
      : [],
    activity: launched
      ? [
          { at: T0 + 8 * DAY, label: "New outfit", detail: "generated · paid by content budget" },
          { at: T0 + DAY, label: "Identity and portrait", detail: "generated · paid by creator's credits" },
        ]
      : [{ at: T0, label: "Identity and portrait", detail: "generated · example" }],
  };
}
