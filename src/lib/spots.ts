// Spots for the map page and the API routes: every city of data/cities.json (src/lib/cities.ts).
// Same names and values as Henry's src/lib/logic/dataset.ts (SPOTS_BY_ID = all cities), without its
// server-side checks, because the map runs in the browser.
//
// This loader only checks what the MAP needs (id, name, coordinates near the city, optional placeId), so a
// broken entry fails loudly at startup instead of putting a pin in the sea.
// Not server-only on purpose: the data is public (no private fields) and the map runs in the browser.
import type { Spot } from "@/contracts/contract";
// Google Place IDs (field placeId) are in the datasets, written by scripts/match-places.mjs. A spot without one
// (e.g. an OpenStreetMap city not matched yet) shows our own data on the place card.
import { ALL_SPOTS_BY_ID, CITY_CONFIG, cityFile, kmBetween } from "@/lib/cities";

function problems(spots: Record<string, unknown>, city: string, base: { lat: number; lng: number }): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(spots)) {
    const s = value as Partial<Spot>;
    const e = (m: string) => errors.push(`${key}: ${m}`);
    if (s.id !== key) e(`key != id "${s.id}"`);
    if (typeof s.name !== "string" || !s.name) e("missing name");
    // Same check as Henry's: within 60 km of the city's base point (catches swapped or missing lat/lng).
    if (!(Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)) &&
      kmBetween({ lat: Number(s.lat), lng: Number(s.lng) }, base) < 60)) e(`lat/lng outside ${city}`);
    if (s.placeId !== undefined && (typeof s.placeId !== "string" || !s.placeId)) e("placeId must be a non-empty string");
  }
  return errors;
}

for (const c of Object.values(CITY_CONFIG)) {
  const errors = problems(cityFile(c), c.name, c.base);
  if (errors.length) throw new Error(`Invalid data/${c.spots}:\n- ${errors.join("\n- ")}`);
}

export const SPOTS_BY_ID: Readonly<Record<string, Spot>> = ALL_SPOTS_BY_ID;
export const SPOTS: Spot[] = Object.values(SPOTS_BY_ID);

/** The spot for an id, or undefined if the id is unknown (e.g. an old itinerary after a dataset change). */
export const getSpot = (id: string): Spot | undefined => (Object.hasOwn(SPOTS_BY_ID, id) ? SPOTS_BY_ID[id] : undefined);
