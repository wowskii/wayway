// Trip name + the two main tabs of a trip: Group chat | Map. Goes inside <Header wide> (use <TripHeader>).
// One component for every trip page (it replaces chatbox-hub/ChatboxTabs), so the tabs never move:
// from md up they start exactly at the line between the trip page's sidebar (w-72) and the chat
// (absolute, inside the wide Header which is relative); on phones they just follow the logo.
// "Me" is not a tab: it sits at the top right of the Header, next to Log out.
import Link from "next/link";

/** The group chat = the trip page itself (Patrick's hub). */
export const CHAT_HREF = (tripId: string) => `/trips/${tripId}`;
/** The trip map page. */
export const MAP_HREF = (tripId: string) => `/trips/${tripId}/map`;

export type TripTab = "chat" | "map";

// short = label on phones, so the bar fits on one line
const TABS: { id: TripTab; label: string; short: string; href: (tripId: string) => string }[] = [
  { id: "chat", label: "Group chat", short: "Chat", href: CHAT_HREF },
  { id: "map", label: "Map", short: "Map", href: MAP_HREF },
];

export function TripTabs({
  tripId, tripName, dates, active,
}: { tripId: string; tripName: string; dates?: string; active?: TripTab }) {
  return (
    <div className="flex items-center gap-4">
      <div className="hidden min-w-0 border-l border-line pl-4 sm:block md:max-w-[8.5rem]" title={tripName}>
        <p className="truncate text-sm font-medium">{tripName}</p>
        {dates && <p className="text-xs text-muted">{dates}</p>}
      </div>
      <nav className="flex gap-1 md:absolute md:inset-y-0 md:left-72 md:items-center" aria-label="Trip">
        {TABS.map(({ id, label, short, href }) => (
          <Link
            key={id}
            href={href(tripId)}
            aria-current={active === id ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${active === id ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-page hover:text-ink"}`}
          >
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
