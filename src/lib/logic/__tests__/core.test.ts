// Core rules, ported from last week's standalone package (Role 4). Run: npm run test:logic
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Option, OptionSet, SatisfactionLevel } from "@/contracts/contract";
import { checkOption, routePaths } from "@/lib/logic/constraints";
import { creditWeight, rankOptions, ratingMap, summarize } from "@/lib/logic/metrics";
import { advancePoll, castVote, quorumNeeded, startPoll } from "@/lib/logic/voting";
import type { Poll } from "@/lib/logic/voting";
import { estimateAccuracy, literalPrivacyHits, publicOptionFacts } from "@/lib/logic/evaluation";
import { offlineScenarios, runOffline } from "../../../../eval/offline";

const [hard, conflict, split] = offlineScenarios();
const [A, B, C] = split.decisions[0].options;
const guard = { members: conflict.members, spots: conflict.spots };
const deadline = Date.parse("2026-11-22T15:00:00Z"); // midnight in Tokyo
const halfHour = 30 * 60_000;
const roster = guard.members.map(member => member.id);

function makePoll(options: Option[] = [A, B], fields: Partial<OptionSet> = {}, definitelyNo: Poll["definitelyNo"] = {}) {
  const end = new Date(deadline).toISOString();
  return startPoll({
    id: "test-poll", tripId: "trip", round: 3, slot: { day: 1, start: "13:00", end: "14:00", label: "Test" },
    candidateOptionId: "B", options, status: "voting", roundDeadline: end, voteDeadline: end, ...fields,
  }, guard, "Asia/Tokyo", {}, definitelyNo);
}
function vote(poll: Poll, memberId: string, optionId: Option["id"], level: SatisfactionLevel, now = deadline - 1) {
  return castVote(poll, { memberId, optionId, level, optionSetId: poll.optionSet.id }, poll.optionSet.voteAttempt!, now);
}
function allSame(poll: Poll, voters: string[], now = deadline - 1) {
  for (const member of voters) for (const option of poll.optionSet.options) {
    const result = vote(poll, member, option.id, "same", now);
    assert.equal(result.error, null);
    poll = result.poll;
  }
  return poll;
}

for (const example of offlineScenarios()) test(`offline scenario ${example.id}`, () => { runOffline(example); });

test("score mapping, exact weighted totals, maximin and zero Gini convention", () => {
  const metrics = summarize(ratingMap(A.scores, roster), { tom: 3 });
  assert.deepEqual(metrics, { mean: 7.5, min: 0, gini: 0.25, satisfactionRatio: 0.75, weightedTotal: 33 });
  assert.equal(summarize(new Map([["mia", "definitely_no"]]))?.gini, 1);
  const ranked = rankOptions([A, B], roster, {});
  assert.equal(ranked.bestTotal?.option.id, "A");
  assert.equal(ranked.fairest?.option.id, "B");
  assert.equal(creditWeight(6), 1.5);
  assert.throws(() => creditWeight(-1));
});

test("missing, invalid, duplicate and foreign ratings never enter a ranking", () => {
  assert.equal(summarize(new Map()), null);
  const variants = [
    { ...A, scores: [] },
    { ...A, scores: [{ ...A.scores[0], level: "toString" as SatisfactionLevel }, ...A.scores.slice(1)] },
    { ...A, scores: [A.scores[0], ...A.scores] },
    { ...A, scores: [{ ...A.scores[0], memberId: "other" }, ...A.scores.slice(1)] },
  ];
  for (const option of variants) {
    const result = rankOptions([option, B], roster, {});
    assert.equal(result.rejected.length, 1);
    assert.equal(result.bestTotal?.option.id, "B");
  }
});

test("hard filter: unknown spot blocks, prior spend counts, known allergen blocks, missing allergen data only warns", () => {
  const plan = { ...A, spots: ["veg", "missing"] };
  const members = [{ id: "mia", hard: { diet: ["Vegetarian"], allergies: ["PEANUT"], maxBudget: 1300 } }];
  const check = (allergens?: string[], allergenFree?: string[]) => checkOption(plan, members,
    { ...guard.spots, veg: { ...guard.spots.veg, allergens, allergenFree } }, { spentByMember: { mia: 200 } });
  assert.deepEqual(check().map(x => [x.code, x.status]),
    [["allergy_unverified", "unverified"], ["unknown_spot", "violation"], ["over_budget", "violation"]]);
  assert.equal(check(["peanut"])[0].code, "allergen_present");
  assert.deepEqual(check([], ["peanut"]).map(x => x.code), ["unknown_spot", "over_budget"]);
  assert.equal(checkOption({ ...A, spots: ["unknown"] }, members, guard.spots)[0].code, "unknown_price");
});

