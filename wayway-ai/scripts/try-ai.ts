// Try the AI pipeline outside the app, on scenario 2.
//   npm run try        -> real LLM calls (needs OPENROUTER_API_KEY in .env)
//   npm run try:mock   -> fake model, tests the validation and retry logic for free
//
// Steps: negotiateSlot (Tom asks, WayWay proposes a time, Mia changes it) ->
// extractPreferences (Sarah, onboarding) -> generateOptions (agreed time) -> temporary ranking
// (placeholder for role 4's rankOptions) -> writeMessage -> extractPreferences (Tom reacts to the
// options) -> reviseOptions (round 2, with real reactions) -> generateOptions (lunch, diet check).

import type { ChatMessage, Option, PrivateMessage, Spot, TimeSlot, Trip } from "@/contracts/contract";
import { LEVEL_VALUE } from "@/contracts/contract";
import {
  extractPreferences, generateOptions, negotiateSlot, reviseOptions, setClient, writeMessage, PROMPT_VERSION,
  type Candidate, type MemberReaction,
} from "../lib/ai";
import { SPOTS, TRIP } from "../data/scenario2";
import { mockClient } from "./mock";

if (process.argv.includes("--mock")) setClient(mockClient);

const [mia, tom, sarah] = TRIP.members;
const now = () => new Date().toISOString();
const chat: ChatMessage[] = [
  { id: "c1", tripId: TRIP.id, senderId: tom.id, text: "Shibuya this afternoon, no discussion 😎", createdAt: now() },
  { id: "c2", tripId: TRIP.id, senderId: mia.id, text: "Hmm I'd love to see the National Museum...", createdAt: now() },
  { id: "c3", tripId: TRIP.id, senderId: sarah.id, text: "anything is fine for me", createdAt: now() },
  { id: "c4", tripId: TRIP.id, senderId: tom.id, text: "@WayWay what should we do this afternoon?", createdAt: now() },
];

// TEMPORARY hard-constraint filter until role 4 delivers filterHardConstraints.
// Same rule as planning/wayway-starter/metrics.py: a food spot must carry every member's diet tag.
// (No allergens field in Spot yet; budget vs prices is still an open rule.)
function tempFilterHardConstraints(spots: Spot[], trip: Trip): Spot[] {
  const diets = [...new Set(trip.members.flatMap((m) => m.hard.diet))];
  return spots.filter((s) => s.category !== "food" || diets.every((d) => s.dietTags.includes(d)));
}

// TEMPORARY ranking until role 4 delivers rankOptions (no fairness credits here).
function tempRank(cands: Candidate[]): Option[] {
  const vals = (c: Candidate) => c.scores.map((s) => LEVEL_VALUE[s.level]);
  const total = (c: Candidate) => vals(c).reduce((a, b) => a + b, 0);
  const min = (c: Candidate) => Math.min(...vals(c));
  const together = cands.filter((c) => !c.branches);
  const best = [...together].sort((a, b) => total(b) - total(a))[0];
  // B = fairest among the OTHER candidates (highest minimum, then highest total). When A is also the
  // fairest overall, this still shows a second card (the team's suggested answer to the open question).
  const fairest = together.filter((c) => c !== best).sort((a, b) => min(b) - min(a) || total(b) - total(a))[0];
  const bestMin = Math.max(...together.map(min));
  // Split only when no shared option keeps everyone at "same" or better
  const split = bestMin < LEVEL_VALUE.same ? cands.find((c) => c.branches) : undefined;
  const out: Option[] = [];
  const push = (c: Candidate | undefined, id: Option["id"], kind: Option["kind"]) => {
    if (c) out.push({ ...c, id, kind, metrics: { mean: total(c) / c.scores.length, min: min(c), gini: 0, satisfactionRatio: c.satisfiedMemberIds.length / c.scores.length, weightedTotal: total(c) } });
  };
  push(best, "A", "best_total");
  push(fairest, "B", "fairest");
  push(split, "C", "split");
  return out;
}

function show(options: Option[]) {
  const names = new Map(TRIP.members.map((m) => [m.id, m.name]));
  for (const o of options) {
    const where = o.branches
      ? o.branches.map((b) => `${b.memberIds.map((id) => names.get(id)).join("+")}: ${b.spots.join(" > ")}`).join(" | ") + ` → meet ${o.rendezvous?.spotId} ${o.rendezvous?.time}`
      : o.spots.join(" > ");
    console.log(`  ${o.id} (${o.kind}) ${o.title}\n     ${where}`);
    console.log(`     ${o.scores.map((s) => `${names.get(s.memberId)}=${s.level}`).join(", ")}  | min ${o.metrics?.min}, mean ${o.metrics?.mean.toFixed(2)}`);
    console.log(`     "${o.explanation}"`);
  }
}

const privateMsg = (memberId: string, text: string, round: number): PrivateMessage =>
  ({ id: `p-${memberId}-${round}`, tripId: TRIP.id, memberId, sender: "member", round, createdAt: now(), text });

