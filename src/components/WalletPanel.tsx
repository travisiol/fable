"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { formatCredits, formatDate, formatUnits } from "@/lib/format";
import { openWalletDialog, signIn, useWallet, walletErrorMessage } from "./wallet/store";

export interface WalletSummaryView {
  address: string;
  fable: { configured: boolean; balance: string | null; decimals: number; error: string | null };
  eligibility: { status: "eligible" | "not-eligible" | "not-measured"; average: string; minimum: string; daysMeasured: number };
  credits: { balance: number; reserved: number; available: number };
  nextAllocationAt: number;
}

/** Loads /api/me for the signed-in wallet. Null while signed out. */
export function useMe(refreshKey = 0) {
  const w = useWallet();
  const signedIn = Boolean(w.session && (!w.address || w.session === w.address));
  const [me, setMe] = useState<{ for: string; wallet: WalletSummaryView } | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    api<{ signedIn: boolean; wallet?: WalletSummaryView }>("/api/me")
      .then((j) => {
        if (live && j.wallet) setMe({ for: j.wallet.address, wallet: j.wallet });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [signedIn, w.session, refreshKey]);
  return { signedIn, address: w.address, wallet: signedIn && me && me.for === w.session ? me.wallet : null };
}

function Cell({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="border-t border-ink/80 pt-3">
      <p className="label">{label}</p>
      <p className="mono mt-1 text-xl">{value}</p>
      {note && <p className="hint mt-1">{note}</p>}
    </div>
  );
}

/** FABLE balance / Eligibility / Available credits / Next allocation. Placeholders until signed in; never an invented balance. */
export function WalletPanel({ nextAllocationAt, minimumTokens }: { nextAllocationAt: number; minimumTokens: number }) {
  const { signedIn, address, wallet } = useMe();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="label">Your wallet</p>
        <p className="mt-1 text-sm text-ink-2">{signedIn ? "Signed in. Figures below are read for this wallet." : "Connect and sign in to see your own figures."}</p>
      </div>
      {!address ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={openWalletDialog}>
          Connect wallet
        </button>
      ) : !signedIn ? (
        <button
          type="button"
          className="btn btn-violet btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await signIn();
            } catch (e) {
              setError(walletErrorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <span className="spinner" /> : "Sign in with this wallet"}
        </button>
      ) : (
        <Link href="/dashboard" className="btn btn-outline btn-sm">
          Open dashboard
        </Link>
      )}
    </div>
  );

  return (
    <div className="sheet p-5 sm:p-6" data-testid="wallet-panel">
      {header}
      {error && <p className="notice notice-alert mt-3">{error}</p>}
      <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-5 lg:grid-cols-4">
        {wallet ? (
          <>
            <Cell
              label="FABLE balance"
              value={!wallet.fable.configured ? "—" : wallet.fable.balance === null ? "—" : formatUnits(BigInt(wallet.fable.balance), wallet.fable.decimals, 2)}
              note={!wallet.fable.configured ? "The FABLE token is not live yet." : wallet.fable.error ?? "Read from chain."}
            />
            <Cell
              label="Eligibility"
              value={wallet.eligibility.status === "eligible" ? "Eligible" : wallet.eligibility.status === "not-eligible" ? "Not yet" : "Not measured"}
              note={wallet.eligibility.status === "not-measured" ? "No holder snapshot this week yet." : `7-day average ${formatUnits(BigInt(wallet.eligibility.average), 6, 0)} of ${formatUnits(BigInt(wallet.eligibility.minimum), 6, 0)} needed.`}
            />
            <Cell label="Available credits" value={wallet.credits.available.toLocaleString("en-US")} note={wallet.credits.reserved ? `${formatCredits(wallet.credits.reserved)} reserved by running jobs.` : "Spendable in the Studio."} />
            <Cell label="Next allocation" value={formatDate(wallet.nextAllocationAt)} note="Mondays, 00:00 UTC." />
          </>
        ) : (
          <>
            <Cell label="FABLE balance" value="—" note="Shown after you sign in." />
            <Cell label="Eligibility" value="—" note={`Average of at least ${minimumTokens.toLocaleString("en-US")} FABLE over the previous week.`} />
            <Cell label="Available credits" value="—" note="Your allocated Studio credits." />
            <Cell label="Next allocation" value={formatDate(nextAllocationAt)} note="Weekly, from confirmed fee receipts." />
          </>
        )}
      </div>
    </div>
  );
}
