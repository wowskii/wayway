// Satisfaction metrics (Role 4, ported from planning/wayway-starter/metrics.py). Numbers are for code only,
// never shown to users. Levels: must_go 10, want_to_go 7.5, same 5, lean_not_go 2.5, definitely_no 0.
// weightedTotal uses fairness-credit weights: 1 + 0.1 per credit, max 1.5.
import { LEVEL_VALUE, SETTINGS } from "@/contracts/contract";
import type { MemberScore, OptionMetrics, SatisfactionLevel } from "@/contracts/contract";

export type Balances = Readonly<Record<string, number>>;
export type Scores = ReadonlyMap<string, SatisfactionLevel>;
export const isLevel = (level: unknown): level is SatisfactionLevel =>
  typeof level === "string" && Object.hasOwn(LEVEL_VALUE, level);
export const rankOf = (level: SatisfactionLevel) => LEVEL_VALUE[level] / 2.5;

export function creditWeight(credits: number): number {
  if (!Number.isSafeInteger(credits) || credits < 0) throw new Error("Invalid credit balance");
  return Math.min(1 + credits * SETTINGS.creditWeightStep, SETTINGS.maxWeight);
}

export function ratingMap(
  rows: readonly Pick<MemberScore, "memberId" | "level">[], memberIds: readonly string[],
): Map<string, SatisfactionLevel> {
  const expected = new Set(memberIds);
  if (expected.size !== memberIds.length || !expected.size) throw new Error("Invalid roster");
  const scores = new Map<string, SatisfactionLevel>();
  for (const { memberId, level } of rows) {
    if (!expected.has(memberId) || scores.has(memberId) || !isLevel(level)) {
      throw new Error("Invalid, duplicate or unknown member rating");
    }
    scores.set(memberId, level);
  }
  return scores;
}

export function summarize(scores: Scores, credits: Balances = {}): OptionMetrics | null {
  const levels = [...scores.values()];
  if (!levels.length) return null;
  if (levels.some(level => !isLevel(level))) throw new Error("Invalid rating");
  const values = levels.map(level => LEVEL_VALUE[level]);
  const total = values.reduce((sum, value) => sum + value, 0);
  let distance = 0;
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) distance += Math.abs(values[i] - values[j]);
  }
  let weightedQuarters = 0;
  for (const [id, level] of scores) {
    const balance = Object.hasOwn(credits, id) ? credits[id] : 0;
    // Scores advance in steps of 2.5 and weights in tenths. Compare exact quarter-points.
    weightedQuarters += rankOf(level) * Math.round(10 * creditWeight(balance));
  }
  return {
    mean: total / values.length,
    min: Math.min(...values),
    gini: total ? distance / (values.length * total) : 1,
    satisfactionRatio: values.filter(value => value >= LEVEL_VALUE[SETTINGS.satisfiedLevel]).length / values.length,
    weightedTotal: weightedQuarters / 4,
  };
}

export function rankOptions<T extends { id: string; scores: readonly MemberScore[] }>(
  proposals: readonly T[], memberIds: readonly string[], credits: Balances,
) {
  const rejected: { id: string; reason: string }[] = [];
  const ranked: { option: T; metrics: OptionMetrics; satisfiedMemberIds: string[] }[] = [];
  const counts = new Map<string, number>();
  for (const { id } of proposals) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const option of proposals) {
    try {
      if (!option.id || counts.get(option.id) !== 1) throw new Error("Duplicate or empty proposal ID");
      const scores = ratingMap(option.scores, memberIds);
      if (scores.size !== memberIds.length) throw new Error("Missing member ratings");
      const metrics = summarize(scores, credits);
      if (!metrics) throw new Error("No ratings");
      ranked.push({
        option, metrics, satisfiedMemberIds: memberIds.filter(id =>
          LEVEL_VALUE[scores.get(id)!] >= LEVEL_VALUE[SETTINGS.satisfiedLevel]),
      });
    } catch (error) {
      rejected.push({ id: option.id, reason: (error as Error).message });
    }
  }
  const stable = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const bestTotal = [...ranked].sort((a, b) =>
    b.metrics.weightedTotal - a.metrics.weightedTotal || stable(a.option.id, b.option.id))[0] ?? null;
  const fairest = [...ranked].sort((a, b) =>
    b.metrics.min - a.metrics.min || b.metrics.mean - a.metrics.mean ||
    stable(a.option.id, b.option.id))[0] ?? null;
  return { bestTotal, fairest, rejected };
}
