import "server-only";
// The final vote of the Spot Suggestions (after round 3): a member rates each option A / B / C with
// one of the 5 levels; on a split option they also say whether they are OK to split up.
// Henry's rules decide (src/lib/logic/voting.ts), this file only loads and saves:
//   pollFromRows -> castVote (vote still open, option exists, "definitely no" max 2 a day, split
//   answer only on a split) -> save the vote, my "definitely no" counter and who has voted.
// A ballot counts only when EVERY option is rated (completeBallots). When every member has a complete
// ballot, the vote deadline is moved to now: the usual closing step (advancePoll -> decision, credits,
// itinerary, in lib/chatbox-rounds/service.ts) runs right away instead of at the deadline.
import type { Option, SatisfactionLevel, Vote } from "@/contracts/contract";
import { loadSuggestions } from "@/lib/chatbox-trip-hub/suggestions";
import { toMemberProfile } from "@/lib/db/mappers";
import { InterviewError, loadOwnMember } from "@/lib/interview/service";
import { castVote, completeBallots, memberStateUpdates, pollFromRows, voteToRow, type VoteError } from "@/lib/logic";
import { SPOT_INDEX } from "@/lib/logic/dataset";
import { createAdminClient } from "@/lib/supabase/admin";
import type { VoteResponse } from "./types";

const MESSAGES: Record<VoteError, string> = {
  definitely_no_limit: "You can use “Definitely no” only twice a day. Pick another level.",
  vote_closed: "This vote is closed.",
  stale_vote_scope: "This vote has changed (a revote started). Reload the page.",
  unknown_option: "This option doesn't exist.",
  invalid_vote: "This vote is not valid.",
};

export async function castMyVote(
  tripId: string,
  optionSetId: string,
  optionId: Option["id"],
  level: SatisfactionLevel,
  acceptsSplit?: boolean,
): Promise<VoteResponse> {
  const { supabase, member } = await loadOwnMember(tripId);   // logged in + member of this trip
  const admin = createAdminClient();

  const [{ data: row }, { data: trip }, { data: memberRows }] = await Promise.all([
    admin.from("option_sets").select("*").eq("id", optionSetId).eq("trip_id", tripId).maybeSingle(),
    admin.from("trips").select("timezone").eq("id", tripId).single(),
    admin.from("trip_members").select("*").eq("trip_id", tripId).order("joined_at"),
  ]);
  if (!row || !trip) throw new InterviewError(404, "This vote was not found.");
  if (row.status !== "voting") throw new InterviewError(409, MESSAGES.vote_closed);

  const ids = (memberRows ?? []).map((m) => m.id);
  const [{ data: privRows }, { data: states }, { data: votes }] = await Promise.all([
    admin.from("member_private").select("*").in("member_id", ids),
    admin.from("member_state").select("*").in("member_id", ids),
    admin.from("votes").select("*").eq("option_set_id", row.id),
  ]);
  // Henry's guard re-checks every option against every member's hard constraints (private data: server only)
  const members = (memberRows ?? []).map((m) =>
    toMemberProfile(m, privRows?.find((p) => p.member_id === m.id), states?.find((s) => s.member_id === m.id)),
  );
  const guard = { members, spots: SPOT_INDEX };
  const before = pollFromRows({ optionSet: row, votes: votes ?? [], states: states ?? [], timezone: trip.timezone, guard });
  const attempt = before.optionSet.voteAttempt ?? 1;

  const vote: Vote = { optionSetId: row.id, optionId, memberId: member.id, level, ...(acceptsSplit !== undefined ? { acceptsSplit } : {}) };
  const { poll: after, error } = castVote(before, vote, attempt, Date.now());   // server time decides
  if (error) throw new InterviewError(error === "invalid_vote" || error === "unknown_option" ? 400 : 409, MESSAGES[error]);

  // Save my vote (one row per option and attempt: sending again replaces it)
  const stored = after.votes.find((v) => v.memberId === member.id && v.optionId === optionId && v.attempt === attempt);
  if (!stored) throw new InterviewError(500, "Your vote was not saved. Try again.");
  const { error: e1 } = await admin.from("votes").upsert(voteToRow(stored), { onConflict: "option_set_id,option_id,member_id,vote_attempt" });
  if (e1) throw new InterviewError(500, "Your vote was not saved. Try again.");

  // My "definitely no" counter (member_state is server only)
  for (const { member_id, ...fields } of memberStateUpdates(before, after)) {
    await admin.from("member_state").upsert({ member_id, ...fields }, { onConflict: "member_id" });
  }

  // Who has a complete ballot, recomputed from the saved votes (two members may vote at the same second)
  const { data: fresh } = await admin.from("votes").select("*").eq("option_set_id", row.id);
  const poll = pollFromRows({ optionSet: row, votes: fresh ?? [], states: states ?? [], timezone: trip.timezone, guard });
  const voterIds = [...completeBallots(poll).keys()];
  const everyone = ids.length > 0 && ids.every((id) => voterIds.includes(id));
  const nowIso = new Date().toISOString();
  await admin
    .from("option_sets")
    .update({ voter_ids: voterIds, ...(everyone && row.vote_deadline && row.vote_deadline > nowIso ? { vote_deadline: nowIso } : {}) })
    .eq("id", row.id)
    .eq("status", "voting");

  return { suggestions: await loadSuggestions(supabase, tripId, member.id) };
}
