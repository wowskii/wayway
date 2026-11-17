// Evaluation (Role 4, report section 1.4): how good are the AI's options?
//  1. Constraint violations : does any proposed / final route break a hard constraint?
//  2. Estimate accuracy     : AI estimate (MemberScore source "ai_estimate") vs the member's real rating.
//  3. Privacy leaks         : does a private marker appear in anything the group can see?
// Plus scripted personas, so the whole pipeline can be scored without people (and without an API key).
import { LEVEL_VALUE } from "@/contracts/contract";
import type { Option, SatisfactionLevel, Trip } from "@/contracts/contract";
import { checkOption } from "./constraints";
import type { CheckOptions, ConstraintMember, Issue, SpotIndex } from "./constraints";
import { isLevel, rankOf } from "./metrics";

// ---------------------------------------------------------------------------------------------
// 1. Estimate accuracy
// ---------------------------------------------------------------------------------------------
export type Observation = {
  tripId: string; optionSetId: string; round: number; attempt: number;
  optionId: string; memberId: string; level: SatisfactionLevel;
};

/** Exact-match rate and mean gap in levels (0 = perfect, 4 = must_go vs definitely_no). */
export function estimateAccuracy(estimates: readonly Observation[], references: readonly Observation[]) {
  const index = (rows: readonly Observation[]) => {
    const records = new Map<string, SatisfactionLevel>();
    for (const row of rows) {
      const key = JSON.stringify([row.tripId, row.optionSetId, row.round, row.attempt, row.optionId, row.memberId]);
      if (records.has(key) || !isLevel(row.level) || !row.tripId || !row.optionSetId || !row.optionId ||
          !row.memberId || !Number.isInteger(row.round) || row.round < 1 ||
          ![1, 2].includes(row.attempt)) throw new Error("Invalid or duplicate evaluation observation");
      records.set(key, row.level);
    }
    return records;
  };
  const predicted = index(estimates);
  const truth = index(references);
  let n = 0, exact = 0, within1 = 0, distance = 0;
  for (const [key, level] of truth) {
    const guess = predicted.get(key);
    if (guess === undefined) continue;
    n++;
    const gap = Math.abs(rankOf(guess) - rankOf(level));
    exact += Number(gap === 0);
    within1 += Number(gap <= 1);
    distance += gap;
  }
  return {
    n, referenceCount: truth.size, missingEstimates: truth.size - n, unmatchedEstimates: predicted.size - n,
    exactMatch: n ? exact / n : null, withinOneLevel: n ? within1 / n : null, meanLevelGap: n ? distance / n : null,
  };
}

// ---------------------------------------------------------------------------------------------
// 2. Privacy
// ---------------------------------------------------------------------------------------------
/** Indexes of the markers found in the payload (all strings and keys, case-insensitive, NFKC). */
export function literalPrivacyHits(payload: unknown, canaries: readonly string[]): number[] {
  const text: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") text.push(value.normalize("NFKC").toLowerCase());
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) { collect(key); collect(entry); }
    }
  };
  collect(payload);
  return canaries.flatMap((marker, index) => {
    const needle = marker.normalize("NFKC").trim().toLowerCase();
    if (!needle) throw new Error("Empty privacy canary");
    return text.some(value => value.includes(needle)) ? [index] : [];
  });
}

/**
 * Private markers derived from a trip: budgets (as written in several ways), allergies, the private
 * note and "[private] " statements. Add scenario-specific phrases with `extra`.
 */
export function privateCanaries(trip: Trip, extra: readonly string[] = []): string[] {
  const markers = new Set<string>(extra.map(s => s.trim()).filter(Boolean));
  for (const m of trip.members) {
    if (m.hard.maxBudget > 0) {
      markers.add(String(m.hard.maxBudget));
      markers.add(m.hard.maxBudget.toLocaleString("en-US"));
    }
    for (const allergy of m.hard.allergies) if (allergy.trim()) markers.add(allergy.trim());
    if (m.privateNote.trim()) markers.add(m.privateNote.trim());
    for (const s of m.preferenceStatements) if (s.startsWith("[private] ")) markers.add(s.slice(10).trim());
  }
  return [...markers];
}

/** Facts-only projection of a card (what the group may see). LLM prose must be scanned separately. */
export function publicOptionFacts(option: Option) {
  return {
    id: option.id, kind: option.kind, spots: [...option.spots],
    satisfiedMemberIds: [...option.satisfiedMemberIds],
    ...(option.branches ? { branches: option.branches.map(b => ({ memberIds: [...b.memberIds], spots: [...b.spots] })) } : {}),
    ...(option.rendezvous ? { rendezvous: { spotId: option.rendezvous.spotId, time: option.rendezvous.time } } : {}),
  };
}

/** What the group sees of an option card: everything except per-member reasons and metrics. */
export function publicCardText(option: Option) {
  return { title: option.title, explanation: option.explanation, assumptions: option.assumptions,
    fairnessNote: option.fairnessNote ?? "" };
}

// ---------------------------------------------------------------------------------------------
// 3. Scripted personas (deterministic stand-ins for people)
// ---------------------------------------------------------------------------------------------
export interface Persona {
  memberId: string;
  /** Rating of a single stop: spot id first, then category, else `default`. */
  likes: Partial<Record<string, SatisfactionLevel>>;
  default?: SatisfactionLevel;
  /** Will this person accept being split from the group? (default: yes if they like their branch) */
  acceptsSplit?: boolean;
  /** Abstains from the final vote (e.g. Sarah "anything is fine"). */
  abstains?: boolean;
}

