// Structured outputs: the JSON shape each LLM call must return (tool input schemas).
// The "reasoning" field comes FIRST so the model thinks before answering (chain of thought);
// it is never shown to users.

import type { JsonSchema } from "./llm";

const LEVELS = ["must_go", "want_to_go", "same", "lean_not_go", "definitely_no"];

export const EXTRACT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    statements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "One preference, in English, third person, under 15 words." },
          private: { type: "boolean", description: "true if sensitive (money, health, personal situation) or asked to keep private." },
        },
        required: ["text", "private"],
      },
      description: "FULL updated list of this member's preference statements (max 8).",
    },
    reactions: {
      type: "array",
      description: "Only when options are listed in <context>: one entry per option the member talked about. Omit otherwise.",
      items: {
        type: "object",
        properties: {
          option: { type: "string", enum: ["A", "B", "C"] },
          level: { type: "string", enum: LEVELS },
          reason: { type: "string", description: "Neutral, under 10 words, no sensitive details." },
        },
        required: ["option", "level", "reason"],
      },
    },
    hardConstraintsToConfirm: {
      type: "object",
      description: "Only if the message states a diet, an allergy or a maximum budget. Omit otherwise.",
      properties: {
        diet: { type: "array", items: { type: "string" } },
        allergies: { type: "array", items: { type: "string" } },
        maxBudget: { type: "number", description: "Per person for the whole trip, JPY" },
      },
    },
    reply: { type: "string", description: "Private reply to the member, 1-2 sentences, in their language." },
  },
  required: ["statements", "reply"],
};

const SCORE = {
  type: "object",
  properties: {
    member: { type: "string", description: "Member id, e.g. m1" },
    level: { type: "string", enum: LEVELS },
    reason: { type: "string", description: "Under 10 words, never from private information" },
  },
  required: ["member", "level", "reason"],
};

export const OPTIONS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    reasoning: { type: "string", description: "Wishes and conflicts per member, under 150 words. Not shown to users." },
    candidates: {
      type: "array",
      description: "4 to 5 genuinely different candidates (2 to 4 when revising).",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title, under 8 words, in the group chat's language" },
          spots: {
            type: "array", items: { type: "string" },
            description: "Spot ids in visiting order. Empty for a split.",
          },
          branches: {
            type: "array",
            description: "Only for a split: exactly 2 branches.",
            items: {
              type: "object",
              properties: {
                members: { type: "array", items: { type: "string" } },
                spots: { type: "array", items: { type: "string" } },
              },
              required: ["members", "spots"],
            },
          },
          rendezvous: {
            type: "object",
            description: "Only for a split.",
            properties: { spot: { type: "string" }, time: { type: "string", description: "HH:MM" } },
            required: ["spot", "time"],
          },
          scores: { type: "array", items: SCORE, description: "Exactly one score per member." },
          explanation: { type: "string", description: "The trade-off in one plain sentence." },
          assumptions: { type: "array", items: { type: "string" } },
        },
        required: ["title", "spots", "scores", "explanation", "assumptions"],
      },
    },
  },
  required: ["reasoning", "candidates"],
};

export const SLOT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["propose", "confirm", "change", "none"] },
    slot: {
      type: "object",
      description: "Required for propose, change, and confirm without a pending proposal.",
      properties: {
        day: { type: "integer", description: "Trip day number (1 = first day)" },
        start: { type: "string", description: "HH:MM, 24h" },
        end: { type: "string", description: "HH:MM, 24h" },
        label: { type: "string", description: 'Short English label, e.g. "Lunch, day 2" or "Afternoon, day 1"' },
      },
      required: ["day", "start", "end", "label"],
    },
    kind: { type: "string", enum: ["meal", "activity"] },
    reply: { type: "string", description: "For propose: 1-2 sentences in the group's language stating the time and asking to confirm or change it." },
  },
  required: ["action"],
};

export const MESSAGE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: "The chat message, 2-4 sentences." },
    fairnessNote: { type: "string", description: "Only if a favored member is given; else empty." },
  },
  required: ["text"],
};

export const LEVEL_SET = new Set(LEVELS);
