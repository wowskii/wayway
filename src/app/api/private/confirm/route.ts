// POST /api/private/confirm — the member answers a confirmation card.
// Body: { tripId, messageId, decision: "confirm" | "reject", constraints?: Partial<HardConstraints> }
// "constraints" is the member's edited version of the card; without it, the card's values are used.
import { NextResponse } from "next/server";
import { badRequest, handleError, isUuid, readJson } from "@/lib/interview/http";
import { answerConstraintCard } from "@/lib/interview/service";

export async function POST(req: Request) {
  const body = await readJson(req);
  const decision = body?.decision;
  if (!body || !isUuid(body.tripId) || !isUuid(body.messageId) || (decision !== "confirm" && decision !== "reject")) {
    return badRequest('Expected { tripId, messageId, decision: "confirm" | "reject" }.');
  }
  try {
    return NextResponse.json(await answerConstraintCard(body.tripId, body.messageId, decision, body.constraints));
  } catch (err) {
    return handleError(err);
  }
}
