// Smoke test of the whole AI flow WITHOUT a database (about 15 AI calls, ~1-2 min).
// Calls the app's own AI switches (src/lib/ai/*) in real mode with inputs shaped like the API services
// build them, then runs the Role 4 logic on the answers, like the routes do:
//   interview (3 turns) -> @WayWay negotiate -> generateOptions -> buildOptions -> group message
//   -> private feedback (2 members) -> reactions saved/reloaded as JSON -> reviseOptions -> buildOptions
//   -> group message -> startPoll -> castVote -> advancePoll -> itinerary -> decision message
// Not covered: the database, RLS, timers, the UI (needs a local Supabase).
//
//   npm run smoke:ai                   real AI (OPENROUTER_API_KEY in .env.local), stops above 40 calls
//   npm run smoke:ai -- --fake-llm     Simon's fake LLM: no network, no cost
import type { ChatMessage, MemberProfile, Option, OptionSet, PrivateMessage, TimeSlot, Trip } from "@/contracts/contract";
import { LEVEL_VALUE } from "@/contracts/contract";
import { getFeedbackHandler } from "@/lib/ai/feedback";
import { getInterviewer } from "@/lib/ai/interviewer";
import { getRoundAI } from "@/lib/ai/rounds";
import type { InterviewTopic } from "@/lib/ai/types";
import { getWayWayAI } from "@/lib/ai/wayway";
import { advancePoll, buildOptions, castVote, filterSpotsForTrip, itineraryFromOption, startPoll } from "@/lib/logic";
import { EVIDENCE, SPOT_INDEX, SPOTS, SPOTS_BY_ID } from "@/lib/logic/dataset";
import { AIOutputError, pickCandidate, setClient, type MemberReaction, type OptionsOutput } from "../wayway-ai/lib/ai";
import { TRIP as BASE } from "../wayway-ai/data/scenario2";
import { mockClient } from "../wayway-ai/scripts/mock";

const FAKE = process.argv.includes("--fake-llm");
const MAX_CALLS = 40;
process.env.WAYWAY_AI_MODE = "real";   // the switches read it at call time
if (FAKE) setClient(mockClient);

// ---- Cost guard: count OpenRouter calls and tokens, stop above MAX_CALLS ----
let calls = 0, tokIn = 0, tokOut = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
  if (!String(url).includes("openrouter")) return realFetch(url, init);
  if (++calls > MAX_CALLS) throw new Error(`Cost guard: more than ${MAX_CALLS} AI calls, stopping.`);
  const res = await realFetch(url, init);
  try {
    const j = await res.clone().json();
    tokIn += j.usage?.prompt_tokens ?? 0;
    tokOut += j.usage?.completion_tokens ?? 0;
  } catch { /* not JSON: counted as a call only */ }
  return res;
}) as typeof fetch;

