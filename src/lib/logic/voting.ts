// Final group vote (Role 4). Pure functions: state in -> new state out. The API route loads the
// state from Supabase (see persistence.ts), calls these, then saves what changed.
//
// Rules (contract SETTINGS):
//  - A ballot counts only when the member rated EVERY option of the current attempt.
//  - Quorum = ceil(0.6 x members). Short at the deadline -> +30 min once. Still short -> no decision.
//  - Perfect tie (weighted total, then minimum, then mean) -> one fresh revote (attempt 2, +30 min).
//    Tie again -> the candidate option wins.
//  - "definitely_no": max 2 per member per local day (trip timezone). It is still a normal rating
//    (value 0); it never blocks a safe option on its own. Changing a vote does not refund it.
//  - A split wins only if every member placed in a branch answered acceptsSplit = true;
//    otherwise the best shared option wins (resolvedBy "split_refused").
//  - Credits are settled once, at the decision (credits.ts).
import { SETTINGS } from "@/contracts/contract";
import type { Decision, Option, OptionSet, SatisfactionLevel, Vote } from "@/contracts/contract";
import { blocks, checkOption } from "./constraints";
import type { CheckOptions, ConstraintMember, Issue, SpotIndex } from "./constraints";
import { creditWeight, isLevel, summarize } from "./metrics";
import type { Balances } from "./metrics";
import { settleCredits } from "./credits";

type OptionId = Option["id"];
export type Attempt = 1 | 2;
export interface Guard extends CheckOptions {
  members: readonly ConstraintMember[];
  spots: SpotIndex;
}
/** A stored vote = contract Vote + which attempt it belongs to (votes.vote_attempt in the DB). */
export type StoredVote = Vote & { attempt: Attempt; day?: string };
/** member_state.definitely_no_used_today + definitely_no_day */
export type DefinitelyNoCounter = { day: string | null; used: number };
export type Outcome = "open" | "decided" | "no_quorum" | "no_split_fallback" | "constraints_changed";
export interface Poll {
  optionSet: OptionSet;               // status "voting" while open
  roster: readonly string[];
  timezone: string;
  deadline: number;                   // ms, = optionSet.voteDeadline
  extended: boolean;                  // option_sets.vote_extended
  votes: readonly StoredVote[];
  definitelyNo: Readonly<Record<string, DefinitelyNoCounter>>;
  credits: Balances;                  // member_state.fairness_credits
  outcome: Outcome;
  decision?: Decision;
  issues?: Issue[];
}
export type VoteError = "vote_closed" | "stale_vote_scope" | "unknown_option" | "invalid_vote" | "definitely_no_limit";

const minutes = (n: number) => n * 60_000;
const OPTION_IDS: readonly OptionId[] = ["A", "B", "C"];

export function quorumNeeded(memberCount: number): number {
  if (!Number.isSafeInteger(memberCount) || memberCount < 1) throw new Error("Invalid member count");
  return Math.ceil(SETTINGS.quorumRatio * memberCount);
}

