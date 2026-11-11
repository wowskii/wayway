// Placeholder for the AI interview (built in step 6). Checks that the user belongs to this trip.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Get to know you · WayWay" };

export default async function InterviewPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const user = await requireUser(`/trips/${tripId}/interview`);
  const supabase = await createClient();

  // RLS only returns the trip if the user is a member (or its creator)
  const { data: trip } = await supabase.from("trips").select("id, name").eq("id", tripId).maybeSingle();
  const { data: member } = await supabase
    .from("trip_members")
    .select("id")
    .eq("trip_id", tripId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!trip || !member) notFound();

  return (
    <>
      <Header displayName={user.displayName}>
        <span className="text-sm font-medium">{trip.name}</span>
      </Header>
      <main className="mx-auto max-w-2xl px-4 py-10">
        <Card>
          <h1 className="text-xl font-semibold">Hi {user.displayName}, you&apos;re in!</h1>
          <p className="mt-2 text-sm text-muted">
            The private chat with WayWay will appear here (step 6).
          </p>
        </Card>
      </main>
    </>
  );
}
