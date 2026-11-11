// FAKE interviewer used until the real AI is connected (WAYWAY_AI_MODE=mock).
// It asks the 6 topics in order and recognises simple keywords. It is deliberately dumb:
// its job is to let us build and test the page, the database and the confirmation card
// without an API key. It returns exactly the same shape as the real AI will.
import type { HardConstraints, MemberProfile } from "@/contracts/contract";
import {
  INTERVIEW_TOPICS,
  progressFrom,
  type InterviewOutput,
  type InterviewTopic,
  type Interviewer,
  type ProfileUpdate,
} from "@/lib/ai/types";

export const QUESTIONS: Record<InterviewTopic, string> = {
  interests: "What do you enjoy most when you travel? Food, temples, museums, shopping, nature, nightlife…",
  pace: "How busy do you like your days: relaxed with breaks, something in between, or packed?",
  sleep: "Are you an early bird, a night owl, or flexible?",
  diet: "Do you follow a diet, like vegetarian, vegan or halal?",
  allergies: "Any food allergies I should always avoid? This stays private.",
  budget: "Roughly how much do you want to spend for the whole trip, in yen? This stays private too.",
};

export function openingMessage(name: string) {
  return `Hi ${name}! I'm WayWay. A few quick questions so I can suggest plans you'll like. Only I see this chat. ${QUESTIONS.interests}`;
}

