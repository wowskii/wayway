import "server-only";
// Round change of the Spot Suggestions (rounds 1-3, then the final vote). Called by
// POST /api/chatbox/next-round when a member's browser sees a round end (countdown at 0, or a page
// opened after the deadline). Server time decides, never the browser's.
//
//   for each option set of the trip still collecting feedback whose round_deadline has passed:
//     ① claim it (one conditional UPDATE): only ONE request changes a round, even if every
//        member's browser asks at the same second. A failed change is retried after claimMs().
//     round 1 or 2 -> next round
//       ② read the round's private reactions (private_messages.reactions) and critiques (votes)
//       ③ filterSpotsForTrip (Henry) -> pickCandidate (Simon) -> reviseOptions (Simon, AI)
//          -> buildOptions([...kept, ...new], ...) (Henry) -> new A / B / C
//       ④ round + 1, new options, deadline = now + one round (30 min; 30 s with the mock AI)
//       ⑤ writeMessage("next_round") (Simon, AI) -> WayWay's message in the group chat
//     round 3 -> final vote
//       ② startPoll (Henry) checks every option is still safe -> status "voting", vote deadline
//       ③ writeMessage("voting_open") (Simon, AI) -> group chat
//   for each set still "voting" whose vote_deadline has passed (claimed the same way):
//     ② advancePoll (Henry): counts the complete ballots
//       still open  -> not enough votes (extended once, 30 min) or a perfect tie (one revote):
//                      save the new deadline, writeMessage("no_quorum" / "tie_revote")
//       decided     -> itineraryFromOption + decisionRows (Henry) -> save_decision() writes status,
//                      decision, credits and itinerary in ONE transaction -> writeMessage("decision" /
//                      "split_refused"). The itinerary panel and the map show the new stops.
//       no decision -> (still not enough votes, split refused with nothing else, an option became
//                      unsafe) the set is closed without a decision, WayWay says so; ask @WayWay again
//   then returns the member's fresh view of every open set (their own client, RLS).
//
// Uses the admin client for the writes and for every member's private data (the AI needs it):
// server only, and nothing private goes back to the browser.
import { LEVEL_VALUE, SETTINGS, type ChatMessage, type OptionReaction, type OptionSet, type SatisfactionLevel, type Vote } from "@/contracts/contract";
import { getRoundAI, isMockAI } from "@/lib/ai/rounds";
import { loadSuggestions, toOptions, toSlot } from "@/lib/chatbox-trip-hub/suggestions";
import type { Json, Tables } from "@/lib/db/database.types";
import { toChatMessage, toItineraryItem, toMemberProfile, toTrip } from "@/lib/db/mappers";
import { loadOwnMember } from "@/lib/interview/service";
import {
  advancePoll, buildOptions, decisionRows, filterSpotsForTrip, itineraryFromOption, memberStateUpdates, optionSetFromRow,
  optionSetUpdate, pollFromRows, spentFromItinerary, startPoll,
} from "@/lib/logic";
import { EVIDENCE, SPOT_INDEX, SPOTS, SPOTS_BY_ID } from "@/lib/logic/dataset";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NextRoundResult } from "./types";
import { pickCandidate, type MemberReaction, type MessageKind } from "../../../wayway-ai/lib/ai";

// How long things last. ONE switch for everything: WAYWAY_AI_MODE in .env.local.
//   real (contract SETTINGS)                       mock (local testing)
//   round            30 min (roundTimeoutMin)      30 s
//   final vote       30 min (same as a round)      30 s
//   vote extension   +30 min (voteExtensionMin)    +30 s   not enough votes at the deadline, once
//   tie revote       30 min (roundTimeoutMin)      30 s    a perfect tie, once
// The extension and the revote are timed inside Henry's advancePoll (real durations); in mock mode
// closeVote() replaces that deadline with MOCK_STEP_MS. Henry's code is not changed.
const MOCK_STEP_MS = 30_000;
export const roundMs = () => (isMockAI() ? MOCK_STEP_MS : SETTINGS.roundTimeoutMin * 60_000);
const voteMs = roundMs;
// A round change claimed by a request that then crashed is retried after this (longer than the AI takes).
const claimMs = () => (isMockAI() ? 10_000 : 90_000);
const RECENT_CHAT = 20;

