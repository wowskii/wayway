// The 5 satisfaction levels as the member sees them (contract: SatisfactionLevel).
// Numbers (LEVEL_VALUE) are never shown to users.
import type { SatisfactionLevel, Spot } from "@/contracts/contract";

export const LEVELS: readonly { id: SatisfactionLevel; label: string }[] = [
  { id: "must_go", label: "Must go" },
  { id: "want_to_go", label: "Want to go" },
  { id: "same", label: "Same" },
  { id: "lean_not_go", label: "Lean not go" },
  { id: "definitely_no", label: "Definitely no" },
];

/** Spot.category as shown under the spot name. */
export const CATEGORY_LABEL: Record<Spot["category"], string> = {
  museum: "Museum",
  temple: "Temple, church & shrine",
  landmark: "Landmark",
  food: "Food & market",
  shopping: "Shopping",
  nature: "Nature & parks",
  nightlife: "Nightlife",
  hotel: "Hotel",
};
