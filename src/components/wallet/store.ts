"use client";

import { useSyncExternalStore } from "react";
import bs58 from "bs58";
import { CLIENT_RPC_PATH, chainId } from "@/config/solana";

/**
 * Wallet discovery through the wallet-standard protocol, without the adapter packages:
 * the app dispatches `wallet-standard:app-ready` with a `register` API, wallets announce
 * themselves with `wallet-standard:register-wallet` (and older ones push into
 * `navigator.wallets`). Phantom, Solflare, Backpack and the CDP stub all speak it.
 */

export interface StandardAccount {
  address: string;
  publicKey: Uint8Array;
  chains: readonly string[];
  features: readonly string[];
}

type ConnectFeature = { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly StandardAccount[] }> };
type DisconnectFeature = { disconnect(): Promise<void> };
type EventsFeature = { on(event: "change", listener: (props: { accounts?: readonly StandardAccount[] }) => void): () => void };
type SignMessageFeature = {
  signMessage(...inputs: { account: StandardAccount; message: Uint8Array }[]): Promise<{ signedMessage: Uint8Array; signature: Uint8Array }[]>;
};
type SignAndSendFeature = {
  signAndSendTransaction(
    ...inputs: { account: StandardAccount; chain: string; transaction: Uint8Array; options?: Record<string, unknown> }[]
  ): Promise<{ signature: Uint8Array }[]>;
};

export interface StandardWallet {
  name: string;
  icon: string;
  version: string;
  chains: readonly string[];
  accounts: readonly StandardAccount[];
  features: Record<string, unknown>;
}

export interface WalletState {
  wallets: StandardWallet[];
  address: string | null;
  walletName: string | null;
  dialogOpen: boolean;
  /** Address of the server session (signed in), or null. */
  session: string | null;
}

const REMEMBER_KEY = "fable.wallet";
const SERVER_STATE: WalletState = { wallets: [], address: null, walletName: null, dialogOpen: false, session: null };

let state: WalletState = SERVER_STATE;
let activeWallet: StandardWallet | null = null;
let activeAccount: StandardAccount | null = null;
let offChange: (() => void) | null = null;
let started = false;
const listeners = new Set<() => void>();

