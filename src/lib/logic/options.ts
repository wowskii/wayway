// Turns the AI's candidates into the option cards A / B / C (replaces tempRank in the AI module).
//
//   LLM (Role 3)            -> candidates with a satisfaction estimate per member
//   buildOptions (Role 4)   -> 1. drop unsafe candidates (checkOption)
//                              2. A = best credit-weighted total (shared route)
//                              3. B = fairest of the OTHER shared routes (highest minimum, then mean)
//                              4. C = split, only if no shared route keeps everyone at "same" or better
//                              5. metrics + satisfiedMemberIds recomputed by code (never trusted from the LLM)
//                              6. a fairness sentence (no numbers) when credits changed which route is A
import { LEVEL_VALUE, SETTINGS } from "@/contracts/contract";
import type { Branch, MemberProfile, MemberScore, Option } from "@/contracts/contract";
import { checkOption, blocks } from "./constraints";
import type { CheckOptions, Issue, SpotIndex } from "./constraints";
import { ratingMap, summarize } from "./metrics";
import type { Balances } from "./metrics";

/** Same shape as `Candidate` in wayway-ai/lib/ai/options.ts (structural, no import needed). */
export interface CandidateLike {
  title: string;
  spots: string[];
  branches?: Branch[];
  rendezvous?: { spotId: string; time: string };
  scores: MemberScore[];
  satisfiedMemberIds?: string[];
  explanation: string;
  assumptions: string[];
  fairnessNote?: string;
}

export type BuildMember = Pick<MemberProfile, "id" | "name" | "hard">;

export interface BuildResult {
  options: Option[];
  candidateOptionId: Option["id"] | null;     // OptionSet.candidateOptionId (highest min, then mean: pickCandidateId)
  dropped: { title: string; issues: Issue[]; reason: string }[];  // server log only
  /** Unverified items (e.g. allergen data missing) to tell ONE member privately. Never public. */
  privateWarnings: { optionId: Option["id"]; memberId: string; spotId?: string; code: string }[];
}

const satisfied = (level: MemberScore["level"]) => LEVEL_VALUE[level] >= LEVEL_VALUE[SETTINGS.satisfiedLevel];