type Admin = ReturnType<typeof createAdminClient>;
type OptionSetRow = Tables<"option_sets">;

export async function advanceExpiredRounds(tripId: string): Promise<NextRoundResult> {
  const { supabase, member } = await loadOwnMember(tripId);   // logged in + member of this trip (else 401 / 403)
  const admin = createAdminClient();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const { data: expired } = await admin
    .from("option_sets")
    .select("*")
    .eq("trip_id", tripId)
    .eq("status", "collecting_feedback")
    .lte("round_deadline", nowIso);

  const advanced: string[] = [];
  if (expired?.length) {
    const ctx = await loadContext(admin, tripId);
    for (const row of expired) {
      // ① Claim: push the deadline a little, only if nobody changed this round in the meantime
      const { data: claimed } = await admin
        .from("option_sets")
        .update({ round_deadline: new Date(now + claimMs()).toISOString() })
        .eq("id", row.id)
        .eq("round", row.round)
        .eq("status", "collecting_feedback")
        .lte("round_deadline", nowIso)
        .select("id");
      if (!claimed?.length) continue;   // another member's request is already on it
      try {
        const done = row.round < SETTINGS.maxRounds ? await nextRound(admin, ctx, row, now) : await openVote(admin, ctx, row, now);
        if (done) advanced.push(row.id);
      } catch (err) {
        console.error("[next-round]", row.id, err);   // the claim runs out after claimMs(), then a later request retries
      }
    }
  }

  // Final votes that have ended (same claim, on the vote deadline)
  const { data: votesEnded } = await admin
    .from("option_sets")
    .select("*")
    .eq("trip_id", tripId)
    .eq("status", "voting")
    .lte("vote_deadline", nowIso);
  if (votesEnded?.length) {
    const ctx = await loadContext(admin, tripId);
    for (const row of votesEnded) {
      const { data: claimed } = await admin
        .from("option_sets")
        .update({ vote_deadline: new Date(now + claimMs()).toISOString() })
        .eq("id", row.id)
        .eq("status", "voting")
        .lte("vote_deadline", nowIso)
        .select("id");
      if (!claimed?.length) continue;
      try {
        // `row` still holds the real deadline (read before the claim): advancePoll sees the vote as over
        if (await closeVote(admin, ctx, row, now)) advanced.push(row.id);
      } catch (err) {
        console.error("[close-vote]", row.id, err);   // retried by a later request after claimMs()
      }
    }
  }

  return { advanced, suggestions: await loadSuggestions(supabase, tripId, member.id), claimWindowMs: claimMs() };
}

// ---------------------------------------------------------------------------
// Everything the AI and the logic need about the trip (server only: contains private data)
// ---------------------------------------------------------------------------
export async function loadContext(admin: Admin, tripId: string) {
  const [{ data: tripRow }, { data: memberRows }, { data: chatRows }, { data: itemRows }] = await Promise.all([
    admin.from("trips").select("*").eq("id", tripId).single(),
    admin.from("trip_members").select("*").eq("trip_id", tripId).order("joined_at"),
    admin.from("chat_messages").select("*").eq("trip_id", tripId).order("created_at", { ascending: false }).limit(RECENT_CHAT),
    admin.from("itinerary_items").select("day, start_time, end_time, spot_id, branches").eq("trip_id", tripId),
  ]);
  if (!tripRow) throw new Error("Trip not found");
  const ids = (memberRows ?? []).map((m) => m.id);
  const [{ data: privRows }, { data: stateRows }] = await Promise.all([
    admin.from("member_private").select("*").in("member_id", ids),
    admin.from("member_state").select("*").in("member_id", ids),
  ]);

  const members = (memberRows ?? []).map((m) =>
    toMemberProfile(m, privRows?.find((p) => p.member_id === m.id), stateRows?.find((s) => s.member_id === m.id)),
  );
  const spentByMember = spentFromItinerary((itemRows ?? []).map(toItineraryItem), ids, SPOTS_BY_ID);
  return {
    trip: toTrip(tripRow, members),
    members,
    timezone: tripRow.timezone,
    recentChat: (chatRows ?? []).reverse().map(toChatMessage),
    credits: Object.fromEntries((stateRows ?? []).map((s) => [s.member_id, s.fairness_credits])),
    spentByMember,
    allowedSpots: filterSpotsForTrip(SPOTS, members, { evidence: EVIDENCE, spentByMember }).allowed,
  };
}
export type Context = Awaited<ReturnType<typeof loadContext>>;

