"use client";
// Left card of the map page: day tabs + the day's plan (shared stops and split cards).
// Clicking a stop selects it (the map pans to it); a pin click selects it here too.
import { useEffect } from "react";
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
}

export function ItineraryPanel({ days, day, onDay, selectedKey, onSelect, dateOf, nameOf, myMemberId }: Props) {
  const plan = days.find((d) => d.day === day);

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
                        <StopRow key={s.key} stop={s} selected={selectedKey === s.key} onSelect={onSelect} compact />
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
