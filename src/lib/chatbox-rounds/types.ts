// Types shared by the round-change API (server) and the trip page (browser).
import type { SuggestionsData } from "@/lib/chatbox-trip-hub/types";

/** POST /api/chatbox/next-round answer */
export interface NextRoundResult {
  advanced: string[];          // option set ids whose round (or vote) changed in THIS request
  suggestions: SuggestionsData; // the member's fresh view of every open set
  // While a request changes a round it pushes that round's deadline by this much ("claim"). A round
  // that comes back pushed by about this much is being changed by another member's request right now.
  claimWindowMs: number;
}
