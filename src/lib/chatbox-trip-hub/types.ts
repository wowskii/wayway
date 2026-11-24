// View models for the trip page (/trips/[tripId]): what the server loads and the browser shows.
// They are built from contract types on the server (lib/chatbox-trip-hub/load.ts) and contain no private
// data of other members.
import type { Option, OptionSet, SatisfactionLevel } from "@/contracts/contract";
import type { InterviewMessage } from "@/lib/interview/types";

/** The three tools in the bottom-left dock. */
export type PanelId = "private" | "suggestions" | "itinerary";
export const PANEL_IDS: readonly PanelId[] = ["private", "suggestions", "itinerary"];
export const isPanelId = (v: unknown): v is PanelId => PANEL_IDS.includes(v as PanelId);

export interface HubMember {
  id: string;
  name: string;
}

/** One trip in the "Your trips" list (group selection). */
export interface HubTrip {
  id: string;
  name: string;
  city: string;
  dates: string;          // "Nov 21 – 23"
  needsProfile: boolean;  // interview not finished yet
}

// ---------------------------------------------------------------------------
// Spot Suggestions panel: one big card per option set that is still being decided.
// Built on the server from option_sets + MY private messages about each set.
// Shows only what the option cards show the group (no scores, no other member's reactions).
// ---------------------------------------------------------------------------
export interface SuggestionOption {
  id: Option["id"];                 // "A" | "B" | "C"
  kind: Option["kind"];
  title: string;
  stops: string[];                  // spot names in visiting order (shared route)
  groups?: { members: string[]; stops: string[] }[];       // split only
  meet?: { place: string; time: string };                  // split only
  worksFor: string[];               // member names (satisfiedMemberIds)
  explanation: string;
  fairnessNote?: string;
}

/** My final vote on a set (only while it is "voting"). Who voted what stays private. */
export interface Ballot {
  attempt: 1 | 2;                   // 2 = the revote after a perfect tie
  extended: boolean;                // not enough votes at the first deadline: the vote got extra time (once)
  mine: Partial<Record<Option["id"], { level: SatisfactionLevel; acceptsSplit?: boolean }>>;
  voters: number;                   // members whose ballot is complete (every option rated)
  members: number;
  definitelyNoLeft: number;         // my "Definitely no" left today (max 2 a day, trip time zone)
}

export interface SuggestionSet {
  id: string;                       // option_sets.id
  status: Extract<OptionSet["status"], "collecting_feedback" | "voting">;
  round: number;                    // 1 to 3
  deadline: string;                 // ISO: end of the round, or of the vote while voting
  date: string;                     // "Sat, Nov 21"
  time: string;                     // "14:00 – 17:30"
  label: string;                    // "Afternoon, day 1"
  options: SuggestionOption[];
  messages: InterviewMessage[];     // my private exchange with WayWay about THIS set
  ballot?: Ballot;                  // only while voting
}

export interface SuggestionsData {
  sets: SuggestionSet[];            // least time left first (soonest deadline = page 1)
}

// ---------------------------------------------------------------------------
// Itinerary panel (contract: ItineraryItem)
// ---------------------------------------------------------------------------
export interface ItineraryEntry {
  id: string;
  start: string;          // "10:30"
  end: string;
  title: string;          // spot name, or "Split into 2 groups"
  branches?: { members: string[]; spots: string[] }[];
  createdAt: string;      // ISO, used for the "new" badge
}

export interface ItineraryDay {
  day: number;            // 1 = first day
  label: string;          // "Nov 21"
  entries: ItineraryEntry[];
}

export interface ItineraryData {
  days: ItineraryDay[];
}
