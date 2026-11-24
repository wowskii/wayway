// How Role 4 plugs into the AI module (Candidate -> Option) and the database (rows <-> poll),
// on the real shared dataset. Run: npm run test:logic
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MemberScore, Option, OptionSet, SatisfactionLevel } from "@/contracts/contract";
import { buildOptions, pickCandidateId } from "@/lib/logic/options";
import type { BuildMember, CandidateLike } from "@/lib/logic/options";
import { filterSpotsForTrip } from "@/lib/logic/constraints";
import { SPOTS, SPOTS_BY_ID, SPOT_INDEX, validateDataset } from "@/lib/logic/dataset";
import { advancePoll, castVote, startPoll } from "@/lib/logic/voting";
import { decisionRows, memberStateUpdates, optionSetUpdate, pollFromRows, voteFromRow, voteToRow } from "@/lib/logic/persistence";
import type { OptionSetRow } from "@/lib/logic/persistence";
import { itineraryFromOption, spentFromItinerary } from "@/lib/logic/itinerary";
import { aiErrorKind, evaluateRun, personaRating, privateCanaries } from "@/lib/logic/evaluation";

const members: BuildMember[] = [
  { id: "mia", name: "Mia", hard: { diet: ["vegetarian"], allergies: [], maxBudget: 40000 } },
  { id: "tom", name: "Tom", hard: { diet: [], allergies: [], maxBudget: 80000 } },
  { id: "sarah", name: "Sarah", hard: { diet: [], allergies: [], maxBudget: 3000 } },
  { id: "ken", name: "Ken", hard: { diet: [], allergies: [], maxBudget: 0 } },   // budget not known yet
];
const ids = members.map(m => m.id);
const scores = (...levels: SatisfactionLevel[]): MemberScore[] =>
  levels.map((level, i) => ({ memberId: ids[i], level, source: "ai_estimate", reason: "test" }));
const cand = (title: string, spots: string[], s: MemberScore[], extra: Partial<CandidateLike> = {}): CandidateLike =>
  ({ title, spots, scores: s, satisfiedMemberIds: [], explanation: `${title} trade-off`, assumptions: [], ...extra });

const museum = cand("Ueno museums", ["tnm", "nmwa"], scores("must_go", "lean_not_go", "want_to_go", "want_to_go"));
const shopping = cand("Shibuya shopping", ["shibuya_shopping"], scores("lean_not_go", "must_go", "same", "want_to_go"));
const mixed = cand("Park and market", ["ueno_park", "ameyoko"], scores("same", "same", "want_to_go", "want_to_go"));
const split = cand("Split and meet", [], scores("must_go", "must_go", "want_to_go", "want_to_go"), {
  branches: [{ memberIds: ["mia", "sarah"], spots: ["tnm"] }, { memberIds: ["tom", "ken"], spots: ["ameyoko"] }],
  rendezvous: { spotId: "ueno_park", time: "16:30" },
});

test("the shared dataset is valid and the evidence file only refers to existing spots", () => {
  assert.deepEqual(validateDataset(SPOTS_BY_ID as Record<string, unknown>), []);
  assert.ok(SPOTS.length >= 30 && SPOTS.length <= 50, "30-50 spots (milestone 3)");
  assert.ok(SPOTS.filter(s => s.category === "food").length >= 5, "enough food spots for meal slots");
  assert.deepEqual(SPOT_INDEX.ts_tantan.allergens, ["sesame"]);
  const broken = { x: { ...SPOTS_BY_ID.tnm, id: "x", openHours: "9:30 to 17:00", lat: 139.7, lng: 35.7 } };
  assert.deepEqual(validateDataset(broken).map(e => e.split(": ")[1].slice(0, 9)), ["openHours", "lat/lng o"]);
});

