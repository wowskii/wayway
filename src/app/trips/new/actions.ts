"use server";
// Creates the trip with the friends picked on the page, in one database transaction (create_trip).
// Answers { tripId, inviteCode } so the page can show the invite link, or { error }.
import { cityConfig } from "@/lib/cities";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CITIES, GOALS, type CreateTripInput, type CreateTripResult } from "@/lib/tripgen-create/types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function createTrip(input: CreateTripInput): Promise<CreateTripResult> {
  const name = input.name?.trim() ?? "";
  if (!name || name.length > 80) return { error: "Give the trip a name (80 characters at most)." };
  if (!CITIES.includes(input.city)) return { error: "Pick a city from the list." };
  if (!DATE.test(input.startDate) || !DATE.test(input.endDate)) return { error: "Pick the first and last day." };
  if (input.endDate < input.startDate) return { error: "The last day can't be before the first day." };
  if (!GOALS.some((g) => g.id === input.goal)) return { error: "Pick a pace." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_trip", {
    p_name: name,
    p_city: input.city,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_goal: input.goal,
    p_friend_ids: [...new Set(input.friendIds)],
  });
  const trip = data?.[0];
  if (error || !trip) {
    // Our own checks in create_trip have messages written for people; others don't
    const msg = error?.message ?? "";
    return { error: /at most|up to|signed in/.test(msg) ? msg : "The trip was not created. Try again." };
  }
  // The trip runs on its city's clock (deadlines, "today", times in the chat). create_trip leaves the
  // table default (Asia/Tokyo), so set it here for other cities.
  const tz = cityConfig(input.city)?.timezone;
  if (tz && tz !== "Asia/Tokyo") {
    const { error: tzError } = await createAdminClient().from("trips").update({ timezone: tz }).eq("id", trip.trip_id);
    if (tzError) return { error: "The trip was created but its time zone could not be set. Try again." };
  }
  return { tripId: trip.trip_id, inviteCode: trip.invite_code };
}
