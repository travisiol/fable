"use client";

import { useState } from "react";

export function CopyText({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="mono min-w-0 truncate text-sm" title={text}>
        {label ?? text}
      </span>
      <button
        type="button"
        className="btn btn-quiet btn-sm shrink-0"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            setDone(false);
          }
        }}
      >
        {done ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
