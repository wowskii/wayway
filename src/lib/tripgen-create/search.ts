// Browser side of the "add friends" dropdown: accounts whose email starts with what was typed.
// Runs as the logged-in user; the database function search_users decides what may be seen.
import { createClient } from "@/lib/supabase/client";
import { MIN_SEARCH, type FoundUser } from "./types";

/** tripId: leave out people already in that trip (trip settings window). */
export async function searchUsers(query: string, tripId?: string): Promise<FoundUser[]> {
  const q = query.trim();
  if (q.length < MIN_SEARCH) return [];
  const { data, error } = await createClient().rpc("search_users", { p_query: q, p_trip_id: tripId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ userId: r.user_id, displayName: r.display_name, email: r.email }));
}

/** Trip settings window: adds the account to the trip right away (any member may). Answers the new member id. */
export async function addTripMember(tripId: string, userId: string): Promise<string> {
  const { data, error } = await createClient().rpc("add_trip_member", { p_trip_id: tripId, p_user_id: userId });
  if (error || !data) throw new Error(error?.message ?? "Not added");
  return data;
}

/** Trip settings window: removes a member, with their group messages (only the trip's creator may). */
export async function removeTripMember(memberId: string) {
  const { error } = await createClient().rpc("remove_trip_member", { p_member_id: memberId });
  if (error) throw new Error(error.message);
}
