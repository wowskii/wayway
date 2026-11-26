// The trips between stops ("legs") of one day, for the route lines and travel times on the map page.
// Pure logic, like view.ts.
//
// Which legs exist:
//   shared stop -> next shared stop
//   last shared stop before a split -> first stop of EACH group
//   inside a group: stop -> next stop
//   last stop of each group -> the meeting point (the shared stop right after the split)
//
// How each leg is shown (decided here, by straight-line distance, BEFORE any Google call):
//   walk     (<= WALK_MAX_METERS): the server asks Google for the real walking route and time.
//   transit  (longer): no Google call. Google's Routes API returns no public-transport routes in Japan
//            (tested Nov 19), so we draw a dashed straight line and show the same travel estimate the
//            AI used to plan the day, plus a link to Google Maps directions (which do show trains).
import type { Spot } from "@/contracts/contract";
import type { DayPlan, PlanStop } from "./view";

export const WALK_MAX_METERS = 1200;   // ~15 min on foot: above that, people take the train

export interface Leg {
  id: string;                 // "<fromSpotId>><toSpotId>": same trip = same id (shared cache key)
  from: PlanStop;
  to: PlanStop;
  group: PlanStop["group"];   // line colour: the group that travels it
  meters: number;             // straight-line distance
  mode: "walk" | "transit";
  estimateMin: number;        // our estimate (used for transit, and for walk until Google answers)
}

/** A real walking route from Google (answer of POST /api/route). */
export interface WalkRoute {
  minutes: number;
  meters: number;
  polyline: string;           // Google's encoded polyline (the map library draws it directly)
}

export function dayLegs(plan: DayPlan): Leg[] {
  const legs: Leg[] = [];
  const add = (from: PlanStop | undefined, to: PlanStop, group: PlanStop["group"]) => {
    if (!from || from.spot.id === to.spot.id) return;
    const meters = distanceMeters(from.spot, to.spot);
    legs.push({
      id: `${from.spot.id}>${to.spot.id}`, from, to, group, meters,
      mode: meters <= WALK_MAX_METERS ? "walk" : "transit",
      estimateMin: travelMin(from.spot, to.spot),
    });
  };

  let lastShared: PlanStop | undefined;      // where everyone was last together
  let groupEnds: PlanStop[] = [];            // last stop of each group, right after a split
  for (const entry of plan.entries) {
    if (entry.kind === "split") {
      groupEnds = [];
      for (const b of entry.branches) {
        let prev = lastShared;
        for (const s of b.stops) {
          add(prev, s, s.group);
          prev = s;
        }
        if (prev && prev !== lastShared) groupEnds.push(prev);
      }
      continue;
    }
    const stop = entry.stop;
    if (groupEnds.length && stop.isRendezvous) {
      for (const end of groupEnds) add(end, stop, end.group);     // each group walks/rides to the meeting point
    } else {
      add(lastShared, stop, "shared");
    }
    groupEnds = [];
    lastShared = stop;
  }
  return legs;
}

/**
 * Decodes Google's "encoded polyline" text into points (Google's published algorithm: each number is
 * the difference from the previous point, x 1e5, split into 5-bit chunks stored as characters).
 * We decode it ourselves so the map can add the pins at both ends (see walkPath).
 */
export function decodePolyline(encoded: string): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = [];
  let i = 0, lat = 0, lng = 0;
  const next = () => {
    let result = 0, shift = 0, b: number;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/**
 * The line to draw for a walk: pin -> Google's route -> pin. Google snaps the start and end to the
 * nearest street, a few meters from the pin; the two short extra segments make the line touch the pins.
 */
export function walkPath(leg: Leg, walk: WalkRoute): { lat: number; lng: number }[] {
  return [
    { lat: leg.from.spot.lat, lng: leg.from.spot.lng },
    ...decodePolyline(walk.polyline),
    { lat: leg.to.spot.lat, lng: leg.to.spot.lng },
  ];
}

/** Straight-line distance in meters (haversine). */
export function distanceMeters(a: Pick<Spot, "lat" | "lng">, b: Pick<Spot, "lat" | "lng">): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

/**
 * Travel estimate in minutes: the SAME rule as the AI module and Henry's logic (travelMin):
 * 10 min inside one area, else 10 min + 3 min/km, rounded up to 5. Using the same rule keeps the map
 * consistent with the times WayWay planned. TODO(after merges): import travelMin from @/lib/logic/itinerary.
 */
export function travelMin(a: Spot, b: Spot): number {
  if (a.id === b.id) return 0;
  if (a.area === b.area) return 10;
  return Math.ceil((10 + (3 * distanceMeters(a, b)) / 1000) / 5) * 5;
}

/** Google Maps directions link (free, no key): opens the website/app with public transport selected. */
export function directionsUrl(from: Spot, to: Spot): string {
  const p = new URLSearchParams({
    api: "1",
    origin: from.name,
    destination: to.name,
    travelmode: "transit",
  });
  if (from.placeId) p.set("origin_place_id", from.placeId);
  if (to.placeId) p.set("destination_place_id", to.placeId);
  return `https://www.google.com/maps/dir/?${p}`;
}
