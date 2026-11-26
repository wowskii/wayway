// Where the map page gets a trip's itinerary: the itinerary_items table in Supabase.
// Read AS THE LOGGED-IN USER (not the admin key), so the database rules (RLS) decide: only members of
// the trip get its itinerary and its members' names.
// Only rows written by a group decision (save_decision: they carry their option_set_id) are shown:
// the SAME filter as the chat's itinerary panel (src/lib/chatbox-trip-hub/load.ts), so both always match.
import "server-only";
import type { ItineraryItem } from "@/contracts/contract";
import { toItineraryItem } from "@/lib/db/mappers";
import { createClient } from "@/lib/supabase/server";

export interface TripItinerary {
  items: ItineraryItem[];
  itemIds: string[];         // database ids of the rows shown (the live refresh needs them for deletions)
  members: { id: string; name: string }[];
  myMemberId?: string;       // the viewer's member id (for "Your group")
}

export async function getTripItinerary(tripId: string): Promise<TripItinerary> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [items, members] = await Promise.all([
    supabase.from("itinerary_items")
      .select("id, day, start_time, end_time, spot_id, branches")
      .eq("trip_id", tripId)
      .not("option_set_id", "is", null)
      .order("day").order("start_time"),
    supabase.from("trip_members").select("id, user_id, name").eq("trip_id", tripId),
  ]);
  if (items.error) throw new Error(`Loading the itinerary failed: ${items.error.message}`);
  if (members.error) throw new Error(`Loading the members failed: ${members.error.message}`);

  return {
    items: items.data.map(toItineraryItem),
    itemIds: items.data.map((r) => r.id),
    members: members.data.map((m) => ({ id: m.id, name: m.name })),
    myMemberId: members.data.find((m) => m.user_id === user?.id)?.id,
  };
}
