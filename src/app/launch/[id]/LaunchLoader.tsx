"use client";

import dynamic from "next/dynamic";

export const LaunchLoader = dynamic(() => import("./LaunchWizard"), {
  ssr: false,
  loading: () => <div className="sheet h-64 animate-pulse" />,
});
