"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { formatUsd } from "@/lib/format";

interface Market {
  source: string | null;
  priceSol: number | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  graduated: boolean | null;
  curveProgress: number | null;
  at: number;
}

/** Market data from a real provider only, with loading and unavailable states. */
export function MarketPanel({ mint }: { mint: string }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "ok"; m: Market } | { status: "unavailable" }>({ status: "loading" });
  useEffect(() => {
    let live = true;
    api<{ market: Market }>(`/api/market/${mint}`)
      .then((j) => live && setState(j.market.source ? { status: "ok", m: j.market } : { status: "unavailable" }))
      .catch(() => live && setState({ status: "unavailable" }));
    return () => {
      live = false;
    };
  }, [mint]);
  if (state.status === "loading")
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="spinner" /> Loading market data…
      </div>
    );
  if (state.status === "unavailable") return <p className="text-sm text-muted">Market data is unavailable right now. No figure is shown rather than a guess.</p>;
  const m = state.m;
  return (
    <div>
      <div className="kv">
        <span>Price</span>
        <span className="mono">{m.priceUsd !== null ? formatUsd(m.priceUsd) : m.priceSol !== null ? `${m.priceSol.toExponential(3)} SOL` : "—"}</span>
      </div>
      <div className="kv">
        <span>Market cap</span>
        <span className="mono">{m.marketCapUsd !== null ? formatUsd(m.marketCapUsd) : "—"}</span>
      </div>
      {m.curveProgress !== null && !m.graduated && (
        <div className="kv">
          <span>Bonding curve</span>
          <span className="mono">{(m.curveProgress * 100).toFixed(1)}% sold</span>
        </div>
      )}
      <p className="hint mt-2">Source: {m.source}. Refreshed every 30 s.</p>
    </div>
  );
}
