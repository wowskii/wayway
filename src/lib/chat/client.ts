// Browser-side helpers for the group chat. This is the ONE place that decides how a message is sent.
//
// Today: the member writes straight into chat_messages (allowed by the database rules: a member can
// only post as themselves). Nothing answers @WayWay yet.
// Later: replace sendGroupMessage with a POST to /api/chat (contract ChatRequest), so the server can
// see every @WayWay mention and post WayWay's reply. The chat component does not need to change.
import type { ChatMessage, SatisfactionLevel } from "@/contracts/contract";
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

/**
 * Saves how I feel about one spot. Needs the server part (spot_ratings table + route), which does not
 * exist yet: the rate panel only calls this with live data.
 */
export async function saveSpotRating(tripId: string, spotId: string, level: SatisfactionLevel) {
  const res = await fetch("/api/spot-ratings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tripId, spotId, level }),
  });
  if (res.status === 404) throw new Error("Ratings aren't connected to the server yet.");
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Your rating was not saved. Try again.");
  return json;
}
