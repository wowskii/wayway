"use server";
// Called by the floating group chat when it opens, so it starts from fresh messages
// (the page may have been open for a while), then Realtime keeps it live.
import { loadChatWindow, type ChatWindowData } from "@/lib/chat-window";
import { isUuid } from "@/lib/interview/http";

export async function openChatWindow(tripId: string): Promise<ChatWindowData | null> {
  if (!isUuid(tripId)) return null;
  return loadChatWindow(tripId);
}
