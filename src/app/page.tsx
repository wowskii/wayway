// Home: logged out -> welcome + log in / sign up. Logged in -> "My trips".
import Link from "next/link";
import { Header } from "@/components/Header";
import { Card, Logo } from "@/components/ui";
import { formatTripDates, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) return <Welcome />;

  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("trip_members")
    .select("onboarding_status, trips (id, name, city, start_date, end_date)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: false });

  const trips = (memberships ?? []).flatMap((m) => (m.trips ? [{ ...m.trips, status: m.onboarding_status }] : []));

  return (
    <>
      <Header displayName={user.displayName} />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
        <h1 className="text-2xl font-semibold">My trips</h1>
        {trips.length === 0 ? (
          <Card>
            <p className="font-medium">No trips yet.</p>
            <p className="mt-1 text-sm text-muted">Open an invite link from a friend to join their trip.</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {trips.map((t) => (
              <li key={t.id}>
                <Link href={`/trips/${t.id}/interview`}>
                  <Card className="flex items-center justify-between transition-colors hover:border-brand">
                    <div>
                      <p className="font-medium">{t.name}</p>
                      <p className="text-sm text-muted">
                        {t.city} · {formatTripDates(t.start_date, t.end_date)}
                      </p>
                    </div>
                    {t.status !== "done" && (
                      <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
                        Finish your profile
                      </span>
                    )}
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function Welcome() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-5 px-4 text-center">
      <Logo />
      <h1 className="text-3xl font-semibold">Plan your trip together.</h1>
      <p className="text-muted">
        WayWay listens to everyone privately, proposes options, and keeps decisions fair.
      </p>
      <div className="flex gap-3">
        <Link href="/signup" className="inline-flex h-11 items-center rounded-xl bg-brand px-5 text-sm font-medium text-white hover:bg-brand-dark">
          Create an account
        </Link>
        <Link href="/login" className="inline-flex h-11 items-center rounded-xl border border-line bg-card px-5 text-sm font-medium hover:bg-page">
          Log in
        </Link>
      </div>
    </main>
  );
}
