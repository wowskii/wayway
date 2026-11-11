import "server-only";
// Server logic of the onboarding interview (private chat with WayWay, round 0).
// Order of every turn:  check who you are -> save your message -> ask the interviewer ->
// save what it learned -> save WayWay's reply -> send both messages back.
// Hard constraints (diet, allergies, budget) are only PROPOSED here; they are applied
// in confirmConstraints() after the member taps "Confirm".
import type { HardConstraints, PrivateMessage } from "@/contracts/contract";
import { openingMessage } from "@/lib/ai-mock/interview";
import { getInterviewer } from "@/lib/ai/interviewer";
import { isInterviewTopic, progressFrom, type InterviewProgress } from "@/lib/ai/types";
import {
  constraintsToConfirm,
  toMemberProfile,
  toPrivateMessage,
  type PrivateMessageRow,
} from "@/lib/db/mappers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const ONBOARDING_ROUND = 0;
const HISTORY_SIZE = 12;
export const MAX_MESSAGE_LENGTH = 1000;

/** A private message as the interview page needs it: the contract shape + the confirmation card. */
export interface InterviewMessage extends PrivateMessage {
  constraintsToConfirm?: Partial<HardConstraints>;
  constraintsStatus?: "pending" | "confirmed" | "rejected";
}

export class InterviewError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 500, message: string) {
    super(message);
  }
}

export function toInterviewMessage(row: PrivateMessageRow): InterviewMessage {
  const card = constraintsToConfirm(row);
  return {
    ...toPrivateMessage(row),
    ...(card ? { constraintsToConfirm: card } : {}),
    ...(row.constraints_status ? { constraintsStatus: row.constraints_status as InterviewMessage["constraintsStatus"] } : {}),
  };
}

/**
 * Loads the member that belongs to the logged-in user in this trip.
 * Uses the user's own client, so RLS guarantees they can only load THEMSELVES.
 */
async function loadOwnMember(tripId: string, memberId?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new InterviewError(401, "Please log in again.");

  let query = supabase.from("trip_members").select("*").eq("trip_id", tripId).eq("user_id", user.id);
  if (memberId) query = query.eq("id", memberId);
  const { data: member } = await query.maybeSingle();
  if (!member) throw new InterviewError(403, "You are not a member of this trip.");

  const { data: priv } = await supabase.from("member_private").select("*").eq("member_id", member.id).single();
  return { supabase, member, priv };
}

/** Everything the interview page needs on load. Posts WayWay's opening message the first time. */
export async function getInterviewState(tripId: string) {
  const { supabase, member, priv } = await loadOwnMember(tripId);
  const admin = createAdminClient();

  let { data: rows } = await supabase
    .from("private_messages")
    .select("*")
    .eq("member_id", member.id)
    .order("created_at", { ascending: true });

  if (!rows?.length) {
    const { data: first, error } = await admin
      .from("private_messages")
      .insert({ trip_id: tripId, member_id: member.id, sender: "wayway", text: openingMessage(member.name), round: ONBOARDING_ROUND })
      .select("*")
      .single();
    if (error) throw new InterviewError(500, "Could not start the interview.");
    rows = [first];
  }

  return {
    memberId: member.id,
    memberName: member.name,
    onboardingStatus: member.onboarding_status,
    messages: rows.map(toInterviewMessage),
    interview: progressFrom((priv?.interview_topics ?? []).filter(isInterviewTopic)),
  };
}

/** One turn of the interview: the member's message in, WayWay's reply out. */
export async function sendInterviewMessage(tripId: string, memberId: string, text: string) {
  const clean = text.trim();
  if (!clean) throw new InterviewError(400, "Write a message first.");
  if (clean.length > MAX_MESSAGE_LENGTH) throw new InterviewError(400, `Keep it under ${MAX_MESSAGE_LENGTH} characters.`);

  const { supabase, member, priv } = await loadOwnMember(tripId, memberId);
  const admin = createAdminClient();

  // 1. Save the member's message (as the user: RLS checks it is really theirs)
  const { data: mine, error: e1 } = await supabase
    .from("private_messages")
    .insert({ trip_id: tripId, member_id: member.id, sender: "member", text: clean, round: ONBOARDING_ROUND })
    .select("*")
    .single();
  if (e1 || !mine) throw new InterviewError(500, "Could not save your message.");

  // 2. Context for the interviewer
  const { data: state } = await admin.from("member_state").select("*").eq("member_id", member.id).maybeSingle();
  const { data: recent } = await supabase
    .from("private_messages")
    .select("*")
    .eq("member_id", member.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_SIZE + 1);
  const history = (recent ?? []).filter((r) => r.id !== mine.id).reverse().map(toPrivateMessage);
  const coveredTopics = (priv?.interview_topics ?? []).filter(isInterviewTopic);

  // 3. Ask the interviewer (mock or real AI)
  const out = await getInterviewer()({
    member: toMemberProfile(member, priv, state),
    message: toPrivateMessage(mine),
    history,
    round: ONBOARDING_ROUND,
    coveredTopics,
  });

  // 4. Save what it learned. Private things go to member_private, public profile to trip_members.
  await admin
    .from("member_private")
    .update({
      preference_statements: out.preferenceUpdate.statements,
      interview_topics: out.interview.covered,
      updated_at: new Date().toISOString(),
    })
    .eq("member_id", member.id);

  const p = out.profileUpdate;
  await admin
    .from("trip_members")
    .update({
      ...(p?.interests ? { interests: p.interests } : {}),
      ...(p?.pace ? { pace: p.pace } : {}),
      ...(p?.sleep ? { sleep: p.sleep } : {}),
      ...(member.onboarding_status === "not_started" ? { onboarding_status: "in_progress" } : {}),
    })
    .eq("id", member.id);

  // 5. Save WayWay's reply, with the confirmation card if hard constraints were detected
  const card = out.preferenceUpdate.hardConstraintsToConfirm;
  const { data: reply, error: e2 } = await admin
    .from("private_messages")
    .insert({
      trip_id: tripId,
      member_id: member.id,
      sender: "wayway",
      text: out.reply,
      round: ONBOARDING_ROUND,
      ...(card ? { constraints_to_confirm: card, constraints_status: "pending" } : {}),
    })
    .select("*")
    .single();
  if (e2 || !reply) throw new InterviewError(500, "WayWay could not answer. Try again.");

  return {
    messages: [toInterviewMessage(mine), toInterviewMessage(reply)],
    preferenceUpdate: out.preferenceUpdate,
    interview: out.interview satisfies InterviewProgress,
  };
}

