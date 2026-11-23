// Tokyo spots for the map page: data/spots_tokyo.json (Role 4's curated dataset, contract Spot, keyed by id).
//
// TEMPORARY: Henry's src/lib/logic/dataset.ts (branch feature/logic-evaluation) loads the same file with
// the full validation (prices, diets, opening hours, allergen evidence). Once his PR is merged, delete this
// file and import { SPOTS, SPOTS_BY_ID } from "@/lib/logic/dataset" instead: same names, same values.
//
// This loader only checks what the MAP needs (id, name, coordinates, optional placeId), so a broken
// entry fails loudly at startup instead of putting a pin in the sea.
// Not server-only on purpose: the data is public (no private fields) and the map runs in the browser.
import type { Spot } from "@/contracts/contract";
import raw from "../../data/spots_tokyo.json";
// Google Place IDs found by scripts/match-places.mjs ({ spotId: placeId | null }, null = no single place fits).
// TEMPORARY too: once Henry copies them into spots_tokyo.json (field placeId), delete this file and the merge below.
import placeIds from "../../data/place_ids.json";

function problems(spots: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(spots)) {
    const s = value as Partial<Spot>;
    const e = (m: string) => errors.push(`${key}: ${m}`);
    if (s.id !== key) e(`key != id "${s.id}"`);
    if (typeof s.name !== "string" || !s.name) e("missing name");
    // Same Tokyo box as Henry's check: catches swapped or missing lat/lng.
    if (!(Number(s.lat) > 35.4 && Number(s.lat) < 35.95 && Number(s.lng) > 139.0 && Number(s.lng) < 140.0)) {
      e("lat/lng outside Tokyo");
    }
    if (s.placeId !== undefined && (typeof s.placeId !== "string" || !s.placeId)) e("placeId must be a non-empty string");
  }
  return errors;
}

const errors = problems(raw as Record<string, unknown>);
if (errors.length) throw new Error(`Invalid data/spots_tokyo.json:\n- ${errors.join("\n- ")}`);

// The dataset's own placeId wins; otherwise take the one from place_ids.json (if any).
const ids = placeIds as Record<string, string | null>;
export const SPOTS_BY_ID: Readonly<Record<string, Spot>> = Object.fromEntries(
  Object.entries(raw as Record<string, Spot>).map(([id, s]) => [id, s.placeId || !ids[id] ? s : { ...s, placeId: ids[id]! }]),
);
export const SPOTS: Spot[] = Object.values(SPOTS_BY_ID);

/** The spot for an id, or undefined if the id is unknown (e.g. an old itinerary after a dataset change). */
export const getSpot = (id: string): Spot | undefined => (Object.hasOwn(SPOTS_BY_ID, id) ? SPOTS_BY_ID[id] : undefined);
