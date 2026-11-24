import "server-only";
// Chooses who answers a member's private feedback on the options of a round (rounds 1-3):
// the fake one or Simon's real extractPreferences. Same switch as the interview:
// WAYWAY_AI_MODE in .env.local ("mock" by default; "real" needs OPENROUTER_API_KEY).
import { mockFeedback } from "@/lib/ai-mock/feedback";
import { extractPreferences, type ExtractInput, type ExtractOutput } from "../../../wayway-ai/lib/ai";

export type { ExtractInput as FeedbackInput, ExtractOutput as FeedbackOutput };

/** Any feedback handler (mock or real AI) is a function with this shape. */
export type FeedbackHandler = (input: ExtractInput) => Promise<ExtractOutput>;

export function getFeedbackHandler(): FeedbackHandler {
  const mode = process.env.WAYWAY_AI_MODE ?? "mock";
  if (mode === "mock") return mockFeedback;
  if (mode === "real") return extractPreferences;
  throw new Error(`Unknown WAYWAY_AI_MODE "${mode}" (use "mock" or "real").`);
}
