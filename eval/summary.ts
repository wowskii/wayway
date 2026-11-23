// Numbers of one scenario result (eval/run-ai.ts), as raw counts so several scenarios or several runs can be
// pooled before turning them into rates. Used by run-ai.ts (table after a run) and aggregate.ts (3 runs).

type Accuracy = { n: number; exactMatch: number | null; withinOneLevel: number | null; meanLevelGap: number | null };
export interface ScenarioResult {
  scenario: string;
  report: {
    jsonValidity: { valid: number; total: number } | null;
    aiErrors?: { caughtByAiCheck: { total: number; byKind: Record<string, number> };
      caughtByRole4: { total: number; byCode: Record<string, number> }; duplicateRoutes: number };
    shownRoutes?: { checked: number; withViolations: number };
    finalRoutes: { checked: number; withViolations: number };
    estimateAccuracy: Accuracy & { round1?: Accuracy; laterRounds?: Accuracy };
    privacy: { publicPayloads: number; payloadsWithLeaks: number };
  };
  decisions: Record<string, unknown>[];
}

export type Counts = Record<(typeof COUNT_KEYS)[number], number>;
const COUNT_KEYS = [
  "validOutputs", "aiOutputs", "caughtByAiCheck", "caughtByRole4", "unsafeShown", "shown", "finalViolations", "final",
  "exact1", "n1", "exactLater", "nLater", "within1", "n", "gapSum", "leaks", "payloads", "decided", "slots", "ties",
  "creditChanges",
] as const;

const times = (rate: number | null | undefined, n: number) => Math.round((rate ?? 0) * n);

export function countsOf(r: ScenarioResult): Counts {
  const e = r.report.estimateAccuracy;
  const ok = r.decisions.filter(d => !d.error);
  return {
    validOutputs: r.report.jsonValidity?.valid ?? 0, aiOutputs: r.report.jsonValidity?.total ?? 0,
    caughtByAiCheck: r.report.aiErrors?.caughtByAiCheck.total ?? 0,
    caughtByRole4: r.report.aiErrors?.caughtByRole4.total ?? 0,
    unsafeShown: r.report.shownRoutes?.withViolations ?? 0, shown: r.report.shownRoutes?.checked ?? 0,
    finalViolations: r.report.finalRoutes.withViolations, final: r.report.finalRoutes.checked,
    exact1: times(e.round1?.exactMatch, e.round1?.n ?? 0), n1: e.round1?.n ?? 0,
    exactLater: times(e.laterRounds?.exactMatch, e.laterRounds?.n ?? 0), nLater: e.laterRounds?.n ?? 0,
    within1: times(e.withinOneLevel, e.n), n: e.n, gapSum: (e.meanLevelGap ?? 0) * e.n,
    leaks: r.report.privacy.payloadsWithLeaks, payloads: r.report.privacy.publicPayloads,
    decided: ok.filter(d => d.winner).length, slots: r.decisions.length,
    ties: ok.filter(d => d.resolvedBy === "tie_candidate").length,
    creditChanges: ok.reduce((sum, d) => sum + Object.values((d.credits ?? {}) as Record<string, string>)
      .filter(v => v.split("→")[0] !== v.split("→")[1]).length, 0),
  };
}

export function addCounts(rows: readonly Counts[]): Counts {
  const out = Object.fromEntries(COUNT_KEYS.map(k => [k, 0])) as Counts;
  for (const row of rows) for (const k of COUNT_KEYS) out[k] += row[k];
  return out;
}

const ratio = (a: number, b: number) => (b ? a / b : null);

/** The numbers the report shows (rates are 0-1, null when nothing was measured). */
export const METRICS = [
  { key: "valid", label: "Valid AI outputs", kind: "rate", of: (c: Counts) => ratio(c.validOutputs, c.aiOutputs) },
  { key: "caught", label: "AI errors caught by code (AI check + Role 4)", kind: "count", of: (c: Counts) => c.caughtByAiCheck + c.caughtByRole4 },
  { key: "unsafe", label: "Unsafe routes shown to the group", kind: "count", of: (c: Counts) => c.unsafeShown },
  { key: "finalViol", label: "Decided routes with violations", kind: "count", of: (c: Counts) => c.finalViolations },
  { key: "exact1", label: "Estimate exact, round 1 (cold)", kind: "rate", of: (c: Counts) => ratio(c.exact1, c.n1) },
  { key: "exactLater", label: "Estimate exact, round 2+ (after reactions)", kind: "rate", of: (c: Counts) => ratio(c.exactLater, c.nLater) },
  { key: "within1", label: "Estimate within ±1 level (all rounds)", kind: "rate", of: (c: Counts) => ratio(c.within1, c.n) },
  { key: "gap", label: "Mean gap in levels (0-4)", kind: "number", of: (c: Counts) => ratio(c.gapSum, c.n) },
  { key: "leaks", label: "Public texts with literal leaks", kind: "count", of: (c: Counts) => c.leaks },
  { key: "ties", label: "Decisions settled by the candidate after a tie", kind: "count", of: (c: Counts) => c.ties },
  { key: "credits", label: "Credit balance changes", kind: "count", of: (c: Counts) => c.creditChanges },
] as const;

export const fmt = (kind: string, x: number | null | undefined) =>
  x === null || x === undefined ? "n/a" : kind === "rate" ? `${Math.round(x * 100)}%` : kind === "number" ? x.toFixed(2) : String(Math.round(x * 10) / 10);

/** "4 (closed 2, too_late 2)" */
export const breakdown = (counts: Record<string, number> | undefined) =>
  Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
