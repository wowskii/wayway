import "server-only";
// "@WayWay ..." in the group chat (POST /api/chatbox/message). The flow decided by the team:
// WayWay agrees on WHEN first, then proposes WHAT.
//
//   ① save my message (as me: RLS "send as yourself")
//   ② negotiateSlot (Simon, AI): read the message with the recent chat, the pending proposal and
//      the slots already planned ->
//        none     nothing to do (no answer)
//        ask      WayWay asks what to plan
//        propose  a new time: the previous pending proposal is cancelled, the new one saved
//                 (slot_proposals, "pending") and WayWay asks the group to confirm or change it
//        confirm / change  the time is agreed (by ANY member): proposal "confirmed" -> ③
//   ③ options for the agreed slot: filterSpotsForTrip (Henry) -> generateOptions (Simon, AI) ->
//      buildOptions (Henry) -> a new option set (round 1, collecting feedback, one round to answer)
//      -> writeMessage("options_round") (Simon, AI). It then shows up in Spot Suggestions.
//
// Everything WayWay posts is written by the server (sender_member_id = null) and reaches every
// member through Realtime. Uses the admin client for the AI's private context: server only.
import type { TimeSlot } from "@/contracts/contract";
import { getWayWayAI } from "@/lib/ai/wayway";
import { MAX_CHAT_LENGTH } from "@/lib/chatbox-chat/client";
import { loadContext, localTime, postAsWayWay, postMessage, roundMs, type Context } from "@/lib/chatbox-rounds/service";
import { toSlot } from "@/lib/chatbox-trip-hub/suggestions";
import type { Json } from "@/lib/db/database.types";
import { toChatMessage } from "@/lib/db/mappers";
import { InterviewError, loadOwnMember } from "@/lib/interview/service";
import { buildOptions } from "@/lib/logic";
import { SPOT_INDEX } from "@/lib/logic/dataset";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAiLimit } from "@/lib/ai/limit";
import { AIOutputError, describeOptions, mentionsWayWay } from "../../../wayway-ai/lib/ai";
import { getRoundAI } from "@/lib/ai/rounds";
import { currencyOf } from "@/lib/cities";
import { toOptions } from "@/lib/chatbox-trip-hub/suggestions";
import { SPOTS_BY_ID } from "@/lib/logic/dataset";
import type { WayWayMessageResponse } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

export async function sendWayWayMessage(tripId: string, text: string): Promise<WayWayMessageResponse> {
  const clean = text.trim();
  if (!clean) throw new InterviewError(400, "Write a message first.");
  if (clean.length > MAX_CHAT_LENGTH) throw new InterviewError(400, `Keep it under ${MAX_CHAT_LENGTH} characters.`);

  // ① My message, saved as me
  const { supabase, member } = await loadOwnMember(tripId);
  if (mentionsWayWay(clean)) await checkAiLimit(createAdminClient(), "chat", member.id);   // before saving: a refused message is not posted
  const { data: mine, error } = await supabase
    .from("chat_messages")
    .insert({ trip_id: tripId, sender_member_id: member.id, text: clean })
    .select("*")
    .single();
  if (error || !mine) throw new InterviewError(500, "Your message was not sent. Try again.");
  const message = toChatMessage(mine);
  if (!mentionsWayWay(clean)) return { message, replies: [] };

  // ② When? (the context is read AFTER my message, so the AI sees it in the recent chat too)
  const admin = createAdminClient();
  const [ctx, { data: pendingRow }, { data: setRows }] = await Promise.all([
    loadContext(admin, tripId),
    admin.from("slot_proposals").select("*").eq("trip_id", tripId).eq("status", "pending")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("option_sets").select("slot, status, chosen_option_id").eq("trip_id", tripId),
  ]);
  const pending = pendingRow ? toSlot(pendingRow.slot) ?? undefined : undefined;
  // Slots already being decided, or decided with a result (a vote closed without a result frees its slot)
  const decided = (setRows ?? [])
    .filter((r) => r.status !== "decided" || r.chosen_option_id)
    .flatMap((r) => toSlot(r.slot) ?? []);

  const ai = getWayWayAI();
  const out = await ai.negotiate({ trip: ctx.trip, message, recentChat: ctx.recentChat, pending, decided });
  const replies = [];

  if ((out.action === "ask" || out.action === "propose") && out.reply) {
    if (out.action === "propose" && out.slot && out.kind) {
      await admin.from("slot_proposals").update({ status: "cancelled" }).eq("trip_id", tripId).eq("status", "pending");
      await admin.from("slot_proposals").insert({
        trip_id: tripId, slot: out.slot as unknown as NonNullable<Json>, kind: out.kind, status: "pending", requested_by: member.id,
      });
    }
    replies.push(await postAsWayWay(admin, tripId, out.reply, null));
  }

  if ((out.action === "confirm" || out.action === "change") && out.slot && out.kind) {
    let agreed = true;
    if (pendingRow) {
      // Confirm the pending proposal once (two members may say "ok" at the same second)
      const { data: claimed } = await admin
        .from("slot_proposals")
        .update({ status: "confirmed", slot: out.slot as unknown as NonNullable<Json>, kind: out.kind, confirmed_by: member.id })
        .eq("id", pendingRow.id)
        .eq("status", "pending")
        .select("id");
      agreed = Boolean(claimed?.length);
    } else {
      // Exact times given in the first message: agreed at once
      await admin.from("slot_proposals").insert({
        trip_id: tripId, slot: out.slot as unknown as NonNullable<Json>, kind: out.kind, status: "confirmed",
        requested_by: member.id, confirmed_by: member.id,
      });
    }
    if (agreed) replies.push(...(await createOptions(admin, ctx, out.slot)));
  }

  // Not about the time (a question about the options, a greeting...): WayWay answers instead of staying silent.
  if (out.action === "none") replies.push(await answerInGroup(admin, ctx, tripId));

  return { message, replies: replies.filter((r) => r !== null) };
}

