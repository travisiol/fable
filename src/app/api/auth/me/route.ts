import { handle } from "@/server/http";
import { currentAddress } from "@/server/session";

export async function GET() {
  return handle(async () => Response.json({ address: await currentAddress() }, { headers: { "cache-control": "no-store" } }));
}