// ---------------------------------------------------------------------------
// Confirmation card
// ---------------------------------------------------------------------------

/** Keeps only clean values: short lowercase words, at most 10, and a sensible budget. */
export function sanitizeConstraints(raw: unknown): Partial<HardConstraints> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const words = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase()).filter((x) => x.length > 0 && x.length <= 40))].slice(0, 10)
      : undefined;
  const out: Partial<HardConstraints> = {};
  const diet = words(r.diet);
  const allergies = words(r.allergies);
  if (diet) out.diet = diet;
  if (allergies) out.allergies = allergies;
  if (typeof r.maxBudget === "number" && Number.isFinite(r.maxBudget) && r.maxBudget >= 1_000 && r.maxBudget <= 10_000_000) {
    out.maxBudget = Math.round(r.maxBudget);
  }
  return out;
}

/**
 * The member answers a confirmation card.
 * confirm: apply the values (optionally edited by the member); reject: apply nothing.
 * Diet goes to the public profile, allergies and budget to the private table.
 */
export async function answerConstraintCard(
  tripId: string,
  messageId: string,
  decision: "confirm" | "reject",
  edited?: unknown,
) {
  const { supabase, member, priv } = await loadOwnMember(tripId);
  const admin = createAdminClient();

  // RLS: the user can only read messages from their own private chat
  const { data: msg } = await supabase
    .from("private_messages")
    .select("*")
    .eq("id", messageId)
    .eq("member_id", member.id)
    .maybeSingle();
  if (!msg || msg.sender !== "wayway" || !msg.constraints_to_confirm) throw new InterviewError(404, "Card not found.");
  if (msg.constraints_status !== "pending") throw new InterviewError(409, "This card was already answered.");

  let applied: Partial<HardConstraints> = {};
  if (decision === "confirm") {
    applied = sanitizeConstraints(edited ?? msg.constraints_to_confirm);
    if (applied.diet) {
      await admin
        .from("trip_members")
        .update({ diet: [...new Set([...member.diet, ...applied.diet])] })
        .eq("id", member.id);
    }
    if (applied.allergies || applied.maxBudget !== undefined) {
      await admin
        .from("member_private")
        .update({
          ...(applied.allergies ? { allergies: [...new Set([...(priv?.allergies ?? []), ...applied.allergies])] } : {}),
          ...(applied.maxBudget !== undefined ? { max_budget: applied.maxBudget } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("member_id", member.id);
    }
  }

  const { data: updated } = await admin
    .from("private_messages")
    .update({
      constraints_status: decision === "confirm" ? "confirmed" : "rejected",
      ...(decision === "confirm" ? { constraints_to_confirm: applied } : {}),   // keep what was really applied
    })
    .eq("id", msg.id)
    .eq("constraints_status", "pending")      // two clicks at once: only the first one wins
    .select("*")
    .maybeSingle();
  if (!updated) throw new InterviewError(409, "This card was already answered.");

  return { message: toInterviewMessage(updated), applied };
}

/** The member taps "Finish": the interview is done (only when every topic is covered). */
export async function finishInterview(tripId: string) {
  const { member, priv } = await loadOwnMember(tripId);
  const progress = progressFrom((priv?.interview_topics ?? []).filter(isInterviewTopic));
  if (!progress.done) throw new InterviewError(409, "A few questions are still open.");
  await createAdminClient().from("trip_members").update({ onboarding_status: "done" }).eq("id", member.id);
  return { onboardingStatus: "done" as const };
}
