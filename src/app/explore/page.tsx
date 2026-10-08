import type { Metadata } from "next";
import Link from "next/link";
import { CharacterCard } from "@/components/CharacterCard";
import type { CardData } from "@/components/CharacterCard";
import { EXAMPLES } from "@/config/examples";
import { catalogueNo } from "@/lib/format";
import { listPublic } from "@/server/characters";
import type { ExploreFilter } from "@/server/characters";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Explore characters" };
export const dynamic = "force-dynamic";

const FILTERS: { id: ExploreFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "token", label: "With a token" },
  { id: "new", label: "New characters" },
];

export default async function Explore({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string }> }) {
  const sp = await searchParams;
  const filter: ExploreFilter = sp.filter === "token" || sp.filter === "new" ? sp.filter : "all";
  const q = (sp.q ?? "").slice(0, 40);
  let cards: CardData[] = [];
  let failed = false;
  try {
    cards = (await listPublic(await db(), { filter, search: q, limit: 120 })).map((c) => ({
      href: `/c/${c.slug}`,
      number: catalogueNo(c.number),
      name: c.name,
      bio: c.bio,
      niche: c.niche,
      portrait: c.portrait,
      token: c.tokenStatus === "live" ? { kind: "live", ticker: c.ticker ?? "" } : c.tokenStatus === "pending" ? { kind: "pending" } : { kind: "none" },
    }));
  } catch {
    failed = true;
  }
  const qs = (f: ExploreFilter) => `/explore?${new URLSearchParams({ ...(f !== "all" ? { filter: f } : {}), ...(q ? { q } : {}) }).toString()}`;
  return (
    <main className="shell py-10 sm:py-14">
      <p className="label">Explore</p>
      <h1 className="display mt-3 text-5xl sm:text-6xl">The catalogue</h1>
      <p className="mt-4 max-w-2xl text-ink-2">Every saved character on FABLE, newest first. All of them are AI-generated. Nothing here is ranked by popularity.</p>

      <div className="mt-8 flex flex-col gap-4 border-y border-ink/80 py-4 md:flex-row md:items-center md:justify-between">
        <nav className="flex flex-wrap gap-2" aria-label="Filters">
          {FILTERS.map((f) => (
            <Link key={f.id} href={qs(f.id)} className={`chip ${filter === f.id ? "chip-dark" : "hover:border-ink"}`} aria-current={filter === f.id ? "page" : undefined}>
              {f.label}
            </Link>
          ))}
        </nav>
        <form action="/explore" className="flex w-full gap-2 md:w-auto">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <input name="q" defaultValue={q} className="field md:w-72" placeholder="Search by name or $TICKER" aria-label="Search by name or ticker" />
          <button className="btn btn-primary" type="submit">
            Search
          </button>
        </form>
      </div>

      {failed ? (
        <p className="notice notice-alert mt-8">The catalogue could not be loaded right now.</p>
      ) : cards.length === 0 ? (
        <div className="mt-10 sheet p-6">
          <p className="display text-2xl">{q || filter !== "all" ? "No character matches." : "No public characters yet."}</p>
          <p className="mt-2 text-ink-2">
            {q || filter !== "all" ? "Try another name or filter." : "Be the first: describe a character, generate it and save it."}{" "}
            <Link href="/create" className="link">
              Create a character
            </Link>
          </p>
        </div>
      ) : (
        <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => (
            <CharacterCard key={c.href} c={c} />
          ))}
        </div>
      )}

      <section className="mt-20" aria-labelledby="examples">
        <div className="rule pt-5">
          <h2 id="examples" className="display text-3xl">
            Example characters
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">Made by FABLE to show what a character looks like. They are not live launches, have no coin and are kept out of the catalogue above.</p>
          <div className="mt-8 grid grid-cols-2 gap-6 lg:grid-cols-4">
            {EXAMPLES.map((e) => (
              <CharacterCard key={e.slug} c={{ href: `/demo/c/${e.slug}`, number: e.number, name: e.name, bio: e.bio, niche: e.niche, portrait: e.portrait, token: { kind: "example" } }} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
