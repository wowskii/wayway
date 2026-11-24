import "server-only";
// Chooses which interviewer answers the member: the fake one or Simon's real `interview`
// (extractPreferences + interests / pace / sleep + topics covered, same shape as `Interviewer`).
// Set WAYWAY_AI_MODE in .env.local ("mock" by default; "real" needs OPENROUTER_API_KEY).
import { mockInterviewer } from "@/lib/ai-mock/interview";
import { interview } from "../../../wayway-ai/lib/ai";
import type { Interviewer } from "./types";

export function getInterviewer(): Interviewer {
  const mode = process.env.WAYWAY_AI_MODE ?? "mock";
  if (mode === "mock") return mockInterviewer;
  if (mode === "real") return interview;
  throw new Error(`Unknown WAYWAY_AI_MODE "${mode}" (use "mock" or "real").`);
}
