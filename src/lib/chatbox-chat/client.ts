// Browser-side helpers for the group chat. This is the ONE place that decides how a message is sent.
//
//   no @WayWay  -> written straight into chat_messages (the database rules let a member post only as
//                  themselves): fast, and nothing else has to happen
//   @WayWay     -> POST /api/chatbox/message: the server saves it, then WayWay answers (agree on a
//                  time, then create the options). Its replies reach everyone through Realtime.
import type { ChatMessage } from "@/contracts/contract";
import type { WayWayMessageResponse } from "@/lib/chatbox-wayway/types";
import { toChatMessage } from "@/lib/db/mappers";
import type { createClient } from "@/lib/supabase/client";

type BrowserClient = ReturnType<typeof createClient>;

export const MAX_CHAT_LENGTH = 2000;
export const mentionsWayWay = (text: string) => /(^|[^\w@])@wayway\b/i.test(text);   // same rule as the AI module

export async function sendGroupMessage(
  supabase: BrowserClient,
  tripId: string,
  memberId: string,
  text: string,
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({ trip_id: tripId, sender_member_id: memberId, text })
    .select("*")
    .single();
  if (error || !data) throw new Error("Your message was not sent. Try again.");
  return toChatMessage(data);
}

/** A message for @WayWay: saved by the server, which then answers. Returns my message and WayWay's replies. */
export async function sendToWayWay(tripId: string, text: string): Promise<WayWayMessageResponse> {
  const res = await fetch("/api/chatbox/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tripId, text }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Your message was not sent. Try again.");
  return json as WayWayMessageResponse;
}
