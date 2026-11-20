import "server-only";
// Loads everything the trip page needs, with the LOGGED-IN USER's own Supabase client:
// the database rules (RLS) decide what comes back, so nothing private of other members leaks.
import type { Branch, ChatMessage } from "@/contracts/contract";
import { formatTripDates } from "@/lib/auth";
import { toChatMessage } from "@/lib/db/mappers";
import { createClient } from "@/lib/supabase/server";
import { previewItinerary, previewRate } from "./preview";
import type { HubMember, HubTrip, ItineraryData, ItineraryEntry, RateData } from "./types";

const MESSAGE_PAGE = 60;   // latest group messages loaded with the page

export interface HubData {
  trip: { id: string; name: string; timezone: string };
  me: HubMember;
  members: HubMember[];
  trips: HubTrip[];
  messages: ChatMessage[];
  reads: Record<string, string>;   // chat_reads: memberId -> read up to this createdAt
  rate: RateData;
  itinerary: ItineraryData;
}

const hhmm = (t: string) => t.slice(0, 5);
// Spots are not in the database yet (still a JSON file). Until then the id is shown as-is.
const spotName = (id: string) => id;

function tripDays(start: string, end: string) {
  const first = Date.parse(`${start}T00:00:00Z`);
  const count = Math.round((Date.parse(`${end}T00:00:00Z`) - first) / 86_400_000) + 1;
  return Array.from({ length: Math.max(count, 1) }, (_, i) => ({
    day: i + 1,
    label: new Date(first + i * 86_400_000).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }),
  }));
}

/** Returns null when the trip does not exist or the user is not a member. */
export async function loadHub(tripId: string, userId: string): Promise<HubData | null> {
  const supabase = await createClient();

  const { data: trip } = await supabase
    .from("trips")
    .select("id, name, timezone, start_date, end_date")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) return null;

  const [{ data: memberRows }, { data: memberships }, { data: messageRows }, { data: itemRows }, { data: readRows }] =
    await Promise.all([
      supabase.from("trip_members").select("id, name, user_id").eq("trip_id", tripId).order("joined_at"),
      supabase
        .from("trip_members")
        .select("onboarding_status, trips (id, name, city, start_date, end_date)")
        .eq("user_id", userId)
        .order("joined_at", { ascending: false }),
      supabase
        .from("chat_messages")
        .select("*")
        .eq("trip_id", tripId)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_PAGE),
      supabase
        .from("itinerary_items")
        .select("id, day, start_time, end_time, spot_id, branches, created_at")
        .eq("trip_id", tripId)
        .order("day")
        .order("start_time"),
      supabase.from("chat_reads").select("member_id, last_read_at").eq("trip_id", tripId),
    ]);

  const meRow = memberRows?.find((m) => m.user_id === userId);
  if (!meRow) return null;

  const members: HubMember[] = (memberRows ?? []).map((m) => ({ id: m.id, name: m.name }));
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "A traveler";

  const trips: HubTrip[] = (memberships ?? []).flatMap((m) =>
    m.trips
      ? [{
          id: m.trips.id,
          name: m.trips.name,
          city: m.trips.city,
          dates: formatTripDates(m.trips.start_date, m.trips.end_date),
          needsProfile: m.onboarding_status !== "done",
        }]
      : [],
  );

  // ----- Rate panel: spot ratings are not stored anywhere yet (needs the spot_ratings table),
  // so the panel shows sample spots until then.
  const rate: RateData = previewRate();

  // ----- Itinerary panel
  const days = tripDays(trip.start_date, trip.end_date);
  let itinerary: ItineraryData = previewItinerary(days);
  if (itemRows?.length) {
    itinerary = {
      source: "live",
      days: days.map((d) => ({
        ...d,
        entries: itemRows
          .filter((r) => r.day === d.day)
          .map((r): ItineraryEntry => {
            const branches = (r.branches as unknown as Branch[] | null) ?? undefined;
            return {
              id: r.id,
              start: hhmm(r.start_time),
              end: hhmm(r.end_time),
              title: r.spot_id ? spotName(r.spot_id) : `Split into ${branches?.length ?? 2} groups`,
              createdAt: r.created_at,
              ...(branches
                ? { branches: branches.map((b) => ({ members: b.memberIds.map(nameOf), spots: b.spots.map(spotName) })) }
                : {}),
            };
          }),
      })),
    };
  }

  return {
    trip: { id: trip.id, name: trip.name, timezone: trip.timezone },
    me: { id: meRow.id, name: meRow.name },
    members,
    trips,
    messages: (messageRows ?? []).reverse().map(toChatMessage),
    reads: Object.fromEntries((readRows ?? []).map((r) => [r.member_id, r.last_read_at])),
    rate,
    itinerary,
  };
}
