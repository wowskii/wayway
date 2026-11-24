// Trip name + the two main tabs of a trip (Group chat | Map), at the top of the trip page.
// From md up the tabs start exactly at the line between the sidebar (w-72) and the chat
// (absolute, inside the wide Header which is relative); on phones there is no sidebar, they just follow.
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
      <div className="hidden min-w-0 border-l border-line pl-4 sm:block md:max-w-[8.5rem]" title={tripName}>
        <p className="truncate text-sm font-medium">{tripName}</p>
        {dates && <p className="text-xs text-muted">{dates}</p>}
      </div>
      <nav className="flex gap-1 md:absolute md:inset-y-0 md:left-72 md:items-center" aria-label="Trip">
        {tab(CHAT_HREF(tripId), "Group chat", active === "chat")}
        {tab(MAP_HREF(tripId), "Map", active === "map")}
      </nav>
    </div>
  );
}
