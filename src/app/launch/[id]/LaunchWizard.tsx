"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { MAX_INITIAL_BUY_LAMPORTS, TICKER_RE, TOKEN_LIMITS } from "@/config/fable";
import { explorerUrl } from "@/config/solana";
import { api, b64ToBytes, sleep } from "@/lib/client";
import { formatSol, shortAddress } from "@/lib/format";
import { CopyText } from "@/components/CopyText";
import { signAndSendTransaction, walletErrorMessage } from "@/components/wallet/store";

interface Character {
  id: string;
  slug: string | null;
  name: string;
  bio: string;
  status: string;
  portrait: string | null;
}
interface LaunchView {
  id: string;
  status: "prepared" | "submitted" | "confirmed" | "failed" | "rejected" | "expired";
  mint: string;
  ticker: string;
  name: string;
  description: string;
  cluster: string;
  createSig: string | null;
  sharingStatus: "none" | "prepared" | "submitted" | "active" | "failed";
  sharingSig: string | null;
  error: string | null;
}
interface Summary {
  network: string;
  payer: string;
  mint: string;
  creatorOfRecord: string;
  instructions: string[];
  initialBuyLamports: string;
  expectedTokens: string;
  estimatedNetworkFeeLamports: string;
  estimatedRentLamports: string;
}
export interface Availability {
  ok: boolean;
  missing: string[];
  cluster: string;
  poolWallet: string | null;
  budgetWallet: string | null;
}

const isRejection = (e: unknown) => {
  const x = e as { code?: number; message?: string };
  return x?.code === 4001 || /reject|declin|cancel|denied/i.test(x?.message ?? "");
};

/** A fresh mint keypair, generated in this browser; its secret never leaves the page. */
function freshMint(): Keypair {
  return Keypair.generate();
}

