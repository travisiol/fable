"use client";

/** Small browser helpers shared by the interactive pages. */

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(url, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) {
    const e = new Error(j.error ?? `Request failed (${r.status}).`) as Error & { status?: number; body?: unknown };
    e.status = r.status;
    e.body = j;
    throw e;
  }
  return j;
}

/** A fresh idempotency key for one user action (kept until that action succeeds or fails). */
export function newKey(prefix = "k"): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `${prefix}-${r}`.slice(0, 60);
}

export function nowMs(): number {
  return Date.now();
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const DRAFT_KEY = "fable.create-draft";

export interface LocalDraft {
  idea: string;
  name: string;
  personality: string;
  style: string;
  niche: string;
  characterId?: string | null;
}

export function readLocalDraft(): LocalDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as LocalDraft) : null;
  } catch {
    return null;
  }
}

export function writeLocalDraft(d: LocalDraft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // storage unavailable: the server draft still exists once generated
  }
}
