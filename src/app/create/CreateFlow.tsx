"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { COSTS, STYLES } from "@/config/fable";
import { IDEA_EXAMPLES } from "@/config/examples";
import { api, newKey, readLocalDraft, writeLocalDraft } from "@/lib/client";
import type { LocalDraft } from "@/lib/client";
import { formatCredits } from "@/lib/format";
import { SignInGate } from "@/components/SignInGate";
import { useMe } from "@/components/WalletPanel";
import { isOpen, statusLabel, useJob } from "@/components/jobs";
import type { JobView } from "@/components/jobs";

interface Character {
  id: string;
  slug: string | null;
  number: number | null;
  status: "draft" | "saved" | "discarded";
  idea: string;
  name: string;
  bio: string;
  personality: string;
  style: string;
  niche: string;
  look: string;
  portrait: string | null;
}

const EMPTY: LocalDraft = { idea: "", name: "", personality: "", style: STYLES[0], niche: "", characterId: null };

function initialDraft(): LocalDraft {
  const d = readLocalDraft();
  const fromUrl = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("draft") : null;
  return { ...EMPTY, ...(d ?? {}), style: d?.style || STYLES[0], characterId: fromUrl ?? d?.characterId ?? null };
}

function setDraftParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("draft", id);
  else url.searchParams.delete("draft");
  window.history.replaceState(window.history.state, "", url.toString());
}

