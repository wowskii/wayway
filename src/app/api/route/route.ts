// POST /api/route — real walking routes for the short legs of a day on the map page.
// Body: { legs: [{ from: spotId, to: spotId }, ...] }   (max 12)
// Answer: { routes: { "<from>><to>": { minutes, meters, polyline } | null }, limited?: true }
//
// - Logged-in users only (the free daily limit is shared by the team).
// - Only legs between known spots, at most WALK_MAX_METERS apart: long legs never reach Google
//   (no public-transport routes in Japan through the API; the page shows an estimate instead).
// - Each leg = one Routes API call, counted in the shared daily limit ("route"). When the limit is
//   reached we stop and answer what we have + limited: true; the page falls back to straight lines.
// - Nothing is stored (Google's terms): the browser keeps the answer while the page is open.
import { NextResponse } from "next/server";
import { distanceMeters, WALK_MAX_METERS, type WalkRoute } from "@/lib/itinerary/legs";
import { GoogleError, googleFetch } from "@/lib/google/server";
import { getSpot } from "@/lib/spots";
import { createClient } from "@/lib/supabase/server";
import type { Spot } from "@/contracts/contract";

const MAX_LEGS = 12;

interface RoutesAnswer {
  routes?: { duration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string } }[];
}

// Prefer the Place ID (Google knows the entrance); fall back to our coordinates.
const waypoint = (s: Spot) =>
  s.placeId ? { placeId: s.placeId } : { location: { latLng: { latitude: s.lat, longitude: s.lng } } };

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Log in first." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const legs: unknown = body?.legs;
  if (!Array.isArray(legs) || legs.length > MAX_LEGS) {
    return NextResponse.json({ error: `Expected { legs: [{ from, to }] } (max ${MAX_LEGS}).` }, { status: 400 });
  }

  const routes: Record<string, WalkRoute | null> = {};
  let limited = false;
  for (const leg of legs) {
    const from = typeof leg?.from === "string" ? getSpot(leg.from) : undefined;
    const to = typeof leg?.to === "string" ? getSpot(leg.to) : undefined;
    if (!from || !to) return NextResponse.json({ error: "Unknown spot id." }, { status: 400 });
    const id = `${from.id}>${to.id}`;
    if (id in routes) continue;                                    // same leg twice: one call
    if (distanceMeters(from, to) > WALK_MAX_METERS) {
      return NextResponse.json({ error: `${id} is too far to walk: not asked to Google.` }, { status: 400 });
    }
    if (limited) {
      routes[id] = null;
      continue;
    }
    try {
      const answer = await googleFetch<RoutesAnswer>("route", "https://routes.googleapis.com/directions/v2:computeRoutes", {
        body: { origin: waypoint(from), destination: waypoint(to), travelMode: "WALK", languageCode: "en" },
        // Basic fields only (Essentials tier: 10,000 free per month)
        fieldMask: "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      });
      const r = answer.routes?.[0];
      // duration comes as "754s"
      routes[id] = r?.polyline?.encodedPolyline
        ? { minutes: Math.max(1, Math.round(parseInt(r.duration ?? "0", 10) / 60)), meters: r.distanceMeters ?? 0, polyline: r.polyline.encodedPolyline }
        : null;
    } catch (err) {
      if (err instanceof GoogleError && err.kind === "limit") {
        limited = true;
        routes[id] = null;
        continue;
      }
      console.error("[route]", err);
      routes[id] = null;                                           // this leg falls back to a straight line
    }
  }
  return NextResponse.json(limited ? { routes, limited } : { routes });
}
