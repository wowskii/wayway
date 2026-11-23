// POST /api/private/finish — the member taps "Finish" at the end of the interview. Body: { tripId }
import { NextResponse } from "next/server";
import { badRequest, handleError, isUuid, readJson } from "@/lib/interview/http";
import { finishInterview } from "@/lib/interview/service";

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body || !isUuid(body.tripId)) return badRequest("Expected { tripId }.");
  try {
    return NextResponse.json(await finishInterview(body.tripId));
  } catch (err) {
    return handleError(err);
  }
}