test("budget 0 means 'not known yet' (DB NULL) and is never a violation", () => {
  const members = [{ id: "mia", hard: { diet: [], allergies: [], maxBudget: 0 } }];
  assert.deepEqual(checkOption({ ...A, spots: ["museum", "food"] }, members, guard.spots), []);
});

test("split budget follows each member's own route including the rendezvous", () => {
  assert.deepEqual(routePaths(C, roster)?.get("mia"), ["shops", "park"]);
  assert.equal(routePaths({ ...C, branches: [{ memberIds: roster, spots: ["shops"] }] }, roster), null);
  const members = guard.members.map(m => m.id === "mia" ? { ...m, hard: { ...m.hard, maxBudget: 100 } } : m);
  assert.deepEqual(checkOption(C, members, guard.spots), []);
  const expensiveMeetup = { ...guard.spots, park: { ...guard.spots.park, price: 101 } };
  assert.deepEqual(checkOption(C, members, expensiveMeetup).map(x => x.memberId), ["mia"]);
});

test("quorum rounds up; incomplete ballots get one extension, then no decision", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(quorumNeeded), [1, 2, 2, 3, 3, 4]);
  let poll = allSame(makePoll(), roster.slice(0, 2));
  poll = vote(poll, "mia", "A", "same").poll;
  assert.equal(poll.optionSet.voterIds?.length, 2);
  assert.equal(advancePoll(poll, deadline - 1, guard), poll);
  const next = advancePoll(poll, deadline, guard);
  assert.equal(next.deadline, deadline + halfHour);
  assert.equal(next.extended, true);
  const end = advancePoll(next, deadline + halfHour, guard);
  assert.equal(end.outcome, "no_quorum");
  assert.equal(end.decision, undefined);
});

test("a complete ballot during the extension can reach quorum", () => {
  let poll = makePoll();
  for (const id of roster.slice(0, 2)) {
    poll = vote(poll, id, "A", "must_go").poll;
    poll = vote(poll, id, "B", "same").poll;
  }
  poll = advancePoll(poll, deadline, guard);
  poll = allSame(poll, ["mia"], deadline + 100);
  const end = advancePoll(poll, poll.deadline, guard);
  assert.equal(end.decision?.chosenOptionId, "A");
  assert.deepEqual(end.decision?.voterIds, roster.slice(0, 3));
});

test("perfect tie: one fresh revote, then the candidate wins; attempt-1 votes do not count in attempt 2", () => {
  let poll = allSame(makePoll(), roster.slice(0, 3));
  poll = advancePoll(poll, deadline, guard);
  assert.equal(poll.optionSet.voteAttempt, 2);
  assert.deepEqual(poll.optionSet.voterIds, []);
  const stale = { memberId: "mia", optionId: "A" as const, level: "same" as const, optionSetId: "test-poll" };
  assert.equal(castVote(poll, stale, 1, deadline + 1).error, "stale_vote_scope");
  poll = allSame(poll, roster.slice(0, 3), deadline + 1);
  poll = advancePoll(poll, poll.deadline, guard);
  assert.equal(poll.decision?.resolvedBy, "tie_candidate");
  assert.equal(poll.decision?.chosenOptionId, "B");
});

test("closed, foreign and invalid votes are rejected without using a definitely_no", () => {
  const poll = makePoll();
  assert.equal(vote(poll, "tom", "A", "definitely_no", deadline).error, "vote_closed");
  assert.equal(vote(poll, "other", "A", "same").error, "invalid_vote");
  assert.equal(vote(poll, "tom", "C", "same").error, "unknown_option");
  assert.equal(vote(poll, "tom", "A", "3" as SatisfactionLevel).error, "invalid_vote");
  assert.deepEqual(poll.definitelyNo, {});
});

