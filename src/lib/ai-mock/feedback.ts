// FAKE feedback handler used until the real AI is connected (WAYWAY_AI_MODE=mock).
// It recognises an option letter (A, B, C) and a few feeling words, and answers with the card
// facts only. Deliberately dumb: it lets us build the Spot Suggestions panel, the database and the
// round logic without an API key. It returns exactly the same shape as Simon's extractPreferences
// (and, like it, never recommends an option and never changes the preference list on its own).
import type { OptionReaction, SatisfactionLevel } from "@/contracts/contract";
import type { FeedbackHandler } from "@/lib/ai/feedback";

// Checked in this order: the first match wins ("don't like" before "like").
const FEELINGS: [RegExp, SatisfactionLevel, string][] = [
  [/\b(hate|never|no way|definitely not|absolutely not)\b/, "definitely_no", "Strongly against it"],
  [/\b(don'?t (like|want)|not (keen|really)|boring|tiring|too (far|long|expensive))\b/, "lean_not_go", "Not keen on it"],
  [/\b(must|need to|really want|love)\b/, "must_go", "Really wants it"],
  [/\b(like|want|nice|good|great|fun)\b/, "want_to_go", "Likes it"],
  [/\b(ok|okay|fine|either|don'?t mind)\b/, "same", "Fine either way"],
];

export const mockFeedback: FeedbackHandler = async ({ member, message, round, currentOptions = [] }) => {
  const text = message.text;
  const lower = text.toLowerCase();
  const ids = new Set(currentOptions.map((o) => o.id));
  const mentioned = [...new Set([...text.matchAll(/\b(?:option\s*)?([ABC])\b/gi)].map((m) => m[1].toUpperCase()))]
    .filter((id): id is OptionReaction["optionId"] => ids.has(id as OptionReaction["optionId"]));
  const feeling = FEELINGS.find(([re]) => re.test(lower));

  const reactions: OptionReaction[] = feeling ? mentioned.map((optionId) => ({ optionId, level: feeling[1], reason: feeling[2] })) : [];
  const titles = mentioned.map((id) => `${id}: ${currentOptions.find((o) => o.id === id)!.title}`).join(" · ");

  let reply: string;
  if (reactions.length) reply = `Thanks, noted for ${mentioned.join(" and ")}! I'll take it into the next round.`;
  else if (mentioned.length) reply = `${titles}. Tell me what you like or don't like about it, and I'll take it into the next round.`;
  else reply = "Thanks! Which option are you talking about: A, B or C?";

  return {
    preferenceUpdate: {
      memberId: member.id,
      round,
      statements: member.preferenceStatements,   // the mock never edits the list
      ...(reactions.length ? { reactions } : {}),
    },
    reply,
  };
};
