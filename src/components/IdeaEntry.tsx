"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IDEA_EXAMPLES } from "@/config/examples";
import { readLocalDraft, writeLocalDraft } from "@/lib/client";

/** "Who are you bringing to life?" — a working field that carries the idea into the creation flow. */
export function IdeaEntry({ cost }: { cost: number }) {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const go = (text: string) => {
    const t = text.trim();
    if (t.length < 8) return;
    const prev = readLocalDraft();
    writeLocalDraft({ idea: t, name: "", personality: "", style: prev?.style ?? "", niche: "", characterId: null });
    router.push("/create");
  };
  return (
    <form
      className="sheet p-5 sm:p-7"
      onSubmit={(e) => {
        e.preventDefault();
        go(idea);
      }}
    >
      <label htmlFor="idea" className="display block text-3xl sm:text-4xl">
        Who are you bringing to life?
      </label>
      <textarea
        id="idea"
        className="field mt-4 min-h-28 text-lg"
        placeholder="A washed-up robot comedian broadcasting from a tiny apartment in Tokyo."
        value={idea}
        maxLength={400}
        onChange={(e) => setIdea(e.target.value)}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="label mr-1">Examples</span>
        {IDEA_EXAMPLES.map((x) => (
          <button key={x.label} type="button" className="chip hover:border-ink" onClick={() => setIdea(x.idea)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="hint">Next: add a name, personality and style, then generate. Estimated cost {cost} credits, shown again before anything is charged.</p>
        <button type="submit" className="btn btn-primary" disabled={idea.trim().length < 8}>
          Start creating
        </button>
      </div>
    </form>
  );
}
