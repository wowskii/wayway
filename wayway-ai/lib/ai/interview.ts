// interview: the onboarding interview in a member's private chat with WayWay (round 0).
// It is extractPreferences + what the interview page needs (role 1, src/lib/ai/types.ts on
// feature/web-skeleton): the public profile found in the answer (interests, pace, sleep) and
// which of the 6 topics are covered. Signature = role 1's `Interviewer`, so it plugs in as is:
//   if (mode === "real") return interview;
//
// The LLM proposes, the code decides: topics are only added (never removed), a topic implied by
// a detected value counts as covered, values are cleaned, and hard constraints (diet, allergies,
// budget) are only PROPOSED: role 1's confirmation card applies them.

import type { HardConstraints, MemberProfile } from "@/contracts/contract";
import { MAX_TOKENS, MODELS, TEMPERATURE } from "./config";
import { isPrivateStatement, storeStatement, stripPrivate } from "./context";
import { checkHardConstraints, checkStatements, nonEmptyHard, type ExtractInput, type ExtractOutput } from "./extractPreferences";
import { AIOutputError, callTool, type Validation } from "./llm";
import { INTERVIEW_SYSTEM, interviewUser } from "./prompts";
import { INTERVIEW_SCHEMA } from "./schemas";

// ---------- Types (identical to role 1's src/lib/ai/types.ts) ----------
export const INTERVIEW_TOPICS = ["interests", "pace", "sleep", "diet", "allergies", "budget"] as const;
export type InterviewTopic = (typeof INTERVIEW_TOPICS)[number];

export interface InterviewProgress {
  covered: InterviewTopic[];
  missing: InterviewTopic[];
  done: boolean;
}

export interface ProfileUpdate {
  interests?: string[];               // full updated list
  pace?: MemberProfile["pace"];
  sleep?: MemberProfile["sleep"];
}

export interface InterviewInput extends ExtractInput {
  coveredTopics: InterviewTopic[];    // topics already answered before this message
}

export interface InterviewOutput extends ExtractOutput {
  profileUpdate?: ProfileUpdate;
  interview: InterviewProgress;
}

export function progressFrom(covered: Iterable<InterviewTopic>): InterviewProgress {
  const set = new Set(covered);
  return {
    covered: INTERVIEW_TOPICS.filter((t) => set.has(t)),
    missing: INTERVIEW_TOPICS.filter((t) => !set.has(t)),
    done: INTERVIEW_TOPICS.every((t) => set.has(t)),
  };
}

const isTopic = (v: unknown): v is InterviewTopic => (INTERVIEW_TOPICS as readonly string[]).includes(v as string);
const PACES = new Set(["relaxed", "moderate", "packed"]);
const SLEEPS = new Set(["early_bird", "night_owl", "flexible"]);

// Fallback questions (English) when the model fails: the member can always go on.
const QUESTIONS: Record<InterviewTopic, string> = {
  interests: "What do you enjoy most when you travel? Food, temples, museums, shopping, nature, nightlife…",
  pace: "How busy do you like your days: relaxed with breaks, something in between, or packed?",
  sleep: "Are you an early bird, a night owl, or flexible?",
  diet: "Do you follow a diet, like vegetarian, vegan or halal?",
  allergies: "Any food allergies I should always avoid? This stays private.",
  budget: "Roughly how much do you want to spend for the whole trip, in yen? This stays private too.",
};

interface Raw {
  answered: InterviewTopic[];
  statements: { text: string; private: boolean }[];
  profileUpdate?: ProfileUpdate;
  hardConstraintsToConfirm?: Partial<HardConstraints>;
  reply: string;
}

