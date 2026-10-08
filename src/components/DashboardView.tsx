import Link from "next/link";
import { catalogueNo, formatCredits, formatDate, formatDateTime, formatSol, formatUnits, shortAddress } from "@/lib/format";

export interface DashboardData {
  wallet: {
    address: string;
    fable: { configured: boolean; balance: string | null; decimals: number; error: string | null };
    eligibility: { status: "eligible" | "not-eligible" | "not-measured"; average: string; minimum: string; daysMeasured: number };
    credits: { balance: number; reserved: number; available: number };
    nextAllocationAt: number;
    history: { week: string; credits: number; average: string }[];
    spending: { spent: number; refunded: number; allocated: number; granted: number };
    ledger: { id: number; kind: string; amount: number; jobId: string | null; ref: string | null; note: string | null; createdAt: number }[];
  };
  creator: {
    characters: { id: string; slug: string | null; number: number | null; name: string; status: string; idea: string; portrait: string | null; launchStatus: string | null; ticker: string | null; mint: string | null; sharingStatus: string | null; updatedAt: number }[];
    budgets: { id: string; funded: number; spent: number; available: number; reserved: number }[];
    receipts: { signature: string; mint: string; characterId: string | null; source: string; totalLamports: string; poolLamports: string; budgetLamports: string; creatorLamports: string; poolCredits: number; budgetCredits: number; at: number }[];
    creatorFeesConfirmedLamports: string;
    jobs: { id: string; kind: string; preset: string | null; status: string; cost: number; payer: string; createdAt: number; error: string | null }[];
  };
}

const LEDGER_LABEL: Record<string, string> = {
  allocation: "Weekly allocation",
  grant: "Grant from the pool",
  reserve: "Reserved for a job",
  spend: "Spent on a generation",
  release: "Restored (job failed or cancelled)",
  funding: "Funding",
};

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-t border-ink/80 pt-3">
      <p className="label">{label}</p>
      <p className="mono mt-1 text-2xl">{value}</p>
      {note && <p className="hint mt-1">{note}</p>}
    </div>
  );
}

