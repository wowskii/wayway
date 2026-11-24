// The trip map page: /trips/<tripId>/map  (Figma 288:2015 "Trip map · Simplified", decluttered)
// The server checks the user and the trip, prepares the day plans, then the browser draws the map.
// The group chat floats over it (button at the bottom right, closed by default).
import type { Metadata } from "next";
import { TripHeader } from "@/components/Header";
import { FloatingChat } from "@/components/map/FloatingChat";
import { TripMap } from "@/components/map/TripMap";
import { formatTripDates } from "@/lib/auth";
import { loadChatWindow, unreadCount } from "@/lib/chat-window";
import { getTripItinerary } from "@/lib/itinerary/source";
import { buildDayPlans } from "@/lib/itinerary/view";
import { getSpot } from "@/lib/spots";
import { loadTripPage } from "@/lib/trip";

export const metadata: Metadata = { title: "Trip map · WayWay" };

export default async function MapPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { trip } = await loadTripPage(tripId, "map");   // login, membership, interview done

  const [itinerary, chat] = await Promise.all([getTripItinerary(tripId), loadChatWindow(tripId)]);
  const { days, missing } = buildDayPlans(itinerary.items, getSpot, itinerary.myMemberId);
  if (missing.length) console.warn(`[map] trip ${tripId}: unknown spot ids skipped: ${missing.join(", ")}`);

  return (
    <>
      <TripHeader tripId={tripId} tripName={trip.name} dates={formatTripDates(trip.start_date, trip.end_date)} active="map" />
      <TripMap
        tripId={tripId}
        days={days}
        startDate={trip.start_date}
        memberNames={Object.fromEntries(itinerary.members.map((m) => [m.id, m.name]))}
        myMemberId={itinerary.myMemberId}
      />
      {chat && <FloatingChat tripId={tripId} myMemberId={chat.me.id} initialUnread={unreadCount(chat)} />}
    </>
  );
}
