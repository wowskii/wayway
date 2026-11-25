// Shared spot datasets (Role 4): one file per city (src/lib/cities.ts, data/cities.json), contract Spot keyed by id,
// + data/spots_evidence.json (sources and allergen evidence for Tokyo, which the Spot type cannot carry).
// SPOTS stays the Tokyo list (the evaluation runs on Tokyo); lookups by id (SPOTS_BY_ID, SPOT_INDEX) cover every
// city, so votes and itineraries of a trip in any city find their spots. The AI gets spotsForCity(trip.city).
import type { Spot } from "@/contracts/contract";
import { ALL_SPOTS_BY_ID, CITY_CONFIG, cityFile, kmBetween, spotsForCity } from "@/lib/cities";
import rawEvidence from "../../../data/spots_evidence.json";
import { spotIndex } from "./constraints";
import type { SpotEvidence, SpotIndex } from "./constraints";

const CATEGORIES = new Set<Spot["category"]>(["museum", "temple", "landmark", "food", "shopping", "nature", "nightlife", "hotel"]);
const WEEKDAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const TOKYO_BASE = { lat: 35.6812, lng: 139.7671 };
const HOURS = /^([01]\d|2[0-4]):[0-5]\d-([01]\d|2[0-4]):[0-5]\d$/;

export interface EvidenceRecord extends SpotEvidence {
  sourceUrl?: string;
  checked?: string;          // date the source was read
  note?: string;
}

/** Every problem in the dataset (empty = valid). Same rules as the AI module's loader, plus evidence. */
export function validateDataset(
  spots: Record<string, unknown>, evidence: Record<string, unknown> = {},
  city: { name: string; base: { lat: number; lng: number } } = { name: "Tokyo", base: TOKYO_BASE },
): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(spots)) {
    const s = value as Partial<Spot>;
    const e = (m: string) => errors.push(`${key}: ${m}`);
    if (s.id !== key) e(`key != id "${s.id}"`);
    if (!/^[a-z0-9_]+$/.test(s.id ?? "")) e("id must be a short lowercase slug (a-z, 0-9, _)");
    if (typeof s.name !== "string" || !s.name) e("missing name");
    if (!CATEGORIES.has(s.category as Spot["category"])) e(`bad category "${s.category}"`);
    if (!Number.isSafeInteger(s.price) || s.price! < 0) e("price must be a whole number >= 0 (trip currency)");
    if (!Array.isArray(s.dietTags)) e("dietTags must be an array");
    else if (s.category !== "food" && s.dietTags.length) e("dietTags are for food spots only");
    if (!Number.isSafeInteger(s.durationMin) || s.durationMin! <= 0) e("bad durationMin");
    if (!HOURS.test(s.openHours ?? "")) e(`openHours must be "HH:MM-HH:MM", got "${s.openHours}"`);
    if (s.openHoursByDay !== undefined) {
      for (const [d, h] of Object.entries(s.openHoursByDay ?? {})) {
        if (!WEEKDAYS.has(d)) e(`openHoursByDay: unknown day "${d}"`);
        if (h !== "closed" && !HOURS.test(h ?? "")) e(`openHoursByDay.${d} must be "HH:MM-HH:MM" or "closed", got "${h}"`);
      }
    }
    if (typeof s.area !== "string" || !s.area) e("missing area");
    // Within 60 km of the city's base point: catches swapped or missing lat/lng.
    if (!(Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)) &&
      kmBetween({ lat: Number(s.lat), lng: Number(s.lng) }, city.base) < 60)) e(`lat/lng outside ${city.name}`);
  }
  for (const [key, value] of Object.entries(evidence)) {
    if (key.startsWith("_")) continue;
    if (!Object.hasOwn(spots, key)) errors.push(`evidence "${key}": no such spot`);
    const r = value as EvidenceRecord;
    for (const field of ["allergens", "allergenFree"] as const) {
      if (r[field] !== undefined && (!Array.isArray(r[field]) || r[field]!.some(a => typeof a !== "string" || !a))) {
        errors.push(`evidence "${key}": ${field} must be a list of words`);
      }
    }
  }
  return errors;
}

for (const c of Object.values(CITY_CONFIG)) {
  const problems = validateDataset(cityFile(c), c.name === "Tokyo" ? rawEvidence as Record<string, unknown> : {}, c);
  if (problems.length) throw new Error(`Invalid ${c.name} dataset (data/${c.spots}):\n- ${problems.join("\n- ")}`);
}

/** The Tokyo spots (hand-made dataset, used by the evaluation). For a trip, use spotsForCity(trip.city). */
export const SPOTS: Spot[] = spotsForCity("Tokyo");
/** Every spot of every city, by id. */
export const SPOTS_BY_ID: Readonly<Record<string, Spot>> = ALL_SPOTS_BY_ID;
export const EVIDENCE: Readonly<Record<string, EvidenceRecord>> = Object.fromEntries(
  Object.entries(rawEvidence).filter(([key]) => !key.startsWith("_"))) as Record<string, EvidenceRecord>;
/** Lookup used by every hard-constraint check (dataset + allergen evidence). */
export const SPOT_INDEX: SpotIndex = spotIndex(Object.values(ALL_SPOTS_BY_ID), EVIDENCE);