export function DashboardView({ d, demo = false }: { d: DashboardData; demo?: boolean }) {
  const w = d.wallet;
  const budgetOf = (id: string) => d.creator.budgets.find((b) => b.id === id);
  return (
    <div className="space-y-14">
      <section aria-labelledby="w">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="w" className="display text-4xl">
            Wallet
          </h2>
          <span className="mono text-sm text-muted">{shortAddress(w.address)}</span>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
          <Stat label="FABLE holdings" value={!w.fable.configured || w.fable.balance === null ? "—" : formatUnits(BigInt(w.fable.balance), w.fable.decimals, 2)} note={!w.fable.configured ? "The FABLE token is not live yet." : (w.fable.error ?? "Read from chain now.")} />
          <Stat
            label="Credit eligibility"
            value={w.eligibility.status === "eligible" ? "Eligible" : w.eligibility.status === "not-eligible" ? "Not eligible" : "Not measured"}
            note={`7-day average ${formatUnits(BigInt(w.eligibility.average), 6, 0)} · minimum ${formatUnits(BigInt(w.eligibility.minimum), 6, 0)} · ${w.eligibility.daysMeasured}/7 snapshots`}
          />
          <Stat label="Available Studio credits" value={w.credits.available.toLocaleString("en-US")} note={w.credits.reserved ? `${formatCredits(w.credits.reserved)} reserved` : "Nothing reserved"} />
          <Stat label="Next allocation" value={formatDate(w.nextAllocationAt)} note="Mondays 00:00 UTC" />
        </div>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div>
            <p className="label">Allocation history</p>
            {w.history.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No allocation yet.</p>
            ) : (
              <ul className="mt-2">
                {w.history.map((h) => (
                  <li key={h.week} className="kv">
                    <span>Week of {formatDate(Date.parse(h.week))}</span>
                    <span className="mono">+{formatCredits(h.credits)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="label">Generation spending</p>
            <div className="mt-2">
              <div className="kv">
                <span>Received (allocations + grants)</span>
                <span className="mono">{formatCredits(w.spending.allocated + w.spending.granted)}</span>
              </div>
              <div className="kv">
                <span>Spent on generations</span>
                <span className="mono">{formatCredits(w.spending.spent)}</span>
              </div>
              <div className="kv">
                <span>Restored after failures</span>
                <span className="mono">{formatCredits(w.spending.refunded)}</span>
              </div>
            </div>
          </div>
        </div>
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold">Credit ledger ({w.ledger.length})</summary>
          {w.ledger.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No movements yet.</p>
          ) : (
            <ul className="mt-2">
              {w.ledger.map((l) => (
                <li key={l.id} className="kv">
                  <span>
                    {formatDateTime(l.createdAt)} · {LEDGER_LABEL[l.kind] ?? l.kind}
                  </span>
                  <span className="mono">{l.kind === "spend" ? "−" : l.kind === "reserve" || l.kind === "release" ? "" : "+"}{l.amount}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>

      <section aria-labelledby="cr">
        <div className="rule flex flex-wrap items-end justify-between gap-3 pt-5">
          <h2 id="cr" className="display text-4xl">
            Creator
          </h2>
          {!demo && (
            <Link href="/create" className="btn btn-primary btn-sm">
              New character
            </Link>
          )}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
          <Stat label="Characters" value={String(d.creator.characters.length)} />
          <Stat label="Coins launched" value={String(d.creator.characters.filter((c) => c.launchStatus === "confirmed").length)} />
          <Stat label="Creator fees received" value={`${formatSol(d.creator.creatorFeesConfirmedLamports)} SOL`} note="Confirmed receipts only" />
          <Stat label="Budgets remaining" value={formatCredits(d.creator.budgets.reduce((a, b) => a + b.available, 0))} />
        </div>
        {d.creator.characters.length === 0 ? (
          <div className="sheet mt-8 p-6">
            <p className="display text-2xl">No characters yet</p>
            <p className="mt-2 text-ink-2">Your drafts and saved characters appear here.</p>
          </div>
        ) : (
          <ul className="mt-8 divide-y divide-line border-y border-line">
            {d.creator.characters.map((c) => {
              const b = budgetOf(c.id);
              return (
                <li key={c.id} className="grid grid-cols-[4rem_1fr] gap-4 py-4 sm:grid-cols-[4rem_1.2fr_1fr_1fr_auto] sm:items-center">
                  <div className="portrait w-16 border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
                    {c.portrait && <img src={c.portrait} alt="" />}
                  </div>
                  <div className="min-w-0">
                    <p className="catno">{c.status === "saved" ? catalogueNo(c.number) : "Draft"}</p>
                    <p className="display truncate text-xl">{c.name}</p>
                    <p className="truncate text-xs text-muted">{c.idea}</p>
                  </div>
                  <div className="col-start-2 text-sm sm:col-start-auto">
                    <p className="label">Token</p>
                    <p>
                      {c.launchStatus === "confirmed" ? (
                        <span className="mono">${c.ticker}</span>
                      ) : c.launchStatus ? (
                        `Launch ${c.launchStatus}`
                      ) : (
                        "Not deployed"
                      )}
                      {c.launchStatus === "confirmed" && <span className="text-muted"> · split {c.sharingStatus === "active" ? "active" : "not set"}</span>}
                    </p>
                  </div>
                  <div className="col-start-2 text-sm sm:col-start-auto">
                    <p className="label">Content budget</p>
                    <p className="mono">{b ? `${b.available} left of ${b.funded}` : "—"}</p>
                  </div>
                  <div className="col-start-2 flex flex-wrap gap-2 sm:col-start-auto">
                    {c.status === "saved" ? (
                      <>
                        <Link className="btn btn-outline btn-sm" href={demo ? `/demo/c/${c.slug}` : `/c/${c.slug}`}>
                          Page
                        </Link>
                        {!demo && (
                          <Link className="btn btn-quiet btn-sm" href={c.launchStatus === "confirmed" ? `/launch/${c.id}` : `/launch/${c.id}`}>
                            {c.launchStatus === "confirmed" ? "Coin" : "Launch"}
                          </Link>
                        )}
                      </>
                    ) : (
                      !demo && (
                        <Link className="btn btn-outline btn-sm" href={`/create?draft=${c.id}`}>
                          Continue
                        </Link>
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <div>
            <p className="label">Funding activity (confirmed receipts)</p>
            {d.creator.receipts.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No confirmed creator fee receipts yet. Estimates are never shown as receipts.</p>
            ) : (
              <ul className="mt-2">
                {d.creator.receipts.map((r) => (
                  <li key={r.signature} className="kv">
                    <span>
                      {formatDateTime(r.at)} · {shortAddress(r.signature)}
                    </span>
                    <span className="mono text-sm">
                      {formatSol(r.totalLamports)} SOL · you {formatSol(r.creatorLamports)} · budget +{r.budgetCredits}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="label">Recent jobs</p>
            {d.creator.jobs.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No generations yet.</p>
            ) : (
              <ul className="mt-2">
                {d.creator.jobs.map((j) => (
                  <li key={j.id} className="kv">
                    <span>
                      {formatDateTime(j.createdAt)} · {j.preset ?? j.kind}
                    </span>
                    <span className="text-sm">
                      <span className={`chip ${j.status === "succeeded" ? "chip-good" : j.status === "failed" ? "chip-alert" : ""}`}>{j.status}</span> <span className="mono">{j.cost}</span> · {j.payer === "character_budget" ? "budget" : "credits"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