// ---------------------------------------------------------------------------
// Round 1 or 2 -> next round
// ---------------------------------------------------------------------------
async function nextRound(admin: Admin, ctx: Context, row: OptionSetRow, now: number): Promise<boolean> {
  const previousOptions = toOptions(row.options);
  const slot = toSlot(row.slot);
  if (!previousOptions.length || !slot) throw new Error("Option set has no options or no slot");

  // ② What members said privately this round, and critiques attached to votes (none before the vote yet)
  const [reactions, critiques] = await Promise.all([loadReactions(admin, row.id, row.round), loadCritiques(admin, row.id)]);

  // ③ Revise: Simon's AI proposes, Henry's code checks and ranks
  const ai = getRoundAI();
  const candidate = pickCandidate(previousOptions);
  const rev = await ai.revise({
    trip: ctx.trip, slot, allowedSpots: ctx.allowedSpots, recentChat: ctx.recentChat,
    previousOptions, candidate, reactions, critiques,
  });
  const kept = rev.kept.length ? rev.kept : previousOptions;
  const check = { spentByMember: ctx.spentByMember };
  let built = buildOptions([...kept, ...rev.candidates], ctx.members, SPOT_INDEX, ctx.credits, check);
  // Every kept and new route was dropped (e.g. a member confirmed a diet or allergy during the round):
  // fall back to whatever is still SAFE among the round's options. Never re-show an unsafe one.
  if (!built.options.length) built = buildOptions(previousOptions, ctx.members, SPOT_INDEX, ctx.credits, check);
  if (!built.options.length) {
    console.warn("[next-round] no safe option left, round extended:", row.id, built.dropped.map((d) => d.reason).join(", "));
    await admin.from("option_sets").update({ round_deadline: new Date(now + roundMs()).toISOString() }).eq("id", row.id);
    return false;
  }
  const options = built.options;
  const candidateId = built.candidateOptionId ?? row.candidate_option_id;

  // ④ Save the new round (still only if this request owns the change)
  const round = row.round + 1;
  const deadline = new Date(now + roundMs()).toISOString();
  const { data: saved } = await admin
    .from("option_sets")
    .update({ round, options: options as unknown as NonNullable<Json>, candidate_option_id: candidateId, round_deadline: deadline })
    .eq("id", row.id)
    .eq("round", row.round)
    .select("id");
  if (!saved?.length) return false;

  // ⑤ Tell the group
  await postMessage(admin, ctx, row.id, "next_round", {
    slot: slot.label, round, options: options.map((o) => `${o.id}: ${o.title}`), deadline: localTime(deadline, ctx.timezone),
  });
  return true;
}

