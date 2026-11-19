// Shared Tokyo dataset (Role 4): data/spots_tokyo.json (contract Spot, keyed by id)
// + data/spots_evidence.json (sources and allergen evidence, which the Spot type cannot carry).
import type { Spot } from "@/contracts/contract";
import rawSpots from "../../../data/spots_tokyo.json";
import rawEvidence from "../../../data/spots_evidence.json";
import { spotIndex } from "./constraints";
import type { SpotEvidence, SpotIndex } from "./constraints";

const CATEGORIES = new Set<Spot["category"]>(["museum", "temple", "food", "shopping", "nature", "nightlife", "hotel"]);
const HOURS = /^([01]\d|2[0-4]):[0-5]\d-([01]\d|2[0-4]):[0-5]\d$/;

export interface EvidenceRecord extends SpotEvidence {
  sourceUrl?: string;
  checked?: string;          // date the source was read
  note?: string;
}

/** Every problem in the dataset (empty = valid). Same rules as the AI module's loader, plus evidence. */
export function validateDataset(spots: Record<string, unknown>, evidence: Record<string, unknown> = {}): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(spots)) {
    const s = value as Partial<Spot>;
    const e = (m: string) => errors.push(`${key}: ${m}`);
    if (s.id !== key) e(`key != id "${s.id}"`);
    if (!/^[a-z0-9_]+$/.test(s.id ?? "")) e("id must be a short lowercase slug (a-z, 0-9, _)");
    if (typeof s.name !== "string" || !s.name) e("missing name");
    if (!CATEGORIES.has(s.category as Spot["category"])) e(`bad category "${s.category}"`);
    if (!Number.isSafeInteger(s.price) || s.price! < 0) e("price must be a whole number of JPY >= 0");
    if (!Array.isArray(s.dietTags)) e("dietTags must be an array");
    else if (s.category !== "food" && s.dietTags.length) e("dietTags are for food spots only");
    if (!Number.isSafeInteger(s.durationMin) || s.durationMin! <= 0) e("bad durationMin");
    if (!HOURS.test(s.openHours ?? "")) e(`openHours must be "HH:MM-HH:MM", got "${s.openHours}"`);
    if (typeof s.area !== "string" || !s.area) e("missing area");
    // Tokyo metropolis bounding box (mainland part): catches swapped lat/lng.
    if (!(Number(s.lat) > 35.4 && Number(s.lat) < 35.95 && Number(s.lng) > 139.0 && Number(s.lng) < 140.0)) e("lat/lng outside Tokyo");
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

const problems = validateDataset(rawSpots as Record<string, unknown>, rawEvidence as Record<string, unknown>);
if (problems.length) throw new Error(`Invalid Tokyo dataset:\n- ${problems.join("\n- ")}`);

export const SPOTS: Spot[] = Object.values(rawSpots) as Spot[];
export const SPOTS_BY_ID: Readonly<Record<string, Spot>> = rawSpots as Record<string, Spot>;
export const EVIDENCE: Readonly<Record<string, EvidenceRecord>> = Object.fromEntries(
  Object.entries(rawEvidence).filter(([key]) => !key.startsWith("_"))) as Record<string, EvidenceRecord>;
/** Lookup used by every hard-constraint check (dataset + allergen evidence). */
export const SPOT_INDEX: SpotIndex = spotIndex(SPOTS, EVIDENCE);
