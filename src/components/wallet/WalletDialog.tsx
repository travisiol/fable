"use client";

import { useState } from "react";
import { shortAddress } from "@/lib/format";
import { Modal } from "../Modal";
import type { StandardWallet } from "./store";
import { closeWalletDialog, connectWallet, disconnectWallet, signIn, signOut, useWallet, walletErrorMessage } from "./store";

export function WalletDialog() {
  const wallet = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    closeWalletDialog();
  };

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const signedIn = wallet.address !== null && wallet.session === wallet.address;

  return (
    <Modal open={wallet.dialogOpen} onClose={close} title={wallet.address ? "Your wallet" : "Connect a wallet"}>
      {wallet.address ? (
        <div className="space-y-4">
          <div className="card flex items-center gap-4 p-4">
            <span className="dot" aria-hidden="true" />
            <div className="min-w-0">
              <p className="mono text-lg" data-testid="wallet-address">{shortAddress(wallet.address)}</p>
              <p className="text-sm text-muted">Connected with {wallet.walletName}</p>
            </div>
          </div>
          {signedIn ? (
            <p className="notice" data-testid="signed-in">Signed in as {shortAddress(wallet.address)}.</p>
          ) : (
            <>
              <p className="text-muted">Sign a short message to prove this address is yours. It costs nothing and moves no funds.</p>
              <button type="button" className="btn btn-primary w-full" disabled={busy !== null} onClick={() => run("signin", signIn)}>
                {busy === "signin" ? <span className="spinner" /> : "Sign in"}
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-quiet w-full"
            onClick={() =>
              run("disconnect", async () => {
                if (signedIn) await signOut();
                disconnectWallet();
                close();
              })
            }
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {wallet.wallets.length > 0 ? (
            <ul className="space-y-2">
              {wallet.wallets.map((candidate: StandardWallet) => (
                <li key={candidate.name}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => run(candidate.name, () => connectWallet(candidate))}
                    className="card wallet-option"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- wallet-provided data URI */}
                    <img src={candidate.icon} alt="" className="size-9 rounded-lg" />
                    <span className="flex-1 text-left font-medium">{candidate.name}</span>
                    {busy === candidate.name ? <span className="spinner" /> : <span className="text-sm text-muted">Detected</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="card p-4">
              <p className="font-medium">No Solana wallet found in this browser</p>
              <p className="mt-1 text-sm text-muted">
                Install{" "}
                <a className="link" href="https://phantom.com" target="_blank" rel="noreferrer">Phantom</a>,{" "}
                <a className="link" href="https://solflare.com" target="_blank" rel="noreferrer">Solflare</a> or{" "}
                <a className="link" href="https://backpack.app" target="_blank" rel="noreferrer">Backpack</a>, then reopen this window.
              </p>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="notice notice-alert mt-4">
          {error}
        </p>
      )}
    </Modal>
  );
}
