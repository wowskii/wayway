import "server-only";
// Chooses which interviewer answers the member: the fake one or the real AI.
// Set WAYWAY_AI_MODE in .env.local ("mock" by default).
import { mockInterviewer } from "@/lib/ai-mock/interview";
import type { Interviewer } from "./types";

export function getInterviewer(): Interviewer {
  const mode = process.env.WAYWAY_AI_MODE ?? "mock";
  if (mode === "mock") return mockInterviewer;
  if (mode === "real") {
    // TODO(integration): once feature/ai-module is merged, wrap extractPreferences (+ the interview
    // additions agreed with Simon) here. The route and the page do not need to change.
    throw new Error("WAYWAY_AI_MODE=real is not connected yet: the AI module is not merged. Use mock.");
  }
  throw new Error(`Unknown WAYWAY_AI_MODE "${mode}" (use "mock" or "real").`);
}