function Steps({ step }: { step: 0 | 1 | 2 }) {
  return (
    <ol className="steps" aria-label="Progress">
      {["Describe", "Generate", "Review"].map((s, i) => (
        <li key={s} className="step" data-state={i < step ? "done" : i === step ? "current" : "todo"} aria-current={i === step ? "step" : undefined}>
          <span className="mono mr-2 text-xs">{i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

export default function CreateFlow() {
  const [draft, setDraft] = useState<LocalDraft>(initialDraft);
  const [character, setCharacter] = useState<Character | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [key, setKey] = useState(() => newKey("create"));
  const me = useMe(refresh);
  const router = useRouter();
  const available = me.wallet?.credits.available ?? null;

  const loadCharacter = useCallback(async (id: string) => {
    const j = await api<{ character: Character; jobs: JobView[] }>(`/api/characters/${id}`);
    setCharacter(j.character);
    return j;
  }, []);

  const [job, setJob] = useJob(null, (j) => {
    setRefresh((n) => n + 1);
    if (j.status === "succeeded" && draft.characterId) void loadCharacter(draft.characterId);
  });

  // persist the inputs locally on every change (drafts survive a refresh before generation)
  useEffect(() => {
    writeLocalDraft(draft);
  }, [draft]);

  // resume a server draft (after a refresh, or from the dashboard)
  useEffect(() => {
    const id = draft.characterId;
    if (!id || !me.signedIn) return;
    let live = true;
    api<{ character: Character; jobs: JobView[] }>(`/api/characters/${id}`)
      .then((j) => {
        if (!live) return;
        setCharacter(j.character);
        const open = j.jobs.find((x) => isOpen(x)) ?? j.jobs[0] ?? null;
        if (open) setJob(open);
      })
      .catch(() => {
        if (live) setDraft((d) => ({ ...d, characterId: null }));
      });
    return () => {
      live = false;
    };
  }, [draft.characterId, me.signedIn, setJob]);

  const set = (k: keyof LocalDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const generate = async () => {
    setBusy("generate");
    setError(null);
    try {
      const r = await api<{ characterId: string; job: JobView }>("/api/characters", { body: { ...draft, idempotencyKey: key } });
      setDraft((d) => ({ ...d, characterId: r.characterId }));
      setDraftParam(r.characterId);
      setJob(r.job);
      setKey(newKey("create"));
    } catch (e) {
      const body = (e as { body?: { characterId?: string } }).body;
      if (body?.characterId) {
        setDraft((d) => ({ ...d, characterId: body.characterId! }));
        setDraftParam(body.characterId);
      }
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async (what: "all" | "portrait") => {
    if (!character) return;
    setBusy(what);
    setError(null);
    try {
      await saveEdits();
      const r = await api<{ job: JobView }>(`/api/characters/${character.id}/generate`, { body: { what, idempotencyKey: newKey("regen") } });
      setJob(r.job);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveEdits = async () => {
    if (!character) return;
    const r = await api<{ character: Character }>(`/api/characters/${character.id}`, {
      method: "PATCH",
      body: { name: character.name, bio: character.bio, personality: character.personality, niche: character.niche, style: character.style, look: character.look },
    });
    setCharacter(r.character);
  };

  const save = async (thenLaunch: boolean) => {
    if (!character) return;
    setBusy(thenLaunch ? "launch" : "save");
    setError(null);
    try {
      await saveEdits();
      const r = await api<{ character: { id: string; slug: string } }>(`/api/characters/${character.id}/save`, { body: {} });
      writeLocalDraft(null);
      if (thenLaunch) router.push(`/launch/${r.character.id}`);
      else await loadCharacter(character.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const startOver = () => {
    writeLocalDraft(null);
    setDraftParam(null);
    setCharacter(null);
    setJob(null);
    setDraft({ ...EMPTY });
  };

  const generating = isOpen(job);
  const failed = job && (job.status === "failed" || job.status === "cancelled") && !character?.portrait;
  const step: 0 | 1 | 2 = character?.portrait && !generating ? 2 : generating || (draft.characterId && !character?.portrait) ? 1 : 0;

  return (
    <div className="space-y-8">
      <Steps step={step} />

      {character?.status === "saved" ? (
        <Saved character={character} onNew={startOver} />
      ) : step === 2 && character ? (
        <Review
          character={character}
          onChange={(patch) => setCharacter((c) => (c ? { ...c, ...patch } : c))}
          busy={busy}
          job={job}
          available={available}
          onRegenerate={regenerate}
          onSave={() => save(false)}
          onLaunch={() => save(true)}
          onStartOver={startOver}
        />
      ) : step === 1 ? (
        <GenerateProgress job={job} failed={Boolean(failed)} onRetry={generate} onEdit={() => setJob(null)} busy={busy} draft={draft} />
      ) : (
        <SignInGate why="Generating a character is paid with your Studio credits, so FABLE needs to know which wallet is creating.">
          <Describe draft={draft} set={set} setDraft={setDraft} available={available} busy={busy} onGenerate={generate} />
        </SignInGate>
      )}

      {step === 0 && !me.signedIn && (
        <div className="sheet p-5">
          <p className="label">Your idea is kept</p>
          <p className="mt-1 text-sm text-ink-2">What you type here is saved in this browser until you generate, then as a private draft on your account.</p>
          <textarea className="field mt-3" value={draft.idea} onChange={set("idea")} placeholder="Who are you bringing to life?" maxLength={400} />
        </div>
      )}

      {error && (
        <p className="notice notice-alert" role="alert">
          {error}
          {/credits/i.test(error) && (
            <>
              {" "}
              <Link href="/how-it-works#rules" className="link">
                How credits are allocated
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Describe({
  draft,
  set,
  setDraft,
  available,
  busy,
  onGenerate,
}: {
  draft: LocalDraft;
  set: (k: keyof LocalDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  setDraft: React.Dispatch<React.SetStateAction<LocalDraft>>;
  available: number | null;
  busy: string | null;
  onGenerate: () => void;
}) {
  const short = available !== null && available < COSTS.character;
  return (
    <form
      className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr]"
      onSubmit={(e) => {
        e.preventDefault();
        onGenerate();
      }}
    >
      <div className="space-y-5">
        <div>
          <label className="field-label" htmlFor="c-idea">
            Character idea
          </label>
          <textarea id="c-idea" className="field min-h-28 text-lg" value={draft.idea} onChange={set("idea")} maxLength={400} placeholder="A washed-up robot comedian broadcasting from a tiny apartment in Tokyo." required />
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="label mr-1 self-center">Examples</span>
            {IDEA_EXAMPLES.map((x) => (
              <button key={x.label} type="button" className="chip hover:border-ink" onClick={() => setDraft((d) => ({ ...d, idea: x.idea }))}>
                {x.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="c-name">
              Name <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="c-name" className="field" value={draft.name} onChange={set("name")} maxLength={28} placeholder="Leave empty for a suggestion" />
          </div>
          <div>
            <label className="field-label" htmlFor="c-niche">
              Content niche
            </label>
            <input id="c-niche" className="field" value={draft.niche} onChange={set("niche")} maxLength={100} placeholder="Stand-up, street food, slow travel…" />
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="c-personality">
            Personality
          </label>
          <input id="c-personality" className="field" value={draft.personality} onChange={set("personality")} maxLength={200} placeholder="Deadpan, warm underneath, allergic to applause" />
        </div>
        <fieldset>
          <legend className="field-label">Visual style</legend>
          <div className="flex flex-wrap gap-2">
            {STYLES.map((s) => (
              <label key={s} className={`chip cursor-pointer ${draft.style === s ? "chip-dark" : ""}`}>
                <input type="radio" name="style" className="sr-only" value={s} checked={draft.style === s} onChange={set("style")} />
                {s}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <aside className="sheet h-fit space-y-4 p-5">
        <p className="label">You will get</p>
        <ul className="space-y-1 text-sm text-ink-2">
          <li>— An original portrait</li>
          <li>— A suggested name (or yours)</li>
          <li>— A short biography</li>
          <li>— A personality summary</li>
        </ul>
        <div className="kv">
          <span>Estimated cost</span>
          <span className="mono">{formatCredits(COSTS.character)}</span>
        </div>
        <div className="kv">
          <span>Paid from</span>
          <span>Your Studio credits</span>
        </div>
        <div className="kv">
          <span>Available</span>
          <span className="mono">{available === null ? "…" : formatCredits(available)}</span>
        </div>
        {short && <p className="notice notice-alert">Not enough credits for a new character yet. Credits are allocated weekly to eligible FABLE holders.</p>}
        <p className="hint">The cost is reserved when you press Generate and charged only if the generation succeeds. A failed generation restores it.</p>
        <button type="submit" className="btn btn-primary w-full" disabled={busy !== null || draft.idea.trim().length < 8 || short}>
          {busy === "generate" ? <span className="spinner" /> : `Generate · ${COSTS.character} credits`}
        </button>
      </aside>
    </form>
  );
}

function GenerateProgress({ job, failed, onRetry, onEdit, busy, draft }: { job: JobView | null; failed: boolean; onRetry: () => void; onEdit: () => void; busy: string | null; draft: LocalDraft }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="portrait grid place-items-center border border-line">
        {failed ? <p className="px-6 text-center text-sm text-muted">No portrait was produced.</p> : <span className="spinner text-violet" style={{ width: 28, height: 28 }} />}
      </div>
      <div className="space-y-4">
        <p className="label">Generating</p>
        <h2 className="display text-4xl">{failed ? "This generation did not finish" : "Writing the character and painting the portrait"}</h2>
        <p className="text-ink-2">“{draft.idea}”</p>
        {job && (
          <>
            {!failed && (
              <div className="bar bar-indeterminate" aria-hidden="true">
                <span />
              </div>
            )}
            <div className="kv">
              <span>Status</span>
              <span data-testid="job-status">{statusLabel(job)}</span>
            </div>
            <div className="kv">
              <span>Cost</span>
              <span className="mono">{formatCredits(job.cost)} · {job.status === "succeeded" ? "charged" : failed ? "restored" : "reserved"}</span>
            </div>
            {job.error && <p className={failed ? "notice notice-alert" : "notice"}>{job.error}</p>}
          </>
        )}
        {!failed && <p className="hint">Usually 30 to 90 seconds. You can leave this page: the draft and its generation continue, and reopening Create resumes here.</p>}
        {failed && (
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary" onClick={onRetry} disabled={busy !== null}>
              Try again · {COSTS.character} credits
            </button>
            <button type="button" className="btn btn-outline" onClick={onEdit}>
              Edit the description
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Review({
  character,
  onChange,
  busy,
  job,
  available,
  onRegenerate,
  onSave,
  onLaunch,
  onStartOver,
}: {
  character: Character;
  onChange: (p: Partial<Character>) => void;
  busy: string | null;
  job: JobView | null;
  available: number | null;
  onRegenerate: (what: "all" | "portrait") => void;
  onSave: () => void;
  onLaunch: () => void;
  onStartOver: () => void;
}) {
  const field = (k: "name" | "bio" | "personality" | "niche") => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ [k]: e.target.value });
  return (
    <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
      <div>
        <div className="portrait border border-ink">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
          <img src={character.portrait!} alt={`Portrait of ${character.name}`} />
          <span className="ai-tag absolute left-3 top-3">AI-generated</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline btn-sm" disabled={busy !== null || (available !== null && available < COSTS.portrait)} onClick={() => onRegenerate("portrait")}>
            New portrait · {COSTS.portrait} credits
          </button>
          <button type="button" className="btn btn-quiet btn-sm" disabled={busy !== null || (available !== null && available < COSTS.character)} onClick={() => onRegenerate("all")}>
            Regenerate everything · {COSTS.character}
          </button>
        </div>
        {job?.status === "failed" && <p className="notice notice-alert mt-3">{job.error} Your credits were restored.</p>}
      </div>
      <div className="space-y-5">
        <div>
          <p className="label">Review · draft, only you can see it</p>
          <p className="mt-1 text-sm text-ink-2">Edit anything. Text edits are free; only new generations cost credits.</p>
        </div>
        <div>
          <label className="field-label" htmlFor="r-name">
            Name
          </label>
          <input id="r-name" className="field display text-3xl" value={character.name} onChange={field("name")} maxLength={28} />
        </div>
        <div>
          <label className="field-label" htmlFor="r-bio">
            Biography
          </label>
          <textarea id="r-bio" className="field min-h-24" value={character.bio} onChange={field("bio")} maxLength={300} />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="r-personality">
              Personality
            </label>
            <textarea id="r-personality" className="field min-h-20" value={character.personality} onChange={field("personality")} maxLength={220} />
          </div>
          <div>
            <label className="field-label" htmlFor="r-niche">
              Content niche
            </label>
            <textarea id="r-niche" className="field min-h-20" value={character.niche} onChange={field("niche")} maxLength={100} />
          </div>
        </div>
        <p className="hint">Saving gives the character a public page labelled AI-generated. Its coin is optional and can be launched later.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={onSave} data-testid="save-character">
            {busy === "save" ? <span className="spinner" /> : "Save character"}
          </button>
          <button type="button" className="btn btn-violet" disabled={busy !== null} onClick={onLaunch}>
            {busy === "launch" ? <span className="spinner" /> : "Launch its coin"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onStartOver}>
            Start a new character
          </button>
        </div>
      </div>
    </div>
  );
}

function Saved({ character, onNew }: { character: Character; onNew: () => void }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="portrait border border-ink">
        {/* eslint-disable-next-line @next/next/no-img-element -- generated media */}
        <img src={character.portrait!} alt={`Portrait of ${character.name}`} />
        <span className="ai-tag absolute left-3 top-3">AI-generated</span>
      </div>
      <div className="space-y-4">
        <p className="notice notice-good">Saved. {character.name} now has a public creator page.</p>
        <p className="catno">No. {String(character.number ?? 0).padStart(3, "0")}</p>
        <h2 className="display text-5xl">{character.name}</h2>
        <p className="text-ink-2">{character.bio}</p>
        <div className="flex flex-wrap gap-3">
          <Link href={`/c/${character.slug}`} className="btn btn-primary">
            View the page
          </Link>
          <Link href={`/studio?character=${character.id}`} className="btn btn-outline">
            Create content in Studio
          </Link>
          <Link href={`/launch/${character.id}`} className="btn btn-violet">
            Launch its coin
          </Link>
          <button type="button" className="btn btn-quiet" onClick={onNew}>
            New character
          </button>
        </div>
      </div>
    </div>
  );
}