function set(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function remember(name: string | null) {
  try {
    if (name) localStorage.setItem(REMEMBER_KEY, name);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // storage unavailable: the choice is simply not remembered
  }
}

function isSolanaWallet(wallet: StandardWallet): boolean {
  return Boolean(wallet?.features?.["standard:connect"]) && wallet.chains.some((c) => c.startsWith("solana:"));
}

function attach(wallet: StandardWallet, account: StandardAccount) {
  activeWallet = wallet;
  activeAccount = account;
  offChange?.();
  offChange = (wallet.features["standard:events"] as EventsFeature | undefined)?.on("change", ({ accounts }) => {
    if (activeWallet !== wallet || !accounts) return;
    const next = accounts[0];
    if (next) {
      activeAccount = next;
      set({ address: next.address, session: state.session === next.address ? state.session : null });
    } else disconnectWallet();
  }) ?? null;
  set({ address: account.address, walletName: wallet.name });
  void refreshSession();
}

function addWallet(wallet: StandardWallet) {
  if (!isSolanaWallet(wallet) || state.wallets.some((w) => w.name === wallet.name)) return;
  set({ wallets: [...state.wallets, wallet] });
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(REMEMBER_KEY);
  } catch {
    remembered = null;
  }
  if (remembered === wallet.name && !state.address) {
    // Silent restore never opens a prompt; a wallet that refuses it just stays disconnected.
    (wallet.features["standard:connect"] as ConnectFeature)
      .connect({ silent: true })
      .then(({ accounts }) => {
        if (accounts[0] && !state.address) attach(wallet, accounts[0]);
      })
      .catch(() => {});
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const api = {
    register: (...wallets: StandardWallet[]) => {
      wallets.forEach(addWallet);
      return () => {};
    },
  };
  window.addEventListener("wallet-standard:register-wallet", (event) => {
    const callback = (event as CustomEvent).detail as ((a: typeof api) => void) | undefined;
    if (typeof callback === "function") callback(api);
  });
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
  // Legacy registration: callbacks pushed into navigator.wallets before the app loaded.
  const nav = window.navigator as unknown as { wallets?: unknown };
  const legacy = Array.isArray(nav.wallets) ? (nav.wallets as ((a: typeof api) => void)[]) : [];
  legacy.forEach((cb) => typeof cb === "function" && cb(api));
  void refreshSession();
}

export function useWallet(): WalletState {
  return useSyncExternalStore(
    (listener) => {
      start();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => SERVER_STATE,
  );
}

export function openWalletDialog() {
  start();
  set({ dialogOpen: true });
}

export function closeWalletDialog() {
  set({ dialogOpen: false });
}

export async function connectWallet(wallet: StandardWallet): Promise<string> {
  const { accounts } = await (wallet.features["standard:connect"] as ConnectFeature).connect();
  const account = accounts.find((a) => a.chains.length === 0 || a.chains.some((c) => c.startsWith("solana:"))) ?? accounts[0];
  if (!account) throw new Error("The wallet returned no account.");
  attach(wallet, account);
  remember(wallet.name);
  return account.address;
}

export function disconnectWallet() {
  const wallet = activeWallet;
  activeWallet = null;
  activeAccount = null;
  offChange?.();
  offChange = null;
  remember(null);
  set({ address: null, walletName: null });
  void (wallet?.features["standard:disconnect"] as DisconnectFeature | undefined)?.disconnect().catch(() => {});
}

export function walletErrorMessage(error: unknown): string {
  const e = error as { code?: number; name?: string; message?: string };
  if (e?.code === 4001 || /reject|declin|cancel/i.test(e?.message ?? "")) return "Request declined in your wallet.";
  return e?.message && e.message.length < 140 ? e.message : "The wallet request failed.";
}

/** Signs UTF-8 text with `solana:signMessage`; returns the base58 signature. */
export async function signMessage(message: string): Promise<string> {
  if (!activeWallet || !activeAccount) throw new Error("Connect a wallet first.");
  const feature = activeWallet.features["solana:signMessage"] as SignMessageFeature | undefined;
  if (!feature) throw new Error("This wallet cannot sign messages.");
  const [out] = await feature.signMessage({ account: activeAccount, message: new TextEncoder().encode(message) });
  return bs58.encode(out.signature);
}

/** Signs and sends a serialized transaction with `solana:signAndSendTransaction`; returns the base58 signature. */
export async function signAndSendTransaction(transaction: Uint8Array): Promise<string> {
  if (!activeWallet || !activeAccount) throw new Error("Connect a wallet first.");
  const feature = activeWallet.features["solana:signAndSendTransaction"] as SignAndSendFeature | undefined;
  if (!feature) throw new Error("This wallet cannot send transactions.");
  const [out] = await feature.signAndSendTransaction({ account: activeAccount, chain: chainId(), transaction });
  return bs58.encode(out.signature);
}

// ───────────────────────────── session (sign-in by message)

export async function refreshSession() {
  try {
    const r = await fetch("/api/auth/me", { cache: "no-store" });
    const j = (await r.json()) as { address?: string | null };
    set({ session: j.address ?? null });
  } catch {
    // offline: session state unknown, keep the previous value
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? "Request failed.");
  return j;
}

/** nonce → signMessage → verify → httpOnly session cookie. */
export async function signIn(): Promise<string> {
  const address = state.address;
  if (!address) throw new Error("Connect a wallet first.");
  const { nonce, issuedAt, message } = await postJson<{ nonce: string; issuedAt: string; message: string }>("/api/auth/nonce", { address });
  const signature = await signMessage(message);
  const verified = await postJson<{ address: string }>("/api/auth/verify", { address, nonce, issuedAt, signature });
  set({ session: verified.address });
  return verified.address;
}

export async function signOut() {
  await postJson("/api/auth/logout", {}).catch(() => {});
  set({ session: null });
}

// ───────────────────────────── reads through the same-origin relay

let rpcId = 0;
export async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(CLIENT_RPC_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}
