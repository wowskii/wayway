// Hard constraints (Role 4). The LLM never decides these: code does.
//
// Two levels of checks:
//  1. filterSpotsForTrip  -> BEFORE the AI: which spots the AI is allowed to use at all.
//  2. checkOption         -> AFTER the AI: is a whole proposed route safe for every member on it?
//
// Rules (agreed defaults, see docs/logic-integration.md):
//  - Diet (public): every food stop on a member's path must carry each of that member's diet tags.
//  - Allergies (private): a food stop with a KNOWN allergen of a member on its path is blocked.
//    Missing allergen data does NOT block (the dataset has no allergen field); it is returned as
//    an "unverified" issue so WayWay can remind that member privately. strictEvidence = true blocks it.
//  - Budget (private): prior spend + every stop on a member's path <= maxBudget.
//    maxBudget <= 0 means "not known yet" (that is what the DB mapper returns for NULL): no budget check.
//  - Unknown spot ids or invalid prices always block (the AI must not invent places).
import type { MemberProfile, Option, Spot } from "@/contracts/contract";

/** Extra per-spot evidence that the contract's Spot cannot carry (see data/spots_evidence.json). */
export interface SpotEvidence {
  allergens?: readonly string[];      // known to be present in the named dish / menu
  allergenFree?: readonly string[];   // verified absent (only from a reliable venue source)
}
export type SafetySpot = Pick<Spot, "id" | "category" | "dietTags"> & { price: number | null; durationMin?: number } & SpotEvidence;
export type SpotIndex = Readonly<Record<string, SafetySpot>>;
export type ConstraintMember = Pick<MemberProfile, "id" | "hard">;
export type Route = Pick<Option, "kind" | "spots" | "branches" | "rendezvous">;
export type IssueCode =
  | "invalid_route" | "unknown_spot" | "unknown_price" | "invalid_spend"
  | "diet_mismatch" | "allergen_present" | "allergy_unverified" | "over_budget";
export interface Issue {
  code: IssueCode;
  status: "violation" | "unverified";
  memberId?: string;
  spotId?: string;
}
export interface CheckOptions {
  spentByMember?: Readonly<Record<string, number>>;
  /** Block routes when allergen evidence is missing (default false, see header). */
  strictEvidence?: boolean;
}

const money = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const normalize = (value: string) => value.trim().toLowerCase();
/** A budget of 0, null or garbage means "unknown": the member has not told WayWay yet. */
export const hasBudget = (maxBudget: unknown): maxBudget is number => money(maxBudget) && maxBudget > 0;

/** Builds the lookup used by the checks, merging the dataset with the optional evidence file. */
export function spotIndex(spots: readonly Spot[], evidence: Readonly<Record<string, SpotEvidence>> = {}): SpotIndex {
  const index: Record<string, SafetySpot> = {};
  for (const spot of spots) {
    const extra = Object.hasOwn(evidence, spot.id) ? evidence[spot.id] : {};
    index[spot.id] = { ...spot, ...extra };
  }
  return index;
}

/** Path followed by each member. Split: own branch then the rendezvous. Null = malformed route. */
export function routePaths(option: Route, memberIds: readonly string[]): Map<string, string[]> | null {
  if (!memberIds.length || new Set(memberIds).size !== memberIds.length) return null;
  const validStops = (stops: unknown): stops is string[] =>
    Array.isArray(stops) && stops.every(id => typeof id === "string" && Boolean(id));
  if (!validStops(option.spots) || !["best_total", "fairest", "split"].includes(option.kind)) return null;
  if (option.kind !== "split") {
    if (!option.spots.length || option.branches?.length || option.rendezvous !== undefined) return null;
    return new Map(memberIds.map(id => [id, [...option.spots]]));
  }
  const rendezvous = option.rendezvous;
  if (typeof rendezvous?.spotId !== "string" || !rendezvous.spotId ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rendezvous.time) ||
      option.spots.length || option.branches?.length !== 2) return null;
  const paths = new Map<string, string[]>();
  const roster = new Set(memberIds);
  for (const branch of option.branches) {
    if (!Array.isArray(branch?.memberIds) || !branch.memberIds.length ||
        !validStops(branch.spots) || !branch.spots.length) return null;
    for (const memberId of branch.memberIds) {
      if (!roster.has(memberId) || paths.has(memberId)) return null;
      const stops = [...branch.spots];
      if (stops.at(-1) !== rendezvous.spotId) stops.push(rendezvous.spotId);
      paths.set(memberId, stops);
    }
  }
  return paths.size === memberIds.length ? paths : null;
}

