// AI evaluation runner (Role 4, report section 1.4).
// Runs every persona scenario through: hard filter -> options generator -> buildOptions -> (revision round)
// -> scripted persona votes -> decision -> credits -> itinerary, and measures:
//   valid structured responses, constraint violations (proposed / final), AI estimate accuracy
//   against the personas, literal privacy leaks in everything the group sees, decisions and credits.
//
//   npm run eval:ai -- --baseline          rule-based generator built in here (no AI module, no key)
//   npm run eval:ai -- --mock              Kuro's AI module with its fake model (needs feature/ai-module merged)
//   npm run eval:ai                        Kuro's AI module with the real model (needs OPENROUTER_API_KEY)
//   options: --scenario scenario3_split    --rounds 1|2    --json
// Results are saved in eval/results/ (scenario data is synthetic: safe to commit).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { ChatMessage, Option, OptionSet, SatisfactionLevel, Spot, TimeSlot, Trip } from "@/contracts/contract";
import { filterSpotsForTrip } from "@/lib/logic/constraints";
import { EVIDENCE, SPOTS, SPOTS_BY_ID, SPOT_INDEX } from "@/lib/logic/dataset";
import { buildOptions } from "@/lib/logic/options";
import type { CandidateLike } from "@/lib/logic/options";
import { advancePoll, castVote, startPoll } from "@/lib/logic/voting";
import { itineraryFromOption, spentFromItinerary, travelMin } from "@/lib/logic/itinerary";
import { evaluateRun, personaRating, publicCardText } from "@/lib/logic/evaluation";
import type { Observation, Persona } from "@/lib/logic/evaluation";
import type { Balances } from "@/lib/logic/metrics";

type Scenario = {
  id: string; description: string; expected: string[]; trip: Trip; canaries: string[];
  personas: Persona[]; slots: { slot: TimeSlot; chat: ChatMessage[] }[];
};
type Generated = { candidates: CandidateLike[]; attempts: number; rejected?: string[] };
interface Generator {
  name: string;
  generate(trip: Trip, slot: TimeSlot, allowed: Spot[], chat: ChatMessage[]): Promise<Generated>;
  revise?(trip: Trip, slot: TimeSlot, allowed: Spot[], chat: ChatMessage[], previous: Option[], candidate: Option,
    reactions: { memberId: string; optionId: Option["id"]; level: SatisfactionLevel; reason: string }[]): Promise<Generated>;
  message(trip: Trip, slot: TimeSlot, options: Option[], chat: ChatMessage[], favored?: string): Promise<string>;
}

// ------------------------------------------------------------------------------------------------
// Baseline generator: no AI. One route per member's favourite category, estimates all "same".
// It gives the report a floor to compare the LLM against (estimate accuracy, violations).
// ------------------------------------------------------------------------------------------------
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const isMeal = (slot: TimeSlot) => /\b(breakfast|brunch|lunch|dinner|meal)\b/i.test(slot.label);
const baseline: Generator = {
  name: "baseline (rule-based, no AI)",
  async generate(trip, slot, allowed) {
    const length = toMin(slot.end) - toMin(slot.start);
    const pool = allowed.filter(s => (s.category === "food") === isMeal(slot) && s.durationMin <= length);
    const candidates: CandidateLike[] = [];
    const seen = new Set<string>();
    for (const m of trip.members) {
      const want = m.interests.join(" ").toLowerCase();
      const first = pool.find(s => want.includes(s.category) || want.includes(s.area.toLowerCase())) ?? pool[candidates.length];
      if (!first) continue;
      const second = isMeal(slot) ? undefined : pool.find(s => s !== first && s.area === first.area &&
        first.durationMin + travelMin(first, s) + s.durationMin <= length);
      const spots = second ? [first.id, second.id] : [first.id];
      const key = [...spots].sort().join();
      if (seen.has(key)) continue;           // same stops in another order = same route
      seen.add(key);
      candidates.push({ title: spots.map(id => SPOTS_BY_ID[id].name).join(" + "), spots,
        scores: trip.members.map(x => ({ memberId: x.id, level: "same" as const, source: "ai_estimate" as const, reason: "baseline" })),
        explanation: "Baseline route.", assumptions: [] });
    }
    return { candidates, attempts: 1 };
  },
  async message(_trip, slot, options) {
    return `Here are ${options.length} options for ${slot.label}: ${options.map(o => `${o.id}) ${o.title}`).join(", ")}.`;
  },
};

