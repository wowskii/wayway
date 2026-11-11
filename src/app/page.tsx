import { SETTINGS } from "@/contracts/contract";

// Temporary home page: proves the app runs and can import the shared contract.
// It will become the "my trips" page once accounts exist (step 4).
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand">WayWay</span>
      <h1 className="text-3xl font-semibold">Plan your trip together.</h1>
      <p className="text-muted">
        WayWay listens to everyone privately, proposes options, and keeps decisions fair.
      </p>
      <p className="text-xs text-muted">
        Contract loaded: up to {SETTINGS.maxRounds} rounds per decision.
      </p>
    </main>
  );
}
