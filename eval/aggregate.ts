// Mean and range over several evaluation runs (eval/results/*.json from eval/run-ai.ts).
//   npm run eval:aggregate                          every run of the current eval version, grouped by generator
//   npm run eval:aggregate -- --generator wayway-ai --since 2026-11-24
//   npm run eval:aggregate -- eval/results/a.json eval/results/b.json      exact files
// Runs are only pooled when generator, rounds and persona model are the same (otherwise not comparable).
import { readFileSync, readdirSync } from "node:fs";
import { METRICS, addCounts, countsOf, fmt } from "./summary";
import type { Counts, ScenarioResult } from "./summary";

type Run = { evalVersion?: number; generator: string; rounds: number; personaModel?: string; date: string;
  results: ScenarioResult[]; file: string };

const EVAL_VERSION = 2;
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const flagValues = new Set(["--generator", "--since"].map(value));
const explicit = args.filter(a => a.endsWith(".json") && !flagValues.has(a));

const folder = new URL("./results/", import.meta.url);
const files = explicit.length ? explicit : readdirSync(folder).filter(f => f.endsWith(".json")).sort().map(f => new URL(f, folder).pathname);
const runs: Run[] = files.map(file => ({ ...JSON.parse(readFileSync(file, "utf8")), file }))
  .filter(r => explicit.length || r.evalVersion === EVAL_VERSION)
  .filter(r => !value("--generator") || r.generator.includes(value("--generator")!))
  .filter(r => !value("--since") || r.date >= value("--since")!);
if (!runs.length) {
  console.log(`No run found (eval version ${EVAL_VERSION}${value("--generator") ? `, generator ~ ${value("--generator")}` : ""}` +
    `${value("--since") ? `, since ${value("--since")}` : ""}). Run npm run eval:ai first.`);
  process.exit(0);
}

const groups = new Map<string, Run[]>();
for (const run of runs) {
  const key = `${run.generator} · rounds ${run.rounds} · persona model ${run.personaModel ?? "?"}`;
  groups.set(key, [...(groups.get(key) ?? []), run]);
}

/** "68% (60–75%)" = mean over runs, then min–max. */
function cell(kind: string, values: (number | null)[]) {
  const xs = values.filter((x): x is number => x !== null);
  if (!xs.length) return "n/a";
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return xs.length === 1 || lo === hi ? fmt(kind, mean) : `${fmt(kind, mean)} (${fmt(kind, lo)}–${fmt(kind, hi)})`;
}

for (const [key, group] of groups) {
  console.log(`\n## ${key} — ${group.length} run(s)`);
  for (const run of group) console.log(`- ${run.date.slice(0, 19)} · ${run.file.split("/").pop()}`);
  const scenarios = [...new Set(group.flatMap(run => run.results.map(r => r.scenario)))].sort();
  // Per run: counts per scenario, plus all scenarios pooled ("all").
  const perRun = group.map(run => {
    const rows = new Map<string, Counts>(run.results.map(r => [r.scenario, countsOf(r)]));
    rows.set("all", addCounts([...rows.values()]));
    return rows;
  });
  console.log(`\n| Measure | ${[...scenarios, "all"].join(" | ")} |`);
  console.log(`|---|${[...scenarios, "all"].map(() => "---").join("|")}|`);
  for (const m of METRICS) {
    const cells = [...scenarios, "all"].map(s => cell(m.kind, perRun.map(rows => (rows.has(s) ? m.of(rows.get(s)!) : null))));
    console.log(`| ${m.label} | ${cells.join(" | ")} |`);
  }
}
console.log("\nCells: mean over the runs (min–max). Counts are per run; rates pool all observations of a run first.");
