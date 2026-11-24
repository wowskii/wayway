import "server-only";
// The AI steps behind "@WayWay ..." in the group chat: agree on WHEN (negotiateSlot), then propose
// WHAT (generateOptions). Mock or Simon's real functions, with the same switch as the rest:
// WAYWAY_AI_MODE ("mock" by default; "real" needs OPENROUTER_API_KEY).
import { mockGenerate, mockNegotiate } from "@/lib/ai-mock/wayway";
import {
  generateOptions,
  negotiateSlot,
  type GenerateInput,
  type OptionsOutput,
  type SlotInput,
  type SlotOutput,
} from "../../../wayway-ai/lib/ai";

export type Negotiator = (input: SlotInput) => Promise<SlotOutput>;
export type Generator = (input: GenerateInput) => Promise<OptionsOutput>;

export function getWayWayAI(): { negotiate: Negotiator; generate: Generator } {
  const mode = process.env.WAYWAY_AI_MODE ?? "mock";
  if (mode === "mock") return { negotiate: mockNegotiate, generate: mockGenerate };
  if (mode === "real") return { negotiate: negotiateSlot, generate: generateOptions };
  throw new Error(`Unknown WAYWAY_AI_MODE "${mode}" (use "mock" or "real").`);
}
