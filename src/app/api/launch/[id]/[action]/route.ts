import { ctx } from "@/server/app";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, handle } from "@/server/http";
import {
  confirmLaunch,
  confirmSharing,
  launchView,
  markRejected,
  markSharingRejected,
  markSharingSubmitted,
  markSubmitted,
  owned,
  prepareSharing,
} from "@/server/launch";

export const maxDuration = 30;
type P = { params: Promise<{ id: string; action: string }> };

/** GET /api/launch/<id>/status — the owner's view of a launch. */
export async function GET(_: Request, { params }: P) {
  return handle(async () => {
    const { id, action } = await params;
    if (action !== "status") throw new HttpError(404, "Not found.");
    const { db, me } = await ctx();
    return Response.json({ launch: launchView(await owned(db, me, id)) }, { headers: { "cache-control": "no-store" } });
  });
}

/** submitted · rejected · confirm · sharing · sharing-submitted · sharing-rejected · sharing-confirm */
export async function POST(request: Request, { params }: P) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id, action } = await params;
    const { db, me } = await ctx();
    let body: { signature?: string; reason?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }
    switch (action) {
      case "submitted":
        return Response.json({ launch: launchView(await markSubmitted(db, me, id, body.signature)) });
      case "rejected":
        return Response.json({ launch: launchView(await markRejected(db, me, id, body.reason)) });
      case "confirm":
        return Response.json({ launch: launchView(await confirmLaunch(db, me, id)) });
      case "sharing": {
        const s = await prepareSharing(db, me, id);
        return Response.json({ launch: launchView(s.launch), transaction: s.transaction, shareholders: s.shareholders });
      }
      case "sharing-submitted":
        return Response.json({ launch: launchView(await markSharingSubmitted(db, me, id, body.signature)) });
      case "sharing-rejected":
        return Response.json({ launch: launchView(await markSharingRejected(db, me, id)) });
      case "sharing-confirm":
        return Response.json({ launch: launchView(await confirmSharing(db, me, id)) });
      default:
        throw new HttpError(404, "Unknown action.");
    }
  });
}
