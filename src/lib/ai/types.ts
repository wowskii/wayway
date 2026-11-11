// The "plug" between the app and the AI for the onboarding interview.
//
// ExtractInput / ExtractOutput are COPIES of the types in Simon's AI module
// (branch feature/ai-module, wayway-ai/lib/ai/extractPreferences.ts). Keep them identical:
// when his module is merged, these copies are replaced by imports from it.
//
// InterviewOutput adds what the interview page needs on top of extractPreferences
// (proposal to discuss with the team before changing contract.ts):
//   - profileUpdate: interests / pace / sleep found in the answer (MemberProfile fields)
//   - interview: which topics are covered and whether the interview is finished
import type { MemberProfile, Option, PreferenceUpdate, PrivateMessage } from "@/contracts/contract";

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

/** Topics WayWay covers during the onboarding interview, in the order it asks them. */
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

/** Any interviewer (mock or real AI) is a function with this shape. */
export type Interviewer = (input: InterviewInput) => Promise<InterviewOutput>;

export function progressFrom(covered: Iterable<InterviewTopic>): InterviewProgress {
  const set = new Set(covered);
  const ordered = INTERVIEW_TOPICS.filter((t) => set.has(t));
  const missing = INTERVIEW_TOPICS.filter((t) => !set.has(t));
  return { covered: ordered, missing, done: missing.length === 0 };
}

export const isInterviewTopic = (v: unknown): v is InterviewTopic =>
  (INTERVIEW_TOPICS as readonly string[]).includes(v as string);