export function buildOptions(
  candidates: readonly CandidateLike[], members: readonly BuildMember[], spots: SpotIndex,
  credits: Balances = {}, opts: CheckOptions = {},
): BuildResult {
  const roster = members.map(member => member.id);
  const dropped: BuildResult["dropped"] = [];
  type Scored = { c: CandidateLike; split: boolean; metrics: NonNullable<ReturnType<typeof summarize>>;
    plain: NonNullable<ReturnType<typeof summarize>>; warnings: Issue[]; order: number };
  const scored: Scored[] = [];

  const seen = new Set<string>();
  candidates.forEach((c, order) => {
    const split = Boolean(c.branches?.length);
    // The same route twice (e.g. a revision round re-proposing the kept candidate) is shown once.
    const signature = split
      ? JSON.stringify([c.branches!.map(b => [[...b.memberIds].sort(), b.spots]).sort(), c.rendezvous])
      : JSON.stringify(c.spots);
    if (seen.has(signature)) return dropped.push({ title: c.title, issues: [], reason: "duplicate_route" });
    seen.add(signature);
    const route = { kind: split ? "split" as const : "best_total" as const, spots: split ? [] : c.spots,
      branches: split ? c.branches : undefined, rendezvous: split ? c.rendezvous : undefined };
    const issues = checkOption(route, members, spots, opts);
    if (blocks(issues, opts.strictEvidence)) return dropped.push({ title: c.title, issues, reason: "hard_constraint" });
    try {
      const ratings = ratingMap(c.scores, roster);
      if (ratings.size !== roster.length) throw new Error("Missing member ratings");
      scored.push({ c, split, metrics: summarize(ratings, credits)!, plain: summarize(ratings)!, warnings: issues, order });
    } catch (error) {
      dropped.push({ title: c.title, issues: [], reason: (error as Error).message });
    }
  });

  const byTotal = (a: Scored, b: Scored) => b.metrics.weightedTotal - a.metrics.weightedTotal ||
    b.metrics.min - a.metrics.min || b.metrics.mean - a.metrics.mean || a.order - b.order;
  const byFairness = (a: Scored, b: Scored) => b.metrics.min - a.metrics.min ||
    b.metrics.mean - a.metrics.mean || b.metrics.weightedTotal - a.metrics.weightedTotal || a.order - b.order;

  const shared = scored.filter(entry => !entry.split);
  const best = [...shared].sort(byTotal)[0];
  const fairest = shared.filter(entry => entry !== best).sort(byFairness)[0];
  const everyoneOk = shared.some(entry => entry.metrics.min >= LEVEL_VALUE[SETTINGS.satisfiedLevel]);
  const split = everyoneOk ? undefined : scored.filter(entry => entry.split).sort(byFairness)[0];

  // Fairness sentence: only when the credits changed which route is A (no numbers, contract rule).
  const unweightedBest = [...shared].sort((a, b) => b.plain.weightedTotal - a.plain.weightedTotal ||
    b.plain.min - a.plain.min || b.plain.mean - a.plain.mean || a.order - b.order)[0];
  let fairnessNote: string | undefined;
  if (best && unweightedBest && best !== unweightedBest) {
    const level = (entry: Scored, id: string) => LEVEL_VALUE[entry.c.scores.find(s => s.memberId === id)!.level];
    const favored = members.filter(member => (credits[member.id] ?? 0) > 0 &&
      level(best, member.id) > level(unweightedBest, member.id)).map(member => member.name);
    if (favored.length) {
      const who = favored.length === 1 ? favored[0] : `${favored.slice(0, -1).join(", ")} and ${favored.at(-1)}`;
      fairnessNote = `${who}'s choice is favored a little this time: they compromised on an earlier decision.`;
    }
  }

  const options: Option[] = [];
  const privateWarnings: BuildResult["privateWarnings"] = [];
  const push = (entry: Scored | undefined, id: Option["id"], kind: Option["kind"], note?: string) => {
    if (!entry) return;
    const { c } = entry;
    options.push({
      id, kind, title: c.title,
      spots: kind === "split" ? [] : [...c.spots],
      ...(kind === "split" ? { branches: c.branches!.map(b => ({ memberIds: [...b.memberIds], spots: [...b.spots] })),
        rendezvous: { ...c.rendezvous! } } : {}),
      scores: c.scores.map(score => ({ ...score })),
      satisfiedMemberIds: roster.filter(memberId => satisfied(c.scores.find(s => s.memberId === memberId)!.level)),
      explanation: c.explanation,
      assumptions: [...c.assumptions],
      ...((note ?? c.fairnessNote) ? { fairnessNote: note ?? c.fairnessNote } : {}),
      metrics: entry.metrics,
    });
    for (const issue of entry.warnings) {
      if (issue.memberId) privateWarnings.push({ optionId: id, memberId: issue.memberId, spotId: issue.spotId, code: issue.code });
    }
  };
  push(best, "A", "best_total", fairnessNote);
  push(fairest, "B", "fairest");
  push(split, "C", "split");
  return { options, candidateOptionId: pickCandidateId(options), dropped, privateWarnings };
}

const plainMin = (o: Pick<Option, "scores" | "metrics">) =>
  o.metrics?.min ?? Math.min(...o.scores.map(s => LEVEL_VALUE[s.level]));
const plainMean = (o: Pick<Option, "scores" | "metrics">) =>
  o.metrics?.mean ?? o.scores.reduce((sum, s) => sum + LEVEL_VALUE[s.level], 0) / o.scores.length;

/**
 * The candidate (kept for the next round, wins a second perfect tie): highest min, then highest mean,
 * then the earlier card (A before B before C). Same rule as `pickCandidate` in the AI module.
 * min/mean ignore credits (credits only change which route is A).
 */
export function pickCandidateId(options: readonly Pick<Option, "id" | "scores" | "metrics">[]): Option["id"] | null {
  let pick: (typeof options)[number] | undefined;
  for (const o of options) {
    if (!pick || plainMin(o) > plainMin(pick) || (plainMin(o) === plainMin(pick) && plainMean(o) > plainMean(pick))) pick = o;
  }
  return pick?.id ?? null;
}
