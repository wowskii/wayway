// generateOptions (round 1) and reviseOptions (rounds 2-3).
// The LLM proposes candidates with a satisfaction estimate per member.
// Our code validates them; role 4's rankOptions then picks A (best weighted total),
// B (fairest) and C (split) and computes the metrics.

import type { Branch, MemberScore, Option, Spot, TimeSlot, Trip, Vote, ChatMessage } from "@/contracts/contract";
import { LEVEL_VALUE } from "@/contracts/contract";
import { LIMITS, MAX_TOKENS, MODELS, TEMPERATURE } from "./config";
import {
  buildAliases, findLeaks, formatChat, formatCritiques, formatEstimatesVsReactions, formatMembers, formatOptions,
  formatSpots, hhmm, isOpenDuring, isSatisfied, maxStops, privateTokens, selectSpots, slotKind, slotMinutes, toMin, travelMin,
  type Aliases, type MemberReaction, type PrivateGroups, type SlotKind,
} from "./context";
import { AIOutputError, callTool, type Validation } from "./llm";
import { OPTIONS_SYSTEM, optionsUser } from "./prompts";
import { LEVEL_SET, OPTIONS_SCHEMA } from "./schemas";

// A validated candidate, before role 4 ranks it into an Option (id + kind + metrics).
export interface Candidate {
  title: string;
  spots: string[];
  branches?: Branch[];
  rendezvous?: { spotId: string; time: string };
  scores: MemberScore[];             // source: "ai_estimate"
  satisfiedMemberIds: string[];
  explanation: string;
  assumptions: string[];
}

export interface GenerateInput {
  trip: Trip;
  slot: TimeSlot;
  allowedSpots: Spot[];              // AFTER filterHardConstraints (role 4)
  recentChat: ChatMessage[];
}

export interface ReviseInput extends GenerateInput {
  previousOptions: Option[];
  candidate: Option;                 // pickCandidate(previousOptions): kept by code with the previous best_total
  reactions: MemberReaction[];       // private reactions of this round (PreferenceUpdate.reactions + memberId)
  critiques: Vote[];                 // votes carrying a critique
}

export interface OptionsOutput {
  candidates: Candidate[];
  kept: Option[];                    // reviseOptions: previous options carried over by code (candidate + previous best_total;
                                     // all previous options if the revision failed)
  reasoning: string;                 // kept for debugging and the report, never shown
  attempts: number;
  rejected: string[];                // why some candidates were dropped (logged)
}

// ---------- Round-to-round selection (code decides, not the label) ----------
const optMin = (o: Option) => o.metrics?.min ?? Math.min(...o.scores.map((s) => LEVEL_VALUE[s.level]));
const optMean = (o: Option) => o.metrics?.mean ?? o.scores.reduce((a, s) => a + LEVEL_VALUE[s.level], 0) / o.scores.length;

// The candidate kept for the next round: highest min, then highest mean. Never chosen by its kind label.
export function pickCandidate(options: Option[]): Option {
  if (!options.length) throw new Error("pickCandidate: no options");
  return [...options].sort((a, b) => optMin(b) - optMin(a) || optMean(b) - optMean(a))[0];
}

// Options carried over to the next round: the candidate, plus the previous best_total if different,
// so a round never loses its best option. The next ranking runs on [...kept, ...new candidates].
export function keptOptions(previous: Option[], candidate: Option): Option[] {
  const best = previous.find((o) => o.kind === "best_total");
  return best && best.id !== candidate.id ? [candidate, best] : [candidate];
}

const signature = (c: { spots: string[]; branches?: Branch[] }) => JSON.stringify(c.branches ?? c.spots);

// ---------- Validation ----------
interface Ctx {
  trip: Trip;
  aliases: Aliases;
  spots: Map<string, Spot>;
  slot: TimeSlot;
  kind: SlotKind;
  minSatisfied: number;              // 0 in round 1
  leakTokens: PrivateGroups;
  keptSignatures: Set<string>;       // options already carried over by code (revision only)
  keptHasSplit: boolean;             // a kept option is already a split (revision only)
}

