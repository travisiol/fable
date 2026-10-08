# FABLE — build brief (2026-10-08)

The owner's spec is `SPEC.md` in this folder. It is the source of truth: follow every numbered section. Where the spec
and the owner's older habits (memory notes such as "no demo labels") disagree, **the spec wins** (it explicitly asks for
a clearly labelled demo mode and for disabled actions with the missing configuration shown).

Folder `C:\Users\wowo2\Documents\GitHub\fable`, port **3982** (dev + start). Tests / fake RPC: OS-assigned ports.

## Read first
1. `SPEC.md` (whole).
2. `GitHub/solkit/README.md` + `AGENTS.md` — the base: Next 16 + React 19 + Tailwind 4, wallet-standard connect
   dialog, sign-in by message, `@solana/web3.js` server reads, operator wallet, fake-RPC tests, CDP stub-wallet
   capture/play scripts. This Next.js differs from your training data: read `node_modules/next/dist/docs/` when unsure.
3. `GitHub/idol` (closest prior project: one sentence → JSON-schema character sheet + portrait with OpenAI, Sora clips
   via `client.videos`, pump.fun TradeEvent fee sweep + `collectCreatorFee`, launch, ledger) — borrow its modules, do not
   edit it. Also `GitHub/rain` (holder snapshots), `GitHub/volumepad` (sweep/tick/after()), `GitHub/curb` is being built
   by another agent right now: do not touch it.
