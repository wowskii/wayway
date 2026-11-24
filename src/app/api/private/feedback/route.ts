// POST /api/private/feedback — the member tells WayWay privately what they think of the options
// of one option set (rounds 1-3, Spot Suggestions panel). Body: { tripId, optionSetId, text }
// Answer: { messages: [your message, WayWay's reply] }, both tagged with the option set and round.
import { NextResponse } from "next/server";
import { sendFeedbackMessage } from "@/lib/chatbox-feedback/service";
import type { FeedbackRequest, FeedbackTurnResponse } from "@/lib/chatbox-feedback/types";
import { badRequest, handleError, isUuid, readJson } from "@/lib/interview/http";

export async function POST(req: Request) {
  const body = (await readJson(req)) as Partial<FeedbackRequest> | null;
  if (!body || !isUuid(body.tripId) || !isUuid(body.optionSetId) || typeof body.text !== "string") {
    return badRequest("Expected { tripId, optionSetId, text }.");
  }
  try {
    const result = await sendFeedbackMessage(body.tripId, body.optionSetId, body.text);
    return NextResponse.json(result satisfies FeedbackTurnResponse);
  } catch (err) {
    return handleError(err);
  }
}