const results: { step: string; ok: boolean; note: string }[] = [];
const check = (step: string, ok: boolean, note = "") => {
  results.push({ step, ok, note });
  console.log(`${ok ? "  ✔" : "  ✘"} ${step}${note ? " — " + note : ""}`);
};
const t0 = Date.now();
async function timed<T>(label: string, f: () => Promise<T>): Promise<T> {
  const s = Date.now();
  const v = await f();
  console.log(`    (${label}: ${((Date.now() - s) / 1000).toFixed(1)} s)`);
  return v;
}
function summary() {
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} checks passed · ${calls} AI call(s) · ` +
    `${tokIn} in / ${tokOut} out tokens · ${((Date.now() - t0) / 1000).toFixed(0)} s${FAKE ? " (fake LLM)" : ""}`);
  for (const b of bad) console.log(`  FAILED: ${b.step} — ${b.note}`);
  if (bad.length) process.exitCode = 1;
}

// Sarah's private note and allergy words must never appear in public text
const PRIVATE = /\b(budget|tight|money|afford|nuts?|peanuts?)\b/i;
const publicText = (o: Option) => [o.title, o.explanation, o.fairnessNote ?? "", ...o.assumptions].join(" ");
const route = (o: Option) => (o.branches ? o.branches.flatMap((b) => b.spots) : o.spots).join(" > ");

async function main() {
  // Trip starting TOMORROW in Tokyo. The app's negotiate call passes no `now` (real clock), and a slot that
  // already started today is refused, so a trip starting today would make the result depend on the hour.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
  const day = (n: number) => new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10);
  const trip: Trip = structuredClone({ ...BASE, startDate: day(1), endDate: day(3) });
  const [mia, tom, , ken] = trip.members;
  const names = Object.fromEntries(trip.members.map((m) => [m.id, m.name]));
  const iso = () => new Date().toISOString();
  const say = (id: string, senderId: string, text: string): ChatMessage => ({ id, tripId: trip.id, senderId, text, createdAt: iso() });
  const pm = (memberId: string, text: string, round: number, n: number): PrivateMessage =>
    ({ id: `p-${memberId}-${round}-${n}`, tripId: trip.id, memberId, sender: "member", round, createdAt: iso(), text });
  const chat: ChatMessage[] = [
    say("c1", tom.id, "Shibuya on the first afternoon, no discussion 😎"),
    say("c2", mia.id, "Hmm I'd love to see the National Museum..."),
  ];
  const showScores = (o: Option) => o.scores.map((s) => `${names[s.memberId]}=${s.level}`).join(", ");

  // ---------- 1. Interview (src/lib/interview/service.ts) ----------
  console.log("\n1) Interview (Ken, a fresh member)");
  const fresh: MemberProfile = { ...ken, interests: [], preferenceStatements: [], hard: { ...ken.hard, maxBudget: 0 } };
  let covered: InterviewTopic[] = [];
  const history: PrivateMessage[] = [];
  const answers = [
    "Hi! I mostly like food and shopping for souvenirs.",
    "Pretty relaxed, I don't want to rush. I'm a night owl.",
    "No diet, but I'm allergic to peanuts. Budget around 50000 yen.",
  ];
  for (const [i, text] of answers.entries()) {
    const message = pm(ken.id, text, 0, i);
    const out = await timed(`turn ${i + 1}`, () =>
      getInterviewer()({ member: fresh, message, history: [...history], round: 0, coveredTopics: covered }));
    const grows = covered.every((t) => out.interview.covered.includes(t));
    check(`interview turn ${i + 1}`, out.reply.length > 0 && grows,
      `covered [${out.interview.covered.join(", ")}]${out.profileUpdate ? " profile " + JSON.stringify(out.profileUpdate) : ""}`);
    console.log(`    WayWay: ${out.reply}`);
    if (i === answers.length - 1) {
      check("allergy/budget proposed for confirmation (not applied)", Boolean(out.preferenceUpdate.hardConstraintsToConfirm),
        JSON.stringify(out.preferenceUpdate.hardConstraintsToConfirm ?? null));
    }
    covered = out.interview.covered;
    history.push(message, { ...message, id: `${message.id}-r`, sender: "wayway", text: out.reply });
  }

  // ---------- 2. @WayWay: when? (src/lib/chatbox-wayway/service.ts) ----------
  console.log("\n2) @WayWay negotiates the time");
  const { negotiate, generate } = getWayWayAI();
  const ask = say("c3", tom.id, "@WayWay what should we do on the first afternoon?");
  chat.push(ask);
  const p1 = await timed("negotiate", () => negotiate({ trip, message: ask, recentChat: chat, pending: undefined, decided: [] }));
  check("negotiate: first answer", ["ask", "propose", "confirm", "change"].includes(p1.action),
    `${p1.action} ${JSON.stringify(p1.slot ?? "")} "${p1.reply ?? ""}"`);
  let slot: TimeSlot | undefined = ["confirm", "change"].includes(p1.action) ? p1.slot : undefined;
  if (!slot) {
    const ans = say("c4", mia.id, "@WayWay ok, 15:00-18:00 works for me");
    chat.push(ans);
    const p2 = await timed("negotiate", () => negotiate({ trip, message: ans, recentChat: chat, pending: p1.slot, decided: [] }));
    check("negotiate: agreed slot", ["confirm", "change"].includes(p2.action) && Boolean(p2.slot && p2.kind),
      `${p2.action} ${JSON.stringify(p2.slot ?? "")}`);
    slot = p2.slot;
  }
  if (!slot) return console.log("No agreed slot, stopping.");
  const s: TimeSlot = slot;

  // ---------- 3. First options (createOptions) ----------
  console.log(`\n3) generateOptions -> buildOptions (${s.label} ${s.start}-${s.end})`);
  const allowed = filterSpotsForTrip(SPOTS, trip.members, { evidence: EVIDENCE, spentByMember: {} }).allowed;
  let gen: OptionsOutput;
  try {
    gen = await timed("generate", () => generate({ trip, slot: s, allowedSpots: allowed, recentChat: chat }));
  } catch (e) {
    return check("generate", false, e instanceof AIOutputError ? `AIOutputError ${e.kind} (the app posts "couldn't prepare options")` : String(e));
  }
  const built = buildOptions(gen.candidates, trip.members, SPOT_INDEX, {}, { spentByMember: {} });
  check("generate + buildOptions", built.options.length > 0,
    `${gen.candidates.length} candidates, ${gen.attempts} attempt(s), cards [${built.options.map((o) => `${o.id}:${o.kind}`).join(" ")}], ` +
    `dropped ${built.dropped.length}${gen.rejected.length ? `, AI retried after ${gen.rejected.length} problem(s)` : ""}`);
  if (!built.options.length) return;
  for (const o of built.options) console.log(`    ${o.id} ${o.title} [${route(o)}] ${showScores(o)}`);
  check("option cards: no private words", built.options.every((o) => !PRIVATE.test(publicText(o))));

  const { revise, write } = getRoundAI();
  const m1 = await timed("writeMessage", () => write({ trip, kind: "options_round", recentChat: chat,
    facts: { slot: s.label, options: built.options.map((o) => `${o.id}: ${o.title}`), deadline: "15:30" } }));
  check("group message options_round", Boolean(m1.text) && !PRIVATE.test(m1.text), `"${m1.text}"`);

  // ---------- 4. Private feedback (src/lib/chatbox-feedback/service.ts) ----------
  console.log("\n4) Private feedback on the cards");
  const stored: { memberId: string; reactions: unknown }[] = [];
  const feedback: [MemberProfile, string][] = [
    [tom, "A is ok but too much museum. B is boring. I want real shopping time."],
    [mia, "I really don't want a crowded mall, the museum one is perfect for me."],
  ];
  for (const [m, text] of feedback) {
    const out = await timed(`feedback ${m.name}`, () => getFeedbackHandler()({
      member: m, message: pm(m.id, text, 1, 9), history: [], round: 1, currentOptions: built.options, spots: SPOTS, memberNames: names,
    }));
    const r = out.preferenceUpdate.reactions ?? [];
    check(`feedback ${m.name}`, Boolean(out.reply), `${r.length} reaction(s) ${JSON.stringify(r)}; reply "${out.reply}"`);
    m.preferenceStatements = out.preferenceUpdate.statements;
    if (r.length) stored.push({ memberId: m.id, reactions: JSON.parse(JSON.stringify(r)) });   // jsonb round trip
  }
  // Same reading as loadReactions() in src/lib/chatbox-rounds/service.ts
  const reactions: MemberReaction[] = [];
  let raw = 0;
  for (const row of stored) {
    for (const r of row.reactions as Record<string, unknown>[]) {
      raw++;
      const id = r.optionId, level = r.level;
      if ((id === "A" || id === "B" || id === "C") && typeof level === "string" && Object.hasOwn(LEVEL_VALUE, level)) {
        reactions.push({ memberId: row.memberId, optionId: id, level: level as keyof typeof LEVEL_VALUE,
          reason: typeof r.reason === "string" ? r.reason : "" });
      }
    }
  }
  check("reactions survive the save + reload", reactions.length === raw, `${reactions.length}/${raw}`);

  // ---------- 5. Next round (nextRound) ----------
  console.log("\n5) reviseOptions -> buildOptions (round 2)");
  const previous = built.options;
  const rev = await timed("revise", () => revise({ trip, slot: s, allowedSpots: allowed, recentChat: chat,
    previousOptions: previous, candidate: pickCandidate(previous), reactions, critiques: [] }));
  const kept = rev.kept.length ? rev.kept : previous;
  let b2 = buildOptions([...kept, ...rev.candidates], trip.members, SPOT_INDEX, {}, { spentByMember: {} });
  if (!b2.options.length) b2 = buildOptions(previous, trip.members, SPOT_INDEX, {}, { spentByMember: {} });
  const unchanged = b2.options.map(route).join("|") === previous.map(route).join("|");
  check("revise + buildOptions", b2.options.length > 0,
    `${rev.candidates.length} new, kept [${rev.kept.map((o) => o.id).join(",")}], ${b2.options.length} cards, candidate ${b2.candidateOptionId}` +
    (unchanged ? " (same cards as round 1)" : ""));
  for (const o of b2.options) console.log(`    ${o.id} ${o.title} [${route(o)}] ${showScores(o)}`);
  check("round 2 cards: no private words", b2.options.every((o) => !PRIVATE.test(publicText(o))));
  const m2 = await timed("writeMessage", () => write({ trip, kind: "next_round", recentChat: chat,
    facts: { slot: s.label, round: 2, options: b2.options.map((o) => `${o.id}: ${o.title}`), deadline: "16:00" } }));
  check("group message next_round", Boolean(m2.text) && !PRIVATE.test(m2.text), `"${m2.text}"`);

  // ---------- 6. Vote (openVote / vote route / closeVote) ----------
  console.log("\n6) Vote with the Role 4 logic (each member votes the AI's estimate)");
  const guard = { members: trip.members, spots: SPOT_INDEX, spentByMember: {} };
  const set: OptionSet = {
    id: "os-smoke", tripId: trip.id, slot: s, round: 3, options: b2.options,
    candidateOptionId: b2.candidateOptionId ?? b2.options[0].id, status: "voting", roundDeadline: new Date().toISOString(),
    voteDeadline: new Date(Date.now() + 1000).toISOString(), voteAttempt: 1, voterIds: [],
  };
  let poll = startPoll(set, guard, trip.timezone, {});
  for (const m of trip.members) {
    for (const o of b2.options) {
      const level = o.scores.find((x) => x.memberId === m.id)!.level;
      const inBranch = o.branches?.some((b) => b.memberIds.includes(m.id));
      const res = castVote(poll, { optionSetId: set.id, optionId: o.id, memberId: m.id, level, ...(inBranch ? { acceptsSplit: true } : {}) }, 1, Date.now());
      if (res.error) check(`vote ${m.name} ${o.id}`, false, res.error);
      else poll = res.poll;
    }
  }
  const after = advancePoll(poll, Date.now() + 5000, guard);
  const decision = after.decision;
  check("poll decided", after.outcome === "decided", `${after.outcome}${decision ? ` ${decision.chosenOptionId} by ${decision.resolvedBy}` : ""}`);
  if (!decision) return;
  const chosen = after.optionSet.options.find((o) => o.id === decision.chosenOptionId)!;
  const items = itineraryFromOption(chosen, s, SPOTS_BY_ID);
  check("itinerary from the winner", items.length > 0, items.map((i) => `${i.start}-${i.end} ${i.spotId ?? "(split)"}`).join(", "));
  const m3 = await timed("writeMessage", () => write({ trip, kind: "decision", recentChat: chat, facts: {
    slot: s.label, chosen: `${chosen.id}: ${chosen.title}`,
    stops: items.flatMap((i) => (i.spotId ? [SPOTS_BY_ID[i.spotId]?.name ?? i.spotId] : [])), resolvedBy: decision.resolvedBy,
  } }));
  check("group message decision", Boolean(m3.text) && !PRIVATE.test(m3.text), `"${m3.text}"`);
}

main()
  .catch((e) => { check("run", false, String(e)); })
  .finally(summary);
