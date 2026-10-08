import { SITE } from "@/config/site";
import { serverCluster } from "@/config/solana";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let storage = "unavailable";
  let driver = "none";
  try {
    const d = await db();
    driver = d.info.driver;
    storage = d.info.persistent ? "durable" : "ephemeral";
  } catch {
    // database unreachable: reported below
  }
  return Response.json({ ok: storage !== "unavailable", name: SITE.name, cluster: serverCluster(), database: driver, storage, at: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
