// The trip list on the left (the current trip is highlighted), under a "My trips" button that
// goes back to the trip selection screen (home page "My trips").
import Link from "next/link";
import type { HubTrip } from "@/lib/chatbox-trip-hub/types";

export function TripList({ trips, currentId }: { trips: HubTrip[]; currentId: string }) {
  return (
    <nav aria-label="My trips" className="min-h-0 flex-1 overflow-y-auto p-3">
      <Link
        href="/"
        title="All my trips"
        className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-line bg-card px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink transition-colors hover:border-brand hover:text-brand"
      >
        My trips
        <span aria-hidden className="text-sm">›</span>
      </Link>
      <ul className="flex flex-col gap-1">
        {trips.map((t) => {
          const current = t.id === currentId;
          return (
            <li key={t.id}>
              <Link
                href={`/trips/${t.id}`}
                aria-current={current ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors ${
                  current ? "bg-brand-soft" : "hover:bg-page"
                }`}
              >
                <span
                  aria-hidden
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                    current ? "bg-brand text-white" : "bg-brand-soft text-brand"
                  }`}
                >
                  {t.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {t.city} · {t.dates}
                  </span>
                </span>
                {t.needsProfile && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" title="Finish your profile" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
