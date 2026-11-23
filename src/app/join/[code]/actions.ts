"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Joins the trip with its invite code (database function join_trip), then opens the interview. */
export async function joinTrip(code: string, tripId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_trip", { p_invite_code: code });
  if (error) throw new Error(error.message);
  redirect(`/trips/${tripId}/interview`);
}
