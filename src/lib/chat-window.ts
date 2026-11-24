import "server-only";
// What the floating group chat (map page) needs: the same data the trip page gives Patrick's <GroupChat>,
// without the rest of the trip page (suggestions, itinerary panel, trips list).
// Uses the LOGGED-IN USER's Supabase client: the database rules (RLS) decide what comes back.
import type { ChatMessage } from "@/contracts/contract";
import type { HubMember } from "@/lib/chatbox-trip-hub/types";
import { toChatMessage } from "@/lib/db/mappers";
import { createClient } from "@/lib/supabase/server";

const MESSAGE_PAGE = 60;   // latest messages, same as the trip page

export interface ChatWindowData {
  tripName: string;
  timezone: string;
  me: HubMember;
  members: HubMember[];
  messages: ChatMessage[];
  reads: Record<string, string>;   // memberId -> read up to this createdAt
}

/** Null when the user is logged out or not a member of the trip. */
export async function loadChatWindow(tripId: string): Promise<ChatWindowData | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: trip }, { data: memberRows }, { data: messageRows }, { data: readRows }] = await Promise.all([
    supabase.from("trips").select("name, timezone").eq("id", tripId).maybeSingle(),
    supabase.from("trip_members").select("id, name, user_id").eq("trip_id", tripId).order("joined_at"),
    supabase.from("chat_messages").select("*").eq("trip_id", tripId).order("created_at", { ascending: false }).limit(MESSAGE_PAGE),
    supabase.from("chat_reads").select("member_id, last_read_at").eq("trip_id", tripId),
  ]);
  const meRow = memberRows?.find((m) => m.user_id === user.id);
  if (!trip || !meRow) return null;

  return {
    tripName: trip.name,
    timezone: trip.timezone,
    me: { id: meRow.id, name: meRow.name },
    members: (memberRows ?? []).map((m) => ({ id: m.id, name: m.name })),
    messages: (messageRows ?? []).reverse().map(toChatMessage),
    reads: Object.fromEntries((readRows ?? []).map((r) => [r.member_id, r.last_read_at])),
  };
}

/** Messages from others (or WayWay) newer than what I last read: the number on the chat button. */
export function unreadCount(data: ChatWindowData): number {
  const readUpTo = Date.parse(data.reads[data.me.id] ?? "") || 0;
  return data.messages.filter((m) => m.senderId !== data.me.id && Date.parse(m.createdAt) > readUpTo).length;
}