// ------------------------------------------------------------------------------------------------
// Kuro's AI module (wayway-ai/), loaded only if present so this file also works before the merge.
// ------------------------------------------------------------------------------------------------
async function aiModule(mock: boolean): Promise<Generator> {
  const path = "../wayway-ai/lib/ai/index.ts";
  type Out = { candidates: CandidateLike[]; attempts: number; rejected: string[] };
  let ai: {
    setClient(client: unknown): void; generateOptions(input: unknown): Promise<Out>; reviseOptions(input: unknown): Promise<Out>;
    writeMessage(input: unknown): Promise<{ text: string }>; MODELS?: { reasoning?: string }; PROMPT_VERSION?: string;
  };
  try { ai = await import(path); } catch (error) {
    throw new Error(`AI module not found (${(error as Error).message.split("\n")[0]}). Merge feature/ai-module first, or use --baseline.`);
  }
  if (mock) ai.setClient((await import("../wayway-ai/scripts/mock.ts" as string)).mockClient);
  else if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is missing (put it in .env.local), or use --mock / --baseline.");
  return {
    name: mock ? "wayway-ai (mock model)" : `wayway-ai (${ai.MODELS?.reasoning ?? "real model"}, prompt ${ai.PROMPT_VERSION})`,
    async generate(trip, slot, allowedSpots, recentChat) {
      const out = await ai.generateOptions({ trip, slot, allowedSpots, recentChat });
      return { candidates: out.candidates, attempts: out.attempts, rejected: out.rejected };
    },
    async revise(trip, slot, allowedSpots, recentChat, previousOptions, candidate, reactions) {
      const out = await ai.reviseOptions({ trip, slot, allowedSpots, recentChat, previousOptions, candidate, reactions, critiques: [] });
      return { candidates: out.candidates, attempts: out.attempts, rejected: out.rejected };
    },
    async message(trip, slot, options, recentChat, favoredMemberName) {
      const out = await ai.writeMessage({ trip, kind: "options_round", recentChat, favoredMemberName,
        facts: { slot: `${slot.label}, ${slot.start}-${slot.end}`, options: options.map(o => ({ id: o.id, title: o.title })), deadline: "in 30 minutes" } });
      return out.text;
    },
  };
}

