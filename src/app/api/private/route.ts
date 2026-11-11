// POST /api/private — one member talks privately with WayWay (contract: PrivateChatRequest/Response).
// GET  /api/private?tripId=... — the private chat history and interview progress (for the page).
// For now this serves the onboarding interview (round 0). Simon's rounds 1-3 reactions will use
// the same route later.
import { NextResponse } from "next/server";
import type { PrivateChatRequest, PrivateChatResponse } from "@/contracts/contract";
import { badRequest, handleError, isUuid, readJson } from "@/lib/interview/http";
import { getInterviewState, sendInterviewMessage, type InterviewMessage } from "@/lib/interview/service";
import type { InterviewProgress } from "@/lib/ai/types";

/** Contract response + the interview extras (messages may carry a confirmation card). */
export type PrivateChatApiResponse = PrivateChatResponse & {
  messages: InterviewMessage[];
  interview: InterviewProgress;
};

export async function POST(req: Request) {
  const body = (await readJson(req)) as Partial<PrivateChatRequest> | null;
  if (!body || !isUuid(body.tripId) || !isUuid(body.memberId) || typeof body.message?.text !== "string") {
    return badRequest("Expected { tripId, memberId, message: { text } }.");
  }
  try {
    const result = await sendInterviewMessage(body.tripId, body.memberId, body.message.text);
    return NextResponse.json(result satisfies PrivateChatApiResponse);
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
