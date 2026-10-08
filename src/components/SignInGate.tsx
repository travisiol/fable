"use client";

import { useState } from "react";
import { shortAddress } from "@/lib/format";
import { openWalletDialog, signIn, useWallet, walletErrorMessage } from "./wallet/store";

/** Shows children only to a signed-in wallet; otherwise the connect → sign-in steps, explained. */
export function SignInGate({ children, why }: { children: React.ReactNode; why: string }) {
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (w.session && (!w.address || w.session === w.address)) return <>{children}</>;
  return (
    <div className="sheet p-6 sm:p-8" data-testid="signin-gate">
      <p className="label">Sign in</p>
      <h2 className="display mt-2 text-3xl">Prove this wallet is yours</h2>
      <p className="mt-3 max-w-xl text-ink-2">{why} Signing a short message costs nothing and moves no funds. FABLE never asks for a seed phrase or private key.</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {!w.address ? (
          <button type="button" className="btn btn-primary" onClick={openWalletDialog}>
            Connect wallet
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-violet"
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
              {busy ? <span className="spinner" /> : "Sign in"}
            </button>
            <span className="mono text-sm text-muted">{shortAddress(w.address)}</span>
          </>
        )}
      </div>
      {error && <p className="notice notice-alert mt-4">{error}</p>}
    </div>
  );
}
