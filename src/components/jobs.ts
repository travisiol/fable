"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

export interface JobView {
  id: string;
  characterId: string;
  kind: "character" | "portrait" | "image" | "video";
  preset: string | null;
  prompt: string;
  format: string;
  payer: "holder_credits" | "character_budget";
  cost: number;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempts: number;
  error: string | null;
  result: string | null;
  resultKind: "image" | "video" | null;
  createdAt: number;
  finishedAt: number | null;
}

export const isOpen = (j: JobView | null | undefined) => Boolean(j && (j.status === "queued" || j.status === "running"));

/**
 * Polls a job until it ends. The server advances the job on each poll when needed, so a refresh
 * or a closed tab never loses it: reopening the page resumes polling the same id.
 */
export function useJob(initial: JobView | null, onDone?: (j: JobView) => void) {
  const [job, setJob] = useState<JobView | null>(initial);
  const id = job?.id ?? null;
  const open = isOpen(job);
  useEffect(() => {
    if (!id || !open) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const { job: j } = await api<{ job: JobView }>(`/api/jobs/${id}`);
        if (!live) return;
        setJob(j);
        if (!isOpen(j)) {
          onDone?.(j);
          return;
        }
      } catch {
        // network blip: keep polling
      }
      if (live) timer = setTimeout(tick, 2500);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // onDone is read at completion time only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, open]);
  return [job, setJob] as const;
}

export function statusLabel(j: JobView): string {
  switch (j.status) {
    case "queued":
      return j.attempts > 0 ? "Retrying" : "Queued";
    case "running":
      return j.kind === "video" ? "Rendering at the provider" : "Generating";
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed — credits restored";
    case "cancelled":
      return "Cancelled — credits restored";
  }
}
