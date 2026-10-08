import Image from "next/image";
import Link from "next/link";
import { CopyText } from "./CopyText";
import { MarketPanel } from "./MarketPanel";
import { formatCredits, formatDateTime, formatSol, shortAddress } from "@/lib/format";

export interface ProfileData {
  numberLabel: string;
  name: string;
  bio: string;
  personality: string;
  niche: string;
  style: string;
  portrait: string | null;
  kind: "live" | "example";
  isOwner: boolean;
  characterId: string;
  gallery: { id: string; kind: "image" | "video"; url: string; createdAt: number; prompt: string; preset: string | null }[];
  token:
    | null
    | { status: "pending" }
    | { status: "live"; ticker: string; mint: string; cluster: string; createSig: string | null; sharingStatus: string; tradeUrl: string; explorerUrl: string; demo?: boolean };
  budget: { funded: number; spent: number; available: number } | null;
  receipts: { signature: string; at: number; totalLamports: string; budgetCredits: number; poolCredits: number; creatorLamports: string; url: string }[];
  activity: { at: number; label: string; detail: string }[];
}

export function Profile({ p }: { p: ProfileData }) {
  const local = p.portrait?.startsWith("/examples/");
  return (
    <main>
      <section className="shell grid gap-10 py-10 sm:py-14 lg:grid-cols-[0.75fr_1.25fr]">
        <div>
          <div className="portrait border border-ink">
            {p.portrait &&
              (local ? (
                <Image src={p.portrait} alt={`Portrait of ${p.name}`} fill priority sizes="(max-width: 1024px) 90vw, 32vw" className="object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- generated media
                <img src={p.portrait} alt={`Portrait of ${p.name}`} />
              ))}
            <span className="ai-tag absolute left-3 top-3">AI-generated character</span>
          </div>
          {p.isOwner && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/studio?character=${p.characterId}`} className="btn btn-primary btn-sm">
                Create in Studio
              </Link>
              {!p.token && (
                <Link href={`/launch/${p.characterId}`} className="btn btn-violet btn-sm">
                  Launch its coin
                </Link>
              )}
            </div>
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="catno">{p.numberLabel}</span>
            {p.kind === "example" && <span className="chip chip-violet">Example character · not live</span>}
            {p.token?.status === "live" && <span className="chip chip-good mono">${p.token.ticker}</span>}
            {p.token?.status === "pending" && <span className="chip">Coin launch pending</span>}
            {!p.token && <span className="chip">No coin</span>}
          </div>
          <h1 className="display mt-3 text-5xl sm:text-7xl">{p.name}</h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-2">{p.bio}</p>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            <div className="rule pt-3">
              <p className="label">Personality</p>
              <p className="mt-2 text-sm">{p.personality}</p>
            </div>
            <div className="rule pt-3">
              <p className="label">Niche</p>
              <p className="mt-2 text-sm">{p.niche}</p>
            </div>
            <div className="rule pt-3">
              <p className="label">Style</p>
              <p className="mt-2 text-sm">{p.style || "—"}</p>
            </div>
          </div>
          <p className="mt-6 text-sm text-muted">This is a virtual character generated with AI. It is not a real person and does not speak for anyone.</p>
        </div>
      </section>

      <section className="shell py-8" aria-labelledby="gallery">
        <div className="rule pt-5">
          <h2 id="gallery" className="display text-3xl sm:text-4xl">
            Gallery
          </h2>
          {p.gallery.length === 0 ? (
            <p className="mt-4 text-muted">No content yet. Images and clips created in the Studio appear here.</p>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
              {p.gallery.map((g) => (
                <figure key={g.id}>
                  <div className="portrait border border-line">
                    {g.kind === "video" ? (
                      <video src={g.url} controls playsInline preload="metadata" />
                    ) : g.url.startsWith("/examples/") ? (
                      <Image src={g.url} alt={g.prompt} fill sizes="25vw" className="object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- generated media
                      <img src={g.url} alt={g.prompt} loading="lazy" />
                    )}
                    <span className="ai-tag absolute left-2 top-2">AI</span>
                  </div>
                  <figcaption className="mt-2 line-clamp-2 text-xs text-muted">{g.prompt}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="shell grid gap-10 py-8 lg:grid-cols-2">
        <div className="rule pt-5">
          <h2 className="display text-3xl">Token</h2>
          {!p.token && <p className="mt-4 text-muted">This character has no coin. Characters work without one.</p>}
          {p.token?.status === "pending" && <p className="mt-4 text-muted">A launch is waiting for confirmation on chain. Nothing is shown until it is confirmed.</p>}
          {p.token?.status === "live" && (
            <div className="mt-4">
              <div className="kv">
                <span>Ticker</span>
                <span className="mono">${p.token.ticker}</span>
              </div>
              <div className="kv">
                <span>Contract address</span>
                <CopyText text={p.token.mint} label={shortAddress(p.token.mint)} />
              </div>
              <div className="kv">
                <span>Network</span>
                <span>{p.token.cluster === "devnet" ? "Solana devnet" : "Solana"}</span>
              </div>
              <div className="kv">
                <span>Fee split</span>
                <span>{p.token.sharingStatus === "active" ? "30 / 40 / 30 verified on chain" : "Not set up yet: creator fees go to the creator"}</span>
              </div>
              {!p.token.demo && (
                <div className="mt-4">
                  <MarketPanel mint={p.token.mint} />
                </div>
              )}
              {p.token.demo ? (
                <p className="hint mt-4">Demo coin: no market, no links.</p>
              ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={p.token.tradeUrl} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                  {p.token.cluster === "devnet" ? "Devnet coin: open the token ↗" : "Trade on pump.fun ↗"}
                </a>
                <a href={p.token.explorerUrl} target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm">
                  View on Solscan ↗
                </a>
              </div>
              )}
              <p className="hint mt-3">The link opens the coin with the contract address above, confirmed on chain by FABLE. Holding this coin does not give ownership of the character or of its creator&apos;s earnings.</p>
            </div>
          )}
        </div>
        <div className="rule pt-5">
          <h2 className="display text-3xl">Content budget</h2>
          <p className="mt-3 text-ink-2">A configured share of this token&apos;s creator fees funds its content.</p>
          {p.budget ? (
            <div className="mt-4">
              <div className="kv">
                <span>Received (confirmed)</span>
                <span className="mono">{formatCredits(p.budget.funded)}</span>
              </div>
              <div className="kv">
                <span>Spent on generations</span>
                <span className="mono">{formatCredits(p.budget.spent)}</span>
              </div>
              <div className="kv">
                <span>Remaining</span>
                <span className="mono">{formatCredits(p.budget.available)}</span>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-muted">No budget: the budget is funded only by confirmed creator fee receipts of a launched coin with an active fee split.</p>
          )}
        </div>
      </section>

      <section className="shell grid gap-10 py-8 lg:grid-cols-2">
        <div className="rule pt-5">
          <h2 className="display text-3xl">Recent funding</h2>
          {p.receipts.length === 0 ? (
            <p className="mt-4 text-muted">No confirmed fee receipts yet.</p>
          ) : (
            <ul className="mt-3">
              {p.receipts.map((r) => (
                <li key={r.signature} className="kv">
                  <span>
                    {formatDateTime(r.at)} ·{" "}
                    <a className="link" href={r.url} target="_blank" rel="noreferrer">
                      {shortAddress(r.signature)}
                    </a>
                  </span>
                  <span className="mono">
                    {formatSol(r.totalLamports)} SOL → +{r.budgetCredits} budget
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rule pt-5">
          <h2 className="display text-3xl">Generation activity</h2>
          {p.activity.length === 0 ? (
            <p className="mt-4 text-muted">No generations yet.</p>
          ) : (
            <ul className="mt-3">
              {p.activity.map((a, i) => (
                <li key={i} className="kv">
                  <span>{formatDateTime(a.at)}</span>
                  <span>
                    {a.label} <span className="text-muted">· {a.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