// ------------------------------------------------------------------------------------------------
async function runScenario(s: Scenario, gen: Generator, rounds: number) {
  const trip: Trip = structuredClone(s.trip);
  const members = trip.members;
  const persona = new Map(s.personas.map(p => [p.memberId, p]));
  const name = new Map(members.map(m => [m.id, m.name]));
  let credits: Balances = {};
  const itinerary: ReturnType<typeof itineraryFromOption> = [];
  const optionSets: { id: string; round: number; options: Option[] }[] = [];
  const publicPayloads: unknown[] = [];
  const references: Observation[] = [];
  const finalOptions: Option[] = [];
  const decisions: Record<string, unknown>[] = [];
  let total = 0, invalid = 0;
  // Candidates the AI produced that code had to throw away (AI validator + Role 4 hard filter).
  const candidates = { kept: 0, rejectedByAiValidator: 0, droppedByLogic: 0, duplicates: 0 };
  const tally = (g: Generated, built: ReturnType<typeof buildOptions>) => {
    candidates.rejectedByAiValidator += g.rejected?.length ?? 0;
    candidates.duplicates += built.dropped.filter(d => d.reason === "duplicate_route").length;
    candidates.droppedByLogic += built.dropped.filter(d => d.reason !== "duplicate_route").length;
    candidates.kept += built.options.length;
  };

  for (const [index, { slot, chat }] of s.slots.entries()) {
    const label = `${slot.label} ${slot.start}-${slot.end}`;
    const spent = spentFromItinerary(itinerary, members.map(m => m.id), SPOTS_BY_ID);
    const allowed = filterSpotsForTrip(SPOTS, members, { evidence: EVIDENCE, spentByMember: spent }).allowed;
    const rate = (o: Option, memberId: string) => personaRating(o, persona.get(memberId)!, members.find(m => m.id === memberId)!, SPOT_INDEX);
    let options: Option[] = [];
    try {
      const g = await gen.generate(trip, slot, allowed, chat);
      total += g.attempts; invalid += g.attempts - 1;
      const built = buildOptions(g.candidates, members, SPOT_INDEX, credits, { spentByMember: spent });
      tally(g, built);
      options = built.options;
      let setId = `${s.id}-${index + 1}`;
      optionSets.push({ id: setId, round: 1, options });
      for (let round = 2; round <= rounds && gen.revise && options.length; round++) {
        const reactions = options.flatMap(o => members.map(m => ({ memberId: m.id, optionId: o.id, level: rate(o, m.id).level, reason: "persona" })));
        for (const r of reactions) references.push({ tripId: trip.id, optionSetId: setId, round: round - 1, attempt: 1, optionId: r.optionId, memberId: r.memberId, level: r.level });
        const r = await gen.revise(trip, slot, allowed, chat, options, options[0], reactions);
        total += r.attempts; invalid += Math.max(0, r.attempts - 1);
        const kept = options[0] as CandidateLike;
        const rebuilt = buildOptions([kept, ...r.candidates], members, SPOT_INDEX, credits, { spentByMember: spent });
        tally(r, rebuilt);
        options = rebuilt.options;
        setId = `${s.id}-${index + 1}`;
        optionSets.push({ id: setId, round, options });
      }
    } catch (error) {
      decisions.push({ slot: label, error: (error as Error).message });
      continue;
    }
    if (!options.length) { decisions.push({ slot: label, error: "no valid option after the hard filter" }); continue; }
    const finalRound = optionSets.at(-1)!.round;
    const setId = optionSets.at(-1)!.id;
    for (const o of options) for (const m of members) {
      references.push({ tripId: trip.id, optionSetId: setId, round: finalRound, attempt: 1, optionId: o.id, memberId: m.id, level: rate(o, m.id).level });
    }
    const favored = options[0].fairnessNote ? members.find(m => options[0].fairnessNote!.startsWith(m.name))?.name : undefined;
    const text = await gen.message(trip, slot, options, chat, favored);
    publicPayloads.push({ text }, ...options.map(publicCardText));

    // Final vote by the personas.
    const start = Date.parse(`${trip.startDate}T00:00:00Z`) + (slot.day - 1) * 86_400_000;
    const deadline = start + 3_600_000 * 2;
    const set: OptionSet = { id: setId, tripId: trip.id, slot, round: finalRound, options, candidateOptionId: "A",
      status: "voting", roundDeadline: new Date(deadline).toISOString(), voteDeadline: new Date(deadline).toISOString() };
    const guard = { members, spots: SPOT_INDEX, spentByMember: spent };
    let poll = startPoll(set, guard, trip.timezone, credits);
    for (const m of members) {
      if (persona.get(m.id)!.abstains) continue;
      for (const o of options) {
        const r = rate(o, m.id);
        const ballot = { optionSetId: set.id, optionId: o.id, memberId: m.id, level: r.level,
          ...(o.kind === "split" && o.branches!.some(b => b.memberIds.includes(m.id)) ? { acceptsSplit: r.acceptsSplit ?? false } : {}) };
        let cast = castVote(poll, ballot, 1, deadline - 60_000);
        // Daily "definitely_no" limit reached: a real member would pick the next lowest level.
        if (cast.error === "definitely_no_limit") cast = castVote(poll, { ...ballot, level: "lean_not_go" }, 1, deadline - 60_000);
        poll = cast.poll;
      }
    }
    let now = deadline;
    for (let i = 0; i < 4 && poll.outcome === "open"; i++) {
      poll = advancePoll(poll, now, guard);
      now = poll.deadline;
      if (poll.outcome === "open" && poll.optionSet.voteAttempt === 2 && !poll.optionSet.voterIds?.length) {
        // Revote: personas vote the same way again.
        for (const v of poll.votes.filter(v => v.attempt === 1)) poll = castVote(poll, v, 2, now - 60_000).poll;
      }
    }
    const before = credits;
    if (poll.decision) {
      credits = poll.credits;
      const chosen = options.find(o => o.id === poll.decision!.chosenOptionId)!;
      finalOptions.push(chosen);
      itinerary.push(...itineraryFromOption(chosen, slot, SPOTS_BY_ID));
    }
    decisions.push({
      slot: label, options: options.map(o => `${o.id}:${o.kind}:${o.title}`), outcome: poll.outcome,
      winner: poll.decision?.chosenOptionId ?? null, resolvedBy: poll.decision?.resolvedBy ?? null,
      fairnessNote: options[0].fairnessNote ?? null,
      credits: Object.fromEntries(members.map(m => [m.name, `${before[m.id] ?? 0}→${credits[m.id] ?? 0}`])),
      message: text,
    });
  }
  const report = evaluateRun({ trip: s.trip, optionSets, publicPayloads, references, finalOptions,
    invalidResponses: invalid, totalResponses: total, extraCanaries: s.canaries }, SPOT_INDEX);
  return { scenario: s.id, description: s.description, expected: s.expected, report: { ...report, candidates }, decisions,
    itinerary: itinerary.map(i => ({ ...i, branches: i.branches?.map(b => ({ members: b.memberIds.map(id => name.get(id)), spots: b.spots })) })) };
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : `${Math.round(x * 100)}%`);

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const rounds = Number(value("--rounds") ?? 2);
  const gen = args.includes("--baseline") ? baseline : await aiModule(args.includes("--mock"));
  const folder = new URL("./scenarios/personas/", import.meta.url);
  const scenarios: Scenario[] = readdirSync(folder).filter(f => f.endsWith(".json")).sort()
    .map(f => JSON.parse(readFileSync(new URL(f, folder), "utf8")))
    .filter(s => !value("--scenario") || s.id === value("--scenario"));
  const results = [];
  for (const s of scenarios) results.push(await runScenario(s, gen, rounds));
  const run = { generator: gen.name, rounds, date: new Date().toISOString(), results };
  mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
  const file = new URL(`./results/${run.date.slice(0, 16).replace(/[:T]/g, "-")}-${gen.name.split(" ")[0]}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(run, null, 2) + "\n");
  if (args.includes("--json")) return console.log(JSON.stringify(run, null, 2));

  console.log(`Generator: ${gen.name} · rounds: ${rounds}\n`);
  console.log("| Scenario | Valid AI outputs | Candidates thrown away by code | Proposed routes with violations | Final routes with violations | Estimate exact / ±1 level / mean gap | Public texts with leaks | Decisions |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const e = r.report.estimateAccuracy;
    const j = r.report.jsonValidity;
    const decided = r.decisions.filter(d => d.winner).length;
    const c = r.report.candidates;
    console.log(`| ${r.scenario} | ${j ? `${j.valid}/${j.total}` : "n/a"} | ${c.rejectedByAiValidator + c.droppedByLogic} (AI check ${c.rejectedByAiValidator}, hard filter ${c.droppedByLogic}) | ${r.report.proposedRoutes.withViolations}/${r.report.proposedRoutes.checked} | ` +
      `${r.report.finalRoutes.withViolations}/${r.report.finalRoutes.checked} | ${pct(e.exactMatch)} / ${pct(e.withinOneLevel)} / ${e.meanLevelGap?.toFixed(2) ?? "n/a"} (n=${e.n}) | ` +
      `${r.report.privacy.payloadsWithLeaks}/${r.report.privacy.publicPayloads} | ${decided}/${r.decisions.length} |`);
  }
  for (const r of results) {
    console.log(`\n${r.scenario}`);
    for (const d of r.decisions) {
      if (d.error) { console.log(`  ${d.slot}: ERROR ${d.error}`); continue; }
      console.log(`  ${d.slot}: ${(d.options as string[]).join(" | ")}`);
      console.log(`    -> ${d.winner ?? d.outcome} (${d.resolvedBy ?? "-"}) · credits ${Object.entries(d.credits as object).map(([k, v]) => `${k} ${v}`).join(", ")}` +
        (d.fairnessNote ? `\n    fairness note: "${d.fairnessNote}"` : ""));
    }
  }
  console.log(`\nSaved: ${file.pathname}`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
