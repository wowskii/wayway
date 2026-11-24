import "server-only";
// Spot Suggestions panel: option_sets rows -> the cards the member sees.
// Only what the group's option cards show: titles, routes, "works for", trade-off. Never the
// AI's per-member scores, and only the member's OWN private messages (RLS already filters them).
import { SETTINGS, type Option, type SatisfactionLevel, type TimeSlot } from "@/contracts/contract";
import type { Tables } from "@/lib/db/database.types";
import type { createClient } from "@/lib/supabase/server";
import { toInterviewMessage } from "@/lib/interview/service";
import { localDay } from "@/lib/logic/voting";
import { getSpot } from "@/lib/spots";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Ballot, SuggestionOption, SuggestionSet, SuggestionsData } from "./types";

type OptionSetRow = Tables<"option_sets">;
type PrivateMessageRow = Tables<"private_messages">;
type VoteRow = Tables<"votes">;

/** What the final-vote cards need about me (my own votes and counter only). */
export interface VotingView {
  myVotes: VoteRow[];
  memberCount: number;
  definitelyNoLeft: number;
}

function toBallot(row: OptionSetRow, voting: VotingView): Ballot {
  const attempt = row.vote_attempt === 2 ? 2 : 1;
  const mine: Ballot["mine"] = {};
  for (const v of voting.myVotes) {
    if (v.option_set_id !== row.id || v.vote_attempt !== attempt) continue;
    if (v.option_id !== "A" && v.option_id !== "B" && v.option_id !== "C") continue;
    mine[v.option_id] = { level: v.level as SatisfactionLevel, ...(v.accepts_split !== null ? { acceptsSplit: v.accepts_split } : {}) };
  }
  return {
    attempt, extended: Boolean(row.vote_extended), mine,
    voters: row.voter_ids.length, members: voting.memberCount, definitelyNoLeft: voting.definitelyNoLeft,
  };
}

/** Option sets still being decided: shown in the panel and counted in its header. */
export const OPEN_STATUSES = ["collecting_feedback", "voting"] as const;

const spotName = (id: string) => getSpot(id)?.name ?? id;

// jsonb columns: check the shape instead of trusting it.
export function toSlot(v: unknown): TimeSlot | null {
  const s = v as Partial<TimeSlot> | null;
  return s && typeof s.day === "number" && typeof s.start === "string" && typeof s.end === "string"
    ? { day: s.day, start: s.start, end: s.end, label: typeof s.label === "string" ? s.label : "" }
    : null;
}

export function toOptions(v: unknown): Option[] {
  if (!Array.isArray(v)) return [];
  return v.filter((o): o is Option =>
    !!o && ["A", "B", "C"].includes(o.id) && typeof o.title === "string" && Array.isArray(o.spots));
}

/** "Sat, Nov 21" for trip day `day` (1 = start date). */
function dayDate(startDate: string, day: number) {
  const d = new Date(Date.parse(`${startDate}T00:00:00Z`) + (day - 1) * 86_400_000);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

function toSuggestionOption(o: Option, nameOf: (id: string) => string): SuggestionOption {
  const split = o.kind === "split" && o.branches?.length;
  return {
    id: o.id,
    kind: o.kind,
    title: o.title,
    stops: split ? [] : o.spots.map(spotName),
    ...(split
      ? {
          groups: o.branches!.map((b) => ({ members: b.memberIds.map(nameOf), stops: b.spots.map(spotName) })),
          ...(o.rendezvous ? { meet: { place: spotName(o.rendezvous.spotId), time: o.rendezvous.time } } : {}),
        }
      : {}),
    worksFor: (o.satisfiedMemberIds ?? []).map(nameOf),
    explanation: o.explanation ?? "",
    ...(o.fairnessNote ? { fairnessNote: o.fairnessNote } : {}),
  };
}

export function buildSuggestions(
  tripStartDate: string,
  setRows: OptionSetRow[],
  myMessages: PrivateMessageRow[],
  nameOf: (memberId: string) => string,
  voting?: VotingView,
): SuggestionsData {
  const sets: SuggestionSet[] = [];
  for (const row of setRows) {
    const slot = toSlot(row.slot);
    if (!slot || (row.status !== "collecting_feedback" && row.status !== "voting")) continue;
    sets.push({
      id: row.id,
      status: row.status,
      round: row.round,
      deadline: row.status === "voting" && row.vote_deadline ? row.vote_deadline : row.round_deadline,
      date: dayDate(tripStartDate, slot.day),
      time: `${slot.start} – ${slot.end}`,
      label: slot.label,
      options: toOptions(row.options).sort((a, b) => a.id.localeCompare(b.id)).map((o) => toSuggestionOption(o, nameOf)),
      messages: myMessages.filter((m) => m.option_set_id === row.id).map(toInterviewMessage),
      ...(row.status === "voting" && voting ? { ballot: toBallot(row, voting) } : {}),
    });
  }
  // Most urgent first: the set whose round (or vote) ends soonest is page 1.
  sets.sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
  return { sets };
}

/**
 * The member's current view of every open set. Read with THEIR OWN client: RLS returns only their
 * private messages and their own votes. The only admin read is THEIR OWN "definitely no" counter
 * (member_state is hidden from users). Used by the trip page, after a round change and after a vote.
 */
export async function loadSuggestions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tripId: string,
  memberId: string,
): Promise<SuggestionsData> {
  const [{ data: trip }, { data: memberRows }, { data: setRows }, { data: mine }, { data: myVotes }, { data: state }] = await Promise.all([
    supabase.from("trips").select("start_date, timezone").eq("id", tripId).maybeSingle(),
    supabase.from("trip_members").select("id, name").eq("trip_id", tripId),
    supabase.from("option_sets").select("*").eq("trip_id", tripId).in("status", [...OPEN_STATUSES]).order("created_at"),
    supabase.from("private_messages").select("*").eq("trip_id", tripId).not("option_set_id", "is", null).order("created_at"),
    supabase.from("votes").select("*").eq("member_id", memberId),
    createAdminClient().from("member_state").select("definitely_no_used_today, definitely_no_day").eq("member_id", memberId).maybeSingle(),
  ]);
  if (!trip) return { sets: [] };
  const names = new Map((memberRows ?? []).map((m) => [m.id, m.name]));
  const usedToday = state && state.definitely_no_day === localDay(Date.now(), trip.timezone) ? state.definitely_no_used_today : 0;
  return buildSuggestions(trip.start_date, setRows ?? [], mine ?? [], (id) => names.get(id) ?? "A traveler", {
    myVotes: myVotes ?? [],
    memberCount: memberRows?.length ?? 0,
    definitelyNoLeft: Math.max(0, SETTINGS.maxDefinitelyNoPerDay - usedToday),
  });
}