function Steps({ step }: { step: number }) {
  return (
    <ol className="steps" aria-label="Progress">
      {["Identity", "Token", "Review"].map((s, i) => (
        <li key={s} className="step" data-state={i < step ? "done" : i === step ? "current" : "todo"}>
          <span className="mono mr-2 text-xs">{i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

export default function LaunchWizard({ characterId, availability }: { characterId: string; availability: Availability }) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [launch, setLaunch] = useState<LaunchView | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ ticker: "", description: "", x: "", telegram: "", website: "", initialBuySol: "0" });
  const [prepared, setPrepared] = useState<{ tx: string; summary: Summary; mint: Keypair } | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<{ character: Character; launch: LaunchView | null }>(`/api/characters/${characterId}`)
      .then((j) => {
        if (!live) return;
        setCharacter(j.character);
        setLaunch(j.launch);
        setForm((f) => ({ ...f, description: f.description || j.character.bio, ticker: f.ticker || j.character.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase() }));
      })
      .catch((e) => live && setLoadError((e as Error).message));
    return () => {
      live = false;
    };
  }, [characterId]);

  const pollConfirm = useCallback(async (id: string, action: "confirm" | "sharing-confirm") => {
    for (let i = 0; i < 90; i++) {
      const { launch: l } = await api<{ launch: LaunchView }>(`/api/launch/${id}/${action}`, { body: {} });
      setLaunch(l);
      if (action === "confirm" && l.status !== "submitted" && l.status !== "prepared") return l;
      if (action === "sharing-confirm" && l.sharingStatus !== "submitted" && l.sharingStatus !== "prepared") return l;
      await sleep(2500);
    }
    return null;
  }, []);

  // a submitted launch (after a refresh) keeps being checked
  useEffect(() => {
    if (!launch) return;
    let live = true;
    if (launch.status === "submitted") {
      void (async () => {
        const l = await pollConfirm(launch.id, "confirm").catch(() => null);
        if (live && l) setPhase(null);
      })();
    } else if (launch.status === "confirmed" && launch.sharingStatus === "submitted") {
      void (async () => {
        await pollConfirm(launch.id, "sharing-confirm").catch(() => null);
      })();
    }
    return () => {
      live = false;
    };
    // only on first load of a launch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch?.id]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const ticker = form.ticker.replace(/^\$/, "").toUpperCase();
  const solOk = /^\d+(\.\d{1,9})?$/.test(form.initialBuySol || "0");
  const buyLamports = solOk ? BigInt(Math.round(Number(form.initialBuySol || "0") * 1e9)) : BigInt(0);
  const tokenValid = TICKER_RE.test(ticker) && form.description.trim().length >= 10 && solOk && buyLamports <= MAX_INITIAL_BUY_LAMPORTS;

  const prepare = async () => {
    setError(null);
    setPhase("Preparing the transaction");
    try {
      const mint = prepared?.mint ?? freshMint();
      const r = await api<{ launch: LaunchView; transaction: string; summary: Summary }>("/api/launch/prepare", { body: { characterId, mint: mint.publicKey.toBase58(), ...form, ticker } });
      setPrepared({ tx: r.transaction, summary: r.summary, mint });
      setLaunch(r.launch);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase(null);
    }
  };

  const sign = async () => {
    if (!prepared || !launch) return;
    setError(null);
    setPhase("Waiting for your wallet");
    let signature: string;
    try {
      const tx = VersionedTransaction.deserialize(b64ToBytes(prepared.tx));
      tx.sign([prepared.mint]);
      signature = await signAndSendTransaction(tx.serialize());
    } catch (e) {
      if (isRejection(e)) {
        const r = await api<{ launch: LaunchView }>(`/api/launch/${launch.id}/rejected`, { body: { reason: "The signature request was declined in the wallet." } }).catch(() => null);
        if (r) setLaunch(r.launch);
        setPrepared(null);
        setError("You declined the request in your wallet. Nothing was sent and nothing was charged. You can prepare it again.");
      } else {
        setError(`${walletErrorMessage(e)} If your wallet sent it anyway, use "Check status".`);
      }
      setPhase(null);
      return;
    }
    setPhase("Sent. Waiting for confirmation on chain");
    try {
      await api(`/api/launch/${launch.id}/submitted`, { body: { signature } });
      const l = await pollConfirm(launch.id, "confirm");
      if (l?.status === "failed") setError(l.error ?? "The transaction failed on chain. Nothing was created.");
      if (l?.status === "expired") setError(l.error ?? "The transaction expired before it landed. Nothing was created.");
      if (l && l.status !== "confirmed") setPrepared(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase(null);
    }
  };

  const checkStatus = async () => {
    if (!launch) return;
    setPhase("Checking the chain");
    try {
      const { launch: l } = await api<{ launch: LaunchView }>(`/api/launch/${launch.id}/confirm`, { body: {} });
      setLaunch(l);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase(null);
    }
  };

  const activateSplit = async () => {
    if (!launch) return;
    setError(null);
    setPhase("Preparing the fee split");
    try {
      const r = await api<{ launch: LaunchView; transaction: string }>(`/api/launch/${launch.id}/sharing`, { body: {} });
      setPhase("Waiting for your wallet");
      let sig: string;
      try {
        sig = await signAndSendTransaction(VersionedTransaction.deserialize(b64ToBytes(r.transaction)).serialize());
      } catch (e) {
        if (isRejection(e)) {
          const x = await api<{ launch: LaunchView }>(`/api/launch/${launch.id}/sharing-rejected`, { body: {} });
          setLaunch(x.launch);
          setError("You declined the fee split in your wallet. Until it is set, this coin's creator fees go to your wallet only, and FABLE shows no split for it.");
        } else setError(walletErrorMessage(e));
        return;
      }
      setPhase("Waiting for confirmation on chain");
      await api(`/api/launch/${launch.id}/sharing-submitted`, { body: { signature: sig } });
      const l = await pollConfirm(launch.id, "sharing-confirm");
      if (l?.sharingStatus === "failed") setError(l.error ?? "The fee split could not be verified.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase(null);
    }
  };

  if (loadError) return <p className="notice notice-alert">{loadError}</p>;
  if (!character) return <div className="sheet h-64 animate-pulse" />;
  if (character.status !== "saved")
    return (
      <div className="sheet p-6">
        <p className="display text-2xl">Save the character first</p>
        <p className="mt-2 text-ink-2">A coin is launched for a saved character with a public page.</p>
        <Link href={`/create?draft=${character.id}`} className="btn btn-primary mt-4">
          Back to review
        </Link>
      </div>
    );

  const cluster = (launch?.cluster ?? availability.cluster) === "devnet" ? "devnet" : "mainnet-beta";

  // ── after confirmation
  if (launch?.status === "confirmed")
    return (
      <div className="grid gap-8 lg:grid-cols-[0.6fr_1.4fr]">
        <Portrait c={character} />
        <div className="space-y-5">
          <p className="notice notice-good" data-testid="launch-confirmed">
            Confirmed on chain. ${launch.ticker} exists and its mint carries the name and ticker you chose.
          </p>
          <div className="kv">
            <span>Contract address</span>
            <CopyText text={launch.mint} label={shortAddress(launch.mint)} />
          </div>
          {launch.createSig && (
            <div className="kv">
              <span>Transaction</span>
              <a className="link mono text-sm" href={explorerUrl("tx", launch.createSig, cluster)} target="_blank" rel="noreferrer">
                {shortAddress(launch.createSig)} ↗
              </a>
            </div>
          )}
          <div className="sheet p-5">
            <p className="label">Step 2 · creator fee split</p>
            {launch.sharingStatus === "active" ? (
              <p className="notice notice-good mt-3" data-testid="split-active">
                Active and locked on chain: 30% holder pool, 40% {character.name}&apos;s content budget, 30% you.
              </p>
            ) : (
              <>
                <p className="mt-2 text-ink-2">
                  One more signature registers pump.fun&apos;s own fee sharing for this coin: 30% to the FABLE holder pool ({shortAddress(availability.poolWallet ?? "—")}), 40% to {character.name}&apos;s content budget (
                  {shortAddress(availability.budgetWallet ?? "—")}), 30% to you. It is permanent once set. Until then, creator fees go to your wallet only.
                </p>
                <button type="button" className="btn btn-violet mt-4" disabled={phase !== null} onClick={activateSplit}>
                  {phase ?? "Sign the fee split"}
                </button>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={`/c/${character.slug}`} className="btn btn-primary">
              View {character.name}&apos;s page
            </Link>
            <Link href={`/studio?character=${character.id}`} className="btn btn-outline">
              Create in Studio
            </Link>
          </div>
          {error && <p className="notice notice-alert">{error}</p>}
        </div>
      </div>
    );

  if (!availability.ok)
    return (
      <div className="grid gap-8 lg:grid-cols-[0.6fr_1.4fr]">
        <Portrait c={character} />
        <div className="space-y-4">
          <p className="display text-3xl">Launching is unavailable: deployment is not configured.</p>
          <p className="text-ink-2">{character.name} is saved and keeps working without a coin. The owner of this FABLE deployment has not switched on coin launches yet.</p>
          <button type="button" className="btn btn-violet" disabled>
            Launch its coin
          </button>
          <p className="hint">
            Details for the operator are on the{" "}
            <Link href="/settings/config" className="link">
              configuration page
            </Link>
            .
          </p>
        </div>
      </div>
    );

  const busy = phase !== null;
  return (
    <div className="space-y-8">
      <Steps step={step} />
      {launch?.status === "submitted" && (
        <div className="notice">
          A launch transaction was sent and is waiting for confirmation. {phase ?? ""}{" "}
          <button type="button" className="link" onClick={checkStatus}>
            Check status
          </button>
        </div>
      )}
      <div className="grid gap-8 lg:grid-cols-[0.6fr_1.4fr]">
        <Portrait c={character} />
        <div>
          {step === 0 && (
            <div className="space-y-4">
              <p className="label">Identity</p>
              <h2 className="display text-4xl">{character.name}</h2>
              <p className="text-ink-2">{character.bio}</p>
              <p className="hint">The coin uses this portrait as its image and this name as its token name ({character.name.length}/{TOKEN_LIMITS.name} characters). The name is fixed once launched.</p>
              <button type="button" className="btn btn-primary" onClick={() => setStep(1)}>
                Confirm identity
              </button>
            </div>
          )}
          {step === 1 && (
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (tokenValid) setStep(2);
              }}
            >
              <p className="label">Token</p>
              <div className="grid gap-5 sm:grid-cols-[0.6fr_1.4fr]">
                <div>
                  <label className="field-label" htmlFor="t-ticker">
                    Ticker
                  </label>
                  <input id="t-ticker" className="field mono uppercase" value={form.ticker} onChange={set("ticker")} maxLength={11} />
                  <p className={`hint mt-1 ${form.ticker && !TICKER_RE.test(ticker) ? "text-alert" : ""}`}>2 to 10 letters or digits.</p>
                </div>
                <div>
                  <label className="field-label" htmlFor="t-buy">
                    Initial purchase (optional, SOL)
                  </label>
                  <input id="t-buy" className="field mono" value={form.initialBuySol} onChange={set("initialBuySol")} inputMode="decimal" />
                  <p className={`hint mt-1 ${!solOk || buyLamports > MAX_INITIAL_BUY_LAMPORTS ? "text-alert" : ""}`}>0 for none. Bought in the same transaction as the launch, up to 5 SOL.</p>
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="t-desc">
                  Token description
                </label>
                <textarea id="t-desc" className="field min-h-24" value={form.description} onChange={set("description")} maxLength={TOKEN_LIMITS.description} />
              </div>
              <div className="grid gap-5 sm:grid-cols-3">
                <div>
                  <label className="field-label" htmlFor="t-x">
                    X (optional)
                  </label>
                  <input id="t-x" className="field" value={form.x} onChange={set("x")} placeholder="https://x.com/…" />
                </div>
                <div>
                  <label className="field-label" htmlFor="t-tg">
                    Telegram (optional)
                  </label>
                  <input id="t-tg" className="field" value={form.telegram} onChange={set("telegram")} placeholder="https://t.me/…" />
                </div>
                <div>
                  <label className="field-label" htmlFor="t-web">
                    Website (optional)
                  </label>
                  <input id="t-web" className="field" value={form.website} onChange={set("website")} placeholder="https://…" />
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" className="btn btn-quiet" onClick={() => setStep(0)}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary" disabled={!tokenValid}>
                  Review
                </button>
              </div>
            </form>
          )}
          {step === 2 && (
            <div className="space-y-5">
              <p className="label">Review</p>
              <div>
                <div className="kv">
                  <span>Network</span>
                  <span>{prepared?.summary.network ?? (availability.cluster === "devnet" ? "Solana devnet" : "Solana mainnet")}</span>
                </div>
                <div className="kv">
                  <span>Launch platform</span>
                  <span>pump.fun bonding curve (create_v2)</span>
                </div>
                <div className="kv">
                  <span>Token metadata</span>
                  <span>
                    {character.name} · <span className="mono">${ticker}</span>
                  </span>
                </div>
                <div className="kv">
                  <span>Description</span>
                  <span className="max-w-sm text-sm">{form.description}</span>
                </div>
                <div className="kv">
                  <span>Fee allocation</span>
                  <span className="max-w-sm text-sm">30% holder pool · 40% content budget · 30% you — set by a second signature right after the launch (pump.fun fee sharing)</span>
                </div>
                <div className="kv">
                  <span>Deployment fees</span>
                  <span className="mono text-sm">
                    {prepared ? `≈ ${formatSol(BigInt(prepared.summary.estimatedRentLamports) + BigInt(prepared.summary.estimatedNetworkFeeLamports))} SOL (account rent + network fee)` : "≈ 0.022 SOL account rent + network fee"}
                  </span>
                </div>
                <div className="kv">
                  <span>Initial purchase</span>
                  <span className="mono">{buyLamports > BigInt(0) ? `${formatSol(buyLamports)} SOL` : "None"}</span>
                </div>
              </div>
              {prepared ? (
                <div className="sheet p-4">
                  <p className="label">The transaction your wallet will sign</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                    {prepared.summary.instructions.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ol>
                  <div className="kv mt-2">
                    <span>Fee payer and creator</span>
                    <span className="mono text-sm">{shortAddress(prepared.summary.payer)} (your wallet)</span>
                  </div>
                  <div className="kv">
                    <span>New mint</span>
                    <span className="mono text-sm">{shortAddress(prepared.summary.mint)} (generated in this browser)</span>
                  </div>
                  <p className="hint mt-2">FABLE never asks for a seed phrase or a private key. Your wallet shows the same transaction before you approve.</p>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setStep(1)}>
                  Back
                </button>
                {!prepared ? (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={prepare}>
                    {phase ?? "Prepare the transaction"}
                  </button>
                ) : (
                  <button type="button" className="btn btn-violet" disabled={busy} onClick={sign} data-testid="sign-launch">
                    {phase ?? "Sign and launch"}
                  </button>
                )}
                {launch && (launch.status === "submitted" || prepared) && (
                  <button type="button" className="btn btn-quiet" disabled={busy} onClick={checkStatus}>
                    Check status
                  </button>
                )}
              </div>
              {phase && (
                <div className="bar bar-indeterminate">
                  <span />
                </div>
              )}
            </div>
          )}
          {error && (
            <p className="notice notice-alert mt-5" role="alert" data-testid="launch-error">
              {error}
            </p>
          )}
          {launch && (launch.status === "failed" || launch.status === "expired" || launch.status === "rejected") && !error && <p className="notice notice-alert mt-5">{launch.error ?? `The last attempt ended as ${launch.status}.`} You can try again.</p>}
        </div>
      </div>
    </div>
  );
}

function Portrait({ c }: { c: Character }) {
  return (
    <div>
      <div className="portrait border border-ink">
        {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
        {c.portrait && <img src={c.portrait} alt={`Portrait of ${c.name}`} />}
        <span className="ai-tag absolute left-3 top-3">AI-generated</span>
      </div>
      <p className="display mt-3 text-2xl">{c.name}</p>
    </div>
  );
}
