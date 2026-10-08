/**
 * The provider adapters against a local stub (OPENAI_BASE_URL / GEMINI_BASE_URL): request shapes,
 * structured-output schema, reference image on edits, error classification, and a whole job through
 * the real adapter with a provider failure → credits restored.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakeAi } from "./fake-ai.ts";
import { ProviderError, providers } from "../src/server/ai.ts";
import { memoryDb } from "../src/server/db.ts";
import { createDraft } from "../src/server/characters.ts";
import { credit, ensureAccount, readBalance, walletAccount } from "../src/server/ledger.ts";
import { runJob, submitJob } from "../src/server/jobs.ts";

process.env.FABLE_MEDIA_DIR = `${process.env.TEMP ?? "/tmp"}/fable-test-media`;
const W = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";

test("OpenAI adapter: strict JSON schema sheet, generation, and edits with the portrait as reference", async () => {
  const ai = await startFakeAi();
  process.env.OPENAI_API_KEY = "test-key-not-real";
  process.env.OPENAI_BASE_URL = ai.url;
  try {
    const p = providers();
    const sheet = await p.sheet({ idea: "A robot comedian", name: "", personality: "", style: "Photographic portrait", niche: "" });
    assert.equal(sheet.name, "Tinpan Kowalski");
    const chat = JSON.parse(ai.state.requests.find((r) => r.path === "/chat/completions")!.body);
    assert.equal(chat.response_format.type, "json_schema");
    assert.equal(chat.response_format.json_schema.strict, true);
    const img = await p.image("portrait", [], "1024x1024");
    assert.ok(img.bytes.length > 100);
    await p.image("scene", [{ mime: "image/png", bytes: img.bytes }], "1024x1536");
    const edit = ai.state.requests.find((r) => r.path === "/images/edits")!;
    assert.match(edit.contentType, /multipart\/form-data/);
    assert.match(edit.body, /name="image\[\]"/);
    ai.state.refuseImages = true;
    await assert.rejects(p.image("x", [], "1024x1024"), (e: unknown) => e instanceof ProviderError && !e.retryable && /safety/.test(e.message));
    ai.state.refuseImages = false;
    ai.state.failImages = 1;
    await assert.rejects(p.image("x", [], "1024x1024"), (e: unknown) => e instanceof ProviderError && e.retryable);
  } finally {
    await ai.close();
  }
});

test("Gemini Veo adapter: start → pending → done → download", async () => {
  const ai = await startFakeAi();
  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.GEMINI_BASE_URL = ai.url;
  try {
    const p = providers();
    assert.equal(p.video, true);
    const op = await p.videoStart("talks", { mime: "image/png", bytes: Buffer.from("x") }, "9:16");
    const start = JSON.parse(ai.state.requests.find((r) => r.path.endsWith(":predictLongRunning"))!.body);
    assert.equal(start.instances[0].referenceImages[0].referenceType, "asset");
    assert.equal((await p.videoPoll(op)).status, "pending");
    const done = await p.videoPoll(op);
    assert.equal(done.status, "done");
    const bytes = await p.videoDownload((done as { uri: string }).uri);
    assert.ok(bytes.length > 0);
  } finally {
    await ai.close();
  }
});

test("a real-adapter job that the provider refuses ends failed with the credits restored", async () => {
  const ai = await startFakeAi();
  process.env.OPENAI_API_KEY = "test-key-not-real";
  process.env.OPENAI_BASE_URL = ai.url;
  ai.state.refuseImages = true;
  try {
    const db = await memoryDb();
    await db.tx(async (q) => {
      await ensureAccount(q, walletAccount(W), "holder_credits", W);
      await credit(q, walletAccount(W), 10, "seed-ai", "grant", null, null);
    });
    const c = await createDraft(db, W, { idea: "A dramatic pigeon food critic" });
    const { job } = await submitJob(db, W, { characterId: c.id, kind: "character", payer: "holder_credits", idempotencyKey: "ai-refused-1" });
    const out = await runJob(db, job.id, providers());
    assert.equal(out?.status, "failed");
    const b = await readBalance(db, walletAccount(W));
    assert.deepEqual([b.balance, b.reserved], [10, 0]);
  } finally {
    await ai.close();
  }
});
