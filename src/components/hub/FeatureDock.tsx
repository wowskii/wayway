"use client";
// The three WayWay tools in the bottom-left corner. Each icon shows a phone-style badge (top left)
// with the number of things waiting for you. Tap = open the tool in the middle; tap again = close.
import type { PanelId } from "@/lib/trip-hub/types";
import { ItineraryIcon, PrivateChatIcon, RateIcon } from "./icons";

export const DOCK_ITEMS: { id: PanelId; label: string; title: string; Icon: typeof RateIcon }[] = [
  { id: "private", label: "WayWay", title: "Private chat with WayWay", Icon: PrivateChatIcon },
  { id: "rate", label: "Rate", title: "Rate the options", Icon: RateIcon },
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

export function FeatureDock({
  active,
  badges,
  onToggle,
  compact = false,
}: {
  active: PanelId | null;
  badges: Record<PanelId, number>;
  onToggle: (id: PanelId) => void;
  compact?: boolean;   // icons only (phone header)
}) {
  return (
    <div className={compact ? "flex gap-2" : "grid grid-cols-3 gap-2"}>
      {DOCK_ITEMS.map(({ id, label, title, Icon }) => {
        const on = active === id;
        const count = badges[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => onToggle(id)}
            aria-pressed={on}
            aria-label={`${title}${count ? `, ${count} waiting` : ""}`}
            title={title}
            className="group flex flex-col items-center gap-1.5 rounded-xl text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span
              className={`relative grid place-items-center rounded-2xl border transition-colors ${compact ? "h-9 w-9" : "h-12 w-12"} ${
                on ? "border-brand bg-brand text-white shadow-sm" : "border-line bg-card text-brand group-hover:border-brand"
              }`}
            >
              <Icon className={compact ? "h-5 w-5" : "h-6 w-6"} />
              <Badge count={count} />
            </span>
            {!compact && <span className={on ? "text-brand" : "text-muted"}>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
