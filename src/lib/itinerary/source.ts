// Where the map page gets a trip's itinerary. The ONLY place to change when real data arrives.
//
// Now (map step 4): the fake itinerary in fixtures/example_itinerary.json, for every trip.
// Step 7: read the trip's itinerary_items from Supabase (RLS: members only) and the members' names
// from trip_members, and return the same shape. The page and components won't change.
import "server-only";
import type { ItineraryItem } from "@/contracts/contract";
import fixture from "../../../fixtures/example_itinerary.json";

export interface TripItinerary {
  items: ItineraryItem[];
  members: { id: string; name: string }[];
  myMemberId?: string;       // the viewer's member id (for "Your group")
  isDemo: boolean;           // true = fake data, the page says so
}

export async function getTripItinerary(tripId: string): Promise<TripItinerary> {
  void tripId; // used from step 7
  return {
    items: fixture.items as ItineraryItem[],
    members: fixture.members,
    myMemberId: fixture.me,
    isDemo: true,
  };
}