// Visits happen in order from `start`, with travel time between spots (travelMin) and, if given,
// travel to a final spot (the rendezvous). Checks: known spots, open during each visit, meal rule
// (exactly one food spot), diet of the path's members, and arrival by `limit` (+ slack).
function checkPath(
  ids: string[], start: number, limit: number, ctx: Ctx, tag: string, what: string,
  members: string[], finalSpot?: Spot,
): string[] {
  const errors: string[] = [];
  if (ctx.kind === "meal" && ids.length !== 1) errors.push(`${tag}: ${what} must be exactly one food spot (meal slot).`);
  const diets = ctx.trip.members
    .filter((m) => members.includes(ctx.aliases.toAlias.get(m.id)!))
    .flatMap((m) => m.hard.diet);
  let t = start;
  let prev: Spot | undefined;
  for (const id of ids) {
    const spot = ctx.spots.get(id);
    if (!spot) {
      errors.push(`${tag}: unknown spot id "${id}" (use only <allowed_spots>).`);
      continue;
    }
    if (prev) t += travelMin(prev, spot);
    if (!isOpenDuring(spot, t, t + spot.durationMin)) {
      errors.push(`${tag}: "${id}" is closed during its visit (${hhmm(t)}-${hhmm(t + spot.durationMin)}, open ${spot.openHours}). Reorder or replace it.`);
    }
    if (spot.category === "food") {
      const missing = diets.filter((d) => !spot.dietTags.includes(d));
      if (missing.length) errors.push(`${tag}: "${id}" does not fit the diet (${[...new Set(missing)].join(", ")}) of someone in ${what}.`);
    }
    t += spot.durationMin;
    prev = spot;
  }
  if (finalSpot && prev) t += travelMin(prev, finalSpot);
  if (t > limit + LIMITS.slotSlackMin) {
    errors.push(`${tag}: ${what} ends at ${hhmm(t)} including travel, too late (limit ${hhmm(limit)}). Use closer spots or fewer.`);
  }
  return errors;
}