4. Memory notes (known traps on this machine) in
   `C:\Users\wowo2\.claude\projects\C--Users-wowo2-Documents-GitHub-dustland\memory\`: `react-19-lint-rules.md`,
   `tailwind-layer-trap.md`, `headless-chrome-capture.md`, `bash-heredoc-limit.md`, `gitbash-taskkill-pathconv.md`,
   `vercel-serverless-first.md`, `next-usesearchparams-bailout.md`, `node-sqlite-in-next.md`, `shadcn-base-ui-generation.md`.

## Decisions already taken (apply; note any you must change and why)
- **Base**: copy `GitHub/solkit` into this folder (keep SPEC.md and BRIEF.md) without `node_modules`, `.next*`, `data`,
  `shots`, `.env.local`, `.git`; rename solkit → fable.
- **Persistence on Vercel**: Postgres through `DATABASE_URL` (Neon / Vercel Postgres) with **PGlite** as the local and
  test fallback, one schema, SQL migrations in the repo (Drizzle or plain SQL — your call). Media in **Vercel Blob**
  (`BLOB_READ_WRITE_TOKEN`) with a local-disk fallback. node:sqlite in /tmp is NOT acceptable here (spec: persistence).
- **Accounting**: integer units (credits as integers; SOL in lamports). Double-entry style ledger: allocation, reserve,
  spend, release/refund, each with an idempotency key and a unique constraint so a refund can never happen twice.
  Balance checks + reservation inside one DB transaction with row locks (`SELECT … FOR UPDATE`) so concurrent jobs
  cannot overspend. A job is paid by exactly one source: `holder_credits` or `character_budget` (enforced by schema).
- **Jobs**: a `jobs` table (queued → running → succeeded / failed / cancelled, attempts, provider id, idempotency key).
  Kick with `after()`, advance with a cron route (`/api/jobs/tick`, `CRON_SECRET`) and on client polling; OpenAI video
  is async by id, so it survives timeouts; `maxDuration` set. No background loops.
- **AI provider**: OpenAI, server-side only (`OPENAI_API_KEY`). Check current official docs (WebFetch platform.openai.com
  docs) for: structured output for the character sheet, image generation with a reference image for identity (images
  edit with the portrait as input), video generation (`sora-2` via the videos API, as IDOL does) and current prices.
  Estimated cost per generation is configurable in `src/config/fable.ts` and shown before every submission. Say in the
  UI that likeness is preserved "as closely as the model allows", never "perfectly".
- **Chain / launch**: pump.fun on Solana. Verify against an **official source** before coding (pump.fun's public docs /
  IDL repository `github.com/pump-fun/pump-public-docs`, and `GitHub/solkit/src/config/solana.ts`): the create
  instruction (`create` / `create_v2`) accounts + args, its name/symbol/uri limits, and whether pump.fun's **creator fee
  sharing** can split fees to several wallets. Expected design (confirm or replace with a stated reason): the user's
  wallet signs and pays; the mint keypair is generated in the browser; the `creator` argument = FABLE's fee vault, so
  creator fees accrue to the vault; the server claims them (`collectCreatorFee`, as IDOL), records each **confirmed**
  receipt idempotently by signature, and splits 30 % holder pool / 40 % character budget / 30 % creator payout
  (operator transfer, simulated then sent, on the ledger). If native fee sharing is verified and fits better, say so.
  If neither can be verified, the launch stays disabled with the reason shown and the report proposes the alternative —
  do not silently change the 30/40/30 model. Fee sharing is shown as "Proposed" until `FEE_SPLIT_VERIFIED`-style config
  is on AND the code path is implemented. Duplicate deployment prevented by a launch record keyed on character + mint
  pubkey created before signing; success only after `getSignatureStatuses` confirmation + `getTransaction` shows the
  mint and the metadata. Rejected signature / failed tx paths each have clear UI.
- **FABLE token**: `NEXT_PUBLIC_FABLE_MINT` unset by default — no invented address. Weekly allocation: daily holder
  snapshots of the FABLE mint (cron) → average over the previous 7 days → eligibility (min balance) → pro-rata credits
  capped per wallet; total allocated value ≤ funded pool − outstanding credits − operating reserve (all configurable,
  rules published on a page). Tests must prove allocation totals can never exceed capacity.
- **Market data**: DexScreener public API for graduated pairs; pump.fun bonding-curve account read from chain before
  graduation; loading / unavailable states.
- **Demo mode**: a clearly labelled demo (e.g. `/demo` routes or a cookie toggle with a fixed "Demo" ribbon) driven by
  fixtures that are never written to live tables. "Example characters" on the home/explore are labelled as such.
- **Config screen**: `/settings/config` (or similar) listing which integrations are configured, for the owner; main
  pages only say e.g. "Launching is unavailable: deployment is not configured" at the disabled action.

## Design (from the spec, plus these choices)
- Palette exactly: ivory #F4F1EA, almost black #19171C, deep violet #6547E8, pale lavender #E7DFF8 (+ derived neutrals
  only; one functional red for errors, one green for confirmed).
- Type: display **Young Serif** (expressive, for headlines and character names), body **Inter Tight**, data
  **JetBrains Mono** (balances, addresses, costs). `next/font/google`.
- Casting-catalogue feel: numbered character cards ("No. 001"), portrait-first, thin 1 px rules, generous spacing, a
  violet "AI creator" / "AI-generated" label on every character. No gradients, no neon, no decorative charts.
- Logo: hand-drawn SVG, a square F monogram that reads as an open page (no circle, no border). Favicon from it.
- Example characters (the four from the spec) with real generated portraits: generate them ONCE with the ChatGPT bridge
  from `GitHub/factory` (`node src/gpt.mjs image "<prompt>" --out ../fable/public/examples/<slug>.png`, run from
  `GitHub/factory`; the key stays in `factory/.env`). Same for the hero portrait and one banner (`--size 1536x512`,
  short centered headline + character imagery, never the logo) in `brand/`.

## Validation (spec §15) — required before you report
- Tests (fake RPC + fake OpenAI via `OPENAI_BASE_URL` to a local stub): ledger reserve/spend/refund, no double refund,
  concurrent reservations cannot overspend (run them in parallel), single-source payment, idempotent receipt ingestion,
  idempotent job retry, allocation ≤ capacity (property-style loop), launch duplicate prevention, launch rejected /
  failed / confirmed paths, weekly average-holding eligibility.
- `npx eslint .` 0/0, `npx next typegen && npx tsc --noEmit`, `npx next build`, `next start -p 3982` cold (no env).
- **One real character-generation workflow**: run the app with `OPENAI_API_KEY` read from `GitHub/factory/.env` and
  passed ONLY in that process's environment (never written into this project, a log, a screenshot or the report):
  describe → generate → review → save → refresh → still there; then one real Studio image job with the character
  reference. One real Sora clip only if the API accepts it (one short clip max); otherwise report why.
- **Launch**: prove signing → confirmation on **devnet** if pump.fun's program is deployed there (verify), with a
  throwaway keypair through the CDP stub wallet; otherwise prove it on a local validator/fake RPC and say so. Never
  mainnet, never a real coin.
- Screenshots 1536 and 390 (headless Chrome, `scripts/capture.mjs`) of home, create, studio, explore, a character page,
  dashboard, demo mode; open them yourself and fix overflow / clipping.
- Never deploy, commit, push, or move real funds. Do not touch other folders. Do not use the in-app browser pane.
  Bash heredocs over ~6 KB fail on this machine: use the Write tool. Stop every server you started and check port 3982
  is free before reporting.

## Final report (reply with this, short and factual)
- What is functional (by spec section).
- Fee-sharing verification result: what pump.fun supports today (with the source URL), the design used, limitations,
  proposed alternative if any.
- Required credentials and configuration (env var list).
- Integrations still incomplete.
- Validation performed, with numbers and screenshot paths; what was real (OpenAI calls, devnet) vs faked.
- Anything you are unsure of.
Also write the same as `DELIVERY.md` in the project.