// --- keyword tables ----------------------------------------------------------
const INTEREST_WORDS: [RegExp, string][] = [
  [/\b(food|eat|eating|ramen|sushi|restaurants?|street food|cafes?|izakaya)\b/, "food"],
  [/\b(temples?|shrines?)\b/, "temples"],
  [/\b(museums?|art|galler(y|ies))\b/, "museums"],
  [/\b(shopping|shops?|markets?|fashion)\b/, "shopping"],
  [/\b(nature|parks?|hik(e|ing)|gardens?|mountains?)\b/, "nature"],
  [/\b(nightlife|bars?|clubs?|karaoke|night life)\b/, "nightlife"],
  [/\b(anime|manga|games?|gaming)\b/, "anime & games"],
  [/\b(history|historic|castles?)\b/, "history"],
  [/\b(photos?|photography)\b/, "photography"],
];
const DIET_WORDS: [RegExp, string][] = [
  [/\bvegan\b/, "vegan"],
  [/\bvegetarian\b|\bveggie\b/, "vegetarian"],
  [/\bhalal\b/, "halal"],
  [/\bkosher\b/, "kosher"],
  [/\bpescatarian\b/, "pescatarian"],
  [/\bgluten[- ]?free\b|\bceliac\b|\bcoeliac\b/, "gluten-free"],
];
const ALLERGY_WORDS: [RegExp, string][] = [
  [/\bpeanuts?\b/, "peanuts"],
  [/\b(tree )?nuts?\b/, "nuts"],
  [/\bshellfish|shrimps?|prawns?|crabs?\b/, "shellfish"],
  [/\bfish\b/, "fish"],
  [/\b(dairy|milk|lactose)\b/, "dairy"],
  [/\beggs?\b/, "eggs"],
  [/\b(soy|soya)\b/, "soy"],
  [/\b(wheat|gluten)\b/, "gluten"],
  [/\bsesame\b/, "sesame"],
];
const VAGUE = /\b(anything|whatever|don'?t mind|no preference|up to you|any is fine|i'?m easy)\b/;
const NO = /^\s*(no|nope|none|nothing|nah|not really|no allerg(y|ies)|no restrictions?)\b/;
const PRIVATE = /\b(don'?t tell|between us|private|secret|confidential|embarrass)/;

const found = (text: string, table: [RegExp, string][]) =>
  [...new Set(table.filter(([re]) => re.test(text)).map(([, v]) => v))];

function parseBudget(text: string): number | undefined {
  // "30000", "30,000 yen", "¥30000", "30k", "3万"
  const m = text.replace(/,/g, "").match(/(¥\s*)?(\d+(?:\.\d+)?)\s*(k|万|man)?\b/);
  if (!m) return undefined;
  const n = parseFloat(m[2]) * (m[3] === "k" ? 1_000 : m[3] ? 10_000 : 1);
  return n >= 1_000 && n <= 10_000_000 ? Math.round(n) : undefined;   // ignore "3 days" etc.
}

function pick<T>(text: string, rules: [RegExp, T][]): T | undefined {
  return rules.find(([re]) => re.test(text))?.[1];
}

const shorten = (s: string, words = 12) => s.trim().split(/\s+/).slice(0, words).join(" ");

// --- the interviewer -----------------------------------------------------------
export const mockInterviewer: Interviewer = async (input) => {
  const { member, message, coveredTopics, round } = input;
  const text = message.text.toLowerCase();
  const covered = new Set(coveredTopics);
  const current = INTERVIEW_TOPICS.find((t) => !covered.has(t));   // topic WayWay just asked about

  const statements = new Set(member.preferenceStatements);
  const profileUpdate: ProfileUpdate = {};
  const hard: Partial<HardConstraints> = {};

  // Interests
  const interests = found(text, INTEREST_WORDS);
  if (interests.length) {
    profileUpdate.interests = [...new Set([...member.interests, ...interests])];
    statements.add(`Enjoys ${interests.join(", ")}`);
    covered.add("interests");
  }

  // Pace
  const pace = pick<MemberProfile["pace"]>(text, [
    [/\b(relax(ed|ing)?|slow|chill|breaks?|easy pace|lazy)\b/, "relaxed"],
    [/\b(packed|busy|as much as possible|full days?|lots of)\b/, "packed"],
    [/\b(in between|moderate|balanced|middle|medium|normal)\b/, "moderate"],
  ]);
  if (pace) {
    profileUpdate.pace = pace;
    statements.add({ relaxed: "Prefers a relaxed pace with breaks", moderate: "Likes a balanced pace", packed: "Wants packed days" }[pace]);
    covered.add("pace");
  }

  // Sleep
  const sleep = pick<MemberProfile["sleep"]>(text, [
    [/\b(early bird|early riser|mornings?|wake up early|early)\b/, "early_bird"],
    [/\b(night owl|late|sleep in|nights?)\b/, "night_owl"],
    [/\b(flexible|either|both|depends)\b/, "flexible"],
  ]);
  if (sleep && (current === "sleep" || /early bird|night owl|sleep in|early riser/.test(text))) {
    profileUpdate.sleep = sleep;
    statements.add({ early_bird: "Early riser", night_owl: "Night owl, prefers late starts", flexible: "Flexible about schedule" }[sleep]);
    covered.add("sleep");
  }

  // Diet, allergies, budget -> only PROPOSED, the member must confirm them
  const diet = found(text, DIET_WORDS);
  if (diet.length) {
    hard.diet = diet;
    covered.add("diet");
  }
  const allergies = current === "allergies" || /allerg/.test(text) ? found(text, ALLERGY_WORDS) : [];
  if (allergies.length) {
    hard.allergies = allergies;
    covered.add("allergies");
  }
  const budget = current === "budget" || /yen|¥|budget|spend/.test(text) ? parseBudget(text) : undefined;
  if (budget) {
    hard.maxBudget = budget;
    covered.add("budget");
  }
  if (/\b(cheap|tight budget|broke|student|save money|not much money)\b/.test(text)) {
    statements.add("[private] Prefers budget-friendly options");
  }

  // A plain "no" / "anything is fine" still answers the current question
  if (current && !covered.has(current) && (NO.test(text) || VAGUE.test(text) || current === "interests")) {
    if (VAGUE.test(text)) statements.add(`Easygoing about ${current}`);
    covered.add(current);
  }

  // Asked to keep something private
  if (PRIVATE.test(text)) statements.add(`[private] ${shorten(message.text)}`);

  const progress = progressFrom([...covered].filter((t) => INTERVIEW_TOPICS.includes(t)));
  const hasHard = Object.keys(hard).length > 0;
  // Reply = short reaction + next question (or a closing line when everything is covered).
  // If the current topic is still not answered, "next" is that same topic, so it is asked again.
  const reaction = hasHard
    ? "Thanks! Please check the card below."
    : current && !covered.has(current)
      ? "Sorry, I didn't quite get that."
      : ["Nice!", "Got it.", "Noted, thanks!"][progress.covered.length % 3];
  const next = progress.missing[0];
  const reply = next
    ? `${reaction} ${QUESTIONS[next]}`
    : `${reaction} That's everything I need! Tell me anything else you'd like me to know, or tap Finish.`;

  const output: InterviewOutput = {
    preferenceUpdate: {
      memberId: member.id,
      round,
      statements: [...statements].slice(-12),
      ...(hasHard ? { hardConstraintsToConfirm: hard } : {}),
    },
    reply,
    interview: progress,
    ...(Object.keys(profileUpdate).length ? { profileUpdate } : {}),
  };
  return output;
};
