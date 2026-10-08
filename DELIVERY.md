# FABLE — delivery report (2026-10-08)

Project: `C:\Users\wowo2\Documents\GitHub\fable` (port 3982). Nothing committed, pushed, deployed; no coin launched,
no mainnet transaction, no real funds moved. Port 3982 is free.

## What is functional (by spec section)

- **§1–2, §5–6 Homepage and brand**: palette, Young Serif / Inter Tight / JetBrains Mono, square F "open page" monogram
  (`src/components/Logo.tsx`, `src/app/icon.svg`), hero with an AI-labelled example portrait, "What do I get for holding
  FABLE?", wallet panel (placeholders before sign-in, never invented balances), working "Who are you bringing to life?"
  field with the four labelled examples, both journeys, 30/40/30 breakdown marked **Proposed** until verified, explore
  preview (live characters, else labelled "Example characters"). Generated assets: `public/examples/*.png` (4 portraits),
  `brand/banner-1536x512.png` (centered headline + characters, no logo).
- **§7 Creation**: Describe → Generate → Review; idea, optional name, personality, style, niche; generates portrait,
  suggested name, bio, personality; edit, regenerate portrait or everything; cost shown before submission; drafts kept in
  the browser and on the server (survive refresh); Save character / Launch its coin; works without any token.
- **§8 Launch**: Identity → Token → Review wizard; ticker/description/links validated against pump.fun create_v2 limits;
  review shows network, metadata, fee allocation, deployment fees, optional initial purchase and the instruction list the
  wallet signs; user wallet signs and pays (mint keypair generated in the browser); launch row written before signing
  (duplicate launches refused); rejected / failed / expired / confirmed paths each with clear UI; success only after
  `getSignatureStatuses` confirmation + `getTransaction` shows the mint + the mint account carries name/ticker + curve
  creator matches. Then a second signature registers the 30/40/30 fee split, shown active only after reading the
  SharingConfig back. Without configuration the button is disabled with "Launching is unavailable: deployment is not
  configured."
- **§9 Explore**: filters All / With a token / New characters, search by name or ticker, AI label and token status on
  every card, examples kept in a separate labelled section, newest first (no popularity ranking).
- **§10 Character page**: portrait, bio, personality, niche, AI label, gallery (images + clips), token info, copyable
  CA, verified trade link, market data from the pump.fun curve (chain) or DexScreener with loading / unavailable states,
  content budget, recent funding and generation activity, "does not own the character" wording.
- **§11 Studio**: character reference, Image/Video, presets Portrait / New outfit / Scene / Talking clip, prompt, output
  format, estimated cost, credits or character budget (one payer, stated), progress, result, download, history with
  cancel (queued) and retry; likeness "as closely as the model allows"; nothing is auto-posted.
- **§12 Dashboard**: holdings, eligibility, credits, allocation history, spending, ledger; owned characters, deployment
  status, confirmed creator fees, budgets, jobs, funding; empty states; private data needs the signed sign-in.
- **§13 Implementation**: Postgres (`DATABASE_URL`) / PGlite fallback with SQL migrations; signed-message auth;
  server-side providers; async jobs with leases (after() + polling + cron, Veo operation ids stored); double-entry-style
  credit ledger with reservations and single refunds; idempotent receipts and job submits; Vercel Blob / disk media.
- **§3–4 Economics**: weekly allocation from daily snapshots (7-day average, missing day = 0), min balance, pro-rata,
  per-wallet cap, total ≤ pool − operating reserve; published on `/how-it-works#rules`; next allocation date shown;
  real pool status shown (currently zero). Receipt ingestion from on-chain distributions (balance deltas, per
  signature) + permissionless crank by an optional operator key; owner deposit + grant tools on `/settings/config`.
- **§14 Demo**: `/demo` and `/demo/c/<slug>` from fixtures under a fixed "Demo mode" ribbon; never written to tables.
  `/settings/config` lists every integration as Set / Missing.

## Fee-sharing verification