// ---------------------------------------------------------------------------
// Round 3 -> final vote
// ---------------------------------------------------------------------------
async function openVote(admin: Admin, ctx: Context, row: OptionSetRow, now: number): Promise<boolean> {
  const slot = toSlot(row.slot);
  const voteDeadline = new Date(now + voteMs()).toISOString();
  const voting: OptionSet = { ...optionSetFromRow(row), status: "voting", voteDeadline, voteAttempt: 1, voterIds: [] };

  let poll;
  try {
    // Henry's check: every option is still safe for everyone (e.g. nobody confirmed a new allergy since)
    poll = startPoll(voting, { members: ctx.members, spots: SPOT_INDEX, spentByMember: ctx.spentByMember }, ctx.timezone, ctx.credits);
  } catch (err) {
    console.warn("[next-round] vote not opened, round extended:", row.id, (err as Error).message);
    await admin.from("option_sets").update({ round_deadline: new Date(now + roundMs()).toISOString() }).eq("id", row.id);
    return false;
  }

  const { data: saved } = await admin
    .from("option_sets")
    .update(optionSetUpdate(poll))
    .eq("id", row.id)
    .eq("status", "collecting_feedback")
    .select("id");
  if (!saved?.length) return false;

  await postMessage(admin, ctx, row.id, "voting_open", {
    slot: slot?.label ?? "", options: voting.options.map((o) => `${o.id}: ${o.title}`), deadline: localTime(voteDeadline, ctx.timezone),
  });
  return true;
}

