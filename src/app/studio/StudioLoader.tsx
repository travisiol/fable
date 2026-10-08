"use client";

import dynamic from "next/dynamic";

export const StudioLoader = dynamic(() => import("./StudioPanel"), {
  ssr: false,
  loading: () => (
    <div className="sheet grid h-64 place-items-center">
      <span className="spinner text-violet" />
    </div>
  ),
});
