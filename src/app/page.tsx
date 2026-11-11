import { SETTINGS } from "@/contracts/contract";
import { createClient } from "@/lib/supabase/server";

// Temporary home page: proves the app runs, imports the shared contract and talks to Supabase.
// It will become the "my trips" page once accounts exist (step 4).
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand">WayWay</span>
      <h1 className="text-3xl font-semibold">Plan your trip together.</h1>
      <p className="text-muted">
        WayWay listens to everyone privately, proposes options, and keeps decisions fair.
      </p>
      <p className="text-xs text-muted">
        Contract loaded: up to {SETTINGS.maxRounds} rounds per decision · Supabase connected ·{" "}
        {user ? `signed in as ${user.email}` : "not signed in"}
      </p>
    </main>
  );
}
