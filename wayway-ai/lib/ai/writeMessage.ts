// writeMessage: turn facts computed by the app into one WayWay chat message.
//
// When WayWay speaks without being mentioned (team rule: members reach WayWay only with @WayWay):
// - answer_question: only after a member's @WayWay message;
// - every other kind is triggered by the app itself (timer at a deadline, all members reacted,
//   votes counted), never by a plain chat message. This keeps the decision process moving.

import type { ChatMessage, Trip } from "@/contracts/contract";
import { MAX_TOKENS, MODELS, TEMPERATURE } from "./config";
import { findLeaks, formatChat, privateTokens } from "./context";
import { AIOutputError, callTool, type Validation } from "./llm";
import { MESSAGE_SYSTEM, messageUser } from "./prompts";
import { MESSAGE_SCHEMA } from "./schemas";

export type MessageKind =
  | "options_round"     // new options posted (round 1)
  | "next_round"        // revised options after private feedback
  | "voting_open"       // final vote starts
  | "reminder"          // nudge silent members
  | "no_quorum"         // deadline passed, vote extended by 30 min
  | "tie_revote"        // perfect tie, one revote
  | "decision"          // decision made, itinerary updated
  | "split_refused"     // a member refused the split, best non-split option applied
  | "answer_question";  // a member asked WayWay something during a decision

export interface MessageInput {
  trip: Trip;
  kind: MessageKind;
  facts: Record<string, unknown>;     // ONLY what the code computed: option titles, deadline, names...
  favoredMemberName?: string;          // set by code when fairness credits changed the ranking
  recentChat: ChatMessage[];
}

export interface MessageOutput {
  text: string;
  fairnessNote?: string;
}

const FALLBACK: Record<MessageKind, string> = {
  options_round: "Here are a few options for this slot. Tell me privately what you think, then we'll refine them!",
  next_round: "Thanks for your feedback! Here are the updated options.",
  voting_open: "Time to vote on the final options!",
  reminder: "A few of you haven't answered yet, your opinion counts!",
  no_quorum: "Not enough votes yet, so I'm giving everyone 30 more minutes.",
  tie_revote: "It's a perfect tie! Let's vote one more time.",
  decision: "Decision made, the itinerary has been updated!",
  split_refused: "Not everyone wanted to split up, so I kept the best option for the whole group.",
  answer_question: "Good question! Each option card shows who it works for and why.",
};

export async function writeMessage(input: MessageInput): Promise<MessageOutput> {
  const tokens = privateTokens(input.trip);
  const validate = (raw: any): Validation<MessageOutput> => {
    const errors: string[] = [];
    if (typeof raw?.text !== "string" || !raw.text.trim()) errors.push("text must be a non-empty string.");
    else if (raw.text.trim().split(/(?<=[.!?])\s+/).length > 4) errors.push("text is too long: 2 to 4 sentences.");
    if (raw?.fairnessNote !== undefined && typeof raw.fairnessNote !== "string") errors.push("fairnessNote must be a string.");
    const visible = `${raw?.text ?? ""} ${raw?.fairnessNote ?? ""}`;
    const leaks = findLeaks(visible, tokens);
    if (leaks.length) errors.push(`The message reveals private information (${leaks.join(", ")}). Rewrite neutrally.`);
    if (/\b\d+(\.\d+)?\s*(credit|credits|points?)\b/i.test(visible)) errors.push("Never show fairness numbers.");
    if (!input.favoredMemberName && raw?.fairnessNote) raw.fairnessNote = "";
    return errors.length ? { ok: false, errors } : { ok: true, value: raw };
  };

  try {
    const res = await callTool<MessageOutput>({
      model: MODELS.fast,
      temperature: TEMPERATURE.message,
      maxTokens: MAX_TOKENS.message,
      system: MESSAGE_SYSTEM,
      user: messageUser({
        kind: input.kind,
        facts: JSON.stringify({ ...input.facts, favored: input.favoredMemberName ?? null }, null, 2),
        chat: formatChat(input.recentChat, input.trip),
      }),
      tool: { name: "post_message", description: "Post WayWay's message in the group chat.", schema: MESSAGE_SCHEMA },
      validate,
    });
    const { text, fairnessNote } = res.value;
    return fairnessNote ? { text, fairnessNote } : { text };
  } catch (e) {
    if (!(e instanceof AIOutputError)) throw e;   // only our own programming errors get through
    console.warn(`[writeMessage] fallback (${e.kind}):`, e.errors);
    return { text: FALLBACK[input.kind] };
  }
}
