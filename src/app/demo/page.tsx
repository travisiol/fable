import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { DashboardView } from "@/components/DashboardView";
import { EXAMPLES } from "@/config/examples";
import { COSTS } from "@/config/fable";
import { demoDashboard } from "@/demo/fixtures";

export const metadata: Metadata = { title: "Demo" };

export default function DemoPage() {
  const hero = EXAMPLES[0];
  return (
    <main className="shell py-10 sm:py-14">
      <p className="label">Demo mode</p>
      <h1 className="display mt-3 text-5xl sm:text-6xl">A week on FABLE, with sample data</h1>
      <p className="mt-4 max-w-2xl text-ink-2">This is what a holder who is also a creator sees. Everything below is a fixture: invented balances, an invented coin, invented receipts. Use it to review the interface; the live app never shows these numbers.</p>

      <section className="mt-12 rule pt-5" aria-labelledby="studio">
        <h2 id="studio" className="display text-4xl">
          Studio, mid-job
        </h2>
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          <div className="space-y-4">
            <div className="kv">
              <span>Character reference</span>
              <span>{hero.name}</span>
            </div>
            <div className="kv">
              <span>Mode · preset</span>
              <span>Image · Scene</span>
            </div>
            <div className="kv">
              <span>Prompt</span>
              <span className="max-w-xs text-sm">On a tiny stage under a single spotlight, holding the microphone</span>
            </div>
            <div className="kv">
              <span>Output format</span>
              <span>Portrait 2:3</span>
            </div>
            <div className="kv">
              <span>Estimated cost</span>
              <span className="mono">{COSTS.image} credits</span>
            </div>
            <div className="kv">
              <span>Paid by</span>
              <span>Your Studio credits only (207 available)</span>
            </div>
            <div className="bar bar-indeterminate">
              <span />
            </div>
            <p className="hint">Generating · usually under a minute · credits reserved, charged only on success.</p>
          </div>
          <div>
            <div className="portrait border border-ink">
              <Image src={hero.portrait} alt="Example result" fill sizes="40vw" className="object-cover" />
              <span className="ai-tag absolute left-3 top-3">AI-generated · example</span>
            </div>
            <p className="hint mt-2">Previous result shown as an example.</p>
          </div>
        </div>
      </section>

      <section className="mt-16 rule pt-5">
        <h2 className="display mb-6 text-4xl">Dashboard</h2>
        <DashboardView d={demoDashboard()} demo />
      </section>

      <section className="mt-16 rule pt-5">
        <h2 className="display text-4xl">Example character pages</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <Link key={e.slug} href={`/demo/c/${e.slug}`} className="chip hover:border-ink">
              {e.name}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
