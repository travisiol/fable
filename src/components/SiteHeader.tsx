import Link from "next/link";
import { Wordmark } from "./Logo";
import { ConnectButton } from "./wallet/ConnectButton";

const NAV = [
  { href: "/explore", label: "Explore" },
  { href: "/studio", label: "Studio" },
  { href: "/how-it-works", label: "How it works" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-ink/15 bg-ivory">
      <div className="shell flex h-16 items-center justify-between gap-3">
        <Link href="/" aria-label="FABLE home">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hidden rounded-full px-3 py-2 text-sm font-medium text-ink-2 hover:bg-line-soft md:inline">
              {n.label}
            </Link>
          ))}
          <ConnectButton className="btn btn-primary btn-sm" />
        </nav>
      </div>
      <nav className="shell -mt-1 flex gap-1 overflow-x-auto pb-2 md:hidden" aria-label="Main (mobile)">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="chip">
            {n.label}
          </Link>
        ))}
        <Link href="/dashboard" className="chip">
          Dashboard
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-ink/15">
      <div className="shell grid gap-8 py-10 text-sm sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-3">
          <Wordmark />
          <p className="max-w-sm text-muted">
            An independent AI creator studio on Solana. Every character on FABLE is AI-generated and labelled as such. Holding FABLE does not give ownership of the platform or of any creator&apos;s earnings.
          </p>
        </div>
        <div className="space-y-2">
          <p className="label">Make</p>
          <Link className="block hover:text-violet-deep" href="/create">Create a character</Link>
          <Link className="block hover:text-violet-deep" href="/studio">Studio</Link>
          <Link className="block hover:text-violet-deep" href="/dashboard">Dashboard</Link>
        </div>
        <div className="space-y-2">
          <p className="label">Understand</p>
          <Link className="block hover:text-violet-deep" href="/how-it-works">How it works</Link>
          <Link className="block hover:text-violet-deep" href="/how-it-works#rules">Allocation rules</Link>
          <Link className="block hover:text-violet-deep" href="/demo">Demo mode</Link>
          <Link className="block hover:text-violet-deep" href="/settings/config">Configuration</Link>
        </div>
      </div>
    </footer>
  );
}
