import type { Metadata } from "next";
import Link from "next/link";
import { FundingSplit } from "@/components/FundingSplit";
import { ENV, allocationRules, creditLamports } from "@/config/fable";
import { formatCredits, formatSol } from "@/lib/format";
import { db } from "@/server/db";
import { nextAllocationAt, poolStatus } from "@/server/pool";
import { now } from "@/server/clock";
import { COST_TABLE } from "@/server/views";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "How it works" };
export const dynamic = "force-dynamic";

export default async function HowItWorks() {
  const rules = allocationRules();
  const per = creditLamports();
  let pool: Awaited<ReturnType<typeof poolStatus>> | null = null;
  try {
    pool = await poolStatus(await db(), rules);
  } catch {
    pool = null;
  }
  return (
    <main className="shell py-10 sm:py-14">
      <p className="label">How it works</p>
      <h1 className="display mt-3 text-5xl sm:text-6xl">Two journeys, one studio.</h1>

      <section className="mt-12 grid gap-10 lg:grid-cols-2">
        <div className="rule pt-5">
          <h2 className="display text-3xl">If you hold FABLE</h2>
          <ol className="mt-4 space-y-4">
            <li>
              <p className="font-semibold">1. Hold FABLE</p>
              <p className="text-ink-2">Once a day FABLE records every holder&apos;s balance. Your average over the previous seven days is what counts — buying just before an allocation does not.</p>
            </li>
            <li>
              <p className="font-semibold">2. Receive allocated credits</p>
              <p className="text-ink-2">Every Monday, eligible wallets share that week&apos;s credit budget in proportion to their average holding, up to a cap per wallet.</p>
            </li>
            <li>
              <p className="font-semibold">3. Create in Studio</p>
              <p className="text-ink-2">Spend credits on new characters, portraits, outfits, scenes and talking clips. Each generation shows its cost before you submit.</p>
            </li>
          </ol>
        </div>
        <div className="rule pt-5">
          <h2 className="display text-3xl">If you create a character</h2>
          <ol className="mt-4 space-y-4">
            <li>
              <p className="font-semibold">1. Create a character</p>
              <p className="text-ink-2">Describe it, generate its portrait and identity, edit, save. It gets a public page labelled AI-generated.</p>
            </li>
            <li>
              <p className="font-semibold">2. Launch its coin (optional)</p>
              <p className="text-ink-2">Your wallet signs a pump.fun launch on Solana, then a second signature registers the creator fee split on chain.</p>
            </li>
            <li>
              <p className="font-semibold">3. Receive its creator share</p>
              <p className="text-ink-2">When trading on the coin generates creator fees, pump.fun pays 30% of them to your wallet at each distribution. No trading, no fees.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="mt-16 rule pt-5" aria-labelledby="split">
        <h2 id="split" className="display text-4xl">
          Where creator fees go
        </h2>
        <p className="mt-3 max-w-2xl text-ink-2">Creator fees help fund new content. The split is registered with pump.fun&apos;s own fee sharing (up to ten recipients per coin, set once and then locked), so each share is paid on chain to its recipient.</p>
        <div className="mt-6">
          <FundingSplit active={ENV.feeSharingVerified()} />
        </div>
        <p className="mt-4 text-sm text-muted">The holder pool and each character&apos;s budget are kept apart: a character&apos;s budget pays only for that character&apos;s content. Holding FABLE or a character&apos;s coin gives no ownership of the platform, of the character, or of a creator&apos;s earnings.</p>
      </section>

      <section id="rules" className="mt-16 rule scroll-mt-8 pt-5" aria-labelledby="rules-h">
        <h2 id="rules-h" className="display text-4xl">
          Allocation rules
        </h2>
        <div className="mt-6 grid gap-10 lg:grid-cols-2">
          <div>
            <div className="kv">
              <span>Minimum eligible balance</span>
              <span className="mono">{rules.minAverageTokens.toLocaleString("en-US")} FABLE (7-day average)</span>
            </div>
            <div className="kv">
              <span>Snapshots</span>
              <span>Daily, 00:00 UTC cron; a missed day counts as zero</span>
            </div>
            <div className="kv">
              <span>Allocation day</span>
              <span>Mondays 00:00 UTC · next {formatDate(nextAllocationAt(now()))}</span>
            </div>
            <div className="kv">
              <span>Weekly budget</span>
              <span className="mono">{rules.weeklyShareBps / 100}% of the allocatable pool</span>
            </div>
            <div className="kv">
              <span>Operating reserve</span>
              <span className="mono">{rules.operatingReserveBps / 100}% of all pool funding</span>
            </div>
            <div className="kv">
              <span>Maximum per wallet</span>
              <span className="mono">{formatCredits(rules.maxCreditsPerWallet)} per week</span>
            </div>
            <div className="kv">
              <span>Credit value</span>
              <span className="mono">1 credit = {formatSol(per)} SOL of pool funds</span>
            </div>
            <p className="mt-4 text-sm text-ink-2">
              <span className="font-semibold">Formula.</span> allocatable = unallocated pool credits − operating reserve. budget = allocatable × weekly share. Your credits = min(cap, ⌊budget × your average ÷ sum of eligible averages⌋). Rounding always goes down, so the total can never exceed the budget, and the budget can never exceed what the pool has received.
            </p>
          </div>
          <div>
            <p className="label">Estimated cost of each generation</p>
            <ul className="mt-2">
              {COST_TABLE.map((c) => (
                <li key={c.kind} className="kv">
                  <span>{c.label}</span>
                  <span className="mono">{formatCredits(c.credits)}</span>
                </li>
              ))}
            </ul>
            <p className="hint mt-2">Reserved when you submit, charged on success, restored on failure. Based on the providers&apos; published prices; likeness to the reference portrait is kept as closely as the model allows, not perfectly.</p>
            <p className="label mt-8">Holder pool status (live)</p>
            {pool ? (
              <ul className="mt-2">
                <li className="kv">
                  <span>Confirmed fee receipts</span>
                  <span className="mono">{pool.receipts}</span>
                </li>
                <li className="kv">
                  <span>Funded</span>
                  <span className="mono">{formatCredits(pool.funded)}</span>
                </li>
                <li className="kv">
                  <span>Allocated so far</span>
                  <span className="mono">{formatCredits(pool.allocated)}</span>
                </li>
                <li className="kv">
                  <span>Allocatable next week</span>
                  <span className="mono">{formatCredits(pool.allocatable)}</span>
                </li>
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">Pool status unavailable right now.</p>
            )}
            {pool && pool.funded === 0 && <p className="notice mt-3">The pool has not received any confirmed funds yet, so no credits can be allocated. This is its real status.</p>}
          </div>
        </div>
      </section>

      <section className="mt-16 rule pt-5">
        <h2 className="display text-3xl">Want to look around first?</h2>
        <p className="mt-2 text-ink-2">
          The <Link className="link" href="/demo">demo</Link> shows the Studio and dashboard with sample data, clearly labelled. Nothing in it is live.
        </p>
      </section>
    </main>
  );
}
