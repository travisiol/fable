/**
 * Solana configuration: cluster, RPC endpoints, explorer links and program ids.
 * Imported by the server lib, the client and the node tests (relative imports only, no aliases).
 *
 * Public env vars are read with static `process.env.NEXT_PUBLIC_*` access so Next inlines them in
 * the browser bundle. Server-only overrides (`SOLANA_CLUSTER`, `SOLANA_RPC_URL`) are read at call
 * time so a node script or a test can point the same code at another endpoint.
 */

export type Cluster = "mainnet-beta" | "devnet";

function asCluster(value: string | undefined): Cluster {
  return value === "devnet" ? "devnet" : "mainnet-beta";
}

/** Cluster baked into the browser bundle (`NEXT_PUBLIC_SOLANA_CLUSTER`, `mainnet-beta` by default). */
export const CLUSTER: Cluster = asCluster(process.env.NEXT_PUBLIC_SOLANA_CLUSTER);

/** Cluster seen by server code: `SOLANA_CLUSTER` (scripts, tests) then `NEXT_PUBLIC_SOLANA_CLUSTER`. */
export function serverCluster(): Cluster {
  return asCluster(process.env["SOLANA_CLUSTER"] || process.env["NEXT_PUBLIC_SOLANA_CLUSTER"]);
}

/** Public endpoints, one per cluster. Rate-limited: set SOLANA_RPC_URL to a keyed provider in production. */
export const PUBLIC_RPC: Record<Cluster, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
};

/** Server RPC: `SOLANA_RPC_URL`, else the public endpoint of the server cluster. Never shipped to the browser. */
export function rpcUrl(): string {
  return process.env["SOLANA_RPC_URL"]?.trim() || PUBLIC_RPC[serverCluster()];
}

/** Browser RPC: the same-origin relay, so a keyed URL never reaches the client. */
export const CLIENT_RPC_PATH = "/api/rpc";

/** Wallet-standard chain id for a cluster. */
export function chainId(cluster: Cluster = CLUSTER): "solana:mainnet" | "solana:devnet" {
  return cluster === "devnet" ? "solana:devnet" : "solana:mainnet";
}

/** Solscan link. `?cluster=devnet` is added on devnet only. */
export function explorerUrl(kind: "tx" | "account" | "token", id: string, cluster: Cluster = CLUSTER): string {
  return `https://solscan.io/${kind}/${id}${cluster === "devnet" ? "?cluster=devnet" : ""}`;
}

// ───────────────────────────── program ids
// Verified against the owner's pump.fun engine (donchain.snipe `src/solana/pump/pdas.js` and
// `pump/fees.js`, which send real transactions to these programs on mainnet) and against the
// factory scout (`factory/src/pump.mjs`). Token / Token-2022 / ATA / System / WSOL are the
// canonical SPL ids published at https://spl.solana.com.

/** pump.fun bonding-curve program (pdas.js PUMP_PROGRAM). */
export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
/** PumpSwap AMM, where coins go after the curve completes (pdas.js PUMP_AMM_PROGRAM). */
export const PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
/** pump.fun fee program (pdas.js PUMP_FEE_PROGRAM). */
export const PUMP_FEE_PROGRAM = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
/** SPL Token (pdas.js TOKEN_PROGRAM). */
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/** SPL Token-2022 (pdas.js TOKEN_2022_PROGRAM). New pump.fun coins use it. */
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
/** Associated Token Account program (pdas.js ATA_PROGRAM). */
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/** System program (pdas.js SYSTEM_PROGRAM). */
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
/** Wrapped SOL mint (fees.js WSOL_MINT). */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** Seeds (pdas.js SEEDS / fees.js). The curve vault uses a dash, the PumpSwap vault an underscore. */
export const SEEDS = { creatorVault: "creator-vault", ammCreatorVault: "creator_vault", bondingCurve: "bonding-curve" } as const;

/** Rent-exempt minimum the curve creator vault keeps (fees.js VAULT_RENT_LAMPORTS). */
export const VAULT_RENT_LAMPORTS = BigInt(890880);

export const LAMPORTS_PER_SOL = 1_000_000_000;

