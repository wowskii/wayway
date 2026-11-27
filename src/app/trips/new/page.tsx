// Trip creation page: /trips/new. Name, city, dates, pace and friends (searched by email and
// added directly), then the invite link for everyone else. The form is TripForm (tripgen-create).
import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { TripForm } from "@/components/tripgen-create/TripForm";
import { requireUser } from "@/lib/auth";
import { CITY_CONFIG } from "@/lib/cities";

export const metadata: Metadata = { title: "New trip · WayWay" };

export default async function NewTripPage() {
  const user = await requireUser("/trips/new");
  // Earliest first day = "today" in the city where it is still the earliest date (the city is chosen
  // later in the form): Paris is still on yesterday when Tokyo is already on today.
  const now = new Date();
  const today = Object.values(CITY_CONFIG)
    .map((c) => now.toLocaleDateString("en-CA", { timeZone: c.timezone }))
    .sort()[0];
  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-10">
        <TripForm today={today} hostName={user.displayName} />
      </main>
    </>
  );
}