test("filterSpotsForTrip removes food without everyone's diet, known allergens and spots above the tightest budget", () => {
  const { allowed, removed } = filterSpotsForTrip(SPOTS, members, { evidence: { ts_tantan: { allergens: ["sesame"] } } });
  const food = allowed.filter(s => s.category === "food").map(s => s.id).sort();
  assert.deepEqual(food, ["afuri_harajuku", "ain_soph", "ts_tantan"]);           // vegetarian-tagged only
  assert.ok(allowed.every(s => s.price <= 3000), "Sarah's budget (3000) caps single spots");
  assert.ok(removed.some(r => r.spotId === "teamlab_planets" && r.reasons.includes("over_budget")));
  const allergic = members.map(m => m.id === "sarah" ? { ...m, hard: { ...m.hard, allergies: ["sesame"] } } : m);
  const withAllergy = filterSpotsForTrip(SPOTS, allergic, { evidence: { ts_tantan: { allergens: ["sesame"] } } });
  assert.ok(!withAllergy.allowed.some(s => s.id === "ts_tantan"));
  assert.ok(withAllergy.allowed.some(s => s.id === "afuri_harajuku"), "unknown allergen data does not block");
});

test("buildOptions: A = best total, B = fairest other, no split while a shared option suits everyone", () => {
  const r = buildOptions([museum, shopping, mixed, split], members, SPOT_INDEX);
  assert.deepEqual(r.options.map(o => [o.id, o.kind, o.title]), [["A", "best_total", "Ueno museums"], ["B", "fairest", "Park and market"]]);
  assert.equal(r.candidateOptionId, "B", "candidate = highest min (B keeps everyone at same), not the best total");
  assert.deepEqual(r.options[0].satisfiedMemberIds, ["mia", "sarah", "ken"], "recomputed by code");
  assert.equal(r.options[0].metrics?.min, 2.5);
  assert.equal(r.options[0].fairnessNote, undefined);
});

test("pickCandidateId: highest min, then highest mean, then the earlier card", () => {
  const o = (id: "A" | "B" | "C", ...levels: MemberScore["level"][]) =>
    ({ id, scores: levels.map((level, i): MemberScore => ({ memberId: `m${i}`, level, source: "vote", reason: "" })) });
  assert.equal(pickCandidateId([o("A", "must_go", "lean_not_go"), o("B", "same", "same")]), "B");          // min 5 > 2.5
  assert.equal(pickCandidateId([o("A", "same", "same"), o("B", "same", "want_to_go")]), "B");             // same min, mean
  assert.equal(pickCandidateId([o("A", "same", "want_to_go"), o("B", "want_to_go", "same")]), "A");       // full tie: A
  assert.equal(pickCandidateId([]), null);
});

test("only a split survives the filter: the candidate is C and the final poll opens (was 'Invalid final poll')", () => {
  const { options, candidateOptionId } = buildOptions([split], members, SPOT_INDEX);
  assert.deepEqual(options.map(o => o.id), ["C"]);
  assert.equal(candidateOptionId, "C");
  const set = (candidate: "A" | "C"): OptionSet => ({ id: "os", tripId: "t", round: 2, options, candidateOptionId: candidate,
    slot: { day: 1, start: "13:00", end: "17:00", label: "Afternoon" }, status: "voting",
    roundDeadline: "2026-11-21T08:00:00Z", voteDeadline: "2026-11-21T08:00:00Z" });
  const guard = { members, spots: SPOT_INDEX };
  assert.throws(() => startPoll(set("A"), guard, "Asia/Tokyo", {}), /Invalid final poll/);   // the old eval runner always passed "A"
  assert.equal(startPoll(set(candidateOptionId!), guard, "Asia/Tokyo", {}).outcome, "open");
});

test("buildOptions shows the same route only once (the first one wins, e.g. the kept candidate)", () => {
  const again = { ...museum, title: "Museums again", scores: scores("must_go", "must_go", "must_go", "must_go") };
  const r = buildOptions([museum, again, mixed], members, SPOT_INDEX);
  assert.deepEqual(r.options.map(o => o.title), ["Ueno museums", "Park and market"]);
  assert.deepEqual(r.dropped.map(d => d.reason), ["duplicate_route"]);
});

test("buildOptions: the split is offered as C only when no shared option keeps everyone at 'same' or better", () => {
  const r = buildOptions([museum, shopping, split], members, SPOT_INDEX);
  assert.deepEqual(r.options.map(o => o.id), ["A", "B", "C"]);
  assert.equal(r.options[2].kind, "split");
  assert.deepEqual(r.options[2].spots, []);
  assert.equal(r.options[2].rendezvous?.spotId, "ueno_park");
});