// The open option set (feedback or vote) gives the facts: WayWay answers with the cards only (writeMessage
// "answer_question"). No open set: a fixed sentence built by code (no AI call).
async function answerInGroup(admin: ReturnType<typeof createAdminClient>, ctx: Context, tripId: string) {
  const { data: open } = await admin
    .from("option_sets")
    .select("id, options")
    .eq("trip_id", tripId)
    .in("status", ["collecting_feedback", "voting"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const options = open ? toOptions(open.options) : [];
  if (!options.length) {
    return postAsWayWay(admin, tripId, 'I can plan the next part of your trip: tell me what and when, e.g. "@WayWay lunch tomorrow" or "@WayWay this afternoon".', null);
  }
  const names = Object.fromEntries(ctx.members.map((m) => [m.id, m.name]));
  const spots = [...new Set(options.flatMap((o) => (o.branches ? o.branches.flatMap((b) => b.spots) : o.spots)))]
    .flatMap((id) => (SPOTS_BY_ID[id] ? [SPOTS_BY_ID[id]] : []));
  const { write } = getRoundAI();
  const msg = await write({
    trip: ctx.trip, kind: "answer_question", recentChat: ctx.recentChat,
    facts: { options: describeOptions(options, spots, names, currencyOf(ctx.trip.city)) },
  });
  return postAsWayWay(admin, tripId, msg.text, open?.id ?? null);
}

// ③ What? The first option set for the agreed slot
async function createOptions(admin: Admin, ctx: Context, slot: TimeSlot) {
  const { generate } = getWayWayAI();
  let gen;
  try {
    gen = await generate({ trip: ctx.trip, slot, allowedSpots: ctx.allowedSpots, recentChat: ctx.recentChat });
  } catch (err) {
    if (!(err instanceof AIOutputError)) throw err;
    console.warn("[wayway] generateOptions failed:", err.kind, err.errors);   // Simon: no fallback here, the route answers
    return [await postAsWayWay(admin, ctx.trip.id, `I couldn't prepare options for ${slot.label} right now. Ask @WayWay again in a moment.`, null)];
  }

  const built = buildOptions(gen.candidates, ctx.members, SPOT_INDEX, ctx.credits, { spentByMember: ctx.spentByMember });
  if (!built.options.length) {
    return [await postAsWayWay(admin, ctx.trip.id, `Nothing fits everyone for ${slot.label}. Try another time with @WayWay.`, null)];
  }

  const deadline = new Date(Date.now() + roundMs()).toISOString();
  const { data: set, error } = await admin
    .from("option_sets")
    .insert({
      trip_id: ctx.trip.id,
      slot: slot as unknown as NonNullable<Json>,
      round: 1,
      options: built.options as unknown as NonNullable<Json>,
      candidate_option_id: built.candidateOptionId ?? built.options[0].id,
      status: "collecting_feedback",
      round_deadline: deadline,
    })
    .select("id")
    .single();
  if (error || !set) throw new Error(`Option set not saved: ${error?.message}`);

  return [await postMessage(admin, ctx, set.id, "options_round", {
    slot: slot.label, options: built.options.map((o) => `${o.id}: ${o.title}`), deadline: localTime(deadline, ctx.timezone),
  })];
}
