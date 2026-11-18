// POST /api/private — one member talks privately with WayWay (contract: PrivateChatRequest/Response).
// GET  /api/private?tripId=... — the private chat history and interview progress (for the page).
// For now this serves the onboarding interview (round 0). Simon's rounds 1-3 reactions will use
// the same route later.
import { NextResponse } from "next/server";
import type { PrivateChatRequest, PrivateChatResponse } from "@/contracts/contract";
import { badRequest, handleError, isUuid, readJson } from "@/lib/interview/http";
import { getInterviewState, sendInterviewMessage } from "@/lib/interview/service";
import type { InterviewTurnResponse } from "@/lib/interview/types";

export async function POST(req: Request) {
  const body = (await readJson(req)) as Partial<PrivateChatRequest> | null;
  if (!body || !isUuid(body.tripId) || !isUuid(body.memberId) || typeof body.message?.text !== "string") {
    return badRequest("Expected { tripId, memberId, message: { text } }.");
  }
  try {
    const result = await sendInterviewMessage(body.tripId, body.memberId, body.message.text);
    // The answer is a contract PrivateChatResponse with interview extras (see lib/interview/types.ts)
    return NextResponse.json(result satisfies InterviewTurnResponse & PrivateChatResponse);
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(req: Request) {
  const tripId = new URL(req.url).searchParams.get("tripId");
  if (!isUuid(tripId)) return badRequest("Expected ?tripId=<uuid>.");
  try {
    return NextResponse.json(await getInterviewState(tripId));
  } catch (err) {
    return handleError(err);
  }
}