// ---------------------------------------------------------------------------
// End of the final vote
// ---------------------------------------------------------------------------
async function closeVote(admin: Admin, ctx: Context, row: OptionSetRow, now: number): Promise<boolean> {
  const slot = toSlot(row.slot);
  if (!slot) throw new Error("Option set has no slot");
  const [{ data: votes }, { data: states }] = await Promise.all([
    admin.from("votes").select("*").eq("option_set_id", row.id),
    admin.from("member_state").select("*").in("member_id", ctx.members.map((m) => m.id)),
  ]);
  const guard = { members: ctx.members, spots: SPOT_INDEX, spentByMember: ctx.spentByMember };
  const before = pollFromRows({ optionSet: row, votes: votes ?? [], states: states ?? [], timezone: ctx.timezone, guard });
  const after = advancePoll(before, now, guard);   // Henry: count, extend, revote or decide
  const titles = after.optionSet.options.map((o) => `${o.id}: ${o.title}`);

  // Still open: not enough votes (extended once) or a perfect tie (revote). One UPDATE, no transaction needed.
  if (after.outcome === "open") {
    const update = optionSetUpdate(after);
    if (isMockAI()) update.vote_deadline = new Date(now + MOCK_STEP_MS).toISOString();   // mock: +30 s, not +30 min
    const { data: saved } = await admin
      .from("option_sets")
      .update(update)
      .eq("id", row.id)
      .eq("status", "voting")
      .select("id");
    if (!saved?.length) return false;
    const revote = (after.optionSet.voteAttempt ?? 1) > (before.optionSet.voteAttempt ?? 1);
    await postMessage(admin, ctx, row.id, revote ? "tie_revote" : "no_quorum", {
      slot: slot.label, options: titles, deadline: localTime(update.vote_deadline ?? "", ctx.timezone),
    });
    return true;
  }

  // Decided: the decision, the credits and the itinerary are written together (save_decision)
  if (after.outcome === "decided" && after.decision) {
    const decision = after.decision;
    const chosen = after.optionSet.options.find((o) => o.id === decision.chosenOptionId);
    if (!chosen) throw new Error(`Chosen option ${decision.chosenOptionId} not found`);
    const itinerary = itineraryFromOption(chosen, slot, SPOTS_BY_ID);
    const rows = decisionRows(decision, ctx.trip.id, itinerary);
    const { data: ok, error } = await admin.rpc("save_decision", {
      p_option_set_id: row.id,
      p_option_set: optionSetUpdate(after) as unknown as Json,
      p_decision: rows.decision as unknown as Json,
      p_credit_events: rows.creditEvents as unknown as Json,
      p_itinerary: rows.itinerary as unknown as Json,
      p_member_states: memberStateUpdates(before, after) as unknown as Json,
    });
    if (error) throw error;
    if (!ok) return false;   // another request closed it first
    await postMessage(admin, ctx, row.id, decision.resolvedBy === "split_refused" ? "split_refused" : "decision", {
      slot: slot.label,
      chosen: `${chosen.id}: ${chosen.title}`,
      stops: itinerary.flatMap((i) => (i.spotId ? [SPOTS_BY_ID[i.spotId]?.name ?? i.spotId] : [])),
      resolvedBy: decision.resolvedBy,
    });
    return true;
  }

  // No decision: still not enough votes after the extension, the split was refused with no shared
  // option left, or an option became unsafe. Close the set (no decision row) and tell the group.
  const reason =
    after.outcome === "no_quorum" ? "not enough people voted"
      : after.outcome === "no_split_fallback" ? "not everyone agreed to split up, and there was no shared option"
        : "an option no longer works for everyone";
  const { data: ok, error } = await admin.rpc("save_decision", {
    p_option_set_id: row.id,
    p_option_set: { ...optionSetUpdate(after), status: "decided", chosen_option_id: null } as unknown as Json,
    p_decision: null as unknown as Json,
    p_credit_events: [],
    p_itinerary: [],
    p_member_states: [],
  });
  if (error) throw error;
  if (!ok) return false;
  await postMessage(admin, ctx, row.id, after.outcome === "no_quorum" ? "no_quorum" : "decision", {
    slot: slot.label, decided: false, reason, next: "Ask @WayWay again to plan this time slot.",
  });
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const isLevel = (v: unknown): v is SatisfactionLevel => typeof v === "string" && Object.hasOwn(LEVEL_VALUE, v);
const isOptionId = (v: unknown): v is OptionReaction["optionId"] => v === "A" || v === "B" || v === "C";

/** The round's private reactions, the LATEST one per member and option (a member can change their mind). */
async function loadReactions(admin: Admin, optionSetId: string, round: number): Promise<MemberReaction[]> {
  const { data } = await admin
    .from("private_messages")
    .select("member_id, reactions")
    .eq("option_set_id", optionSetId)
    .eq("round", round)
    .not("reactions", "is", null)
    .order("created_at");
  const latest = new Map<string, MemberReaction>();
  for (const row of data ?? []) {
    if (!Array.isArray(row.reactions)) continue;
    for (const r of row.reactions as Record<string, unknown>[]) {
      if (!isOptionId(r?.optionId) || !isLevel(r?.level)) continue;
      latest.set(`${row.member_id}:${r.optionId}`, {
        memberId: row.member_id, optionId: r.optionId, level: r.level, reason: typeof r.reason === "string" ? r.reason : "",
      });
    }
  }
  return [...latest.values()];
}

/** Votes that carry a critique (contract Vote). */
async function loadCritiques(admin: Admin, optionSetId: string): Promise<Vote[]> {
  const { data } = await admin
    .from("votes")
    .select("option_id, member_id, level, critique, accepts_split")
    .eq("option_set_id", optionSetId)
    .not("critique", "is", null);
  return (data ?? []).flatMap((v) =>
    isOptionId(v.option_id) && isLevel(v.level)
      ? [{
          optionSetId, optionId: v.option_id, memberId: v.member_id, level: v.level, critique: v.critique ?? undefined,
          ...(v.accepts_split !== null ? { acceptsSplit: v.accepts_split } : {}),
        }]
      : [],
  );
}

/** WayWay writes one group message (Simon's writeMessage, or the mock) and posts it as WayWay. */
export async function postMessage(
  admin: Admin, ctx: Context, optionSetId: string | null, kind: MessageKind, facts: Record<string, unknown>,
): Promise<ChatMessage | null> {
  const out = await getRoundAI().write({ trip: ctx.trip, kind, facts, recentChat: ctx.recentChat });
  return postAsWayWay(admin, ctx.trip.id, out.fairnessNote ? `${out.text} ${out.fairnessNote}` : out.text, optionSetId);
}

/** Posts a ready-made text as WayWay (sender_member_id = null: written by the server only). */
export async function postAsWayWay(admin: Admin, tripId: string, text: string, optionSetId: string | null): Promise<ChatMessage | null> {
  const { data, error } = await admin
    .from("chat_messages")
    .insert({ trip_id: tripId, sender_member_id: null, text, option_set_id: optionSetId })
    .select("*")
    .single();
  if (error || !data) {
    console.error("[wayway] message not posted:", error?.message);
    return null;
  }
  return toChatMessage(data);
}

/** "15:30" in the trip's time zone. */
export function localTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
