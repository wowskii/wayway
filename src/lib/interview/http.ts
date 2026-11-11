import "server-only";
import { NextResponse } from "next/server";
import { InterviewError } from "./service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export const badRequest = (message: string) => NextResponse.json({ error: message }, { status: 400 });

/** Reads a JSON body, or null if it isn't valid JSON. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

/** Turns our errors into clean JSON answers; hides unexpected errors from the user. */
export function handleError(err: unknown) {
  if (err instanceof InterviewError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("[interview]", err);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
