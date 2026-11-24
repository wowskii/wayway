// POST /api/chatbox/message — a group message that mentions @WayWay. Body: { tripId, text }
// Saves it as the member, then WayWay answers (lib/chatbox-wayway/service.ts): agree on a time,
// then create the first option set. Answer: { message, replies } (everyone also gets them live).
// Messages without @WayWay don't come here: the browser writes them directly (RLS checks them).
import { NextResponse } from "next/server";
import { sendWayWayMessage } from "@/lib/chatbox-wayway/service";
import type { WayWayMessageRequest, WayWayMessageResponse } from "@/lib/chatbox-wayway/types";
import { badRequest, handleError, isUuid, readJson } from "@/lib/interview/http";

export async function POST(req: Request) {
  const body = (await readJson(req)) as Partial<WayWayMessageRequest> | null;
  if (!body || !isUuid(body.tripId) || typeof body.text !== "string") return badRequest("Expected { tripId, text }.");
  try {
    return NextResponse.json((await sendWayWayMessage(body.tripId, body.text)) satisfies WayWayMessageResponse);
  } catch (err) {
    return handleError(err);
  }
}