- **What pump.fun supports today** (official: https://github.com/pump-fun/pump-public-docs —
  `docs/instructions/CREATOR_FEE_SHARING.md`, `COIN_CREATION.md`, `SWEEP_FEES.md`, `idl/pump.json`, `idl/pump_fees.json`):
  native creator fee sharing — `create_fee_sharing_config` (by the coin's creator), then `update_fee_shares_v2` with up
  to 10 shareholders whose bps sum to 10 000, settable once (admin revoked); `distribute_creator_fees_v2` pays each
  shareholder (permissionless); fees from v3 trades wait on the curve until `sweep_creator_fee`.
- **Design used**: the 30/40/30 model maps 1:1 onto native sharing (holder-pool wallet 3000, character-budget wallet
  4000, creator 3000). No custody of the creator's share, no operator payout. FABLE records each confirmed distribution
  (per signature) and credits the holder pool and that character's budget in separate accounts.
- **Proof against the real programs** (devnet, `docs/devnet-proof-2026-10-08.txt`): `simulateTransaction` OK for
  create_v2 (870 B, 103 k CU), create_v2 + ATA + initial buy (1214 B, 188 k CU), and sweep + create_fee_sharing_config +
  update_fee_shares_v2 [30/40/30] (1045 B, 187 k CU). The devnet faucet refused the airdrop ("Internal error"), so no
  devnet transaction was **sent**; simulation used an existing devnet creator as payer with signature verification off.
- **Limitations**: two signatures (create, then split) — fees from trades between them go to the creator alone, and a
  creator can decline the second signature (the coin then shows "split not set" and no budget). The split is permanent.
  PumpSwap-side (graduated) fee sweeping is not implemented. The 30 % creator share is paid by pump.fun, so FABLE only
  records it from receipts.

## Required credentials and configuration

`OPENAI_API_KEY` (characters + images), `GEMINI_API_KEY` (clips), `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`,
`SESSION_SECRET`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `SOLANA_RPC_URL` (keyed; snapshots need getProgramAccounts),
`NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_FABLE_MINT` (unset: no invented address), `FABLE_LAUNCH_ENABLED=1`,
`FABLE_POOL_WALLET`, `FABLE_BUDGET_WALLET`, `FABLE_FEE_SHARING_VERIFIED`, optional `OPERATOR_SECRET_KEY`,
`FABLE_ADMIN_WALLETS`, economics overrides (`FABLE_CREDIT_LAMPORTS`, `FABLE_MIN_AVERAGE_TOKENS`,
`FABLE_MAX_CREDITS_PER_WALLET`, `FABLE_WEEKLY_SHARE_BPS`, `FABLE_OPERATING_RESERVE_BPS`). All documented in `.env.example`.

## Integrations still incomplete

- No real devnet launch sent (faucet refused); the full UI launch was proven on the fake RPC, the instructions by devnet
  simulation. Recipe: put a throwaway devnet key with ~0.1 SOL in `DEVNET_SECRET` and run
  `node scripts/devnet-proof.ts --send`.
- Video: OpenAI's Sora API is shut down (2026-09-24); the Veo adapter follows Google's REST docs but was only tested
  against a local stub (no Gemini key available). Veo price not published on the guide; 160 credits is an estimate.
- Graduated-coin (PumpSwap) fee sweep; Postgres was not run locally (PGlite used; same SQL, `FOR UPDATE` path for pg is
  written but untested against a real server).
- Holder snapshots never ran for real (no FABLE mint); pump.fun's own IPFS metadata upload is not used (self-hosted
  JSON instead).

## Validation performed

- `npm test`: **30/30** (ledger reserve/spend/refund, no double refund, 6 parallel submits cannot overspend, same-key
  concurrent submits → one job, single-source payment (schema refuses others), idempotent receipts (3 parallel
  ingestions → 1), idempotent retry without second reservation, video survives ticks, 300-round property loop + 6-week DB
  run with allocation ≤ funded − reserve and `audit()` clean, 7-day-average eligibility, launch duplicate / rejected /
  failed / expired / confirmed / split-verification, OpenAI + Veo adapters against a stub, auth nonce replay).
- `npx eslint .` 0 errors 0 warnings; `npx next typegen && npx tsc --noEmit` clean; `npx next build` OK;
  `next start -p 3982` cold with no env and an empty `data/`: every page 200, `/c/unknown` 404, health "pglite durable".
- `npm run play` (fake RPC + fake AI + stub wallet, CDP): **28/28** — sign-in, generate (6 credits charged once),
  refresh persistence, save, public page, studio image (7 credits), refused job → credits restored, duplicate submit →
  one job, video job, launch rejected → failed → confirmed, second launch 409, fee split verified, no overflow at 390 px.
- `npm run play:real` with the **real OpenAI API** (key passed only in the server process env): **14/14** —
  "Kibo Clank" generated in 42 s (gpt-5.5 sheet + gpt-image-2 portrait), survived refresh, saved, public page, one real
  Studio scene with the portrait as reference (identity kept); credits 400 → 394 → 387. No real video (no provider key).
- Screenshots (headless Chrome): `shots/{home,create,studio,explore,character,dashboard,how,demo,demo-character,config}-{1536,1536-full,390}.png`
  and the flow shots `shots/play-real-*.png`, `shots/play-fake-*.png` (incl. `-390` signed-in pages). Opened and checked;
  no horizontal overflow at 390 px.
- Real vs faked: OpenAI calls real (play:real + the 5 brand images); pump.fun programs real via devnet simulation;
  launch signing/confirmation in the UI on a fake RPC that verifies ed25519 signatures; Veo, fee receipts and snapshots
  only against stubs. Test credits in the play runs come from a recorded test deposit + grant in a throwaway database.

## Unsure

- Anchor "None" encoding for `create_fee_sharing_config`'s optional pool accounts (program id placeholder) passed
  devnet simulation, but an on-chain send was never possible.
- Whether pump.fun's UI lists coins whose metadata URI is a self-hosted JSON rather than IPFS (it is valid Metaplex JSON).
- Cost estimates (credits) are based on published per-token prices, not measured invoices.
