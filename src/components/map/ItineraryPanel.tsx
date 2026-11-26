"use client";
// The day's plan on the map page: day tabs + shared stops and split cards.
// Clicking a stop selects it (the map pans to it); a pin click selects it here too.
//   md and up: a column on the left of the map.
//   phones: a sheet under the map (open by default) that scrolls on its own, with two buttons:
//     full screen (the sheet covers the map) and hide (only its title bar stays).
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { directionsUrl, type Leg, type WalkRoute } from "@/lib/itinerary/legs";
import { namesLabel, type DayPlan, type PlanStop } from "@/lib/itinerary/view";
import { GROUP_COLOR } from "./colors";

/** Phone sheet size. Ignored on md and up (the panel is a column there). */
export type SheetState = "open" | "full" | "closed";

interface Props {
  tripId: string;
  days: DayPlan[];
  day: number;
  onDay: (day: number) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  dateOf: (day: number) => string;
  nameOf: (memberId: string) => string;
  myMemberId?: string;
  legs: Leg[];
  walks: Record<string, WalkRoute | null>;
  sheet: SheetState;
  onSheet: (s: SheetState) => void;
}

export function ItineraryPanel({ tripId, days, day, onDay, selectedKey, onSelect, dateOf, nameOf, myMemberId, legs, walks, sheet, onSheet }: Props) {
  const plan = days.find((d) => d.day === day);

  // The trip shown above each stop = how you get there. The meeting point is reached by both groups:
  // the list shows your group's way (the map shows both).
  const arrivals = useMemo(() => {
    const byStop = new Map<string, Leg>();
    for (const leg of legs) {
      const current = byStop.get(leg.to.key);
      if (!current || (current.group === "other" && leg.group !== "other")) byStop.set(leg.to.key, leg);
    }
    return byStop;
  }, [legs]);
  const travel = (stop: PlanStop) => {
    const leg = arrivals.get(stop.key);
    return leg ? <TravelRow leg={leg} walk={walks[leg.id]} /> : null;
  };

  // When a pin is clicked, bring its line into view in the list.
  useEffect(() => {
    if (selectedKey) document.getElementById(`stop-${selectedKey}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedKey]);

  // Nothing decided yet: say where plans come from, with a way to get there.
  if (days.length === 0) {
    return (
      <section className={sheetClass(sheet)}>
        <div className="border-b border-line p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Proposed itinerary</h2>
            <SheetButtons sheet={sheet} onSheet={onSheet} />
          </div>
        </div>
        <div className={`m-4 rounded-xl bg-page p-4 text-center ${sheet === "closed" ? "max-md:hidden" : ""}`}>
          <p className="text-sm font-medium text-ink">Nothing planned yet</p>
          <p className="mt-1 text-sm text-muted">Ask @WayWay in the group chat to plan a time slot. Decided stops show up here and on the map.</p>
          <Link
            href={`/trips/${tripId}`}
            className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            Open the group chat
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={sheetClass(sheet)}>
      <div className="border-b border-line p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Proposed itinerary</h2>
          <span className="ml-auto text-xs text-muted">{plan?.stops.length ?? 0} stops</span>
          <SheetButtons sheet={sheet} onSheet={onSheet} />
        </div>
        <div className={`mt-3 flex flex-wrap items-center gap-2 ${sheet === "closed" ? "max-md:hidden" : ""}`} role="tablist" aria-label="Days">
          {days.map((d) => (
            <button
              key={d.day}
              role="tab"
              aria-selected={d.day === day}
              onClick={() => onDay(d.day)}
              className={`rounded-full px-3 py-1 text-sm ${d.day === day ? "bg-brand text-white" : "border border-line text-ink hover:bg-page"}`}
            >
              Day {d.day}
            </button>
          ))}
          <span className="text-xs text-muted">{dateOf(day)}</span>
        </div>
      </div>

      {/* pb-24 on phones: the last stop can scroll above the round group chat button */}
      <ol className={`min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2 max-md:pb-24 ${sheet === "closed" ? "max-md:hidden" : ""}`}>
        {plan?.entries.map((entry, i) =>
          entry.kind === "stop" ? (
            <li key={entry.stop.key}>
              {travel(entry.stop)}
              <StopRow stop={entry.stop} selected={selectedKey === entry.stop.key} onSelect={onSelect} />
            </li>
          ) : (
            <li key={`split-${i}`} className="rounded-xl bg-page p-3">
              <p className="text-xs text-muted">
                Group splits · {entry.start} – {entry.end}
              </p>
              <div className="mt-2 space-y-3">
                {entry.branches.map((b, j) => (
                  <div key={j}>
                    <p className="text-xs font-medium" style={{ color: GROUP_COLOR[b.group] }}>
                      {b.isMine ? "Your group" : namesLabel(b.memberIds, nameOf)}
                      {b.isMine && b.memberIds.length > 1 && (
                        <span className="font-normal text-muted">
                          {" "}· with {namesLabel(b.memberIds.filter((id) => id !== myMemberId), nameOf)}
                        </span>
                      )}
                    </p>
                    <div className="mt-1 space-y-1">
                      {b.stops.map((s) => (
                        <div key={s.key}>
                          {travel(s)}
                          <StopRow stop={s} selected={selectedKey === s.key} onSelect={onSelect} compact />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </li>
          ),
        )}
      </ol>
    </section>
  );
}

// Phones: a card stuck to the bottom with rounded top corners. open = 45% of the area under the header
// (the map keeps the rest), full = all of it, closed = title bar only. md and up: the left column.
function sheetClass(sheet: SheetState) {
  const phone = { open: "h-[45%] rounded-t-2xl", full: "h-full", closed: "rounded-t-2xl" }[sheet];
  return `flex min-h-0 shrink-0 flex-col border-t border-line bg-card shadow-[0_-4px_16px_rgba(0,0,0,0.08)] ${phone} md:h-auto md:w-72 md:rounded-none md:border-r md:border-t-0 md:shadow-none`;
}

// The two phone-only buttons in the sheet's title bar: full screen / back to the map, and hide / show.
function SheetButtons({ sheet, onSheet }: { sheet: SheetState; onSheet: (s: SheetState) => void }) {
  const btn = "grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-page hover:text-ink";
  return (
    <div className="-my-1 -mr-2 flex shrink-0 md:hidden">
      {sheet !== "closed" && (
        <button
          type="button"
          className={btn}
          onClick={() => onSheet(sheet === "full" ? "open" : "full")}
          aria-label={sheet === "full" ? "Show the map again" : "Full screen"}
          title={sheet === "full" ? "Show the map" : "Full screen"}
        >
          <Icon d={sheet === "full" ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"} />
        </button>
      )}
      <button
        type="button"
        className={btn}
        onClick={() => onSheet(sheet === "closed" ? "open" : "closed")}
        aria-expanded={sheet !== "closed"}
        aria-label={sheet === "closed" ? "Show the itinerary" : "Hide the itinerary"}
        title={sheet === "closed" ? "Show" : "Hide"}
      >
        <Icon d={sheet === "closed" ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
      </button>
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

// "Walk · 6 min" (real, from Google) · "Walk · ≈ 10 min" (estimate, route not loaded)
// "Train or subway · ≈ 25 min · Directions" (estimate + Google Maps link: the API has no transit in Japan)
function TravelRow({ leg, walk }: { leg: Leg; walk?: WalkRoute | null }) {
  const text =
    leg.mode === "walk"
      ? walk ? `Walk · ${walk.minutes} min` : `Walk · ≈ ${leg.estimateMin} min`
      : `Train or subway · ≈ ${leg.estimateMin} min`;
  return (
    <p className="flex items-center gap-2 py-1 pl-[1.1rem] text-xs text-muted">
      <span className="h-4 border-l-2 border-dotted" style={{ borderColor: GROUP_COLOR[leg.group] }} aria-hidden />
      <span className="pl-2">{text}</span>
      {leg.mode === "transit" && (
        <a
          href={directionsUrl(leg.from.spot, leg.to.spot)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand underline-offset-2 hover:underline"
        >
          Directions
        </a>
      )}
    </p>
  );
}

function StopRow({ stop, selected, onSelect, compact }: {
  stop: PlanStop; selected: boolean; onSelect: (key: string) => void; compact?: boolean;
}) {
  return (
    <button
      id={`stop-${stop.key}`}
      onClick={() => onSelect(stop.key)}
      aria-pressed={selected}
      className={`flex w-full items-start gap-3 rounded-xl px-2 text-left transition-colors ${compact ? "py-1.5" : "py-2.5"} ${selected ? "bg-brand-soft" : "hover:bg-page"}`}
    >
      <span
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
        style={{ background: GROUP_COLOR[stop.group] }}
      >
        {stop.number}
      </span>
      <span className="min-w-0">
        {stop.start && (
          <span className="block text-xs font-medium text-brand">
            {stop.start} – {stop.end}
          </span>
        )}
        <span className="block truncate text-sm font-medium">{stop.spot.name}</span>
        <span className="block text-xs text-muted">
          {stop.spot.area}
          {stop.isRendezvous && " · Meeting point: everyone together again"}
        </span>
      </span>
    </button>
  );
}
