"use client";

import { useState } from "react";
import { api, newKey } from "@/lib/client";

/** Owner-only actions (the server checks FABLE_ADMIN_WALLETS on every call). */
export function OwnerTools() {
  const [sig, setSig] = useState("");
  const [wallet, setWallet] = useState("");
  const [credits, setCredits] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string>) => {
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <section className="mt-14 rule pt-5">
      <h2 className="display text-3xl">Owner tools</h2>
      <p className="mt-2 text-sm text-ink-2">Sign in with an owner wallet (FABLE_ADMIN_WALLETS). Every action is checked on the server and recorded on the ledger.</p>
      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <form
          className="sheet space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await api<{ inserted: boolean; lamports: string }>("/api/admin/deposit", { body: { signature: sig.trim() } });
              return r.inserted ? `Recorded: ${r.lamports} lamports added to the holder pool.` : "Already recorded earlier: nothing added.";
            });
          }}
        >
          <p className="font-semibold">Record a deposit into the holder pool</p>
          <p className="hint">Paste the signature of a confirmed SOL transfer to FABLE_POOL_WALLET. Counted once.</p>
          <input className="field mono text-sm" value={sig} onChange={(e) => setSig(e.target.value)} placeholder="Transaction signature" />
          <button className="btn btn-primary btn-sm" type="submit">
            Record deposit
          </button>
        </form>
        <form
          className="sheet space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await api<{ granted: boolean }>("/api/admin/grant", { body: { wallet: wallet.trim(), credits: Number(credits), key: newKey("grant") } });
              return r.granted ? "Granted." : "Already granted.";
            });
          }}
        >
          <p className="font-semibold">Grant credits from the pool</p>
          <p className="hint">Within the same capacity as weekly allocations: the pool cannot go below its operating reserve.</p>
          <input className="field mono text-sm" value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="Wallet address" />
          <input className="field mono text-sm" value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="Credits" inputMode="numeric" />
          <button className="btn btn-primary btn-sm" type="submit">
            Grant
          </button>
        </form>
      </div>
      {msg && <p className={`notice mt-4 ${msg.ok ? "notice-good" : "notice-alert"}`}>{msg.text}</p>}
    </section>
  );
}
