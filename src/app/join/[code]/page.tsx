// Invite link page: /join/<code>. Shows the trip, then one main action: "Join".
// Already a member? Go straight to the trip.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { Button, Card } from "@/components/ui";
import { formatTripDates, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { joinTrip } from "./actions";

export const metadata: Metadata = { title: "Join a trip · WayWay" };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await requireUser(`/join/${code}`);
  const supabase = await createClient();

  const { data: rows } = await supabase.rpc("trip_preview", { p_invite_code: code });
  const trip = rows?.[0];

  if (!trip) {
    return (
      <>
        <Header displayName={user.displayName} />
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <h1 className="text-xl font-semibold">This invite link doesn&apos;t work</h1>
          <p className="mt-2 text-sm text-muted">Ask your friend to send it again.</p>
          <Link href="/" className="mt-6 inline-block text-sm font-medium text-brand hover:underline">
            Back to my trips
          </Link>
        </main>
      </>
    );
  }

  const { data: membership } = await supabase
    .from("trip_members")
    .select("id")
    .eq("trip_id", trip.trip_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership) redirect(`/trips/${trip.trip_id}/interview`);

  const join = joinTrip.bind(null, code, trip.trip_id);
  const others = trip.member_count;

  return (
    <>
      <Header displayName={user.displayName} />
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
        <p className="text-sm text-muted">You&apos;re invited to</p>
        <Card className="flex flex-col gap-5">
          <div>
            <h1 className="text-2xl font-semibold">{trip.name}</h1>
            <p className="mt-1 text-muted">
              {trip.city} · {formatTripDates(trip.start_date, trip.end_date)}
            </p>
          </div>
          <p className="text-sm text-muted">
            {others === 0 ? "Be the first to join." : `${others} ${others === 1 ? "traveler has" : "travelers have"} joined.`}
          </p>
          <form action={join}>
            <Button type="submit" className="w-full">
              Join the trip
            </Button>
          </form>
        </Card>
        <p className="text-center text-xs text-muted">
          Next, WayWay will ask you a few questions privately to learn what you enjoy.
        </p>
      </main>
    </>
  );
}
