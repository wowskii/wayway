// Trip name + the two main tabs of a trip (Group chat | Map), at the top of the trip page.
// Same look as Quentin's TripTabs (src/components/TripTabs.tsx) on the map page, but its "Group chat"
// tab points to /trips/<id>/chat, which does not exist yet (to be settled with him). Once it points to
// the chat page, this file can be replaced by <TripTabs ... active="chat" />.
import Link from "next/link";

/** Where the "Map" tab goes: Quentin's trip map page. Change THIS line to send it somewhere else. */
export const MAP_HREF = (tripId: string) => `/trips/${tripId}/map`;
/** The group chat = this trip page. */
export const CHAT_HREF = (tripId: string) => `/trips/${tripId}`;

export function ChatboxTabs({
  tripId, tripName, dates, active,
}: { tripId: string; tripName: string; dates?: string; active: "chat" | "map" }) {
  const tab = (href: string, label: string, isActive: boolean) => (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${isActive ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-page hover:text-ink"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex items-center gap-4">
      <div className="hidden min-w-0 border-l border-line pl-4 sm:block">
        <p className="truncate text-sm font-medium">{tripName}</p>
        {dates && <p className="text-xs text-muted">{dates}</p>}
      </div>
      <nav className="flex gap-1" aria-label="Trip">
        {tab(CHAT_HREF(tripId), "Group chat", active === "chat")}
        {tab(MAP_HREF(tripId), "Map", active === "map")}
      </nav>
    </div>
  );
}
