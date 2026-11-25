// extractPreferences: one member's private message -> short preference statements
// (+ their private reactions to the current options, when there are options).
// Sensitive statements (money, health, personal situation...) are stored with the
// "[private] " prefix (see context.ts) and are then protected like a private note.

import type { HardConstraints, MemberProfile, Option, PreferenceUpdate, PrivateMessage, SatisfactionLevel, Spot } from "@/contracts/contract";
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
  spots?: Spot[];                     // to describe the option cards (names, areas, prices, hours)
  memberNames?: Record<string, string>; // member id -> name, for split groups and "works for"
  currency?: string;                  // trip currency ("JPY" by default): budgets and prices
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

// Shared with interview.ts: the statement list and the hard constraints have the same rules.
export function checkStatements(list: any, errors: string[]) {
  if (!Array.isArray(list) || list.some((s: any) => typeof s?.text !== "string" || typeof s?.private !== "boolean")) {
    errors.push('statements must be an array of {"text": string, "private": boolean}.');
    return;
  }
  if (list.length > LIMITS.maxStatementsPerMember) {
    errors.push(`Keep at most ${LIMITS.maxStatementsPerMember} statements: merge similar ones.`);
  }
  list.forEach((s: { text: string }, i: number) => {
    if (!s.text.trim()) errors.push(`Statement ${i + 1} is empty.`);
    else if (wordCount(s.text) > 15) errors.push(`Statement ${i + 1} is longer than 15 words.`);
  });
}

export function checkHardConstraints(h: any, errors: string[]) {
  if (h === undefined || h === null) return;
  if (typeof h !== "object") return void errors.push("hardConstraintsToConfirm must be an object.");
  // Check the elements too: ["nuts", null] would otherwise reach the confirmation card (or crash cleanWords).
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim() !== "");
  if (h.diet !== undefined && !strings(h.diet)) errors.push("hardConstraintsToConfirm.diet must be an array of non-empty strings.");
  if (h.allergies !== undefined && !strings(h.allergies)) errors.push("hardConstraintsToConfirm.allergies must be an array of non-empty strings.");
  if (h.maxBudget !== undefined && (typeof h.maxBudget !== "number" || h.maxBudget <= 0)) {
    errors.push("hardConstraintsToConfirm.maxBudget must be a positive number.");
  }
}

// Never propose again what the member already has (v9: a confirmed "mustard" allergy came back as a card
// with every message). Diet and allergies compared without case; the budget only if it is the same amount.
export function newConstraintsOnly(h: Partial<HardConstraints> | undefined, member: MemberProfile): Partial<HardConstraints> | undefined {
  if (!h) return h;
  const has = (list: string[], v: string) => list.some((x) => x.trim().toLowerCase() === v.trim().toLowerCase());
  const out: Partial<HardConstraints> = {};
  if (h.diet) out.diet = h.diet.filter((d) => !has(member.hard.diet, d));
  if (h.allergies) out.allergies = h.allergies.filter((a) => !has(member.hard.allergies, a));
  if (h.maxBudget !== undefined && h.maxBudget !== member.hard.maxBudget) out.maxBudget = h.maxBudget;
  return out;
}

