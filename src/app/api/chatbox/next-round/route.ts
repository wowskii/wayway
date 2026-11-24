// POST /api/chatbox/next-round — a member's browser saw a Spot Suggestions round end (countdown at 0,
// or the page opened after a deadline). Body: { tripId }
// The server checks the deadlines with ITS time, changes every expired round once (Simon's AI +
// Henry's logic, see lib/chatbox-rounds/service.ts) and answers with the member's fresh view:
// { advanced: string[], suggestions: { sets } }. Safe to call often: nothing expired = nothing changes.
import { NextResponse } from "next/server";
import { advanceExpiredRounds } from "@/lib/chatbox-rounds/service";
import type { NextRoundResult } from "@/lib/chatbox-rounds/types";
import { badRequest, handleError, isUuid, readJson } from "@/lib/interview/http";

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body || !isUuid(body.tripId)) return badRequest("Expected { tripId }.");
  try {
    return NextResponse.json((await advanceExpiredRounds(body.tripId)) satisfies NextRoundResult);
  } catch (err) {
    return handleError(err);
  }
}