test("buildOptions: fairness credits can change A and add a sentence without numbers", () => {
  const r = buildOptions([museum, shopping], members, SPOT_INDEX, { tom: 5 });
  assert.equal(r.options[0].title, "Shibuya shopping");
  assert.match(r.options[0].fairnessNote ?? "", /^Tom's choice is favored a little this time/);
  assert.doesNotMatch(r.options[0].fairnessNote ?? "", /\d/);
});

test("buildOptions drops invented spots, diet mismatches and known allergens; unknown allergens become private warnings", () => {
  const meat = cand("Ramen", ["ichiran_shibuya"], scores("same", "same", "same", "same"));
  const fake = cand("Invented", ["fake_spot"], scores("must_go", "must_go", "must_go", "must_go"));
  const vegan = cand("Vegan ramen", ["afuri_harajuku"], scores("want_to_go", "same", "same", "same"));
  const sesame = cand("Sesame bowl", ["ts_tantan"], scores("want_to_go", "same", "same", "same"));
  const allergic = members.map(m => m.id === "sarah" ? { ...m, hard: { ...m.hard, allergies: ["sesame", "nuts"] } } : m);
  const r = buildOptions([meat, fake, vegan, sesame], allergic, SPOT_INDEX);
  assert.deepEqual(r.dropped.map(d => [d.title, [...new Set(d.issues.map(i => i.code))].join()]),
    [["Ramen", "diet_mismatch,allergy_unverified"], ["Invented", "unknown_spot"], ["Sesame bowl", "allergen_present,allergy_unverified"]]);
  assert.deepEqual(r.options.map(o => o.title), ["Vegan ramen"]);
  assert.deepEqual(r.privateWarnings.map(w => [w.memberId, w.code]), [["sarah", "allergy_unverified"], ["sarah", "allergy_unverified"]]);
  const strict = buildOptions([vegan], allergic, SPOT_INDEX, {}, { strictEvidence: true });
  assert.equal(strict.options.length, 0);
});

test("database round trip: rows -> poll -> votes -> decision -> rows", () => {
  const { options } = buildOptions([museum, mixed], members, SPOT_INDEX);
  const slot = { day: 1, start: "14:00", end: "17:30", label: "Afternoon, day 1" };
  const row: OptionSetRow = {
    id: "os-1", trip_id: "trip-1", slot, round: 3, options: options as never, candidate_option_id: "A",
    status: "voting", round_deadline: "2026-11-21T06:00:00Z", vote_deadline: "2026-11-21T06:30:00Z",
    voter_ids: [], vote_attempt: 1, chosen_option_id: null, created_at: "2026-11-21T05:00:00Z",
  };
  const states = members.map(m => ({ member_id: m.id, fairness_credits: m.id === "mia" ? 2 : 0,
    definitely_no_used_today: m.id === "tom" ? 1 : 0, definitely_no_day: m.id === "tom" ? "2026-11-21" : null }));
  const guard = { members, spots: SPOT_INDEX };
  const before = pollFromRows({ optionSet: row, votes: [], states, timezone: "Asia/Tokyo", guard });
  assert.deepEqual(before.credits, { mia: 2, tom: 0, sarah: 0, ken: 0 });
  let poll = before;
  const now = Date.parse("2026-11-21T06:00:00Z");
  const ratings: Record<string, [SatisfactionLevel, SatisfactionLevel]> =
    { mia: ["must_go", "same"], tom: ["definitely_no", "want_to_go"], sarah: ["want_to_go", "want_to_go"] };
  for (const [memberId, [a, b]] of Object.entries(ratings)) {
    poll = castVote(poll, { optionSetId: "os-1", optionId: "A", memberId, level: a }, 1, now).poll;
    poll = castVote(poll, { optionSetId: "os-1", optionId: "B", memberId, level: b }, 1, now).poll;
  }
  // Votes survive a trip through the votes table.
  const stored = poll.votes.map(v => voteFromRow({ ...voteToRow(v), created_at: "2026-11-21T06:00:00Z" } as never, "Asia/Tokyo"));
  assert.deepEqual(stored, poll.votes);
  assert.deepEqual(memberStateUpdates(before, poll), [{ member_id: "tom", definitely_no_day: "2026-11-21", definitely_no_used_today: 2 }]);
  const done = advancePoll(poll, Date.parse("2026-11-21T06:30:00Z"), guard);
  assert.equal(done.outcome, "decided");
  assert.equal(optionSetUpdate(done).status, "decided");
  const chosen = done.optionSet.options.find(o => o.id === done.decision!.chosenOptionId)!;
  const items = itineraryFromOption(chosen, slot, SPOTS_BY_ID);
  const rows = decisionRows(done.decision!, "trip-1", items);
  assert.equal(rows.decision.chosen_option_id, done.decision!.chosenOptionId);
  assert.equal(rows.itinerary.length, chosen.spots.length);
  assert.ok(memberStateUpdates(poll, done).every(u => u.fairness_credits !== undefined));
});

test("itinerary: stops in order with travel time; split = branches until the rendezvous; spend per member", () => {
  const { options } = buildOptions([museum, shopping, split], members, SPOT_INDEX);
  const slot = { day: 2, start: "14:00", end: "17:30", label: "Afternoon, day 2" };
  assert.deepEqual(itineraryFromOption(options[0], slot, SPOTS_BY_ID), [
    { day: 2, start: "14:00", end: "15:30", spotId: "tnm" },
    { day: 2, start: "15:40", end: "16:55", spotId: "nmwa" },          // same area: 10 min walk
  ]);
  const splitItems = itineraryFromOption(options[2], slot, SPOTS_BY_ID);
  assert.deepEqual(splitItems.map(i => [i.start, i.end, i.spotId ?? "branches"]), [["14:00", "16:30", "branches"], ["16:30", "17:30", "ueno_park"]]);
  assert.deepEqual(spentFromItinerary(splitItems, ids, SPOTS_BY_ID), { mia: 1000, tom: 1500, sarah: 1000, ken: 1500 });
});

test("persona model v2: stops weighted by visit time, a hated stop caps the option at lean_not_go", () => {
  const p = { memberId: "mia", likes: { museum: "must_go" as const, shopping: "lean_not_go" as const, akihabara: "definitely_no" as const } };
  const route = (spots: string[]) => ({ ...buildOptions([museum], members, SPOT_INDEX).options[0], spots });
  // 120 min of shopping (lean_not_go) + 75 min museum (must_go): time-weighted 2.15 -> same (v1 said want_to_go)
  assert.equal(personaRating(route(["shibuya_shopping", "nezu_museum"]), p, members[0], SPOT_INDEX).level, "same");
  // Akihabara (hated) + a loved museum: capped at lean_not_go
  assert.equal(personaRating(route(["akihabara", "tnm"]), p, members[0], SPOT_INDEX).level, "lean_not_go");
});

test("personas and the run report: violations, estimate accuracy and privacy leaks", () => {
  const mia = { memberId: "mia", likes: { museum: "must_go" as const, shopping: "lean_not_go" as const } };
  const { options } = buildOptions([museum, shopping, split], members, SPOT_INDEX);
  assert.equal(personaRating(options[0], mia, members[0], SPOT_INDEX).level, "must_go");
  assert.equal(personaRating(options[1], mia, members[0], SPOT_INDEX).level, "lean_not_go");
  assert.deepEqual(personaRating(options[2], mia, members[0], SPOT_INDEX), { level: "want_to_go", acceptsSplit: true });
  const trip = { id: "t", name: "T", city: "Tokyo", startDate: "2026-11-21", endDate: "2026-11-23", timezone: "Asia/Tokyo",
    goal: "balanced" as const, members: members.map(m => ({ ...m, interests: [], pace: "moderate" as const, sleep: "flexible" as const,
      privateNote: m.id === "sarah" ? "Money is tight this month" : "", preferenceStatements: [], fairnessCredits: 0, definitelyNoUsedToday: 0 })) };
  assert.ok(privateCanaries(trip).includes("Money is tight this month"));
  assert.ok(privateCanaries(trip).includes("3,000"));
  const report = evaluateRun({
    trip, optionSets: [{ id: "os", round: 1, options }],
    publicPayloads: [{ text: "Here are 3 options!" }, { text: "Sarah said money is tight this month" }],
    references: [{ tripId: "t", optionSetId: "os", round: 1, attempt: 1, optionId: "A", memberId: "mia", level: "must_go" }],
  }, SPOT_INDEX);
  assert.equal(report.shownRoutes.withViolations, 0);
  assert.equal(report.estimateAccuracy.exactMatch, 1);
  assert.equal(report.privacy.payloadsWithLeaks, 1);
});

test("evaluateRun: AI errors by kind, estimate accuracy per round, carried-over cards counted once", () => {
  // Messages as written by the AI module's validator (wayway-ai/lib/ai/options.ts).
  assert.equal(aiErrorKind("Candidate 2: the path ends at 14:15 including travel, too late (limit 13:30). Use closer spots or fewer."), "too_late");
  assert.equal(aiErrorKind('Candidate 1: unknown spot id "ichiran_shibuya" (use only <allowed_spots>).'), "unknown_spot");
  assert.equal(aiErrorKind('Candidate 1: "tnm" is closed during its visit (17:00-18:30, open 09:30-17:00). Reorder or replace it.'), "closed");
  assert.equal(aiErrorKind("Candidate 3: group-visible text reveals private information (budget). Rewrite neutrally."), "privacy_leak");
  assert.equal(aiErrorKind("Candidate 1: Mia would be alone in a branch without wanting it (needs want_to_go or must_go)."), "lone_member");
  assert.equal(aiErrorKind("Candidate 2: the path must be exactly one food spot (meal slot)."), "meal_rule");
  assert.equal(aiErrorKind("Candidate 1: member Tom needs exactly one score (found 0)."), "scores");
  assert.equal(aiErrorKind("Candidate 2: repeats an option our code already keeps."), "duplicate");
  assert.equal(aiErrorKind("something new"), "other");

  const { options: [a, b] } = buildOptions([museum, shopping], members, SPOT_INDEX);
  const est = (o: Option, id: string) => o.scores.find(s => s.memberId === id)!.level;
  const wrong = (level: SatisfactionLevel): SatisfactionLevel => (level === "must_go" ? "definitely_no" : "must_go");
  const ref = (round: number, o: Option, memberId: string, level: SatisfactionLevel) =>
    ({ tripId: "t", optionSetId: "os", round, attempt: 1, optionId: o.id, memberId, level });
  const trip = { id: "t", name: "T", city: "Tokyo", startDate: "2026-11-21", endDate: "2026-11-23", timezone: "Asia/Tokyo",
    goal: "balanced" as const, members: members.map(m => ({ ...m, interests: [], pace: "moderate" as const, sleep: "flexible" as const,
      privateNote: "", preferenceStatements: [], fairnessCredits: 0, definitelyNoUsedToday: 0 })) };
  const report = evaluateRun({
    trip, publicPayloads: [],
    optionSets: [{ id: "os", round: 1, options: [a] }, { id: "os", round: 2, options: [a, b], carriedOver: ["A"] }],
    references: [
      ref(1, a, "mia", est(a, "mia")),                 // round 1: right
      ref(2, a, "mia", wrong(est(a, "mia"))),          // A was carried over: its round-1 estimate is not scored again
      ref(2, b, "mia", est(b, "mia")),                 // round 2: right
      ref(2, b, "tom", wrong(est(b, "tom"))),          // round 2: wrong
    ],
    aiRejected: ["Candidate 1: \"tnm\" is closed during its visit (x).", "Candidate 2: ends at 14:15 including travel, too late (limit 13:30)."],
    dropped: [{ reason: "hard_constraint", issues: [{ code: "diet_mismatch" }, { code: "diet_mismatch" }] }, { reason: "duplicate_route", issues: [] }],
  }, SPOT_INDEX);
  assert.deepEqual([report.estimateAccuracy.round1.n, report.estimateAccuracy.round1.exactMatch], [1, 1]);
  assert.deepEqual([report.estimateAccuracy.laterRounds.n, report.estimateAccuracy.laterRounds.exactMatch], [2, 0.5]);
  assert.equal(report.estimateAccuracy.n, 3);
  assert.deepEqual(report.aiErrors, {
    caughtByAiCheck: { total: 2, byKind: { closed: 1, too_late: 1 } },
    caughtByRole4: { total: 1, byCode: { diet_mismatch: 1 } },
    duplicateRoutes: 1,
  });
  assert.equal(report.shownRoutes.checked, 3);
});

void ({} as OptionSet);
