// Types shared by the vote API (server) and the Spot Suggestions panel (browser).
import type { Option, SatisfactionLevel } from "@/contracts/contract";
import type { SuggestionsData } from "@/lib/chatbox-trip-hub/types";

/** POST /api/chatbox/vote: one rating of one option (send again to change it). */
export interface VoteRequest {
  tripId: string;
  optionSetId: string;
  optionId: Option["id"];
  level: SatisfactionLevel;
  acceptsSplit?: boolean;          // split option only: am I OK to split up?
}

/** The member's fresh view of every open set (their ballot included). */
export interface VoteResponse {
  suggestions: SuggestionsData;
}