function checkCandidate(c: any, i: number, ctx: Ctx): { candidate?: Candidate; errors: string[] } {
  const errors: string[] = [];
  const tag = `Candidate ${i + 1}`;
  const all = [...ctx.aliases.toId.keys()];
  const slotStart = toMin(ctx.slot.start);
  const slotEnd = toMin(ctx.slot.end);
  const scores: any[] = Array.isArray(c?.scores) ? c.scores : [];

  if (typeof c?.title !== "string" || !c.title.trim()) errors.push(`${tag}: missing title.`);
  if (typeof c?.explanation !== "string" || !c.explanation.trim()) errors.push(`${tag}: missing explanation (one sentence on the trade-off).`);
  const isSplit = Array.isArray(c?.branches) && c.branches.length > 0;
  const spots: string[] = Array.isArray(c?.spots) ? c.spots : [];

  let branches: Branch[] | undefined;
  let rendezvous: Candidate["rendezvous"];
  if (isSplit) {
    if (c.branches.length !== 2) errors.push(`${tag}: a split needs exactly 2 branches.`);

    // Members: every member in exactly one branch, no unknown alias.
    const seen: string[] = [];
    for (const b of c.branches) {
      const members: unknown[] = Array.isArray(b?.members) ? b.members : [];
      for (const m of members) {
        if (typeof m !== "string" || !ctx.aliases.toId.has(m)) errors.push(`${tag}: unknown member "${m}" in a branch.`);
        else seen.push(m);
      }
      if (!members.length) errors.push(`${tag}: each branch needs at least one member.`);
      // Nobody alone unless they want it: a lone member must want this branch.
      if (members.length === 1 && all.length > 1) {
        const level = scores.find((s) => s?.member === members[0])?.level;
        if (level !== "must_go" && level !== "want_to_go") {
          errors.push(`${tag}: ${members[0]} would be alone in a branch without wanting it (needs want_to_go or must_go).`);
        }
      }
      if (!Array.isArray(b?.spots) || !b.spots.length) errors.push(`${tag}: each branch needs at least one spot.`);
    }
    const missing = all.filter((m) => !seen.includes(m));
    const dup = seen.filter((m, k) => seen.indexOf(m) !== k);
    if (missing.length) errors.push(`${tag}: members missing from branches: ${missing.join(", ")}.`);
    if (dup.length) errors.push(`${tag}: members in both branches: ${[...new Set(dup)].join(", ")}.`);

    // Rendezvous: a known spot, open at a time inside the slot; each branch must end before it.
    const rv = c.rendezvous;
    const rvSpot = rv?.spot ? ctx.spots.get(rv.spot) : undefined;
    if (!rvSpot) errors.push(`${tag}: a split needs a rendezvous spot from <allowed_spots>.`);
    else if (!/^\d{2}:\d{2}$/.test(rv.time ?? "") || toMin(rv.time) < slotStart || toMin(rv.time) > slotEnd) {
      errors.push(`${tag}: rendezvous time must be HH:MM inside the slot ${ctx.slot.start}-${ctx.slot.end}.`);
    } else {
      const at = toMin(rv.time);
      if (!isOpenDuring(rvSpot, at, Math.min(at + 15, slotEnd))) {
        errors.push(`${tag}: rendezvous spot "${rv.spot}" is closed at ${rv.time} (open ${rvSpot.openHours}).`);
      }
      c.branches.forEach((b: any, k: number) => {
        const members = Array.isArray(b?.members) ? b.members : [];
        errors.push(...checkPath(b?.spots ?? [], slotStart, at, ctx, tag, `branch ${k + 1}`, members, rvSpot));
      });
      rendezvous = { spotId: rv.spot, time: rv.time };
    }
    branches = (c.branches ?? []).map((b: any) => ({
      memberIds: (b?.members ?? []).map((m: string) => ctx.aliases.toId.get(m) ?? m),
      spots: b?.spots ?? [],
    }));
  } else {
    if (!spots.length) errors.push(`${tag}: needs at least one spot.`);
    errors.push(...checkPath(spots, slotStart, slotEnd, ctx, tag, "the path", all));
  }

  // One valid score per member
  for (const m of all) {
    const n = scores.filter((s) => s?.member === m).length;
    if (n !== 1) errors.push(`${tag}: member ${m} needs exactly one score (found ${n}).`);
  }
  for (const s of scores) {
    if (!LEVEL_SET.has(s?.level)) errors.push(`${tag}: invalid level "${s?.level}".`);
    if (!ctx.aliases.toId.has(s?.member)) errors.push(`${tag}: unknown member "${s?.member}".`);
  }

  // Privacy: nothing from private notes or private statements in group-visible text
  const visible = [c?.title, c?.explanation, ...(Array.isArray(c?.assumptions) ? c.assumptions : []), ...scores.map((s) => s?.reason)].join(" ");
  const leaks = findLeaks(visible, ctx.leakTokens);
  if (leaks.length) errors.push(`${tag}: group-visible text reveals private information (${leaks.join(", ")}). Rewrite neutrally.`);

  if (errors.length) return { errors };

  const memberScores: MemberScore[] = scores.map((s) => ({
    memberId: ctx.aliases.toId.get(s.member)!,
    level: s.level,
    source: "ai_estimate",
    reason: String(s.reason ?? ""),
  }));
  const satisfiedMemberIds = memberScores.filter((s) => isSatisfied(s.level)).map((s) => s.memberId);

  // Revision rule (Papachristou et al.): satisfy at least as many members as the candidate
  if (satisfiedMemberIds.length < ctx.minSatisfied) {
    return { errors: [`${tag}: satisfies ${satisfiedMemberIds.length} members, needs at least ${ctx.minSatisfied}.`] };
  }

  return {
    errors: [],
    candidate: {
      title: c.title.trim(),
      spots: isSplit ? [] : spots,
      ...(isSplit ? { branches, rendezvous } : {}),
      scores: memberScores,
      satisfiedMemberIds,
      explanation: c.explanation.trim(),
      assumptions: Array.isArray(c.assumptions) ? c.assumptions.map(String) : [],
    },
  };
}

// A split is worth proposing when no shared candidate keeps everyone at "same" or better
// (activity slots, 3+ members). Required on the FIRST attempt only: if the retry still has no
// split, the shared options are accepted (better some options than none).
const SAME = LEVEL_VALUE.same;
function needsSplit(valid: Candidate[], ctx: Ctx): boolean {
  if (ctx.kind !== "activity" || ctx.trip.members.length < 3 || ctx.keptHasSplit) return false;
  if (valid.some((c) => c.branches)) return false;
  return valid.length > 0 && !valid.some((c) => c.scores.every((s) => LEVEL_VALUE[s.level] >= SAME));
}

