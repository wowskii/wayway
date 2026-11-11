// Translators between database rows (snake_case, split across tables) and contract types (camelCase).
// The rest of the app should only use contract types; only data-access code touches rows.
import type {
  ChatMessage,
  HardConstraints,
  MemberProfile,
  PrivateMessage,
  Trip,
} from "@/contracts/contract";
import type { Tables } from "./database.types";

export type TripRow = Tables<"trips">;
export type MemberRow = Tables<"trip_members">;
export type MemberPrivateRow = Tables<"member_private">;
export type MemberStateRow = Tables<"member_state">;
export type PrivateMessageRow = Tables<"private_messages">;
export type ChatMessageRow = Tables<"chat_messages">;

/** senderId used in the contract for messages written by the AI */
export const WAYWAY_SENDER_ID = "wayway";

// ---------------------------------------------------------------------------
// Small helpers: the database stores these as text with a CHECK, so we narrow them here.
// ---------------------------------------------------------------------------
type Pace = MemberProfile["pace"];
type Sleep = MemberProfile["sleep"];
const PACES: readonly Pace[] = ["relaxed", "moderate", "packed"];
const SLEEPS: readonly Sleep[] = ["early_bird", "night_owl", "flexible"];

export const isPace = (v: unknown): v is Pace => PACES.includes(v as Pace);
export const isSleep = (v: unknown): v is Sleep => SLEEPS.includes(v as Sleep);

// Defaults used while the interview hasn't found the answer yet (the DB keeps NULL = unknown).
const DEFAULT_PACE: Pace = "moderate";
const DEFAULT_SLEEP: Sleep = "flexible";

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/**
 * Builds the full contract MemberProfile from its 3 rows.
 * SERVER ONLY when `priv` / `state` are passed: they contain private data.
 * For another member, pass only `member` (private fields are left empty).
 */
export function toMemberProfile(
  member: MemberRow,
  priv?: MemberPrivateRow | null,
  state?: MemberStateRow | null,
): MemberProfile {
  return {
    id: member.id,
    name: member.name,
    hard: {
      diet: member.diet,
      allergies: priv?.allergies ?? [],
      maxBudget: priv?.max_budget ?? 0,   // 0 = not known yet
    },
    interests: member.interests,
    pace: isPace(member.pace) ? member.pace : DEFAULT_PACE,
    sleep: isSleep(member.sleep) ? member.sleep : DEFAULT_SLEEP,
    privateNote: priv?.private_note ?? "",
    preferenceStatements: priv?.preference_statements ?? [],
    fairnessCredits: state?.fairness_credits ?? 0,
    definitelyNoUsedToday: state?.definitely_no_used_today ?? 0,
  };
}

/** Builds the contract Trip from its row and its members. */
export function toTrip(trip: TripRow, members: MemberProfile[]): Trip {
  return {
    id: trip.id,
    name: trip.name,
    city: trip.city,
    startDate: trip.start_date,
    endDate: trip.end_date,
    timezone: trip.timezone,
    goal: trip.goal as Trip["goal"],
    members,
  };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export function toPrivateMessage(row: PrivateMessageRow): PrivateMessage {
  return {
    id: row.id,
    tripId: row.trip_id,
    memberId: row.member_id,
    sender: row.sender === "wayway" ? "wayway" : "member",
    text: row.text,
    createdAt: row.created_at,
    ...(row.round !== null ? { round: row.round } : {}),
  };
}

/** Hard constraints WayWay asked the member to confirm (stored on its message), if any. */
export function constraintsToConfirm(row: PrivateMessageRow): Partial<HardConstraints> | null {
  const c = row.constraints_to_confirm;
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  return c as Partial<HardConstraints>;
}

export function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    tripId: row.trip_id,
    senderId: row.sender_member_id ?? WAYWAY_SENDER_ID,
    text: row.text,
    createdAt: row.created_at,
    ...(row.option_set_id ? { optionSetId: row.option_set_id } : {}),
  };
}