/** Food-safety issues of one spot for one member (diet + allergies). */
function foodIssues(spot: SafetySpot, member: ConstraintMember): Issue[] {
  if (spot.category !== "food") return [];
  const issues: Issue[] = [];
  const base = { memberId: member.id, spotId: spot.id };
  const tags = new Set(spot.dietTags.map(normalize));
  for (const diet of member.hard.diet.map(normalize)) {
    if (diet && !tags.has(diet)) issues.push({ code: "diet_mismatch", status: "violation", ...base });
  }
  const allergens = new Set(spot.allergens?.map(normalize));
  const allergenFree = new Set(spot.allergenFree?.map(normalize));
  for (const allergy of member.hard.allergies.map(normalize)) {
    if (!allergy) continue;
    if (allergens.has(allergy)) issues.push({ code: "allergen_present", status: "violation", ...base });
    else if (!allergenFree.has(allergy)) issues.push({ code: "allergy_unverified", status: "unverified", ...base });
  }
  return issues;
}

/** Every issue of a proposed route. Empty array = safe and fully verified. */
export function checkOption(
  option: Route, members: readonly ConstraintMember[], spots: SpotIndex, opts: CheckOptions = {},
): Issue[] {
  const spentByMember = opts.spentByMember ?? {};
  const paths = routePaths(option, members.map(member => member.id));
  if (!paths) return [{ code: "invalid_route", status: "violation" }];
  const issues: Issue[] = [];
  for (const member of members) {
    const memberId = member.id;
    const spent = Object.hasOwn(spentByMember, memberId) ? spentByMember[memberId] : 0;
    let total = money(spent) ? spent : 0;
    if (!money(spent)) issues.push({ code: "invalid_spend", status: "unverified", memberId });
    for (const spotId of paths.get(memberId)!) {
      const spot = Object.hasOwn(spots, spotId) ? spots[spotId] : undefined;
      if (!spot || spot.id !== spotId) {
        issues.push({ code: "unknown_spot", status: "violation", memberId, spotId });
        continue;
      }
      if (!money(spot.price)) issues.push({ code: "unknown_price", status: "violation", memberId, spotId });
      else total += spot.price;
      issues.push(...foodIssues(spot, member));
    }
    if (hasBudget(member.hard.maxBudget) && total > member.hard.maxBudget) {
      issues.push({ code: "over_budget", status: "violation", memberId });
    }
  }
  return issues;
}

/** True if these issues must block the route. */
export function blocks(issues: readonly Issue[], strictEvidence = false): boolean {
  return issues.some(issue => issue.status === "violation" || strictEvidence);
}

export function filterOptions<T extends Route>(
  options: readonly T[], members: readonly ConstraintMember[], spots: SpotIndex, opts: CheckOptions = {},
) {
  const eligible: { option: T; warnings: Issue[] }[] = [];
  const blocked: { option: T; issues: Issue[] }[] = [];
  for (const option of options) {
    const issues = checkOption(option, members, spots, opts);
    if (blocks(issues, opts.strictEvidence)) blocked.push({ option, issues });
    else eligible.push({ option, warnings: issues });
  }
  return { eligible, blocked };
}

/**
 * Spot-level filter used BEFORE generateOptions (replaces tempFilterHardConstraints in the AI module).
 * Removes spots no shared route could use: food without everyone's diet tag, food with a known
 * allergen of any member, and spots whose own price is above the smallest remaining known budget.
 * Splits are still checked route by route afterwards with checkOption.
 */
export function filterSpotsForTrip<S extends Spot>(
  spots: readonly S[], members: readonly ConstraintMember[],
  opts: CheckOptions & { evidence?: Readonly<Record<string, SpotEvidence>> } = {},
) {
  const index = spotIndex(spots, opts.evidence);
  const spent = opts.spentByMember ?? {};
  const remaining = members
    .filter(member => hasBudget(member.hard.maxBudget))
    .map(member => member.hard.maxBudget - (money(spent[member.id]) ? spent[member.id] : 0));
  const cheapestLimit = remaining.length ? Math.min(...remaining) : Infinity;
  const allowed: S[] = [];
  const removed: { spotId: string; reasons: IssueCode[] }[] = [];
  for (const spot of spots) {
    const safety = index[spot.id];
    const reasons = new Set<IssueCode>();
    if (!money(spot.price)) reasons.add("unknown_price");
    else if (spot.price > cheapestLimit) reasons.add("over_budget");
    for (const member of members) {
      for (const issue of foodIssues(safety, member)) {
        if (issue.status === "violation" || opts.strictEvidence) reasons.add(issue.code);
      }
    }
    if (reasons.size) removed.push({ spotId: spot.id, reasons: [...reasons] });
    else allowed.push(spot);
  }
  return { allowed, removed };
}
