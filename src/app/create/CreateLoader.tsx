"use client";

import dynamic from "next/dynamic";

/** The flow reads this browser's saved draft on first render, so it renders on the client only. */
export const CreateLoader = dynamic(() => import("./CreateFlow"), {
  ssr: false,
  loading: () => (
    <div className="sheet grid h-64 place-items-center">
      <span className="spinner text-violet" />
    </div>
  ),
});
