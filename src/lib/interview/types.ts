// Types shared by the interview API (server) and the interview page (browser).
import type { HardConstraints, PreferenceUpdate, PrivateMessage } from "@/contracts/contract";
import type { InterviewProgress } from "@/lib/ai/types";

/** A private message as the interview page needs it: the contract shape + the confirmation card. */
export interface InterviewMessage extends PrivateMessage {
  constraintsToConfirm?: Partial<HardConstraints>;
  constraintsStatus?: "pending" | "confirmed" | "rejected";
}

/** GET /api/private */
export interface InterviewState {
  memberId: string;
  memberName: string;
  onboardingStatus: string;
  messages: InterviewMessage[];
  interview: InterviewProgress;
}

/** POST /api/private (contract PrivateChatResponse + interview extras) */
export interface InterviewTurnResponse {
  messages: InterviewMessage[];
  preferenceUpdate?: PreferenceUpdate;
  interview: InterviewProgress;
}

/** POST /api/private/confirm */
export interface ConfirmResponse {
  message: InterviewMessage;
  applied: Partial<HardConstraints>;
}