// A question alone is not a reaction (v9: "Which one should I pick?" was saved as A = want_to_go): reactions
// of a message that asks something without saying what the member thinks are dropped.
const OPINION = /\b(like|love|loved|prefer|hate|better|worse|good|bad|boring|fun|too|want|wanna|rather|fine|ok|okay|perfect|great|nice|not|no|dislike|enjoy|sounds|happy|amazing|awesome|meh|cool|interesting|tired|far|expensive|cheap|j'?aime|préf[eè]re|nul|bien|trop|pas)\b/i;
export const isPureQuestion = (text: string) => /[?？]/.test(text) && !OPINION.test(text);

// Only non-empty hard constraints are returned (an empty object would show an empty confirmation card).
export function nonEmptyHard(h: Partial<HardConstraints> | undefined): Partial<HardConstraints> | undefined {
  if (!h) return undefined;
  const out: Partial<HardConstraints> = {};
  if (h.diet?.length) out.diet = h.diet;
  if (h.allergies?.length) out.allergies = h.allergies;
  if (h.maxBudget !== undefined) out.maxBudget = h.maxBudget;
  return Object.keys(out).length ? out : undefined;
}

// Neutrality (private chat): WayWay never recommends or ranks an option, even when asked.
const RECOMMEND = new RegExp([
  String.raw`\bI(?:'d| would)? (?:recommend|suggest|pick|choose|go (?:for|with))\b`,
  String.raw`\byou should (?:pick|choose|vote|take|go (?:for|with))\b`,
  String.raw`\b(?:best|right|ideal|perfect) (?:fit|choice|option|pick|match)\b`,
  String.raw`\b(?:fits?|suits?) you (?:best|better|most)\b`,
  String.raw`\b(?:better|best|good|great|perfect) (?:fit|choice|option|match) for you\b`,
  String.raw`\b(?:sounds|seems|looks) like (?:a |the )?(?:better|best|good|great|right|perfect) (?:fit|choice|option|match|pick)\b`,
  String.raw`\bje (?:te |vous )?(?:recommande|conseille|sugg[eè]re)\b`,
  String.raw`\b(?:meilleur|bon) choix\b`,
  String.raw`\btu devrais (?:choisir|prendre|voter)\b`,
].join("|"), "i");

// The facts shown on each card: the only things WayWay may say about an option.
export function describeOptions(options: Option[], spots: Spot[] = [], names: Record<string, string> = {}, currency = "JPY"): string {
  const byId = new Map(spots.map((s) => [s.id, s]));
  const spot = (id: string) => {
    const s = byId.get(id);
    return s ? `${s.name} (${s.area}, about ${s.price} ${currency}, ~${s.durationMin} min, usual hours ${s.openHours})` : id;
  };
  const who = (ids: string[]) => ids.map((id) => names[id] ?? id).join(", ");
  return options.map((o) => {
    const lines = [`Option ${o.id}: ${o.title}`];
    if (o.branches?.length) {
      o.branches.forEach((b, i) => lines.push(`  Group ${i + 1} (${who(b.memberIds)}): ${b.spots.map(spot).join(" > ")}`));
      if (o.rendezvous) lines.push(`  Everyone meets at ${byId.get(o.rendezvous.spotId)?.name ?? o.rendezvous.spotId} at ${o.rendezvous.time}`);
    } else lines.push(`  Plan: ${o.spots.map(spot).join(" > ")}`);
    lines.push(`  Trade-off: ${o.explanation}`);
    if (o.assumptions.length) lines.push(`  Assumptions: ${o.assumptions.join("; ")}`);
    if (o.satisfiedMemberIds.length) lines.push(`  Works for: ${who(o.satisfiedMemberIds)}`);
    if (o.fairnessNote) lines.push(`  Note: ${o.fairnessNote}`);
    return lines.join("\n");
  }).join("\n");
}

function makeValidator(optionIds: Set<string>) {
  return (raw: any): Validation<Raw> => {
    const errors: string[] = [];
    checkStatements(raw?.statements, errors);

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
    else if (raw.reply.length > 500) errors.push("reply is too long: 1-3 sentences.");
    else if (optionIds.size && RECOMMEND.test(raw.reply)) {
      errors.push("The reply recommends an option. Stay neutral: compare the options with the member's own preferences, fact by fact, and let them choose.");
    }
    checkHardConstraints(raw?.hardConstraintsToConfirm, errors);
    return errors.length ? { ok: false, errors } : { ok: true, value: raw as Raw };
  };
}

export async function extractPreferences(input: ExtractInput): Promise<ExtractOutput> {
  const { member, message, history, round, currentOptions, spots, memberNames } = input;
  const context = currentOptions?.length
    ? `Round ${round}. The member is reacting privately to these options (card facts):\n` +
      describeOptions(currentOptions, spots, memberNames, input.currency)
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
    const h = nonEmptyHard(newConstraintsOnly(res.value.hardConstraintsToConfirm, member));
    const hasHard = Boolean(h);
    const reactions = isPureQuestion(message.text) ? []
      : (res.value.reactions ?? []).map((r) => ({ optionId: r.option, level: r.level, reason: r.reason.trim() }));
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
