// extractPreferences: one member's private message -> short preference statements
// (+ their private reactions to the current options, when there are options).
// Sensitive statements (money, health, personal situation...) are stored with the
// "[private] " prefix (see context.ts) and are then protected like a private note.

import type { HardConstraints, MemberProfile, Option, PreferenceUpdate, PrivateMessage, SatisfactionLevel } from "@/contracts/contract";
import { LIMITS, MAX_TOKENS, MODELS, TEMPERATURE } from "./config";
import { isPrivateStatement, storeStatement, stripPrivate } from "./context";
import { AIOutputError, callTool, type Validation } from "./llm";
import { EXTRACT_SYSTEM, extractUser } from "./prompts";
import { EXTRACT_SCHEMA, LEVEL_SET } from "./schemas";

export interface ExtractInput {
  member: MemberProfile;
  message: PrivateMessage;
  history: PrivateMessage[];          // recent private messages of this member
  round: number;                      // 0 = onboarding
  currentOptions?: Option[];          // options the member is reacting to
}

export interface ExtractOutput {
  preferenceUpdate: PreferenceUpdate; // statements: sensitive ones start with "[private] "
  reply: string;
}

interface Raw {
  statements: { text: string; private: boolean }[];
  reactions?: { option: "A" | "B" | "C"; level: SatisfactionLevel; reason: string }[];
  hardConstraintsToConfirm?: Partial<HardConstraints>;
  reply: string;
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function makeValidator(optionIds: Set<string>) {
  return (raw: any): Validation<Raw> => {
    const errors: string[] = [];
    const list = raw?.statements;
    if (!Array.isArray(list) || list.some((s: any) => typeof s?.text !== "string" || typeof s?.private !== "boolean")) {
      errors.push('statements must be an array of {"text": string, "private": boolean}.');
    } else {
      if (list.length > LIMITS.maxStatementsPerMember) {
        errors.push(`Keep at most ${LIMITS.maxStatementsPerMember} statements: merge similar ones.`);
      }
      list.forEach((s: { text: string }, i: number) => {
        if (!s.text.trim()) errors.push(`Statement ${i + 1} is empty.`);
        else if (wordCount(s.text) > 15) errors.push(`Statement ${i + 1} is longer than 15 words.`);
      });
    }

    const reactions = raw?.reactions;
    if (reactions !== undefined && reactions !== null) {
      if (!Array.isArray(reactions)) errors.push("reactions must be an array.");
      else {
        if (reactions.length && !optionIds.size) errors.push("No options are being discussed: omit reactions.");
        const seen = new Set<string>();
        reactions.forEach((r: any, i: number) => {
          if (!optionIds.has(r?.option)) errors.push(`Reaction ${i + 1}: option "${r?.option}" is not one of ${[...optionIds].join(", ") || "(none)"}.`);
          else if (seen.has(r.option)) errors.push(`Reaction ${i + 1}: option ${r.option} appears twice.`);
          else seen.add(r.option);
          if (!LEVEL_SET.has(r?.level)) errors.push(`Reaction ${i + 1}: invalid level "${r?.level}".`);
          if (typeof r?.reason !== "string" || wordCount(r.reason) > 12) errors.push(`Reaction ${i + 1}: reason must be under 10 words.`);
        });
      }
    }

    if (typeof raw?.reply !== "string" || raw.reply.trim() === "") errors.push("reply must be a non-empty string.");
    else if (raw.reply.length > 400) errors.push("reply is too long: 1-2 sentences.");
    const h = raw?.hardConstraintsToConfirm;
    if (h !== undefined && h !== null) {
      if (typeof h !== "object") errors.push("hardConstraintsToConfirm must be an object.");
      else {
        if (h.diet !== undefined && !Array.isArray(h.diet)) errors.push("hardConstraintsToConfirm.diet must be an array.");
        if (h.allergies !== undefined && !Array.isArray(h.allergies)) errors.push("hardConstraintsToConfirm.allergies must be an array.");
        if (h.maxBudget !== undefined && (typeof h.maxBudget !== "number" || h.maxBudget <= 0)) {
          errors.push("hardConstraintsToConfirm.maxBudget must be a positive number.");
        }
      }
    }
    return errors.length ? { ok: false, errors } : { ok: true, value: raw as Raw };
  };
}

export async function extractPreferences(input: ExtractInput): Promise<ExtractOutput> {
  const { member, message, history, round, currentOptions } = input;
  const context = currentOptions?.length
    ? `Round ${round}. The member is reacting privately to these options:\n` +
      currentOptions.map((o) => `Option ${o.id}: ${o.title} (${o.explanation})`).join("\n")
    : "Onboarding: the member is telling WayWay about themselves before the trip. No options yet.";

  try {
    const res = await callTool<Raw>({
      model: MODELS.fast,
      temperature: TEMPERATURE.extract,
      maxTokens: MAX_TOKENS.extract,
      system: EXTRACT_SYSTEM,
      user: extractUser({
        name: member.name,
        statements: member.preferenceStatements.map((s) => ({ text: stripPrivate(s), private: isPrivateStatement(s) })),
        context,
        history: history.slice(-6).map((m) => `${m.sender === "wayway" ? "WayWay" : member.name}: ${m.text}`).join("\n"),
        message: message.text,
      }),
      tool: { name: "save_preferences", description: "Save the member's updated preferences, reactions and reply.", schema: EXTRACT_SCHEMA },
      validate: makeValidator(new Set((currentOptions ?? []).map((o) => o.id))),
    });
    const h = res.value.hardConstraintsToConfirm;
    const hasHard = h && ((h.diet?.length ?? 0) > 0 || (h.allergies?.length ?? 0) > 0 || h.maxBudget !== undefined);
    const reactions = (res.value.reactions ?? []).map((r) => ({ optionId: r.option, level: r.level, reason: r.reason.trim() }));
    return {
      preferenceUpdate: {
        memberId: member.id,
        round,
        statements: res.value.statements.map((s) => storeStatement(s.text, s.private)),
        ...(reactions.length ? { reactions } : {}),
        ...(hasHard ? { hardConstraintsToConfirm: h } : {}),
      },
      reply: res.value.reply,
    };
  } catch (e) {
    if (!(e instanceof AIOutputError)) throw e;   // only our own programming errors get through
    console.warn(`[extractPreferences] fallback (${e.kind}):`, e.errors);
    // Fallback: keep the profile unchanged, never block the member.
    return {
      preferenceUpdate: { memberId: member.id, round, statements: member.preferenceStatements },
      reply: "Thanks, noted! Could you tell me a bit more about what you'd enjoy most?",
    };
  }
}
