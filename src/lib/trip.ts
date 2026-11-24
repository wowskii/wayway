import "server-only";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The pages of a trip, besides the trip page itself (/trips/<id> = group chat, Patrick's hub,
 * which does its own loading but uses the same interview rule).
 * "interview" is the one-time onboarding; the others are the app.
 */
export type TripPage = "interview" | "map" | "me";

/** The group chat (the trip page). */
export const tripChatPath = (tripId: string) => `/trips/${tripId}`;
export const interviewPath = (tripId: string) => `/trips/${tripId}/interview`;

/**
 * Shared start of my trip pages:
 * - logged out -> login page (then back here)
 * - not a member of this trip -> 404 (RLS hides trips you are not in)
 * - interview not finished -> only the interview page is open
 * - interview finished -> the interview page is closed (one-time step); WayWay's private chat
 *   stays open in the trip page's "WayWay" panel, which "Me" -> "Update with WayWay" opens.
 */
export async function loadTripPage(tripId: string, page: TripPage) {
  const user = await requireUser(`/trips/${tripId}/${page}`);
  const supabase = await createClient();

  const [{ data: trip }, { data: member }] = await Promise.all([
    supabase.from("trips").select("id, name, city, start_date, end_date").eq("id", tripId).maybeSingle(),
    supabase.from("trip_members").select("id, onboarding_status").eq("trip_id", tripId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!trip || !member) notFound();

  const interviewDone = member.onboarding_status === "done";
  if (page === "interview" && interviewDone) redirect(tripChatPath(tripId));
  if (page !== "interview" && !interviewDone) redirect(interviewPath(tripId));

  return { user, trip, member, supabase };
}
