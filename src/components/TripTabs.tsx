// Trip name + the two main tabs of a trip (Figma "Simplified": Group chat | Map).
// Goes inside <Header>. Shared with the group chat page (Patrick): use active="chat" there.
import Link from "next/link";

export function TripTabs({
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
        {tab(`/trips/${tripId}/chat`, "Group chat", active === "chat")}
        {tab(`/trips/${tripId}/map`, "Map", active === "map")}
      </nav>
    </div>
  );
}
