import Image from "next/image";
import Link from "next/link";
import { CharacterCard } from "@/components/CharacterCard";
import type { CardData } from "@/components/CharacterCard";
import { FundingSplit } from "@/components/FundingSplit";
import { IdeaEntry } from "@/components/IdeaEntry";
import { WalletPanel } from "@/components/WalletPanel";
import { COSTS, ENV, allocationRules } from "@/config/fable";
import { EXAMPLES } from "@/config/examples";
import { SITE } from "@/config/site";
import { catalogueNo } from "@/lib/format";
import { listPublic } from "@/server/characters";
import { db } from "@/server/db";
import { nextAllocationAt } from "@/server/pool";
import { now } from "@/server/clock";

export const dynamic = "force-dynamic";

const USES = [
  { n: "01", title: "Create an original character", text: "Describe an idea in a sentence. FABLE writes the name, biography and personality, and paints the portrait." },
  { n: "02", title: "Generate images and videos", text: "Spend your allocated Studio credits on new portraits, outfits, scenes and talking clips of your character." },
  { n: "03", title: "Build a profile, optionally launch its coin", text: "Save the character to a public creator page. If you want, launch its coin on Solana and receive the creator share." },
];

export default async function Home() {
  const rules = allocationRules();
  let live: CardData[] = [];
  try {
    live = (await listPublic(await db(), { limit: 4 })).map((c) => ({
      href: `/c/${c.slug}`,
      number: catalogueNo(c.number),
      name: c.name,
      bio: c.bio,
      niche: c.niche,
      portrait: c.portrait,
      token: c.tokenStatus === "live" ? { kind: "live", ticker: c.ticker ?? "" } : c.tokenStatus === "pending" ? { kind: "pending" } : { kind: "none" },
    }));
  } catch {
    live = [];
  }
  const examples: CardData[] = EXAMPLES.map((e) => ({ href: `/demo/c/${e.slug}`, number: e.number, name: e.name, bio: e.bio, niche: e.niche, portrait: e.portrait, token: { kind: "example" } }));
  const hero = EXAMPLES[0];

  return (
    <main>
      {/* HERO */}
      <section className="shell grid items-center gap-10 py-10 sm:py-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
        <div className="fade-up">
          <p className="label">An AI creator studio on Solana</p>
          <h1 className="display mt-4 text-[2.9rem] sm:text-7xl lg:text-[5.4rem]">{SITE.headline}</h1>
          <p className="mt-6 max-w-xl text-lg text-ink-2 sm:text-xl">{SITE.supporting}</p>
          <p className="mt-4 max-w-xl text-ink-2">
            Studio credits are funded by confirmed platform fee receipts and allocated each week to eligible holders. Launching a character&apos;s coin is optional — a character works on its own.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/create" className="btn btn-primary">
              Start creating
            </Link>
            <Link href="/create?then=launch" className="btn btn-outline">
              Launch a character
            </Link>
          </div>
        </div>
        <figure className="relative mx-auto w-full max-w-md">
          <div className="portrait border border-ink">
            <Image src={hero.portrait} alt={`Portrait of ${hero.name}, an AI-generated example character`} fill priority sizes="(max-width: 1024px) 90vw, 30vw" className="object-cover" />
            <span className="ai-tag absolute left-3 top-3">AI creator</span>
          </div>
          <figcaption className="flex items-end justify-between gap-3 border-x border-b border-ink bg-paper px-4 py-3">
            <div>
              <p className="catno">{hero.number} · Example generation</p>
              <p className="display text-3xl">{hero.name}</p>
            </div>
            <span className="chip chip-violet">Example character</span>
          </figcaption>
          <p className="mt-3 text-sm text-ink-2">
            <span className="font-semibold">Prompt:</span> “{hero.bio.split(",")[0]}.”
          </p>
        </figure>
      </section>

      {/* WHAT DO I GET */}
      <section className="shell py-10 sm:py-14" aria-labelledby="get">
        <div className="rule pt-6">
          <h2 id="get" className="display text-4xl sm:text-5xl">
            What do I get for holding FABLE?
          </h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            {USES.map((u) => (
              <div key={u.n}>
                <p className="mono text-sm text-violet">{u.n}</p>
                <h3 className="display mt-2 text-2xl">{u.title}</h3>
                <p className="mt-2 text-ink-2">{u.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 max-w-3xl text-sm text-muted">
            Holding FABLE makes a wallet eligible for Studio credits. It does not give ownership of the platform or of any creator&apos;s earnings, and credits are never unlimited: each week&apos;s allocation is capped by what the holder pool has actually received.
          </p>
          <div className="mt-8">
            <WalletPanel nextAllocationAt={nextAllocationAt(now())} minimumTokens={rules.minAverageTokens} />
          </div>
        </div>
      </section>

      {/* CREATE ENTRY */}
      <section className="shell py-10 sm:py-14">
        <IdeaEntry cost={COSTS.character} />
      </section>

      {/* HOW IT WORKS */}
      <section className="shell py-10 sm:py-14" aria-labelledby="how">
        <div className="rule pt-6">
          <h2 id="how" className="display text-4xl sm:text-5xl">
            How it works
          </h2>
          <div className="mt-8 grid gap-10 md:grid-cols-2">
            {[
              { who: "Holder", steps: ["Hold FABLE", "Receive allocated credits", "Create in Studio"] },
              { who: "Creator", steps: ["Create a character", "Launch its coin", "Receive its creator share"] },
            ].map((j) => (
              <div key={j.who} className="sheet p-5">
                <p className="label">{j.who}</p>
                <ol className="mt-4 grid gap-3 sm:grid-cols-3">
                  {j.steps.map((s, i) => (
                    <li key={s} className="border-t-2 border-ink pt-2">
                      <span className="mono text-xs text-violet">Step {i + 1}</span>
                      <p className="mt-1 font-semibold leading-snug">{s}</p>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          <Link href="/how-it-works" className="link mt-6 inline-block text-sm">
            The full rules: eligibility, allocation formula, costs
          </Link>
        </div>
      </section>

      {/* FUNDING */}
      <section className="shell py-10 sm:py-14" aria-labelledby="funding">
        <div className="rule grid gap-8 pt-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 id="funding" className="display text-4xl sm:text-5xl">
              Creator fees help fund new content.
            </h2>
            <p className="mt-4 text-ink-2">
              For a character coin launched through FABLE, the creator fees it receives are split three ways. A creator receives fees only when eligible trading activity generates them.
            </p>
            {!ENV.feeSharingVerified() && <p className="mt-3 text-sm text-muted">This split is the proposed configuration. It is shown as active only for coins where FABLE has verified it on chain.</p>}
          </div>
          <FundingSplit active={ENV.feeSharingVerified()} />
        </div>
      </section>

      {/* EXPLORE PREVIEW */}
      <section className="shell py-10 sm:py-14" aria-labelledby="explore">
        <div className="rule pt-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="explore" className="display text-4xl sm:text-5xl">
              {live.length ? "New on FABLE" : "Example characters"}
            </h2>
            <Link href="/explore" className="btn btn-outline btn-sm">
              Explore all
            </Link>
          </div>
          {!live.length && <p className="mt-3 text-sm text-muted">No public characters yet. These examples show what a FABLE character looks like; they are not live and have no coin.</p>}
          <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {(live.length ? live : examples).map((c) => (
              <CharacterCard key={c.href} c={c} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