test("definitely_no: 2 per local day, re-sending is free, the counter carries across polls and resets at Tokyo midnight", () => {
  let poll = makePoll([A, B, C]);
  let r = vote(poll, "tom", "A", "definitely_no"); assert.equal(r.definitelyNoCharged, true); poll = r.poll;
  r = vote(poll, "tom", "A", "definitely_no"); assert.equal(r.definitelyNoCharged, false); poll = r.poll;
  poll = vote(poll, "tom", "B", "definitely_no").poll;
  assert.deepEqual(poll.definitelyNo.tom, { day: "2026-11-22", used: 2 });
  assert.equal(vote(poll, "tom", "C", "definitely_no").error, "definitely_no_limit");
  const later = makePoll([A, B], { id: "other-poll" }, poll.definitelyNo);
  assert.equal(vote(later, "tom", "A", "definitely_no").error, "definitely_no_limit");
  const tomorrow = makePoll([A, B, C], { id: "tomorrow", voteDeadline: new Date(deadline + halfHour).toISOString() }, poll.definitelyNo);
  const next = vote(tomorrow, "tom", "C", "definitely_no", deadline + 1);
  assert.equal(next.error, null);
  assert.deepEqual(next.poll.definitelyNo.tom, { day: "2026-11-23", used: 1 });
});

test("changed constraints stop the decision before any credit is given", () => {
  const poll = allSame(makePoll(), roster.slice(0, 3));
  const end = advancePoll(poll, deadline, { ...guard, spots: { ...guard.spots, museum: { ...guard.spots.museum, price: null } } });
  assert.equal(end.outcome, "constraints_changed");
  assert.equal(end.issues?.[0].code, "unknown_price");
  assert.equal(end.decision, undefined);
});

test("split: missing consent is never assumed; a split-only poll cannot finalize; one refusal falls back", () => {
  let only = makePoll([C], { candidateOptionId: "C" });
  for (const memberId of roster.slice(0, 3)) {
    only = castVote(only, { memberId, optionId: "C", level: "must_go", acceptsSplit: true, optionSetId: "test-poll" }, 1, deadline - 1).poll;
  }
  assert.equal(advancePoll(only, deadline, guard).outcome, "no_split_fallback");
  let poll = makePoll([A, B, C]);
  for (const memberId of roster) {
    poll = vote(poll, memberId, "A", "same").poll;
    poll = vote(poll, memberId, "B", "want_to_go").poll;
    const result = castVote(poll, { memberId, optionId: "C", level: "must_go", optionSetId: poll.optionSet.id,
      acceptsSplit: memberId !== "sarah" }, 1, deadline - 1);
    assert.equal(result.error, null);
    poll = result.poll;
  }
  const decision = advancePoll(poll, deadline, guard).decision;
  assert.equal(decision?.chosenOptionId, "B");
  assert.equal(decision?.resolvedBy, "split_refused");
});

test("estimate accuracy keeps set, round and attempt apart and reports coverage", () => {
  const one = { tripId: "trip", optionSetId: "set", round: 1, attempt: 1, optionId: "A", memberId: "mia", level: "must_go" as const };
  const two = { ...one, round: 2, level: "same" as const };
  const three = { ...two, attempt: 2, level: "want_to_go" as const };
  const missing = { ...three, optionSetId: "other" };
  assert.deepEqual(estimateAccuracy([one, two, three], [one, { ...two, level: "lean_not_go" }, three, missing]),
    { n: 3, referenceCount: 4, missingEstimates: 1, unmatchedEstimates: 0, exactMatch: 2 / 3, withinOneLevel: 1, meanLevelGap: 1 / 3 });
  assert.equal(estimateAccuracy([], [one]).exactMatch, null);
  assert.throws(() => estimateAccuracy([one, one], []));
});

test("privacy scan catches injected leaks; the facts-only card is clean", () => {
  const marker = "TEST-Z9 hidden reason";
  const card = { ...A, explanation: marker, assumptions: [marker], scores: [{ ...A.scores[0], reason: marker }], fairnessNote: marker };
  assert.deepEqual(literalPrivacyHits({ optionSet: { options: [card] } }, [marker]), [0]);
  assert.deepEqual(literalPrivacyHits({ messages: [{ text: marker.toLowerCase() }] }, [marker]), [0]);
  assert.deepEqual(literalPrivacyHits(publicOptionFacts(card), [marker]), []);
  assert.throws(() => literalPrivacyHits({}, [""]));
});

void hard;
