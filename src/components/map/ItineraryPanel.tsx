"use client";
// Left card of the map page: day tabs + the day's plan (shared stops and split cards).
// Clicking a stop selects it (the map pans to it); a pin click selects it here too.
import { useEffect, useMemo } from "react";
import { directionsUrl, type Leg, type WalkRoute } from "@/lib/itinerary/legs";
import { namesLabel, type DayPlan, type PlanStop } from "@/lib/itinerary/view";
import { GROUP_COLOR } from "./colors";

interface Props {
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
}

export function ItineraryPanel({ days, day, onDay, selectedKey, onSelect, dateOf, nameOf, myMemberId, legs, walks }: Props) {
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

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-line bg-card shadow-sm">
      <div className="border-b border-line p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Proposed itinerary</h2>
          <span className="text-xs text-muted">{plan?.stops.length ?? 0} stops</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Days">
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

      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
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
                    <p className="text-xs font-medium" style={{ color: GROUP_COLOR[b.isMine ? "mine" : "other"] }}>
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
