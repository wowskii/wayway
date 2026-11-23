// Where the map page gets a trip's itinerary: the itinerary_items table in Supabase.
// Read AS THE LOGGED-IN USER (not the admin key), so the database rules (RLS) decide: only members of
// the trip get its itinerary and its members' names.
// Rows are written by the decision step (one per decided option, with option_set_id), or by
// `npm run seed:itinerary` for the demo trip.
import "server-only";
import type { ItineraryItem } from "@/contracts/contract";
import { toItineraryItem } from "@/lib/db/mappers";
import { createClient } from "@/lib/supabase/server";

export interface TripItinerary {
  items: ItineraryItem[];
  members: { id: string; name: string }[];
  myMemberId?: string;       // the viewer's member id (for "Your group")
}

export async function getTripItinerary(tripId: string): Promise<TripItinerary> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [items, members] = await Promise.all([
    supabase.from("itinerary_items")
      .select("day, start_time, end_time, spot_id, branches")
      .eq("trip_id", tripId)
      .order("day").order("start_time"),
    supabase.from("trip_members").select("id, user_id, name").eq("trip_id", tripId),
  ]);
  if (items.error) throw new Error(`Loading the itinerary failed: ${items.error.message}`);
  if (members.error) throw new Error(`Loading the members failed: ${members.error.message}`);

  return {
    items: items.data.map(toItineraryItem),
    members: members.data.map((m) => ({ id: m.id, name: m.name })),
    myMemberId: members.data.find((m) => m.user_id === user?.id)?.id,
  };
}
