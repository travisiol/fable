import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Profile } from "@/components/Profile";
import type { ProfileData } from "@/components/Profile";
import { explorerUrl } from "@/config/solana";
import { catalogueNo } from "@/lib/format";
import { galleryFor, getCharacter } from "@/server/characters";
import { db } from "@/server/db";
import { num } from "@/server/db";
import { activeLaunchFor } from "@/server/launch";
import { characterAccount, readBalance, totalsFor } from "@/server/ledger";
import { mediaUrl } from "@/server/media";
import { receipts } from "@/server/pool";
import { currentAddress } from "@/server/session";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug } = await params;
  const c = await getCharacter(await db(), slug).catch(() => null);
  if (!c || c.status !== "saved") return { title: "Character" };
  return { title: `${c.name} — AI-generated character`, description: c.bio };
}

const PRESET_LABEL: Record<string, string> = { portrait: "Portrait", outfit: "New outfit", scene: "Scene", talking: "Talking clip" };

export default async function CharacterPage({ params }: P) {
  const { slug } = await params;
  const d = await db();
  const c = await getCharacter(d, slug);
  if (!c || c.status !== "saved") notFound();
  const [me, launch, gallery, rec, totals, bal, jobs] = await Promise.all([
    currentAddress(),
    activeLaunchFor(d, c.id),
    galleryFor(d, c.id),
    receipts(d, { characterId: c.id, limit: 12 }),
    totalsFor(d, characterAccount(c.id)),
    readBalance(d, characterAccount(c.id)),
    d.query("SELECT kind, preset, status, payer, created_at, finished_at FROM jobs WHERE character_id = $1 AND status IN ('succeeded','failed') ORDER BY created_at DESC LIMIT 10", [c.id]),
  ]);
  const cluster = launch?.cluster === "devnet" ? "devnet" : "mainnet-beta";
  const p: ProfileData = {
    numberLabel: catalogueNo(c.number),
    name: c.name,
    bio: c.bio,
    personality: c.personality,
    niche: c.niche,
    style: c.style,
    portrait: mediaUrl(c.portraitMediaId),
    kind: "live",
    isOwner: me === c.owner,
    characterId: c.id,
    gallery,
    token: !launch
      ? null
      : launch.status !== "confirmed"
        ? { status: "pending" }
        : {
            status: "live",
            ticker: launch.ticker,
            mint: launch.mint,
            cluster: launch.cluster,
            createSig: launch.createSig,
            sharingStatus: launch.sharingStatus,
            tradeUrl: cluster === "devnet" ? explorerUrl("token", launch.mint, "devnet") : `https://pump.fun/coin/${launch.mint}`,
            explorerUrl: explorerUrl("token", launch.mint, cluster),
          },
    budget: totals.funding ? { funded: totals.funding ?? 0, spent: totals.spend ?? 0, available: bal.available } : null,
    receipts: rec.map((r) => ({ signature: r.signature, at: r.at, totalLamports: r.totalLamports, budgetCredits: r.budgetCredits, poolCredits: r.poolCredits, creatorLamports: r.creatorLamports, url: explorerUrl("tx", r.signature, cluster) })),
    activity: jobs.map((j) => ({
      at: num(j.finished_at ?? j.created_at),
      label: j.kind === "character" ? "Identity and portrait" : j.kind === "portrait" ? "Portrait" : PRESET_LABEL[String(j.preset)] ?? String(j.kind),
      detail: `${j.status === "succeeded" ? "generated" : "failed, credits restored"} · paid by ${j.payer === "character_budget" ? "content budget" : "creator's credits"}`,
    })),
  };
  return <Profile p={p} />;
}
