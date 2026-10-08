/**
 * A local stand-in for the OpenAI and Gemini endpoints FABLE calls (OPENAI_BASE_URL / GEMINI_BASE_URL
 * point here in tests and in the no-key rig). It records each request and can be told to fail.
 *
 *   node tests/fake-ai.ts   -> prints {"url": "..."} and serves until killed
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface FakeAiState {
  requests: { path: string; contentType: string; body: string }[];
  failImages: number;
  refuseImages: boolean;
  videoPolls: number;
}

const PNG = (() => {
  try {
    return readFileSync(join(import.meta.dirname, "..", "public", "examples", "robot-comedian.png"));
  } catch {
    return Buffer.from("89504e470d0a1a0a", "hex");
  }
})();

export async function startFakeAi(state: FakeAiState = { requests: [], failImages: 0, refuseImages: false, videoPolls: 0 }) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = (req.url ?? "").replace(/^\/v1(beta)?/, "");
      state.requests.push({ path, contentType: String(req.headers["content-type"] ?? ""), body: body.toString("latin1").slice(0, 4000) });
      const json = (code: number, o: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(o));
      if (path === "/__control") {
        Object.assign(state, JSON.parse(body.toString() || "{}"));
        return json(200, { ok: true });
      }
      if (path === "/chat/completions") {
        const sheet = { name: "Tinpan Kowalski", bio: "A washed-up robot comedian broadcasting from a tiny apartment in Tokyo.", personality: "Deadpan, warm underneath.", niche: "Late-night stand-up", look: "Dented chrome robot in a burgundy velvet blazer" };
        return json(200, { choices: [{ message: { content: JSON.stringify(sheet) } }] });
      }
      if (path === "/images/generations" || path === "/images/edits") {
        if (state.refuseImages) return json(400, { error: { code: "moderation_blocked", message: "Your request was rejected by the safety system." } });
        if (state.failImages > 0) {
          state.failImages--;
          return json(503, { error: { message: "overloaded" } });
        }
        return json(200, { data: [{ b64_json: PNG.toString("base64") }], output_format: "png" });
      }
      if (/:predictLongRunning$/.test(path)) return json(200, { name: "operations/fake-1" });
      if (path === "/operations/fake-1") {
        state.videoPolls++;
        if (state.videoPolls < 2) return json(200, { name: "operations/fake-1", done: false });
        const { port } = server.address() as AddressInfo;
        return json(200, { name: "operations/fake-1", done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `http://127.0.0.1:${port}/files/clip.mp4` } }] } } });
      }
      if (path === "/files/clip.mp4") return res.writeHead(200, { "content-type": "video/mp4" }).end(Buffer.from("00000018667479706d703432", "hex"));
      json(404, { error: { message: `no route ${path}` } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/v1`, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  const { url } = await startFakeAi();
  console.log(JSON.stringify({ url }));
}