function makeValidator(ctx: Ctx, minCandidates: number, rejected: string[]) {
  let calls = 0;
  return (raw: any): Validation<{ candidates: Candidate[]; reasoning: string }> => {
    calls++;
    if (!Array.isArray(raw?.candidates)) return { ok: false, errors: ["candidates must be an array."] };
    const valid: Candidate[] = [];
    const errors: string[] = [];
    const signatures = new Set<string>();
    raw.candidates.slice(0, LIMITS.maxCandidates).forEach((c: any, i: number) => {
      const r = checkCandidate(c, i, ctx);
      if (!r.candidate) return errors.push(...r.errors);
      const sig = signature(r.candidate);
      if (signatures.has(sig)) return errors.push(`Candidate ${i + 1}: duplicate of another candidate.`);
      if (ctx.keptSignatures.has(sig)) return errors.push(`Candidate ${i + 1}: repeats an option our code already keeps.`);
      signatures.add(sig);
      valid.push(r.candidate);
    });
    rejected.push(...errors);
    if (valid.length < minCandidates) {
      return { ok: false, errors: [`Only ${valid.length} valid candidates, need at least ${minCandidates}.`, ...errors] };
    }
    if (calls === 1 && needsSplit(valid, ctx)) {
      return { ok: false, errors: [
        "No shared candidate keeps every member at 'same' or better, and there is no split. Keep your valid candidates " +
        "and ADD one split candidate: 2 branches grouped by interest, a rendezvous spot open inside the slot, nobody alone unless they want it.",
        ...errors,
      ] };
    }
    return { ok: true, value: { candidates: valid, reasoning: String(raw.reasoning ?? "") } };
  };
}

// ---------- Shared core ----------
async function run(input: GenerateInput, revise?: ReviseInput): Promise<OptionsOutput> {
  const { trip, slot, recentChat } = input;
  const aliases = buildAliases(trip.members);
  const spots = selectSpots(input.allowedSpots, slot);           // context selection
  const minSatisfied = revise ? revise.candidate.satisfiedMemberIds.length : 0;
  const kind = slotKind(slot);
  const kept = revise ? keptOptions(revise.previousOptions, revise.candidate) : [];
  const ctx: Ctx = {
    trip, aliases, slot, kind, minSatisfied,
    keptSignatures: new Set(kept.map(signature)),
    keptHasSplit: kept.some((o) => Boolean(o.branches?.length)),
    spots: new Map(spots.map((s) => [s.id, s])),
    leakTokens: privateTokens(trip, input.allowedSpots, {
      critiques: (revise?.critiques ?? []).map((v) => v.critique ?? ""),
      reactionReasons: (revise?.reactions ?? []).map((r) => r.reason),
    }),
  };
  const rejected: string[] = [];

  const res = await callTool({
    model: MODELS.reasoning,
    temperature: TEMPERATURE.options,
    maxTokens: MAX_TOKENS.options,
    system: OPTIONS_SYSTEM,
    user: optionsUser({
      tripName: trip.name,
      goal: trip.goal,
      slot: `${slot.label}: day ${slot.day}, ${slot.start}-${slot.end} (${slotMinutes(slot)} min), type: ${kind}, ` +
        `about ${maxStops(spots, slot)} stop(s) per path at most`,
      members: formatMembers(trip, aliases, true),
      spots: formatSpots(spots, slot),
      chat: formatChat(recentChat, trip),
      ...(revise ? {
        previous: formatOptions(revise.previousOptions, aliases),
        candidate: kept.map((o) => `Option ${o.id}: ${o.title}`).join("; "),
        reactions: formatEstimatesVsReactions(revise.previousOptions, revise.reactions, aliases),
        critiques: formatCritiques(revise.critiques, aliases),
        minSatisfied,
      } : {}),
    }),
    tool: { name: "propose_options", description: "Propose candidate options for this slot.", schema: OPTIONS_SCHEMA },
    validate: makeValidator(ctx, revise ? 1 : LIMITS.minCandidates, rejected),
  });
  return { ...res.value, kept, attempts: res.attempts, rejected };
}

export async function generateOptions(input: GenerateInput): Promise<OptionsOutput> {
  // No fallback here: this throws AIOutputError (e.kind tells why), the route posts
  // a neutral message and the group can retry.
  return run(input);
}

export async function reviseOptions(input: ReviseInput): Promise<OptionsOutput> {
  try {
    return await run(input, input);
  } catch (e) {
    if (!(e instanceof AIOutputError)) throw e;   // only our own programming errors get through
    console.warn(`[reviseOptions] fallback (${e.kind}):`, e.errors);
    // Fallback: no better candidate found, keep ALL the previous options. keptOptions() alone could
    // leave a single option (when the candidate is also best_total) and nothing to vote between.
    return { candidates: [], kept: input.previousOptions, reasoning: "", attempts: LIMITS.maxRetries + 1, rejected: e.errors };
  }
}