async function main() {
  console.log(`Prompt version: ${PROMPT_VERSION}`);
  const allowed = tempFilterHardConstraints(SPOTS, TRIP);
  console.log(`${allowed.length}/${SPOTS.length} spots left after the temporary hard-constraint filter`);

  // Day 1 of the trip, 10:00 in Tokyo (fixed so the test does not depend on today's date)
  const tripNow = new Date("2026-11-21T01:00:00Z");
  console.log("\n0) negotiateSlot — agree on the time before proposing options");
  const ask = chat[chat.length - 1];
  const proposal = await negotiateSlot({ trip: TRIP, message: ask, recentChat: chat, decided: [], now: tripNow });
  console.log(`   ${tom.name}: ${ask.text}`);
  console.log(`   -> ${proposal.action}`, proposal.slot ?? "", `\n   WayWay: ${proposal.reply ?? "(no message)"}`);
  // A message without @WayWay never reaches the model, even while a time is pending.
  const chatter: ChatMessage = { id: "c5a", tripId: TRIP.id, senderId: tom.id, text: "ok whatever", createdAt: now() };
  chat.push(chatter);
  const ignored = await negotiateSlot({ trip: TRIP, message: chatter, recentChat: chat, pending: proposal.slot, decided: [], now: tripNow });
  console.log(`   ${tom.name}: ${chatter.text}\n   -> ${ignored.action} (no @WayWay: no model call)`);
  const answer: ChatMessage = { id: "c5", tripId: TRIP.id, senderId: mia.id, text: "@WayWay plutôt 15h-18h pour moi", createdAt: now() };
  chat.push(answer);
  const agreed = await negotiateSlot({ trip: TRIP, message: answer, recentChat: chat, pending: proposal.slot, decided: [], now: tripNow });
  console.log(`   ${mia.name}: ${answer.text}`);
  console.log(`   -> ${agreed.action}`, agreed.slot ?? "");
  const SLOT = agreed.slot ?? proposal.slot;
  if (!SLOT || !["confirm", "change"].includes(agreed.action)) throw new Error("No agreed time slot, stopping here.");

  console.log("\n1) extractPreferences — Sarah's private message (onboarding)");
  const ex = await extractPreferences({
    member: sarah, history: [], round: 0,
    message: privateMsg(sarah.id, "Honestly I'd prefer the museum, and I can't spend much today. Also I'm allergic to nuts.", 0),
  });
  console.log("   statements:", ex.preferenceUpdate.statements);
  console.log("   to confirm:", ex.preferenceUpdate.hardConstraintsToConfirm ?? "none");
  console.log("   reply:", ex.reply);
  sarah.preferenceStatements = ex.preferenceUpdate.statements;

  console.log(`\n2) generateOptions — round 1 (${SLOT.label}, ${SLOT.start}-${SLOT.end})`);
  const gen = await generateOptions({ trip: TRIP, slot: SLOT, allowedSpots: allowed, recentChat: chat });
  console.log(`   ${gen.candidates.length} valid candidates after ${gen.attempts} attempt(s)`);
  if (gen.rejected.length) console.log("   rejected:", gen.rejected);
  const options = tempRank(gen.candidates);
  show(options);

  console.log("\n3) writeMessage — options_round");
  const m = await writeMessage({
    trip: TRIP, kind: "options_round", recentChat: chat,
    facts: { slot: `${SLOT.label}, ${SLOT.start}-${SLOT.end}`, options: options.map((o) => ({ id: o.id, title: o.title })), deadline: "in 30 minutes" },
  });
  console.log("   WayWay:", m.text);

  console.log("\n4) extractPreferences — Tom reacts privately to the options");
  const tomEx = await extractPreferences({
    member: tom, history: [], round: 1, currentOptions: options,
    message: privateMsg(tom.id, "A is ok I guess but way too much museum. B is boring. I really want real shopping time.", 1),
  });
  console.log("   reactions:", tomEx.preferenceUpdate.reactions ?? "none");
  console.log("   reply:", tomEx.reply);
  tom.preferenceStatements = tomEx.preferenceUpdate.statements;
  const reactions: MemberReaction[] = (tomEx.preferenceUpdate.reactions ?? []).map((r) => ({ memberId: tom.id, ...r }));

  const candidate = options.find((o) => o.kind === "fairest") ?? options[0];
  console.log(`\n5) reviseOptions — round 2 (candidate ${candidate.id} kept by code)`);
  const rev = await reviseOptions({
    trip: TRIP, slot: SLOT, allowedSpots: allowed, recentChat: chat,
    previousOptions: options, candidate, reactions,
    critiques: [{ optionSetId: "os1", optionId: candidate.id, memberId: tom.id, level: "lean_not_go", critique: "Too much museum, not enough shopping" }],
  });
  console.log(`   ${rev.candidates.length} new candidate(s)`);
  if (rev.rejected.length) console.log("   rejected:", rev.rejected);
  show(tempRank([candidate, ...rev.candidates]));

  console.log("\n6) generateOptions — lunch (meal slot: one food spot, vegetarian for Mia)");
  const lunch: TimeSlot = { day: 2, start: "12:00", end: "13:30", label: "Lunch, day 2" };
  const lunchGen = await generateOptions({ trip: TRIP, slot: lunch, allowedSpots: allowed, recentChat: [] });
  console.log(`   ${lunchGen.candidates.length} valid candidates after ${lunchGen.attempts} attempt(s)`);
  if (lunchGen.rejected.length) console.log("   rejected:", lunchGen.rejected);
  show(tempRank(lunchGen.candidates));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
