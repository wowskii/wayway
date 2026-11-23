// Loads the shared Tokyo spots dataset (../../data/spots_tokyo.json, keyed by id like the
// Python evaluation scripts expect) and checks it against the contract at startup,
// so a typo in the dataset fails loudly instead of confusing the model.

import type { Spot } from "@/contracts/contract";
import raw from "../../data/spots_tokyo.json";

const CATEGORIES = new Set(["museum", "temple", "food", "shopping", "nature", "nightlife", "hotel"]);
const HOURS = /^([01]\d|2[0-4]):[0-5]\d-([01]\d|2[0-4]):[0-5]\d$/;

function check(key: string, s: any): string[] {
  const e: string[] = [];
  if (s.id !== key) e.push(`key "${key}" != id "${s.id}"`);
  if (!/^[a-z0-9_]+$/.test(s.id ?? "")) e.push("id must be a short lowercase slug");
  if (typeof s.name !== "string" || !s.name) e.push("missing name");
  if (!CATEGORIES.has(s.category)) e.push(`bad category "${s.category}"`);
  if (typeof s.price !== "number" || s.price < 0) e.push("bad price");
  if (!Array.isArray(s.dietTags)) e.push("dietTags must be an array");
  if (typeof s.durationMin !== "number" || s.durationMin <= 0) e.push("bad durationMin");
  if (!HOURS.test(s.openHours ?? "")) e.push(`bad openHours "${s.openHours}"`);
  if (typeof s.area !== "string") e.push("missing area");
  if (typeof s.lat !== "number" || typeof s.lng !== "number") e.push("bad lat/lng");
  return e.map((m) => `${key}: ${m}`);
}

const errors = Object.entries(raw).flatMap(([k, s]) => check(k, s));
if (errors.length) throw new Error(`Invalid data/spots_tokyo.json:\n- ${errors.join("\n- ")}`);

export const ALL_SPOTS: Spot[] = Object.values(raw) as Spot[];
