// The "Me" page: /trips/<tripId>/me — what WayWay learned about me in the interview, for this trip.
// Split in two, so the member sees exactly what the group can see and what stays private.
// "Update with WayWay" opens the private chat with WayWay (trip page, ?panel=private): the AI keeps
// updating this profile from what you tell it there. "Start a new interview" is not built yet.
import { currencyOf, formatMoney } from "@/lib/cities";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { TripHeader } from "@/components/Header";
import { Button, Card } from "@/components/ui";
import { formatTripDates } from "@/lib/auth";
import { loadTripPage } from "@/lib/trip";

export const metadata: Metadata = { title: "Me · WayWay" };

const PACE: Record<string, string> = { relaxed: "Relaxed", moderate: "Moderate", packed: "Packed" };
const SLEEP: Record<string, string> = { early_bird: "Early bird", night_owl: "Night owl", flexible: "Flexible" };
const PRIVATE_TAG = "[private] ";

export default async function MePage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { user, trip, member, supabase } = await loadTripPage(tripId, "me");

  // Both reads go through RLS: trip_members is readable by the group, member_private only by its owner.
  const [{ data: pub }, { data: priv }] = await Promise.all([
    supabase.from("trip_members").select("name, diet, interests, pace, sleep").eq("id", member.id).single(),
    supabase.from("member_private").select("allergies, max_budget, private_note, preference_statements").eq("member_id", member.id).maybeSingle(),
  ]);

  const statements = priv?.preference_statements ?? [];

  return (
    <>
      <TripHeader tripId={tripId} tripName={trip.name} dates={formatTripDates(trip.start_date, trip.end_date)} active="me" />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold">{pub?.name ?? user.displayName}</h1>
          <p className="mt-1 text-sm text-muted">What WayWay learned about you for {trip.name}.</p>
        </div>

        <Card className="flex flex-col gap-4">
          <SectionTitle title="Your group can see" />
          <Row label="Interests">{list(pub?.interests)}</Row>
          <Row label="Pace">{pub?.pace ? PACE[pub.pace] : "Not known yet"}</Row>
          <Row label="Rhythm">{pub?.sleep ? SLEEP[pub.sleep] : "Not known yet"}</Row>
          <Row label="Diet">{list(pub?.diet, "No restrictions")}</Row>
        </Card>

        <Card className="flex flex-col gap-4">
          <SectionTitle title="Only you can see" hint="WayWay uses this to filter options, but never shares it." />
          <Row label="Allergies">{list(priv?.allergies, "None")}</Row>
          <Row label="Max budget">{priv?.max_budget ? `${formatMoney(priv.max_budget, currencyOf(trip.city))} per person` : "Not set"}</Row>
          <Row label="What matters to you">
            {statements.length === 0 ? (
              "Nothing yet"
            ) : (
              <ul className="flex list-disc flex-col gap-1 pl-4">
                {statements.map((s, i) => (
                  <li key={i}>{s.startsWith(PRIVATE_TAG) ? s.slice(PRIVATE_TAG.length) : s}</li>
                ))}
              </ul>
            )}
          </Row>
          {priv?.private_note && <Row label="Note">{priv.private_note}</Row>}
        </Card>

        {/* Changes go through the AI (private chat), not a form. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href={`/trips/${tripId}?panel=private`}
            className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-brand px-5 text-sm font-medium text-white hover:bg-brand-dark"
          >
            Update with WayWay
          </Link>
          <Button disabled variant="ghost" className="flex-1" title="Coming soon">Start a new interview</Button>
        </div>
        <p className="text-center text-xs text-muted">Tell WayWay what changed in your private chat; it updates this page for you.</p>
      </main>
    </>
  );
}

function list(items: string[] | undefined, empty = "Not known yet") {
  return items && items.length ? items.join(", ") : empty;
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="font-medium">{title}</h2>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
      <span className="text-muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}
