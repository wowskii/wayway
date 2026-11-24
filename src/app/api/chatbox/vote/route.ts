// POST /api/chatbox/vote — the member rates one option of a final vote (Spot Suggestions).
// Body: { tripId, optionSetId, optionId: "A"|"B"|"C", level, acceptsSplit? }. Send again to change it.
// Henry's rules check it (lib/chatbox-vote/service.ts). Answer: the member's fresh view of every
// open set, their ballot included. Errors: 409 with a message for the member (vote closed,
// "definitely no" limit reached...).
import { NextResponse } from "next/server";
import { LEVEL_VALUE } from "@/contracts/contract";
import { castMyVote } from "@/lib/chatbox-vote/service";
import type { VoteRequest, VoteResponse } from "@/lib/chatbox-vote/types";
import { badRequest, handleError, isUuid, readJson } from "@/lib/interview/http";

export async function POST(req: Request) {
  const body = (await readJson(req)) as Partial<VoteRequest> | null;
  if (
    !body || !isUuid(body.tripId) || !isUuid(body.optionSetId) ||
    !(body.optionId === "A" || body.optionId === "B" || body.optionId === "C") ||
    typeof body.level !== "string" || !Object.hasOwn(LEVEL_VALUE, body.level) ||
    (body.acceptsSplit !== undefined && typeof body.acceptsSplit !== "boolean")
  ) {
    return badRequest("Expected { tripId, optionSetId, optionId, level, acceptsSplit? }.");
  }
  try {
    const result = await castMyVote(body.tripId, body.optionSetId, body.optionId, body.level, body.acceptsSplit);
    return NextResponse.json(result satisfies VoteResponse);
  } catch (err) {
    return handleError(err);
  }
}
