/**
 * Market data for a character coin, only from real sources:
 *  - before graduation: the pump.fun bonding curve account read from chain (price = virtual quote /
 *    virtual token reserves; 6-decimal token, 9-decimal SOL), USD through Coinbase's SOL spot price;
 *  - after graduation (curve complete): DexScreener's public API (token-pairs/v1/solana/<mint>).
 * Returns `null` fields when a source is unreachable; the page shows "unavailable", never a guess.
 */
import { PublicKey } from "@solana/web3.js";
import { cached, connection, solUsd } from "./chain.ts";
import { bondingCurvePda, parseBondingCurve } from "./pump.ts";

export interface Market {
  source: "pump.fun curve" | "DexScreener" | null;
  priceSol: number | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  graduated: boolean | null;
  curveProgress: number | null;
  tradeUrl: string;
  at: number;
}

const DEX = () => process.env["DEXSCREENER_API_URL"] || "https://api.dexscreener.com";
const TOTAL_SUPPLY_TOKENS = 1_000_000_000;

export async function marketFor(mint: string): Promise<Market> {
  return cached(`market:${mint}`, 30_000, async () => {
    const base: Market = { source: null, priceSol: null, priceUsd: null, marketCapUsd: null, graduated: null, curveProgress: null, tradeUrl: `https://pump.fun/coin/${mint}`, at: Date.now() };
    let complete = false;
    try {
      const acc = await connection().getAccountInfo(bondingCurvePda(new PublicKey(mint)), "confirmed");
      if (acc) {
        const c = parseBondingCurve(acc.data);
        complete = c.complete;
        if (!c.complete && c.virtualTokenReserves > BigInt(0)) {
          const priceSol = Number(c.virtualQuoteReserves) / 1e9 / (Number(c.virtualTokenReserves) / 1e6);
          const usd = await solUsd();
          const initialReal = BigInt(793_100_000_000_000);
          return {
            ...base,
            source: "pump.fun curve",
            priceSol,
            priceUsd: usd ? priceSol * usd : null,
            marketCapUsd: usd ? priceSol * usd * TOTAL_SUPPLY_TOKENS : null,
            graduated: false,
            curveProgress: Math.max(0, Math.min(1, 1 - Number(c.realTokenReserves) / Number(initialReal))),
          };
        }
      }
    } catch {
      // chain unreachable: try DexScreener
    }
    try {
      const r = await fetch(`${DEX()}/token-pairs/v1/solana/${mint}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        type Pair = { priceUsd?: string; priceNative?: string; marketCap?: number; fdv?: number; liquidity?: { usd?: number }; url?: string };
        const pairs = (await r.json()) as Pair[];
        if (Array.isArray(pairs) && pairs.length) {
          const best = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
          return {
            ...base,
            source: "DexScreener",
            priceSol: Number(best.priceNative) || null,
            priceUsd: Number(best.priceUsd) || null,
            marketCapUsd: Number(best.marketCap ?? best.fdv) || null,
            graduated: complete || true,
            curveProgress: 1,
            tradeUrl: best.url ?? base.tradeUrl,
          };
        }
      }
    } catch {
      // unavailable
    }
    return base;
  });
}
