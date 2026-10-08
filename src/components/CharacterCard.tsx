import Image from "next/image";
import Link from "next/link";

export interface CardData {
  href: string;
  number: string;
  name: string;
  bio: string;
  niche: string;
  portrait: string | null;
  token: { kind: "live"; ticker: string } | { kind: "pending" } | { kind: "none" } | { kind: "example" };
}

/** A casting-catalogue card: portrait first, catalogue number, AI label on every character. */
export function CharacterCard({ c, priority = false }: { c: CardData; priority?: boolean }) {
  const local = c.portrait?.startsWith("/examples/");
  return (
    <Link href={c.href} className="group block">
      <div className="portrait border border-line">
        {c.portrait ? (
          local ? (
            <Image src={c.portrait} alt={`Portrait of ${c.name}`} fill sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 22vw" className="object-cover transition duration-500 group-hover:scale-[1.02]" priority={priority} loading={priority ? undefined : "eager"} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- generated media served by /api/media
            <img src={c.portrait} alt={`Portrait of ${c.name}`} loading="lazy" className="transition duration-500 group-hover:scale-[1.02]" />
          )
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted">No portrait yet</div>
        )}
        <span className="ai-tag absolute left-3 top-3">AI-generated</span>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="catno">{c.number}</span>
        {c.token.kind === "live" && <span className="chip chip-good mono">${c.token.ticker}</span>}
        {c.token.kind === "pending" && <span className="chip">Launch pending</span>}
        {c.token.kind === "none" && <span className="chip">No token</span>}
        {c.token.kind === "example" && <span className="chip chip-violet">Example character</span>}
      </div>
      <h3 className="display mt-1 text-2xl group-hover:text-violet-deep">{c.name}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-ink-2">{c.bio}</p>
      <p className="label mt-2 truncate">{c.niche}</p>
    </Link>
  );
}
