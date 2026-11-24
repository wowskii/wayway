"use client";
// The proposed itinerary, one tab per trip day (contract: ItineraryItem).
import { useState } from "react";
import type { ItineraryData } from "@/lib/chatbox-trip-hub/types";
import { PanelFrame } from "./PanelFrame";

export function ItineraryPanel({ data, onClose }: { data: ItineraryData; onClose: () => void }) {
  const [day, setDay] = useState(data.days[0]?.day ?? 1);
  const current = data.days.find((d) => d.day === day);
  const total = data.days.reduce((n, d) => n + d.entries.length, 0);

  return (
    <PanelFrame
      title="Proposed itinerary"
      subtitle={`${data.days.length} ${data.days.length === 1 ? "day" : "days"} · ${total} ${total === 1 ? "stop" : "stops"} · from group decisions`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 p-4">
        <div role="tablist" aria-label="Trip days" className="flex flex-wrap gap-2">
          {data.days.map((d) => (
            <button
              key={d.day}
              type="button"
              role="tab"
              aria-selected={d.day === day}
              onClick={() => setDay(d.day)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                d.day === day ? "border-brand bg-brand text-white" : "border-line bg-card hover:border-brand"
              }`}
            >
              Day {d.day} <span className={d.day === day ? "text-white/80" : "text-muted"}>· {d.label}</span>
            </button>
          ))}
        </div>

        {!current?.entries.length ? (
          <div className="rounded-2xl border border-dashed border-line bg-card p-6 text-center text-sm text-muted">
            <p className="font-medium text-ink">Nothing planned for this day yet</p>
            <p className="mt-1">Stops appear here after the group decides on WayWay&apos;s options.</p>
          </div>
        ) : (
          <ol className="relative flex flex-col gap-3 border-l-2 border-brand-soft pl-5">
            {current.entries.map((e) => (
              <li key={e.id} className="relative">
                <span aria-hidden className="absolute -left-[27px] top-4 h-3 w-3 rounded-full border-2 border-card bg-brand" />
                <div className="rounded-2xl border border-line bg-card p-4 shadow-sm">
                  <p className="text-xs font-medium tabular-nums text-brand">
                    {e.start} – {e.end}
                  </p>
                  <p className="mt-0.5 font-semibold">{e.title}</p>
                  {e.branches && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {e.branches.map((b, i) => (
                        <div key={i} className="rounded-xl bg-page p-3 text-sm">
                          <p className="text-xs text-muted">{b.members.join(", ")}</p>
                          <p className="mt-0.5 font-medium">{b.spots.join(" → ")}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </PanelFrame>
  );
}
