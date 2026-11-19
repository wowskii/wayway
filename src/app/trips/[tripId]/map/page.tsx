// The trip map page: /trips/<tripId>/map  (Figma 288:2015 "Trip map · Simplified", decluttered)
// The server checks the user and the trip, prepares the day plans, then the browser draws the map.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { TripTabs } from "@/components/TripTabs";
import { TripMap } from "@/components/map/TripMap";
import { formatTripDates, requireUser } from "@/lib/auth";
import { getTripItinerary } from "@/lib/itinerary/source";
import { buildDayPlans } from "@/lib/itinerary/view";
import { getSpot } from "@/lib/spots";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Trip map · WayWay" };

export default async function MapPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const user = await requireUser(`/trips/${tripId}/map`);

  // RLS only returns the trip if the user is a member (or its creator)
  const supabase = await createClient();
  const { data: trip } = await supabase
    .from("trips").select("id, name, start_date, end_date").eq("id", tripId).maybeSingle();
  if (!trip) notFound();

  const itinerary = await getTripItinerary(tripId);
  const { days, missing } = buildDayPlans(itinerary.items, getSpot, itinerary.myMemberId);
  if (missing.length) console.warn(`[map] trip ${tripId}: unknown spot ids skipped: ${missing.join(", ")}`);

  return (
    <>
      <Header displayName={user.displayName}>
        <TripTabs tripId={tripId} tripName={trip.name} dates={formatTripDates(trip.start_date, trip.end_date)} active="map" />
      </Header>
      <TripMap
        days={days}
        startDate={trip.start_date}
        memberNames={Object.fromEntries(itinerary.members.map((m) => [m.id, m.name]))}
        myMemberId={itinerary.myMemberId}
        isDemo={itinerary.isDemo}
      />
    </>
  );
}