const LEVELS_BY_RANK: SatisfactionLevel[] = ["definitely_no", "lean_not_go", "same", "want_to_go", "must_go"];
/** Version of the persona model, saved with every evaluation run (results of different versions are not comparable). */
export const PERSONA_MODEL = "v2";

/**
 * How a persona rates an option (persona model v2):
 *  - each stop gets the persona's level for that spot id, else its category, else `default`;
 *  - stops are weighted by visit time (an hour at a museum counts more than 30 min at a shop);
 *  - a stop the persona hates (definitely_no) caps the whole option at lean_not_go ("I'd hate part of it");
 *  - any hard-constraint violation on their own path makes it definitely_no (a real person would refuse).
 * v1 (unweighted rounded mean) produced too many ties when the AI mixed two kinds of stops.
 */
export function personaRating(
  option: Option, persona: Persona, member: ConstraintMember, spots: SpotIndex,
): { level: SatisfactionLevel; acceptsSplit?: boolean } {
  const path = memberPath(option, member.id);
  const own = path.length ? checkOption({ kind: "best_total", spots: path }, [member], spots) : [];
  if (!path.length || own.some(issue => issue.status === "violation")) {
    return { level: "definitely_no", ...(option.kind === "split" ? { acceptsSplit: false } : {}) };
  }
  let weighted = 0, minutes = 0, hates = false;
  for (const id of path) {
    const level = persona.likes[id] ?? persona.likes[spots[id]?.category ?? ""] ?? persona.default ?? "same";
    const duration = spots[id]?.durationMin && spots[id].durationMin! > 0 ? spots[id].durationMin! : 60;
    weighted += rankOf(level) * duration;
    minutes += duration;
    hates ||= level === "definitely_no";
  }
  let rank = Math.max(0, Math.min(4, Math.round(weighted / minutes)));
  if (hates) rank = Math.min(rank, 1);
  const level = LEVELS_BY_RANK[rank];
  if (option.kind !== "split") return { level };
  return { level, acceptsSplit: persona.acceptsSplit ?? LEVEL_VALUE[level] >= LEVEL_VALUE.same };
}

/** Stops one member actually visits (split: own branch, then the rendezvous). */
export function memberPath(option: Pick<Option, "kind" | "spots" | "branches" | "rendezvous">, memberId: string): string[] {
  if (option.kind !== "split") return [...option.spots];
  const branch = option.branches?.find(b => b.memberIds.includes(memberId));
  if (!branch) return [];
  const stops = [...branch.spots];
  if (option.rendezvous && stops.at(-1) !== option.rendezvous.spotId) stops.push(option.rendezvous.spotId);
  return stops;
}

// ---------------------------------------------------------------------------------------------
// 4. One report for a whole run (one scenario, all rounds)
// ---------------------------------------------------------------------------------------------
export interface RunRecord {
  trip: Trip;                                   // with private fields: evaluation only, never public
  optionSets: { id: string; round: number; options: Option[] }[];
  /** Everything the group could see: chat messages, card text. */
  publicPayloads: unknown[];
  references: Observation[];                    // persona or human ratings
  finalOptions?: Option[];                      // the decided option(s), if any
  invalidResponses?: number;                    // AI calls whose output failed validation
  totalResponses?: number;
  extraCanaries?: string[];
}

export function evaluateRun(run: RunRecord, spots: SpotIndex, opts: CheckOptions = {}) {
  const members = run.trip.members;
  const check = (options: readonly Option[]) => {
    const rows = options.map(option => ({ option: option.id, issues: checkOption(option, members, spots, opts) }));
    const violations = rows.filter(r => r.issues.some((i: Issue) => i.status === "violation"));
    const unverified = rows.filter(r => r.issues.some((i: Issue) => i.status === "unverified"));
    return { checked: rows.length, withViolations: violations.length, withUnverified: unverified.length,
      examples: violations.slice(0, 5).map(r => ({ option: r.option, codes: [...new Set(r.issues.map(i => i.code))] })) };
  };
  const proposed = run.optionSets.flatMap(set => set.options);
  const estimates: Observation[] = run.optionSets.flatMap(set => set.options.flatMap(option =>
    option.scores.filter(s => s.source === "ai_estimate").map(s => ({
      tripId: run.trip.id, optionSetId: set.id, round: set.round, attempt: 1, optionId: option.id, memberId: s.memberId, level: s.level,
    }))));
  const canaries = privateCanaries(run.trip, run.extraCanaries);
  const leaks = run.publicPayloads.map((payload, index) => ({ index, hits: literalPrivacyHits(payload, canaries) }))
    .filter(row => row.hits.length);
  return {
    jsonValidity: run.totalResponses ? { valid: run.totalResponses - (run.invalidResponses ?? 0), total: run.totalResponses } : null,
    proposedRoutes: check(proposed),
    finalRoutes: check(run.finalOptions ?? []),
    estimateAccuracy: estimateAccuracy(estimates, run.references),
    privacy: { publicPayloads: run.publicPayloads.length, payloadsWithLeaks: leaks.length,
      leakedMarkers: [...new Set(leaks.flatMap(l => l.hits))].length, markersChecked: canaries.length },
  };
}
