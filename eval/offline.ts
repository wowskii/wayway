// Offline scenarios (Role 4): fixed votes, no AI, no network. Checks the decision rules end to end:
// hard filter -> A/B proposal -> poll -> votes -> deadline -> decision -> credits.
//   npm run eval:offline                      all scenarios
//   npm run eval:offline -- 03-split-consent  one scenario
//   npm run eval:offline -- --json            machine-readable trace
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import type { Option, OptionSet, SatisfactionLevel } from "@/contracts/contract";
import { filterOptions } from "@/lib/logic/constraints";
import type { ConstraintMember, SpotIndex } from "@/lib/logic/constraints";
import { creditWeight, rankOptions } from "@/lib/logic/metrics";
import type { Balances } from "@/lib/logic/metrics";
import { advancePoll, castVote, startPoll } from "@/lib/logic/voting";

export type OfflineScenario = {
  id: string; description: string; members: ConstraintMember[]; spots: SpotIndex;
  spent?: Record<string, number>; startingCredits?: Balances; rejectedOptions?: Option[];
  expectedBlockedCodes?: string[]; expectedProposal?: { bestTotal: string; fairest: string };
  decisions: {
    id: string; options: Option[]; votes: Record<string, SatisfactionLevel[]>;
    consent?: Record<string, boolean>; expectedWinner: Option["id"];
    expectedResolution?: string; expectedCredits?: Balances; unweightedWinner?: Option["id"];
  }[];
};

const folder = new URL("./scenarios/offline/", import.meta.url);
export function offlineScenarios(): OfflineScenario[] {
  return readdirSync(folder).filter(name => name.endsWith(".json")).sort().map(name =>
    JSON.parse(readFileSync(new URL(name, folder), "utf8")));
}

export function runOffline(example: OfflineScenario) {
  const { members, spots, spent } = example;
  const guard = { members, spots, spentByMember: spent };
  const blocked = filterOptions(example.rejectedOptions ?? [], members, spots, { spentByMember: spent });
  assert.equal(blocked.eligible.length, 0, "every rejected option must be blocked");
  const blockedCodes = [...new Set(blocked.blocked.flatMap(row => row.issues.map(issue => issue.code)))].sort();
  if (example.expectedBlockedCodes) assert.deepEqual(blockedCodes, [...example.expectedBlockedCodes].sort());
  let credits = example.startingCredits ?? {};
  const decisions = example.decisions.map((round, index) => {
    const before = credits;
    const deadline = Date.UTC(2026, 10, 21 + index, 4);
    const optionSet: OptionSet = {
      id: round.id, tripId: example.id, round: 3,
      slot: { day: index + 1, start: "13:00", end: "15:00", label: "Afternoon" },
      options: round.options, candidateOptionId: "A", status: "voting",
      roundDeadline: new Date(deadline).toISOString(), voteDeadline: new Date(deadline).toISOString(),
    };
    const ranking = rankOptions(round.options.filter(o => o.kind !== "split"), members.map(m => m.id), before);
    const proposals = { bestTotal: ranking.bestTotal?.option.id, fairest: ranking.fairest?.option.id };
    if (example.expectedProposal) assert.deepEqual(proposals, example.expectedProposal);
    let poll = startPoll(optionSet, guard, "Asia/Tokyo", before);
    for (const [memberId, ratings] of Object.entries(round.votes)) {
      assert.equal(ratings.length, round.options.length);
      for (const [i, level] of ratings.entries()) {
        const option = round.options[i];
        const acceptsSplit = option.kind === "split" ? round.consent?.[memberId] : undefined;
        const result = castVote(poll, { optionSetId: optionSet.id, optionId: option.id, memberId, level, acceptsSplit },
          1, deadline - 60_000);
        assert.equal(result.error, null);
        poll = result.poll;
      }
    }
    if (round.unweightedWinner) {
      assert.equal(advancePoll({ ...poll, credits: {} }, deadline, guard).decision?.chosenOptionId, round.unweightedWinner);
    }
    const resolved = advancePoll(poll, deadline, guard);
    assert.equal(resolved.decision?.chosenOptionId, round.expectedWinner, `${round.id}: winner`);
    assert.equal(advancePoll(resolved, deadline + 1, guard), resolved, "a decided poll never changes again");
    if (round.expectedResolution) assert.equal(resolved.decision?.resolvedBy, round.expectedResolution);
    if (round.expectedCredits) assert.deepEqual(resolved.credits, round.expectedCredits);
    credits = resolved.credits;
    return {
      decision: round.id, proposals, winner: resolved.decision!.chosenOptionId,
      resolvedBy: resolved.decision!.resolvedBy, voters: resolved.decision!.voterIds,
      creditsBefore: before, creditsAfter: credits,
      miaWeightBefore: creditWeight(before.mia ?? 0), miaWeightAfter: creditWeight(credits.mia ?? 0),
      creditEvents: resolved.decision!.creditEvents,
      ...(round.unweightedWinner ? { unweightedWinner: round.unweightedWinner } : {}),
    };
  });
  return { scenario: example.id, description: example.description, blockedCodes, decisions };
}

if (process.argv[1]?.endsWith("offline.ts")) {
  const args = process.argv.slice(2);
  const requested = args.find(arg => arg !== "--json");
  const examples = offlineScenarios().filter(e => !requested || requested === e.id);
  if (!examples.length) throw new Error(`Unknown scenario "${requested}"`);
  const result = { mode: "fixed votes, no AI, no network", scenarios: examples.map(runOffline) };
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(result.mode);
    for (const s of result.scenarios) {
      console.log(`\n${s.scenario} — ${s.description}`);
      if (s.blockedCodes.length) console.log(`  blocked by the hard filter: ${s.blockedCodes.join(", ")}`);
      for (const d of s.decisions) {
        console.log(`  ${d.decision}: proposals A=${d.proposals.bestTotal} B=${d.proposals.fairest} | winner ${d.winner} (${d.resolvedBy}) | ${d.voters.length} voters`);
        console.log(`    Mia credits ${d.creditsBefore.mia ?? 0} → ${d.creditsAfter.mia ?? 0} | weight ${d.miaWeightBefore.toFixed(1)} → ${d.miaWeightAfter.toFixed(1)}` +
          (d.unweightedWinner ? ` | without credits the winner would be ${d.unweightedWinner}` : ""));
      }
    }
    console.log("\nAll offline scenarios passed.");
  }
}
