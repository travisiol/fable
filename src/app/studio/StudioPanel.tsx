"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { COSTS, FORMATS, PRESETS } from "@/config/fable";
import type { Preset } from "@/config/fable";
import { api, newKey } from "@/lib/client";
import { formatCredits, formatDateTime } from "@/lib/format";
import { useMe } from "@/components/WalletPanel";
import { isOpen, statusLabel, useJob } from "@/components/jobs";
import type { JobView } from "@/components/jobs";

interface Char {
  id: string;
  slug: string | null;
  name: string;
  status: string;
  portrait: string | null;
  look: string;
}

const PRESET_LABEL: Record<string, string> = Object.fromEntries(PRESETS.map((p) => [p.id, p.label]));

async function fetchCharacter(id: string) {
  return api<{ budget: { available: number }; jobs: JobView[] }>(`/api/characters/${id}`);
}

function initialCharacter(): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("character");
}

export default function StudioPanel({ imagesOn, videoOn }: { imagesOn: boolean; videoOn: boolean }) {
  const [characters, setCharacters] = useState<Char[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialCharacter);
  const [mode, setMode] = useState<"image" | "video">("image");
  const [preset, setPreset] = useState<Preset>("scene");
  const [prompt, setPrompt] = useState("");
  const [format, setFormat] = useState<string>(FORMATS.image[0].id);
  const [payer, setPayer] = useState<"holder_credits" | "character_budget">("holder_credits");
  const [budget, setBudget] = useState<number | null>(null);
  const [history, setHistory] = useState<JobView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newKey("studio"));
  const [refresh, setRefresh] = useState(0);
  const me = useMe(refresh);

  const [job, setJob] = useJob(null);

  const apply = (j: { budget: { available: number }; jobs: JobView[] }, resume: boolean) => {
    setBudget(j.budget.available);
    const studio = j.jobs.filter((x) => x.kind === "image" || x.kind === "video");
    setHistory(studio);
    const open = studio.find((x) => isOpen(x));
    if (resume && open) setJob((cur) => (isOpen(cur) ? cur : open));
  };
  const load = (id: string) => fetchCharacter(id).then((j) => apply(j, false));

  // when a job ends: refresh balances and history
  const doneKey = job && !isOpen(job) ? `${job.id}:${job.status}` : null;
  useEffect(() => {
    if (!doneKey || !selected) return;
    let live = true;
    fetchCharacter(selected)
      .then((j) => {
        if (!live) return;
        setRefresh((n) => n + 1);
        setBudget(j.budget.available);
        setHistory(j.jobs.filter((x) => x.kind === "image" || x.kind === "video"));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [doneKey, selected]);

  useEffect(() => {
    if (!me.signedIn) return;
    let live = true;
    api<{ characters: Char[] }>("/api/characters")
      .then((j) => {
        if (!live) return;
        const saved = j.characters.filter((c) => c.status === "saved");
        setCharacters(saved);
        setSelected((s) => (s && saved.some((c) => c.id === s) ? s : (saved[0]?.id ?? null)));
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [me.signedIn]);

  useEffect(() => {
    if (!selected || !me.signedIn) return;
    let live = true;
    fetchCharacter(selected)
      .then((j) => {
        if (live) apply(j, true);
      })
      .catch(() => {
        if (live) setError("Could not load this character.");
      });
    return () => {
      live = false;
    };
    // apply only sets state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, me.signedIn]);

  const character = characters?.find((c) => c.id === selected) ?? null;
  const cost = mode === "video" ? COSTS.video : COSTS.image;
  const credits = me.wallet?.credits.available ?? null;
  const balance = payer === "holder_credits" ? credits : budget;
  const unavailable = mode === "video" ? !videoOn : !imagesOn;
  const presets = PRESETS.filter((p) => p.mode === mode);

  const switchMode = (m: "image" | "video") => {
    setMode(m);
    setPreset(m === "video" ? "talking" : "scene");
    setFormat(m === "video" ? FORMATS.video[0].id : FORMATS.image[0].id);
  };

  const submit = async () => {
    if (!character) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ job: JobView }>("/api/jobs", { body: { characterId: character.id, mode, preset, prompt, format, payer, idempotencyKey: key } });
      setJob(r.job);
      setKey(newKey("studio"));
      setRefresh((n) => n + 1);
      void load(character.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (j: JobView, action: "cancel" | "retry") => {
    setError(null);
    try {
      const r = await api<{ job: JobView }>(`/api/jobs/${j.id}/${action}`, { body: { idempotencyKey: newKey("retry") } });
      if (action === "retry") setJob(r.job);
      setRefresh((n) => n + 1);
      if (selected) void load(selected);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (characters && characters.length === 0)
    return (
      <div className="sheet p-6">
        <p className="display text-3xl">No saved character yet</p>
        <p className="mt-2 text-ink-2">The Studio works with a saved character, so every image keeps its identity.</p>
        <Link href="/create" className="btn btn-primary mt-5">
          Create a character
        </Link>
      </div>
    );

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <p className="field-label">Character reference</p>
          {!characters ? (
            <div className="sheet h-24 animate-pulse" />
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {characters.map((c) => (
                <button key={c.id} type="button" onClick={() => setSelected(c.id)} className={`w-24 shrink-0 text-left ${selected === c.id ? "" : "opacity-60 hover:opacity-100"}`} aria-pressed={selected === c.id}>
                  <div className={`portrait border ${selected === c.id ? "border-violet border-2" : "border-line"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
                    {c.portrait && <img src={c.portrait} alt="" />}
                  </div>
                  <p className="mt-1 truncate text-xs font-semibold">{c.name}</p>
                </button>
              ))}
            </div>
          )}
          <p className="hint mt-2">The portrait is sent as a reference image so the character stays recognisable, as closely as the model allows. Exact likeness is not guaranteed.</p>
        </div>

        <div>
          <p className="field-label">Mode</p>
          <div className="inline-flex border border-ink" role="tablist">
            {(["image", "video"] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)} className={`px-5 py-2 text-sm font-semibold ${mode === m ? "bg-ink text-ivory" : ""}`}>
                {m === "image" ? "Image" : "Video"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="field-label">Preset</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {presets.map((p) => (
              <label key={p.id} className={`cursor-pointer border p-3 ${preset === p.id ? "border-ink bg-paper" : "border-line"}`}>
                <input type="radio" className="sr-only" name="preset" checked={preset === p.id} onChange={() => setPreset(p.id)} />
                <span className="block font-semibold">{p.label}</span>
                <span className="mt-1 block text-xs text-muted">{p.hint}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="s-prompt">
            Prompt
          </label>
          <textarea id="s-prompt" className="field min-h-24" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={600} placeholder={mode === "video" ? "Tells the audience about his first gig in Osaka" : "On a tiny stage under a single spotlight, holding the microphone"} />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="s-format">
              Output format
            </label>
            <select id="s-format" className="field" value={format} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS[mode].map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <fieldset>
            <legend className="field-label">Pays for this job</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="payer" checked={payer === "holder_credits"} onChange={() => setPayer("holder_credits")} />
              My Studio credits <span className="mono text-muted">({credits ?? "…"})</span>
            </label>
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input type="radio" name="payer" checked={payer === "character_budget"} onChange={() => setPayer("character_budget")} />
              Character content budget <span className="mono text-muted">({budget ?? "…"})</span>
            </label>
          </fieldset>
        </div>

        <div className="sheet p-4">
          <div className="kv">
            <span>Estimated cost</span>
            <span className="mono">{formatCredits(cost)}</span>
          </div>
          <div className="kv">
            <span>Charged to</span>
            <span>{payer === "holder_credits" ? "Your Studio credits only" : `${character?.name ?? "The character"}'s budget only`}</span>
          </div>
          <div className="kv">
            <span>Available there</span>
            <span className="mono">{balance === null ? "…" : formatCredits(balance)}</span>
          </div>
          {unavailable && <p className="notice notice-alert mt-3">{mode === "video" ? "Video generation is unavailable: no video provider is configured." : "Image generation is unavailable: the AI provider is not configured."}</p>}
          {!unavailable && balance !== null && balance < cost && <p className="notice notice-alert mt-3">Not enough on this balance for this job.</p>}
          <p className="hint mt-3">Reserved when you submit, charged only on success, restored on failure or cancellation. Nothing is posted to social networks.</p>
          <button type="submit" className="btn btn-primary mt-4 w-full" disabled={busy || !character || unavailable || prompt.trim().length < 3 || (balance !== null && balance < cost) || isOpen(job)}>
            {busy ? <span className="spinner" /> : `Generate · ${cost} credits`}
          </button>
        </div>
        {error && <p className="notice notice-alert">{error}</p>}
      </form>

      <div className="space-y-6">
        <div>
          <p className="field-label">Result</p>
          <div className="portrait grid place-items-center border border-ink" style={{ aspectRatio: job?.format === "16:9" || job?.format === "1536x1024" ? "3 / 2" : job?.format === "1024x1024" ? "1 / 1" : "4 / 5" }}>
            {job?.result ? (
              job.resultKind === "video" ? (
                <video src={job.result} controls playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- generated media
                <img src={job.result} alt={job.prompt} />
              )
            ) : isOpen(job) ? (
              <div className="w-2/3 text-center">
                <span className="spinner mx-auto block text-violet" style={{ width: 24, height: 24 }} />
                <p className="mt-3 text-sm">{statusLabel(job!)}</p>
                <div className="bar bar-indeterminate mt-3">
                  <span />
                </div>
                <p className="hint mt-2">{job!.kind === "video" ? "Clips take a few minutes. You can leave: the job keeps going." : "Usually under a minute."}</p>
              </div>
            ) : job && (job.status === "failed" || job.status === "cancelled") ? (
              <p className="px-6 text-center text-sm text-alert">{job.error ?? "Cancelled."} Credits restored.</p>
            ) : (
              <p className="px-6 text-center text-sm text-muted">Your image or clip will appear here.</p>
            )}
            {job?.result && <span className="ai-tag absolute left-3 top-3">AI-generated</span>}
          </div>
          {job?.result && (
            <a href={job.result} download className="btn btn-outline btn-sm mt-3">
              Download
            </a>
          )}
        </div>

        <div>
          <p className="field-label">History {character ? `· ${character.name}` : ""}</p>
          {history.length === 0 ? (
            <p className="text-sm text-muted">No Studio jobs for this character yet.</p>
          ) : (
            <ul>
              {history.map((h) => (
                <li key={h.id} className="kv items-center">
                  <span className="min-w-0">
                    <span className="font-semibold text-ink">{PRESET_LABEL[h.preset ?? ""] ?? h.kind}</span> · {formatDateTime(h.createdAt)}
                    <span className="block truncate text-xs">{h.prompt}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`chip ${h.status === "succeeded" ? "chip-good" : h.status === "failed" ? "chip-alert" : ""}`}>{statusLabel(h)}</span>
                    {h.status === "queued" && (
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => act(h, "cancel")}>
                        Cancel
                      </button>
                    )}
                    {(h.status === "failed" || h.status === "cancelled") && (
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => act(h, "retry")}>
                        Retry
                      </button>
                    )}
                    {h.result && (
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => setJob(h)}>
                        View
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
