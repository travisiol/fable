# FABLE — Hold FABLE. Create with AI.

An AI creator studio and character launchpad on Solana. Next 16 + React 19 + Tailwind 4, Postgres (PGlite locally),
OpenAI (character sheet + images), Google Veo (talking clips), pump.fun (character coins, native creator fee sharing).
Port 3982. Spec: `SPEC.md`. Build brief: `BRIEF.md`. Delivery report: `DELIVERY.md`.

## Pages

| Route | What |
|---|---|
| `/` | Hero, "What do I get for holding FABLE?", wallet panel (placeholders until signed in), idea field, two journeys, 30/40/30 breakdown (Proposed vs Active), live characters or labelled examples |
| `/create` | Describe → Generate → Review; drafts kept in the browser and on the server (`?draft=`), edit, regenerate, Save / Launch its coin |
| `/c/<slug>` | Public creator page: portrait, bio, personality, niche, AI label, gallery, token (copyable CA, verified link, market data with loading/unavailable), content budget, funding and generation activity |
| `/studio` | Saved character → Image / Video, presets Portrait / New outfit / Scene / Talking clip, prompt, format, which balance pays, cost, progress, result, download, history with cancel / retry |
| `/launch/<characterId>` | Identity → Token → Review → wallet signature → confirmation → fee-split signature |
| `/explore` | Catalogue: All / With a token / New characters, search by name or $TICKER, examples in a separate labelled section |
| `/dashboard` | Wallet (holdings, eligibility, credits, allocation history, spending, ledger) and creator overview (characters, deployment, confirmed fees, budgets, jobs, receipts) |
| `/how-it-works` | Journeys, fee split, published allocation rules and formula, cost table, live pool status |
| `/demo`, `/demo/c/<slug>` | Demo mode: fixtures only, fixed violet "Demo mode" ribbon |
| `/settings/config` | Integration status for the owner + owner tools (record a pool deposit, grant credits) |

## Decisions (taken unattended — the owner could not be asked)

1. **Fee split = pump.fun native fee sharing**, not an operator payout. Verified 2026-10-08 in pump.fun's official
   docs (`github.com/pump-fun/pump-public-docs`, `docs/instructions/CREATOR_FEE_SHARING.md`): a coin's creator can
   register up to 10 shareholders with bps summing to 10 000, once (admin revoked after). FABLE's 30/40/30 maps exactly:
   `FABLE_POOL_WALLET` 3000, `FABLE_BUDGET_WALLET` 4000, creator 3000. pump.fun pays each share on chain at every
   `distribute_creator_fees_v2`; FABLE never custodies the creator's 30 %. The coin is created with the user as creator
   (create_v2), then a second user signature sends `sweep_creator_fee + create_fee_sharing_config +
   update_fee_shares_v2`. Shown "Active" for a coin only when the SharingConfig read back from chain matches and is locked;
   the homepage says "Proposed" until the owner sets `FABLE_FEE_SHARING_VERIFIED=1`.
2. **Credits are lamport-denominated**: 1 credit = `FABLE_CREDIT_LAMPORTS` (50 000 = 0.00005 SOL ≈ $0.01 at $200/SOL)
   of pool funds. Integer accounting end to end; no USD conversion needed at ingestion.
3. **Character creation costs credits** (6). Bootstrap before any fee arrives: the owner records a SOL deposit into the
   pool wallet and/or grants credits from `/settings/config`, both inside the same capacity rule as allocations.
4. **Video = Google Veo (Gemini API)**: OpenAI shut its Videos API (Sora 2) down on 2026-09-24 with no replacement.
5. **Operating reserve** = 15 % of all pool funding is never allocated; weekly budget = 50 % of the allocatable pool;
   cap 300 credits per wallet per week; minimum 100 000 FABLE 7-day average. All env-configurable.
6. **Media**: Vercel Blob when configured, else local disk. **Token metadata** is served by the app
   (`/api/launch/<id>/metadata`), so the deployment must stay online at `NEXT_PUBLIC_SITE_URL`.
7. **Initial purchase** uses pump.fun's legacy `buy` in the create transaction (fees paid in-trade, docs keep it working);
   fee recipients and reserves are read from the Global account of the active cluster.
8. **Graduated coins**: PumpSwap-side creator fees need a PumpSwap sweep + `transfer_creator_fees_to_pump_v2` before
   distribution; that crank is not implemented (curve-side fees are).

## Accounting invariants (enforced by the schema, `src/server/schema.ts`)

Balances never negative and never over-reserved (CHECKs); a job has exactly one payer (CHECK) and one reservation
(partial UNIQUE); spend and release share the idempotency key `settle:<job>` + a partial UNIQUE on job_id, so a refund can
happen once and never after a spend; every ledger row has a UNIQUE idempotency key; receipts are keyed on
signature + mint; one active launch per character (partial UNIQUE), a mint used once (UNIQUE). Reservations lock the
account row (`SELECT … FOR UPDATE`) inside one transaction. `audit()` recomputes every balance from the ledger.

## Jobs (serverless-safe)

`jobs` rows: queued → running (lease 6 min) → succeeded / failed / cancelled. Kicked with `after()` on submit, advanced
by client polling (`GET /api/jobs/<id>`), the cron `/api/jobs/tick` and the daily cron. A vanished worker's lease expires
and the job is retried (max 2 attempts, no second reservation). Veo operations are stored by id and polled, so clips survive
refreshes and function timeouts. Cancel only while queued.

## Env

See `.env.example` (every variable is documented there).

## Commands

```
npm run dev                      # next dev -p 3982
npm test                         # 30 node tests: PGlite in memory, fake chain port, local AI stub
npx eslint . ; npx next typegen && npx tsc --noEmit ; npx next build
npm run play                     # after a build: CDP flow, stub wallet + fake RPC + fake AI (28 checks)
npm run play:real                # same, REAL OpenAI (key read from ../factory/.env into the server env only)
npm run devnet-proof             # simulates FABLE's three pump.fun transactions against the real devnet programs
node scripts/capture.mjs http://localhost:3982   # 1536 / 1536-full / 390 screenshots into shots/
```

## Vercel

`vercel.json` declares the daily crons (Hobby: daily only). Set `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`,
`SESSION_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL` at minimum; without the first two, data lives in `/tmp` per
instance (the config page and `/api/health` say "ephemeral").
