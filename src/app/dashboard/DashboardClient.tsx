"use client";

import { useEffect, useState } from "react";
import { DashboardView } from "@/components/DashboardView";
import type { DashboardData } from "@/components/DashboardView";
import { useWallet } from "@/components/wallet/store";
import { api } from "@/lib/client";

export function DashboardClient() {
  const w = useWallet();
  const [data, setData] = useState<{ for: string; d: DashboardData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!w.session) return;
    let live = true;
    api<DashboardData>("/api/dashboard")
      .then((d) => live && setData({ for: d.wallet.address, d }))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [w.session]);
  if (error) return <p className="notice notice-alert">{error}</p>;
  if (!data || data.for !== w.session) return <div className="sheet h-72 animate-pulse" />;
  return <DashboardView d={data.d} />;
}
