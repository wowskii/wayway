// Translators between Supabase rows and the voting state (Role 4 <-> API routes).
// Pure: no database calls here. The /api/chat route reads the rows with the admin client,
// calls these + voting.ts, then writes the returned rows (ideally in one transaction / RPC).
//
// Server only: member_state and credit_events are hidden from every user (RLS), never send them
// to the browser.
import type { Decision, ItineraryItem, Option, OptionSet, TimeSlot } from "@/contracts/contract";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/db/database.types";
import { localDay } from "./voting";
import type { Attempt, DefinitelyNoCounter, Guard, Poll, StoredVote } from "./voting";
import { isLevel } from "./metrics";

/** vote_extended comes from migration 20261123000001 (optional until the DB types are regenerated). */
export type OptionSetRow = Tables<"option_sets"> & { vote_extended?: boolean | null };
export type VoteRow = Tables<"votes">;
export type MemberStateRow = Tables<"member_state">;

const asAttempt = (n: number | null | undefined): Attempt => (n === 2 ? 2 : 1);
const asId = (s: string | null | undefined) => (s === "A" || s === "B" || s === "C" ? s : undefined);

export function optionSetFromRow(row: OptionSetRow): OptionSet {
  return {
    id: row.id, tripId: row.trip_id, slot: row.slot as unknown as TimeSlot, round: row.round,
    options: row.options as unknown as Option[], candidateOptionId: asId(row.candidate_option_id) ?? "A",
    status: row.status as OptionSet["status"], roundDeadline: row.round_deadline,
    ...(row.vote_deadline ? { voteDeadline: row.vote_deadline } : {}),
    voterIds: row.voter_ids, ...(row.vote_attempt ? { voteAttempt: asAttempt(row.vote_attempt) } : {}),
    ...(asId(row.chosen_option_id) ? { chosenOptionId: asId(row.chosen_option_id) } : {}),
  };
}

export function voteFromRow(row: VoteRow, timezone: string): StoredVote | null {
  const optionId = asId(row.option_id);
  if (!optionId || !isLevel(row.level)) return null;
  return {
    optionSetId: row.option_set_id, optionId, memberId: row.member_id, level: row.level,
    ...(row.critique ? { critique: row.critique } : {}),
    ...(row.accepts_split !== null ? { acceptsSplit: row.accepts_split } : {}),
    attempt: asAttempt(row.vote_attempt), day: localDay(Date.parse(row.created_at), timezone),
  };
}

/** Rebuilds an OPEN poll from the database (option set must have status "voting"). */
export function pollFromRows(input: {
  optionSet: OptionSetRow; votes: readonly VoteRow[]; states: readonly MemberStateRow[];
  timezone: string; guard: Guard;
}): Poll {
  const optionSet = optionSetFromRow(input.optionSet);
  const credits: Record<string, number> = {};
  const definitelyNo: Record<string, DefinitelyNoCounter> = {};
  for (const s of input.states) {
    credits[s.member_id] = s.fairness_credits;
    definitelyNo[s.member_id] = { day: s.definitely_no_day, used: s.definitely_no_used_today };
  }
  const outcome = optionSet.status === "decided" ? "decided" : "open";
  return {
    optionSet, roster: input.guard.members.map(m => m.id), timezone: input.timezone,
    deadline: Date.parse(optionSet.voteDeadline ?? optionSet.roundDeadline),
    extended: Boolean(input.optionSet.vote_extended),
    votes: input.votes.map(v => voteFromRow(v, input.timezone)).filter((v): v is StoredVote => v !== null),
    definitelyNo, credits, outcome,
  };
}

export function voteToRow(vote: StoredVote): TablesInsert<"votes"> {
  return {
    option_set_id: vote.optionSetId, option_id: vote.optionId, member_id: vote.memberId,
    vote_attempt: vote.attempt, level: vote.level, critique: vote.critique ?? null,
    accepts_split: vote.acceptsSplit ?? null,
  };
}

export function optionSetUpdate(poll: Poll): TablesUpdate<"option_sets"> & { vote_extended: boolean } {
  const s = poll.optionSet;
  return {
    status: s.status, vote_deadline: s.voteDeadline ?? null, voter_ids: s.voterIds ?? [],
    vote_attempt: s.voteAttempt ?? null, chosen_option_id: s.chosenOptionId ?? null, vote_extended: poll.extended,
  };
}

/** member_state rows that changed (credits after a decision, "definitely_no" counter after a vote). */
export function memberStateUpdates(before: Poll, after: Poll): (TablesUpdate<"member_state"> & { member_id: string })[] {
  return after.roster.flatMap(id => {
    const a = after.definitelyNo[id];
    const b = before.definitelyNo[id];
    const counterChanged = a && (a.day !== b?.day || a.used !== b?.used);
    const creditChanged = (after.credits[id] ?? 0) !== (before.credits[id] ?? 0);
    if (!counterChanged && !creditChanged) return [];
    return [{
      member_id: id,
      ...(counterChanged ? { definitely_no_day: a.day, definitely_no_used_today: a.used } : {}),
      ...(creditChanged ? { fairness_credits: after.credits[id] ?? 0 } : {}),
    }];
  });
}

/** Rows to insert once a poll is decided: decision, credit audit trail, itinerary items. */
export function decisionRows(decision: Decision, tripId: string, itinerary: readonly ItineraryItem[]) {
  return {
    decision: {
      option_set_id: decision.optionSetId, trip_id: tripId, chosen_option_id: decision.chosenOptionId,
      voter_ids: decision.voterIds, split_accepted_by: decision.splitAcceptedBy ?? null,
      resolved_by: decision.resolvedBy, decided_at: decision.decidedAt,
    } satisfies TablesInsert<"decisions">,
    creditEvents: decision.creditEvents.map(e => ({
      member_id: e.memberId, option_set_id: e.optionSetId, change: e.change, reason: e.reason,
    }) satisfies TablesInsert<"credit_events">),
    itinerary: itinerary.map(item => ({
      trip_id: tripId, option_set_id: decision.optionSetId, day: item.day,
      start_time: item.start, end_time: item.end, spot_id: item.spotId ?? null,
      branches: (item.branches ?? null) as TablesInsert<"itinerary_items">["branches"],
    }) satisfies TablesInsert<"itinerary_items">),
  };
}
