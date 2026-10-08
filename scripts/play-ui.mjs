/**
 * Plays FABLE end to end in headless Chrome over CDP (zero deps), with the "Fable Test" stub wallet
 * (scripts/dev-wallet.js: a fresh throwaway keypair that really signs) and the fake Solana RPC
 * (tests/fake-rpc.ts: it executes create_v2 / update_fee_shares_v2 and verifies signatures).
 *
 *   npx next build && node scripts/play-ui.mjs            fake AI (tests/fake-ai.ts): every path, incl. failures + video
 *   node scripts/play-ui.mjs --real                        REAL OpenAI: OPENAI_API_KEY is read from
 *        ../factory/.env and passed ONLY to the server process env — never printed, never written here.
 *
 * Test data lives in data/play-<mode> (wiped each run). Credits for the test wallet come from a
 * recorded test deposit into the holder pool + an owner grant, written to that throwaway database
 * before the server starts (exactly what /settings/config does for the owner). Never a real wallet,
 * never mainnet, nothing deployed.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { startFakeRpc, SYSTEM } from "../tests/fake-rpc.ts";
import { startFakeAi } from "../tests/fake-ai.ts";

const REAL = process.argv.includes("--real");
const PORT = 3982;
const base = `http://localhost:${PORT}`;
const root = resolve(import.meta.dirname, "..");
const shots = join(root, "shots");
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const tag = REAL ? "real" : "fake";

// ── throwaway wallet + fee wallets
const secret = nacl.sign.keyPair().secretKey;
const testAddress = bs58.encode(secret.slice(32));
const POOL = Keypair.generate().publicKey.toBase58();
const BUDGET = Keypair.generate().publicKey.toBase58();
console.log("test wallet:", testAddress, REAL ? "(REAL OpenAI)" : "(fake AI)");

// ── throwaway database, seeded with test credits for the test wallet
const dataDir = join(root, "data", `play-${tag}`);
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
{
  process.env.FABLE_CREDIT_LAMPORTS = "50000";
  const { openPglite } = await import("../src/server/db.ts");
  const { ingestReceipt, grantCredits } = await import("../src/server/pool.ts");
  const d = await openPglite(join(dataDir, "pglite"));
  await ingestReceipt(d, { signature: `play-test-deposit-${Date.now()}`, mint: "SOL", characterId: null, source: "deposit", totalLamports: 50_000_000n, poolLamports: 50_000_000n, budgetLamports: 0n, creatorLamports: 0n });
  await grantCredits(d, testAddress, 400, `play-grant-${Date.now()}`);
  await d.close();
  console.log("seeded: test deposit of 0.05 SOL into the throwaway pool (1000 credits) + grant of 400 credits to the test wallet");
}

// ── fake chain (+ fake AI unless --real)
const fake = await startFakeRpc();
fake.state.accounts.set(testAddress, { lamports: 2_500_000_000, owner: SYSTEM });
{
  // pump.fun Global (devnet values read on 2026-10-08: 1 SOL virtual reserve, fee 95 bps, creator 5 bps)
  const { globalPda } = await import("../src/server/pump.ts");
  const g = Buffer.alloc(1100);
  for (let i = 0; i < 8; i++) Keypair.generate().publicKey.toBuffer().copy(g, i === 0 ? 41 : 162 + 32 * (i - 1));
  for (let i = 0; i < 8; i++) Keypair.generate().publicKey.toBuffer().copy(g, 741 + 32 * i);
  g.writeBigUInt64LE(1_073_000_000_000_000n, 73);
  g.writeBigUInt64LE(1_000_000_000n, 81);
  g.writeBigUInt64LE(793_100_000_000_000n, 89);
  g.writeBigUInt64LE(95n, 105);
  g.writeBigUInt64LE(5n, 154);
  fake.state.accounts.set(globalPda().toBase58(), { lamports: 1, owner: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", data: g });
}
const ai = REAL ? null : await startFakeAi();
let openaiKey = null;
if (REAL) {
  const env = readFileSync(resolve(root, "..", "factory", ".env"), "utf8");
  openaiKey = env.match(/^OPENAI_API_KEY=(.+)$/m)?.[1]?.trim() ?? null;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not found in factory/.env");
}

// ── server (built app)
const serverEnv = {
  ...process.env,
  FABLE_PGLITE_DIR: join(dataDir, "pglite"),
  FABLE_MEDIA_DIR: join(dataDir, "media"),
  SOLANA_RPC_URL: fake.url,
  SOLANA_CLUSTER: "devnet",
  FABLE_LAUNCH_ENABLED: "1",
  FABLE_POOL_WALLET: POOL,
  FABLE_BUDGET_WALLET: BUDGET,
  NEXT_PUBLIC_SITE_URL: base,
  OPERATOR_SECRET_KEY: "",
  DATABASE_URL: "",
  BLOB_READ_WRITE_TOKEN: "",
  ...(REAL ? { OPENAI_API_KEY: openaiKey, OPENAI_BASE_URL: "", GEMINI_API_KEY: "" } : { OPENAI_API_KEY: "fake-key", OPENAI_BASE_URL: ai.url, GEMINI_API_KEY: "fake-key", GEMINI_BASE_URL: ai.url }),
};
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], { cwd: root, env: serverEnv, stdio: ["ignore", "pipe", "pipe"] });
server.stderr.on("data", (d) => process.stderr.write(`[next] ${String(d).replaceAll(openaiKey ?? "\u0000", "***")}`));
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${base}/api/health`)).ok) break;
  } catch {}
  await sleep(500);
}

// ── chrome
const chromePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => p && existsSync(p));
const profile = join(tmpdir(), `fable-play-${Date.now()}`);
const chrome = spawn(chromePath, ["--headless=new", "--no-first-run", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--window-size=1536,960", "about:blank"], { stdio: "ignore" });
let cdpPort = null;
for (let i = 0; i < 100 && !cdpPort; i++) {
  try {
    cdpPort = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]) || null;
  } catch {}
  if (!cdpPort) await sleep(150);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message));
        else res(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
}

async function main() {
  const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1536, height: 960, deviceScaleFactor: 1, mobile: false });
  const naclSrc = readFileSync(join(root, "node_modules", "tweetnacl", "nacl-fast.min.js"), "utf8");
  const stub = readFileSync(join(root, "scripts", "dev-wallet.js"), "utf8");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `${naclSrc}\n;window.FABLE_TEST_SECRET=${JSON.stringify(Array.from(secret))};window.FABLE_TEST_RPC=${JSON.stringify(fake.url)};\n${stub}` });
  const js = async (expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  const clickText = (text, scope = "") =>
    js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(`${scope} button, ${scope} a`)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)}) && !x.disabled); if (b) b.click(); return Boolean(b); })()`);
  const waitFor = async (expression, ms = 20000) => {
    for (let t = 0; t < ms; t += 400) {
      const v = await js(expression).catch(() => null);
      if (v) return v;
      await sleep(400);
    }
    return null;
  };
  const setVal = (sel, v) =>
    js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const p = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, "value").set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  const shot = async (name, full = false) => {
    const params = { format: "png" };
    if (full) {
      const { cssContentSize } = await cdp.send("Page.getLayoutMetrics");
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width: 1536, height: Math.min(6000, Math.ceil(cssContentSize.height)), scale: 1 };
    }
    const { data } = await cdp.send("Page.captureScreenshot", params);
    writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
    console.log(`     shots/${name}.png`);
  };
  const go = async (path) => {
    await cdp.send("Page.navigate", { url: `${base}${path}` });
    await waitFor(`document.readyState === "complete"`);
    await sleep(1200);
  };
  const credits = async () => (await js(`fetch("/api/me").then((r) => r.json())`))?.wallet?.credits;

  // ── connect + sign in
  await go("/");
  check("connect", await clickText("Connect wallet"));
  await waitFor(`[...document.querySelectorAll(".wallet-option")].some((b) => b.textContent.includes("Fable Test"))`);
  await clickText("Fable Test");
  await waitFor(`[...document.querySelectorAll("dialog[open] button")].some((b) => b.textContent.trim() === "Sign in")`);
  await js(`[...document.querySelectorAll("dialog[open] button")].find((x) => x.textContent.trim() === "Sign in").click()`);
  check("signed in by signed message", await waitFor(`document.querySelector("[data-testid=signed-in]")?.innerText`));
  await js(`document.querySelector("dialog[open]")?.close()`);
  const c0 = await credits();
  check("wallet starts with the seeded test credits", c0?.available === 400, JSON.stringify(c0));
  await go("/");
  await waitFor(`document.querySelector("[data-testid=wallet-panel]")?.innerText.includes("400")`);
  await shot(`play-${tag}-home-signed-in`);

  // ── create: describe → generate → review
  await go("/create");
  await waitFor(`Boolean(document.querySelector("#c-idea"))`);
  await setVal("#c-idea", "A washed-up robot comedian broadcasting from a tiny apartment in Tokyo.");
  await setVal("#c-niche", "Late-night stand-up");
  await setVal("#c-personality", "Deadpan, warm underneath, allergic to applause");
  await sleep(300);
  await shot(`play-${tag}-create-describe`);
  check("generate clicked", await clickText("Generate · "));
  const t0 = Date.now();
  await waitFor(`Boolean(document.querySelector("[data-testid=job-status]"))`, 15000);
  await shot(`play-${tag}-create-generating`);
  const review = await waitFor(`Boolean(document.querySelector("[data-testid=save-character]")) && document.querySelector("#r-name").value`, REAL ? 300000 : 60000);
  check("character generated (sheet + portrait)", review, review ? `name "${review}" in ${Math.round((Date.now() - t0) / 1000)} s` : await js(`document.querySelector("[role=alert], .notice-alert")?.innerText`));
  if (!review) return;
  const c1 = await credits();
  check("6 credits charged once for the character", c1?.available === 394 && c1?.reserved === 0, JSON.stringify(c1));
  await shot(`play-${tag}-create-review`);
  const bio = await js(`document.querySelector("#r-bio").value`);
  check("bio and personality written", bio?.length > 20 && (await js(`document.querySelector("#r-personality").value.length`)) > 5, bio?.slice(0, 80));

  // ── persistence after refresh
  await cdp.send("Page.reload", {});
  const afterReload = await waitFor(`document.querySelector("#r-name")?.value`, 20000);
  check("draft survives a page refresh", afterReload === review, `${afterReload}`);

  // ── save → public page
  await clickText("Save character");
  const saved = await waitFor(`document.querySelector(".notice-good")?.innerText.includes("Saved")`);
  check("character saved", saved);
  const pageHref = await js(`[...document.querySelectorAll("a")].find((a) => a.textContent.trim() === "View the page")?.getAttribute("href")`);
  const characterId = await js(`new URL(location.href).searchParams.get("draft")`);
  await go(pageHref);
  check("public creator page renders the character with the AI label", await waitFor(`document.querySelector("h1")?.innerText === ${JSON.stringify(review)} && document.body.innerText.toLowerCase().includes("ai-generated character")`), pageHref);
  await shot(`play-${tag}-character-page`, true);
  await cdp.send("Page.reload", {});
  check("character page still there after refresh", await waitFor(`document.querySelector("h1")?.innerText === ${JSON.stringify(review)}`));

  // ── studio: one image job with the character reference
  await go(`/studio?character=${characterId}`);
  await waitFor(`Boolean(document.querySelector("#s-prompt"))`);
  await setVal("#s-prompt", "On a tiny stage under a single spotlight, holding the microphone, a small audience of three");
  await sleep(300);
  await shot(`play-${tag}-studio-ready`);
  check("studio image submitted", await clickText("Generate · 7"));
  await sleep(2500);
  await shot(`play-${tag}-studio-running`);
  const img = await waitFor(`document.querySelector(".portrait img[alt^='On a tiny stage']")?.getAttribute("src")`, REAL ? 300000 : 60000);
  check("studio image generated with the portrait as reference", img, img ?? (await js(`document.body.innerText.match(/Failed[^\\n]*/)?.[0]`)));
  const c2 = await credits();
  check("7 credits charged once for the image (holder credits only)", c2?.available === 387 && c2?.reserved === 0, JSON.stringify(c2));
  await shot(`play-${tag}-studio-result`);

  if (REAL) return;

  // ── failure → refund (fake AI refuses the next image)
  await fetch(`${ai.url}/__control`, { method: "POST", body: JSON.stringify({ refuseImages: true }) });
  await setVal("#s-prompt", "In a rainy street at night");
  await sleep(300);
  await clickText("Generate · 7");
  const failedText = await waitFor(`document.body.innerText.includes("Credits restored") || document.body.innerText.includes("credits restored")`, 30000);
  const c3 = await credits();
  check("a refused generation fails and its credits are restored", failedText && c3?.available === 387 && c3?.reserved === 0, JSON.stringify(c3));
  await fetch(`${ai.url}/__control`, { method: "POST", body: JSON.stringify({ refuseImages: false }) });
  await shot(`play-${tag}-studio-failed`);

  // ── duplicate submit with the same key → one job
  const dup = await js(`(async () => { const body = JSON.stringify({ characterId: ${JSON.stringify(characterId)}, mode: "image", preset: "outfit", prompt: "a yellow raincoat", payer: "holder_credits", idempotencyKey: "dup-key-123456" }); const h = { "content-type": "application/json" }; const [a, b] = await Promise.all([fetch("/api/jobs", { method: "POST", headers: h, body }).then((r) => r.json()), fetch("/api/jobs", { method: "POST", headers: h, body }).then((r) => r.json())]); return [a.job?.id, b.job?.id, a.created, b.created]; })()`);
  check("two identical submits (same key) create one job", dup?.[0] && dup[0] === dup[1] && dup[2] !== dup[3], JSON.stringify(dup));
  await sleep(6000);

  // ── video (fake Veo): talking clip survives polling
  await go(`/studio?character=${characterId}`);
  await waitFor(`Boolean(document.querySelector("#s-prompt"))`);
  await clickText("Video");
  await setVal("#s-prompt", "Tells the audience about his first gig in Osaka");
  await sleep(300);
  await clickText("Generate · 160");
  const vid = await waitFor(`document.querySelector(".portrait video")?.getAttribute("src")`, 60000);
  check("talking clip job completes through the async video provider", vid, vid ?? "");

  // ── launch: rejected → failed → confirmed → fee split
  await go(`/launch/${characterId}`);
  await waitFor(`document.body.innerText.includes("Confirm identity")`);
  await clickText("Confirm identity");
  await waitFor(`Boolean(document.querySelector("#t-ticker"))`);
  await setVal("#t-ticker", "TINPAN");
  await setVal("#t-buy", "0.1");
  await sleep(300);
  await shot(`play-${tag}-launch-token`);
  await clickText("Review");
  await waitFor(`document.body.innerText.includes("Prepare the transaction")`);
  await clickText("Prepare the transaction");
  await waitFor(`Boolean(document.querySelector("[data-testid=sign-launch]"))`);
  await shot(`play-${tag}-launch-review`, true);
  await js(`window.__FABLE_REJECT_NEXT = true`);
  await clickText("Sign and launch");
  const rejected = await waitFor(`document.querySelector("[data-testid=launch-error]")?.innerText`);
  check("rejected signature: clear message, nothing sent", rejected && /declined/.test(rejected) && fake.state.sent.length === 0, rejected ?? "");
  await shot(`play-${tag}-launch-rejected`);

  await clickText("Prepare the transaction");
  await waitFor(`Boolean(document.querySelector("[data-testid=sign-launch]"))`);
  await fetch(`${fake.url}/__control`, { method: "POST", body: JSON.stringify({ failNext: true }) });
  await clickText("Sign and launch");
  const failedTx = await waitFor(`document.querySelector("[data-testid=launch-error]")?.innerText.includes("failed") && document.querySelector("[data-testid=launch-error]").innerText`, 30000);
  check("failed transaction: reported as failed, no success shown", failedTx && !(await js(`Boolean(document.querySelector("[data-testid=launch-confirmed]"))`)), failedTx ?? "");
  await shot(`play-${tag}-launch-failed`);

  await clickText("Prepare the transaction");
  await waitFor(`Boolean(document.querySelector("[data-testid=sign-launch]"))`);
  await clickText("Sign and launch");
  const confirmed = await waitFor(`document.querySelector("[data-testid=launch-confirmed]")?.innerText`, 40000);
  check("launch signed → sent → confirmed, mint verified on chain", confirmed, confirmed ?? (await js(`document.querySelector("[data-testid=launch-error]")?.innerText`)));
  const dupLaunch = await js(`fetch("/api/launch/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterId: ${JSON.stringify(characterId)}, mint: "${Keypair.generate().publicKey.toBase58()}", ticker: "AGAIN", description: "A second launch attempt for the same character." }) }).then(async (r) => [r.status, (await r.json()).error])`);
  check("a second launch for the same character is refused", dupLaunch?.[0] === 409, JSON.stringify(dupLaunch));
  await clickText("Sign the fee split");
  const split = await waitFor(`document.querySelector("[data-testid=split-active]")?.innerText`, 40000);
  check("fee split signed and verified on chain (30/40/30, locked)", split, split ?? (await js(`document.querySelector(".notice-alert")?.innerText`)));
  await shot(`play-${tag}-launch-confirmed`);
  check("fake chain saw 3 landed transactions (failed create, create, split) and signatures verified", fake.state.sent.length === 3, String(fake.state.sent.length));

  await go(pageHref);
  await waitFor(`document.body.innerText.includes("$TINPAN")`);
  await shot(`play-${tag}-character-page-launched`, true);
  await go("/dashboard");
  await waitFor(`document.body.innerText.includes("Creator fees received")`);
  await sleep(800);
  await shot(`play-${tag}-dashboard`, true);
  await go("/explore");
  await shot(`play-${tag}-explore`, true);

  // signed-in pages at phone width (true 390 px viewport through device emulation)
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (const [name, path] of [["studio", `/studio?character=${characterId}`], ["dashboard", "/dashboard"], ["character", pageHref], ["launch", `/launch/${characterId}`], ["create", "/create"]]) {
    await go(path);
    await sleep(1500);
    const over = await js("document.documentElement.scrollWidth > innerWidth");
    check(`no horizontal overflow at 390 px: ${name}`, !over);
    const { cssContentSize } = await cdp.send("Page.getLayoutMetrics");
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: Math.min(7000, Math.ceil(cssContentSize.height)), scale: 1 } });
    writeFileSync(join(shots, `play-${tag}-${name}-390.png`), Buffer.from(data, "base64"));
    console.log(`     shots/play-${tag}-${name}-390.png`);
  }
  ws.close();
}

let failed = true;
try {
  await main();
  failed = results.some((r) => !r.ok);
} catch (e) {
  console.error(e);
} finally {
  chrome.kill();
  server.kill();
  await fake.close();
  await ai?.close();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  console.log(failed ? `\nplay-ui (${tag}): FAILED` : `\nplay-ui (${tag}): green (${results.length} checks)`);
  process.exit(failed ? 1 : 0);
}
