// Types shared by the feedback API (server) and the Spot Suggestions panel (browser).
import type { InterviewMessage } from "@/lib/interview/types";

/** POST /api/private/feedback: { tripId, optionSetId, text } */
export interface FeedbackRequest {
  tripId: string;
  optionSetId: string;
  text: string;
}

/** The member's saved message and WayWay's reply (both tagged with the option set). */
export interface FeedbackTurnResponse {
  messages: InterviewMessage[];
}
