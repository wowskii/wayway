// Trip creation page: /trips/new. Name, city, dates, pace and friends (searched by email and
// added directly), then the invite link for everyone else. The form is TripForm (tripgen-create).
import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { TripForm } from "@/components/tripgen-create/TripForm";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "New trip · WayWay" };

export default async function NewTripPage() {
  const user = await requireUser("/trips/new");
  // "Today" where the trips happen (Tokyo, the trips table's default time zone): the earliest first day
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-10">
        <TripForm today={today} hostName={user.displayName} />
      </main>
    </>
  );
}
