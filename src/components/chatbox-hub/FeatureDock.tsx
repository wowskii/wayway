"use client";
// The three WayWay tools in the bottom-left corner, in one row:
//   WayWay   Suggestions   Itinerary     <- panels: tap = open in the middle, tap again = close
// (The trip map is a tab at the top of the page: ChatboxTabs.)
// A panel icon can show two numbers:
//   top left  (red, phone-style)   = things waiting for you (e.g. unread option sets)
//   top right (quiet, white/green) = how many there are in total (e.g. option sets in progress)
import type { PanelId } from "@/lib/chatbox-trip-hub/types";
import { ItineraryIcon, PrivateChatIcon, RateIcon } from "./icons";

export const DOCK_ITEMS: { id: PanelId; label: string; title: string; Icon: typeof RateIcon }[] = [
  { id: "private", label: "Profile", title: "Private chat with WayWay", Icon: PrivateChatIcon },
  { id: "suggestions", label: "Suggestions", title: "Spot suggestions: tell WayWay what you think", Icon: RateIcon },
  { id: "itinerary", label: "Itinerary", title: "Proposed itinerary", Icon: ItineraryIcon },
];

export function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -left-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[11px] font-semibold tabular-nums text-white ring-2 ring-card">
      {count > 9 ? "9+" : count}
    </span>
  );
}

/** Quiet count in the top-right corner (white with a soft green ring), never louder than the red badge. */
export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full border border-brand/30 bg-card px-1 text-[11px] font-semibold tabular-nums text-brand shadow-sm">
      {count > 9 ? "9+" : count}
    </span>
  );
}

export function FeatureDock({
  active,
  badges,
  counts = {},
  onToggle,
  compact = false,
}: {
  active: PanelId | null;
  badges: Record<PanelId, number>;
  counts?: Partial<Record<PanelId, number>>;
  onToggle: (id: PanelId) => void;
  compact?: boolean;   // icons only (phone header)
}) {
  const box = `relative grid place-items-center rounded-2xl border transition-colors ${compact ? "h-9 w-9" : "h-12 w-12"}`;
  return (
    <div className={compact ? "flex gap-2" : "grid grid-cols-3 gap-2"}>
      {DOCK_ITEMS.map(({ id, label, title, Icon }) => {
        const on = active === id;
        const count = badges[id];
        const total = counts[id] ?? 0;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onToggle(id)}
            aria-pressed={on}
            aria-label={`${title}${count ? `, ${count} waiting` : ""}${total ? `, ${total} in total` : ""}`}
            title={title}
            className="group flex flex-col items-center gap-1.5 rounded-xl text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span
              className={`${box} ${
                on ? "border-brand bg-brand text-white shadow-sm" : "border-line bg-card text-brand group-hover:border-brand"
              }`}
            >
              <Icon className={compact ? "h-5 w-5" : "h-6 w-6"} />
              <Badge count={count} />
              <CountBadge count={total} />
            </span>
            {!compact && <span className={on ? "text-brand" : "text-muted"}>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