// "Anything is fine" (key finding of our user research): the first vague answer gets an either-or question.
const VAGUE = /\b(anything|whatever|don'?t mind|no preference|up to you|i'?m easy|peu importe|n'importe|comme vous voulez)\b/i;
const SOFT_TOPICS: InterviewTopic[] = ["interests", "pace", "sleep"];
const sentences = (s: string) => s.trim().split(/(?<=[.!?。？！])\s+/).filter(Boolean).length;

function makeValidator(previouslyCovered: InterviewTopic[], message: string, lastMemberMessage?: string) {
  const current = progressFrom(previouslyCovered).missing[0];
  const firstVague = VAGUE.test(message) && !(lastMemberMessage && VAGUE.test(lastMemberMessage));
  return (raw: any): Validation<Raw> => {
    const errors: string[] = [];
    if (!Array.isArray(raw?.answered) || raw.answered.some((t: unknown) => !isTopic(t))) {
      errors.push(`answered must be an array of topics among: ${INTERVIEW_TOPICS.join(", ")}.`);
    } else if (firstVague && SOFT_TOPICS.includes(current) && (raw.answered.includes(current) || implied(raw).includes(current))) {
      errors.push(`The answer about "${current}" is vague and it is the first time: do not mark it answered and do not fill it in profileUpdate. Ask ONE concrete either-or question about ${current} instead.`);
    }
    checkStatements(raw?.statements, errors);
    checkHardConstraints(raw?.hardConstraintsToConfirm, errors);

    const p = raw?.profileUpdate;
    if (p !== undefined && p !== null) {
      if (typeof p !== "object") errors.push("profileUpdate must be an object.");
      else {
        if (p.interests !== undefined && (!Array.isArray(p.interests) || p.interests.some((i: unknown) => typeof i !== "string"))) {
          errors.push("profileUpdate.interests must be an array of strings.");
        }
        if (p.pace !== undefined && !PACES.has(p.pace)) errors.push("profileUpdate.pace must be relaxed, moderate or packed.");
        if (p.sleep !== undefined && !SLEEPS.has(p.sleep)) errors.push("profileUpdate.sleep must be early_bird, night_owl or flexible.");
      }
    }

    if (typeof raw?.reply !== "string" || !raw.reply.trim()) errors.push("reply must be a non-empty string.");
    else if (raw.reply.length > 500 || sentences(raw.reply) > 3) errors.push("reply is too long: at most 3 short sentences.");
    else if (Array.isArray(raw?.answered)) {
      // While topics are missing, the reply must ask the next question.
      const covered = progressFrom([...previouslyCovered, ...raw.answered.filter(isTopic), ...implied(raw)]);
      if (!covered.done && !raw.reply.includes("?") && !raw.reply.includes("？")) {
        errors.push(`The reply must end with a question about "${covered.missing[0]}" (the next topic not answered yet).`);
      }
    }
    return errors.length ? { ok: false, errors } : { ok: true, value: raw as Raw };
  };
}

// A detected value answers its topic, even if the model forgot to list it in "answered".
function implied(raw: any): InterviewTopic[] {
  const out: InterviewTopic[] = [];
  const p = raw?.profileUpdate ?? {};
  const h = raw?.hardConstraintsToConfirm ?? {};
  if (Array.isArray(p.interests) && p.interests.length) out.push("interests");
  if (PACES.has(p.pace)) out.push("pace");
  if (SLEEPS.has(p.sleep)) out.push("sleep");
  if (Array.isArray(h.diet) && h.diet.length) out.push("diet");
  if (Array.isArray(h.allergies) && h.allergies.length) out.push("allergies");
  if (typeof h.maxBudget === "number" && h.maxBudget > 0) out.push("budget");
  return out;
}

const cleanWords = (list: string[], max: number) =>
  [...new Set(list.map((w) => w.trim().toLowerCase()).filter((w) => w && w.length <= 30))].slice(0, max);

export async function interview(input: InterviewInput): Promise<InterviewOutput> {
  const { member, message, history, round, coveredTopics } = input;
  const before = coveredTopics.filter(isTopic);
  const profile = [
    `interests: ${member.interests.join(", ") || "unknown"}`,
    `pace: ${member.pace}`,
    `sleep: ${member.sleep}`,
    `diet: ${member.hard.diet.join(", ") || "none confirmed"}`,
  ].join("\n");

  try {
    const res = await callTool<Raw>({
      model: MODELS.fast,
      temperature: TEMPERATURE.interview,
      maxTokens: MAX_TOKENS.interview,
      system: INTERVIEW_SYSTEM,
      user: interviewUser({
        name: member.name,
        statements: member.preferenceStatements.map((s) => ({ text: stripPrivate(s), private: isPrivateStatement(s) })),
        profile,
        covered: before,
        history: history.slice(-8).map((m) => `${m.sender === "wayway" ? "WayWay" : member.name}: ${m.text}`).join("\n"),
        message: message.text,
      }),
      tool: { name: "save_interview", description: "Save what the member said and reply with the next question.", schema: INTERVIEW_SCHEMA },
      validate: makeValidator(before, message.text, [...history].reverse().find((m) => m.sender === "member")?.text),
    });
    const v = res.value;

    const profileUpdate: ProfileUpdate = {};
    if (v.profileUpdate?.interests?.length) profileUpdate.interests = cleanWords(v.profileUpdate.interests, 8);
    if (v.profileUpdate?.pace) profileUpdate.pace = v.profileUpdate.pace;
    if (v.profileUpdate?.sleep) profileUpdate.sleep = v.profileUpdate.sleep;
    const hard = nonEmptyHard(v.hardConstraintsToConfirm && {
      ...v.hardConstraintsToConfirm,
      ...(v.hardConstraintsToConfirm.diet ? { diet: cleanWords(v.hardConstraintsToConfirm.diet, 10) } : {}),
      ...(v.hardConstraintsToConfirm.allergies ? { allergies: cleanWords(v.hardConstraintsToConfirm.allergies, 10) } : {}),
      ...(v.hardConstraintsToConfirm.maxBudget ? { maxBudget: Math.round(v.hardConstraintsToConfirm.maxBudget) } : {}),
    });

    return {
      preferenceUpdate: {
        memberId: member.id,
        round,
        statements: v.statements.map((s) => storeStatement(s.text, s.private)),
        ...(hard ? { hardConstraintsToConfirm: hard } : {}),
      },
      reply: v.reply.trim(),
      interview: progressFrom([...before, ...v.answered, ...implied(v)]),   // topics are never removed
      ...(Object.keys(profileUpdate).length ? { profileUpdate } : {}),
    };
  } catch (e) {
    if (!(e instanceof AIOutputError)) throw e;   // only our own programming errors get through
    console.warn(`[interview] fallback (${e.kind}):`, e.errors);
    // Fallback: nothing learned, ask the current question again. The member is never blocked.
    const progress = progressFrom(before);
    const next = progress.missing[0];
    return {
      preferenceUpdate: { memberId: member.id, round, statements: member.preferenceStatements },
      reply: next
        ? `Sorry, I didn't quite get that. ${QUESTIONS[next]}`
        : "Thanks! Tell me anything else you'd like me to know, or tap Finish.",
      interview: progress,
    };
  }
}
