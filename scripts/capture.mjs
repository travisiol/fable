/**
 * Headless Chrome screenshots over CDP (no browser pane, zero deps).
 *
 *   node scripts/capture.mjs [base=http://localhost:3982]
 *
 * For each page: shots/<page>-1536.png (1536×960 fold), shots/<page>-1536-full.png (whole page),
 * shots/<page>-390.png (390 px wide, mobile emulation, whole page). Device emulation gives a true
 * 390 px viewport, which `--window-size` cannot (Chrome keeps windows ≥ ~500 px).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:3965";
const out = resolve("shots");
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(
  (p) => p && existsSync(p),
);
const DEFAULT_PAGES = [
  ["home", "/"],
  ["create", "/create"],
  ["studio", "/studio"],
  ["explore", "/explore"],
  ["how", "/how-it-works"],
  ["dashboard", "/dashboard"],
  ["demo", "/demo"],
  ["demo-character", "/demo/c/robot-comedian"],
  ["config", "/settings/config"],
];
// extra pages: CAPTURE_PAGES="name=/path,name2=/path2" (e.g. a live character page)
const PAGES = process.env.CAPTURE_PAGES ? process.env.CAPTURE_PAGES.split(",").map((p) => p.split("=")) : DEFAULT_PAGES;

const profile = join(tmpdir(), `fable-capture-${Date.now()}`);
const chrome = spawn(chromePath, ["--headless=new", "--no-first-run", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let port = null;
for (let i = 0; i < 100 && !port; i++) {
  try {
    port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]) || null;
  } catch {}
  if (!port) await sleep(150);
}

let id = 0;
const pending = new Map();
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });

async function shoot(name, url, width, height, mobile, full) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await send("Page.navigate", { url });
  for (let t = 0; t < 15000; t += 250) {
    const r = await send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
    if (r.result.value === "complete") break;
    await sleep(250);
  }
  await sleep(2500);
  const params = { format: "png" };
  if (full) {
    const { cssContentSize } = await send("Page.getLayoutMetrics");
    params.captureBeyondViewport = true;
    params.clip = { x: 0, y: 0, width, height: Math.ceil(cssContentSize.height), scale: 1 };
  }
  const { data } = await send("Page.captureScreenshot", params);
  const file = join(out, `${name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  const overflow = await send("Runtime.evaluate", { expression: "document.documentElement.scrollWidth > innerWidth", returnByValue: true });
  console.log(`${file}${overflow.result.value ? "  (horizontal overflow!)" : ""}`);
}

try {
  await send("Page.enable");
  for (const [name, path] of PAGES) {
    await shoot(`${name}-1536`, base + path, 1536, 960, false, false);
    await shoot(`${name}-1536-full`, base + path, 1536, 960, false, true);
    await shoot(`${name}-390`, base + path, 390, 844, true, true);
  }
} finally {
  ws.close();
  chrome.kill();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
}
