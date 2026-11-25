import "server-only";
// Server logic of a member's private feedback on the options of a round (rounds 1-3), from the
// Spot Suggestions panel. Same order as the interview turn:
//   check who you are -> check the option set is open -> save your message -> ask the AI
//   (Simon's extractPreferences, or the mock) -> save what it learned -> save WayWay's reply.
// Every message is tagged with the option set and its round, so each set has its own thread.
// Hard constraints are only PROPOSED (confirmation card, answered with /api/private/confirm).
import type { Json } from "@/lib/db/database.types";
import { getFeedbackHandler } from "@/lib/ai/feedback";
import { toMemberProfile, toPrivateMessage } from "@/lib/db/mappers";
import { InterviewError, loadOwnMember, MAX_MESSAGE_LENGTH, toInterviewMessage } from "@/lib/interview/service";
import { SPOTS } from "@/lib/spots";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAiLimit } from "@/lib/ai/limit";
import { toOptions } from "@/lib/chatbox-trip-hub/suggestions";
import type { FeedbackTurnResponse } from "./types";

const HISTORY_SIZE = 12;   // extractPreferences itself keeps the last 6

export async function sendFeedbackMessage(tripId: string, optionSetId: string, text: string): Promise<FeedbackTurnResponse> {
  const clean = text.trim();
  if (!clean) throw new InterviewError(400, "Write a message first.");
  if (clean.length > MAX_MESSAGE_LENGTH) throw new InterviewError(400, `Keep it under ${MAX_MESSAGE_LENGTH} characters.`);

  const { supabase, member, priv } = await loadOwnMember(tripId);
  const admin = createAdminClient();
  await checkAiLimit(admin, "private", member.id);

  // 1. The option set must be in this trip (RLS: members read their trip's sets) and still collecting feedback
  const { data: set } = await supabase
    .from("option_sets")
    .select("*")
    .eq("id", optionSetId)
    .eq("trip_id", tripId)
    .maybeSingle();
  if (!set) throw new InterviewError(404, "These suggestions were not found.");
  if (set.status !== "collecting_feedback") throw new InterviewError(409, "Feedback for this round is closed.");
  const options = toOptions(set.options);

  // 2. Save the member's message (as the user: RLS checks it is really theirs)
  const { data: mine, error: e1 } = await supabase
    .from("private_messages")
    .insert({ trip_id: tripId, member_id: member.id, sender: "member", text: clean, round: set.round, option_set_id: set.id })
    .select("*")
    .single();
  if (e1 || !mine) throw new InterviewError(500, "Could not save your message.");

  // 3. Context: my state (server-only table), names for split groups, this set's thread so far
  const [{ data: state }, { data: memberRows }, { data: recent }] = await Promise.all([
    admin.from("member_state").select("*").eq("member_id", member.id).maybeSingle(),
    supabase.from("trip_members").select("id, name").eq("trip_id", tripId),
    supabase
      .from("private_messages")
      .select("*")
      .eq("member_id", member.id)
      .eq("option_set_id", set.id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_SIZE + 1),
  ]);
  const history = (recent ?? []).filter((r) => r.id !== mine.id).reverse().map(toPrivateMessage);

  // 4. Ask WayWay (mock, or Simon's extractPreferences). AI failures fall back inside it.
  const out = await getFeedbackHandler()({
    member: toMemberProfile(member, priv, state),
    message: toPrivateMessage(mine),
    history,
    round: set.round,
    currentOptions: options,
    spots: SPOTS,
    memberNames: Object.fromEntries((memberRows ?? []).map((m) => [m.id, m.name])),
  });

  // 5. Save what it learned: the FULL updated statement list (private table)
  await admin
    .from("member_private")
    .update({ preference_statements: out.preferenceUpdate.statements, updated_at: new Date().toISOString() })
    .eq("member_id", member.id);

  // 6. Save WayWay's reply, with this message's reactions and the confirmation card if any
  const card = out.preferenceUpdate.hardConstraintsToConfirm;
  const reactions = out.preferenceUpdate.reactions;
  const { data: reply, error: e2 } = await admin
    .from("private_messages")
    .insert({
      trip_id: tripId,
      member_id: member.id,
      sender: "wayway",
      text: out.reply,
      round: set.round,
      option_set_id: set.id,
      ...(reactions?.length ? { reactions: reactions as unknown as Json } : {}),
      ...(card ? { constraints_to_confirm: card, constraints_status: "pending" } : {}),
    })
    .select("*")
    .single();
  if (e2 || !reply) throw new InterviewError(500, "WayWay could not answer. Try again.");

  return { messages: [toInterviewMessage(mine), toInterviewMessage(reply)] };
}
