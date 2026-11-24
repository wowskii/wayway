// Types shared by the "@WayWay" API (server) and the group chat (browser).
import type { ChatMessage } from "@/contracts/contract";

/** POST /api/chatbox/message: a group message that mentions @WayWay. */
export interface WayWayMessageRequest {
  tripId: string;
  text: string;
}

/** My saved message and WayWay's answers (also pushed to everyone by Realtime). */
export interface WayWayMessageResponse {
  message: ChatMessage;
  replies: ChatMessage[];
}
