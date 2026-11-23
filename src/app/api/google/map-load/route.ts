// POST /api/google/map-load — the map page asks this BEFORE loading Google Maps in the browser.
// Takes one "map_load" from the shared daily limit (src/lib/google/limits.ts).
// Answers { allowed: true } or 429 { allowed: false } when today's limit is reached.
// Logged-in users only, so a visitor can't use up the team's free map loads.
import { NextResponse } from "next/server";
import { GoogleError, takeGoogleBudget } from "@/lib/google/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ allowed: false, error: "Log in first." }, { status: 401 });

  try {
    await takeGoogleBudget("map_load");
    return NextResponse.json({ allowed: true });
  } catch (err) {
    if (err instanceof GoogleError && err.kind === "limit") {
      return NextResponse.json({ allowed: false, error: "The map is resting: today's free map loads are used up." }, { status: 429 });
    }
    console.error("[map-load]", err);
    return NextResponse.json({ allowed: false, error: "The map can't load right now." }, { status: 500 });
  }
}