/** Local calendar date (YYYY-MM-DD) in the trip timezone, used for the daily "definitely_no" limit. */
export function localDay(now: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

/** Maps internal errors to the 3 codes allowed in ChatResponse.errors. */
export function contractErrorCode(error: VoteError): "definitely_no_limit" | "vote_closed" | "unknown_option" {
  return error === "definitely_no_limit" || error === "unknown_option" ? error : "vote_closed";
}

function unsafe(optionSet: OptionSet, guard: Guard): Issue[] {
  return optionSet.options.flatMap(option => {
    const issues = checkOption(option, guard.members, guard.spots, guard);
    return blocks(issues, guard.strictEvidence) ? issues : [];
  });
}

/** Opens the final vote on an option set. Throws if the set is malformed or an option is unsafe. */
export function startPoll(
  optionSet: OptionSet, guard: Guard, timezone: string, credits: Balances,
  definitelyNo: Readonly<Record<string, DefinitelyNoCounter>> = {},
): Poll {
  const roster = guard.members.map(member => member.id);
  const ids = optionSet.options.map(option => option.id);
  const deadline = Date.parse(optionSet.voteDeadline ?? "");
  if (optionSet.status !== "voting" || !optionSet.id || !optionSet.tripId ||
      !Number.isInteger(optionSet.round) || optionSet.round < 1 || optionSet.round > SETTINGS.maxRounds ||
      optionSet.chosenOptionId !== undefined || !ids.length ||
      !ids.includes(optionSet.candidateOptionId) || ids.length !== new Set(ids).size ||
      ids.some(id => !OPTION_IDS.includes(id)) || !roster.length || !roster.every(Boolean) ||
      new Set(roster).size !== roster.length || !Number.isFinite(deadline)) {
    throw new Error("Invalid final poll");
  }
  localDay(0, timezone); // throws on an unknown timezone
  for (const balance of Object.values(credits)) creditWeight(balance);
  const issues = unsafe(optionSet, guard);
  if (issues.length) throw new Error("Final poll has unsafe options", { cause: issues });
  return {
    optionSet: { ...structuredClone(optionSet), voteAttempt: optionSet.voteAttempt ?? 1, voterIds: optionSet.voterIds ?? [] },
    roster, timezone, deadline, extended: false, votes: [], definitelyNo: { ...definitelyNo },
    credits: { ...credits }, outcome: "open",
  };
}

/** Complete ballots of the CURRENT attempt, by member. */
export function completeBallots(poll: Poll): Map<string, Map<OptionId, StoredVote>> {
  const attempt = poll.optionSet.voteAttempt ?? 1;
  const ballots = new Map<string, Map<OptionId, StoredVote>>();
  for (const vote of poll.votes) {
    if (vote.attempt !== attempt || !poll.roster.includes(vote.memberId)) continue;
    if (!ballots.has(vote.memberId)) ballots.set(vote.memberId, new Map());
    ballots.get(vote.memberId)!.set(vote.optionId, vote);
  }
  return new Map([...ballots].filter(([, ballot]) => poll.optionSet.options.every(({ id }) => ballot.has(id))));
}

/**
 * Records one rating. `attempt` must be the attempt the member saw (protects against a stale page
 * voting into the revote). Returns the new poll, or the unchanged poll and an error.
 */
export function castVote(poll: Poll, vote: Vote, attempt: Attempt, now: number):
  { poll: Poll; error: VoteError | null; definitelyNoCharged: boolean } {
  const reject = (error: VoteError) => ({ poll, error, definitelyNoCharged: false });
  const { optionSet } = poll;
  if (!Number.isFinite(now) || poll.outcome !== "open" || now >= poll.deadline) return reject("vote_closed");
  if (vote.optionSetId !== optionSet.id || attempt !== (optionSet.voteAttempt ?? 1)) return reject("stale_vote_scope");
  const option = optionSet.options.find(o => o.id === vote.optionId);
  if (!option) return reject("unknown_option");
  if (!poll.roster.includes(vote.memberId) || !isLevel(vote.level) ||
      (vote.acceptsSplit !== undefined && (option.kind !== "split" || typeof vote.acceptsSplit !== "boolean"))) {
    return reject("invalid_vote");
  }
  const today = localDay(now, poll.timezone);
  let definitelyNo = poll.definitelyNo;
  let charged = false;
  if (vote.level === "definitely_no") {
    // Re-sending "definitely_no" for the same option today (same vote, or the revote) is free.
    const alreadyCharged = poll.votes.some(v => v.memberId === vote.memberId && v.optionId === vote.optionId &&
      v.level === "definitely_no" && (v.day ?? today) === today);
    if (!alreadyCharged) {
      const counter = definitelyNo[vote.memberId];
      const used = counter?.day === today ? counter.used : 0;
      if (used >= SETTINGS.maxDefinitelyNoPerDay) return reject("definitely_no_limit");
      definitelyNo = { ...definitelyNo, [vote.memberId]: { day: today, used: used + 1 } };
      charged = true;
    }
  }
  const same = (v: StoredVote) => v.memberId === vote.memberId && v.optionId === vote.optionId && v.attempt === attempt;
  const stored: StoredVote = { ...vote, attempt, day: today };
  const next: Poll = { ...poll, votes: [...poll.votes.filter(v => !same(v)), stored], definitelyNo };
  const complete = completeBallots(next);
  return {
    poll: { ...next, optionSet: { ...optionSet, voterIds: poll.roster.filter(id => complete.has(id)) } },
    error: null, definitelyNoCharged: charged,
  };
}

/** Call at (or after) the deadline. Returns the same object if nothing has to change. */
export function advancePoll(poll: Poll, now: number, guard: Guard): Poll {
  if (!Number.isFinite(now)) throw new Error("Invalid server time");
  if (poll.outcome !== "open" || now < poll.deadline) return poll;
  const { optionSet } = poll;
  const withDeadline = (deadline: number, fields: Partial<OptionSet>): OptionSet =>
    ({ ...optionSet, ...fields, voteDeadline: new Date(deadline).toISOString() });

  const roster = new Set(guard.members.map(member => member.id));
  const issues = roster.size !== poll.roster.length || poll.roster.some(id => !roster.has(id))
    ? [{ code: "invalid_route" as const, status: "violation" as const }] : unsafe(optionSet, guard);
  if (issues.length) return { ...poll, outcome: "constraints_changed", issues };

  const ballots = completeBallots(poll);
  const voterIds = poll.roster.filter(id => ballots.has(id));
  if (voterIds.length < quorumNeeded(poll.roster.length)) {
    if (poll.extended) return { ...poll, outcome: "no_quorum" };
    const deadline = poll.deadline + minutes(SETTINGS.voteExtensionMin);
    return { ...poll, extended: true, deadline, optionSet: withDeadline(deadline, {}) };
  }

  const totals = optionSet.options.map(option => {
    const scores = new Map<string, SatisfactionLevel>();
    for (const id of voterIds) scores.set(id, ballots.get(id)!.get(option.id)!.level);
    return { option, metrics: summarize(scores, poll.credits)! };
  });
  const compare = (a: typeof totals[number], b: typeof totals[number]) =>
    b.metrics.weightedTotal - a.metrics.weightedTotal || b.metrics.min - a.metrics.min || b.metrics.mean - a.metrics.mean;
  totals.sort(compare);
  const tied = totals.length > 1 && compare(totals[0], totals[1]) === 0;
  if (tied && (optionSet.voteAttempt ?? 1) === 1) {
    const deadline = now + minutes(SETTINGS.roundTimeoutMin);
    return { ...poll, extended: false, deadline, optionSet: withDeadline(deadline, { voteAttempt: 2, voterIds: [] }) };
  }

  const accepted = (option: Option) => option.kind !== "split" || option.branches!.every(branch =>
    branch.memberIds.every(id => ballots.get(id)?.get(option.id)?.acceptsSplit === true));
  let chosen = tied ? optionSet.options.find(o => o.id === optionSet.candidateOptionId)! : totals[0].option;
  let resolvedBy: Decision["resolvedBy"] = tied ? "tie_candidate" : "vote";
  if (!accepted(chosen)) {
    const fallback = totals.filter(entry => entry.option.kind !== "split");
    if (!fallback.length) return { ...poll, outcome: "no_split_fallback" };
    const candidate = fallback.find(entry => entry.option.id === optionSet.candidateOptionId);
    chosen = candidate && compare(fallback[0], candidate) === 0 ? candidate.option :
      fallback.filter(entry => compare(fallback[0], entry) === 0).sort((a, b) => a.option.id < b.option.id ? -1 : 1)[0].option;
    resolvedBy = "split_refused";
  }
  const eligible = optionSet.options.filter(accepted).map(option => option.id);
  const { balances, events } = settleCredits(optionSet.id, chosen.id, eligible, ballots, poll.credits);
  const decision: Decision = {
    optionSetId: optionSet.id, chosenOptionId: chosen.id, voterIds, resolvedBy,
    creditEvents: events, decidedAt: new Date(now).toISOString(),
    ...(chosen.kind === "split" ? { splitAcceptedBy: chosen.branches!.flatMap(b => b.memberIds) } : {}),
  };
  return {
    ...poll, credits: balances, decision, outcome: "decided",
    optionSet: { ...optionSet, status: "decided", voterIds, chosenOptionId: chosen.id },
  };
}
