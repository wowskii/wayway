import "server-only";
// The two AI steps of a round change (Spot Suggestions): revise the options with the members'
// private reactions, and write WayWay's group message. Mock or Simon's real functions, with the
// same switch as the interview and the feedback: WAYWAY_AI_MODE ("mock" by default).
import { mockRevise, mockWriteMessage } from "@/lib/ai-mock/rounds";
import {
  reviseOptions,
  writeMessage,
  type MessageInput,
  type MessageOutput,
  type OptionsOutput,
  type ReviseInput,
} from "../../../wayway-ai/lib/ai";

export type Reviser = (input: ReviseInput) => Promise<OptionsOutput>;
export type MessageWriter = (input: MessageInput) => Promise<MessageOutput>;

/** True while the fake AI is used (WAYWAY_AI_MODE unset or "mock"): local testing only. */
export const isMockAI = () => (process.env.WAYWAY_AI_MODE ?? "mock") === "mock";

export function getRoundAI(): { revise: Reviser; write: MessageWriter } {
  const mode = process.env.WAYWAY_AI_MODE ?? "mock";
  if (mode === "mock") return { revise: mockRevise, write: mockWriteMessage };
  if (mode === "real") return { revise: reviseOptions, write: writeMessage };
  throw new Error(`Unknown WAYWAY_AI_MODE "${mode}" (use "mock" or "real").`);
}
