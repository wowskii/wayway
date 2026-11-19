"use client";
// The map page's body: itinerary panel (left) + Google map (right), sharing two pieces of state:
// the selected day and the selected stop. Data comes ready from the server page (buildDayPlans).
import { useState } from "react";
import type { DayPlan } from "@/lib/itinerary/view";
import { ItineraryPanel } from "./ItineraryPanel";
import { MapView } from "./MapView";

interface Props {
  days: DayPlan[];
  startDate: string;                       // trip start "2026-11-21": day 1
  memberNames: Record<string, string>;
  myMemberId?: string;
  isDemo: boolean;
}

export function TripMap({ days, startDate, memberNames, myMemberId, isDemo }: Props) {
  const [day, setDay] = useState(days[0]?.day ?? 1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const plan = days.find((d) => d.day === day);

  const changeDay = (d: number) => {
    setDay(d);
    setSelectedKey(null);
  };
  // "Nov 21": the trip's first date + (day - 1)
  const dateOf = (d: number) => {
    const date = new Date(`${startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + d - 1);
    return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Trip map</h1>
        <p className="text-sm text-muted">
          Your daily plan, with room to explore.
          {isDemo && <span className="ml-2 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Example itinerary</span>}
        </p>
      </div>

      {days.length === 0 ? (
        <p className="rounded-2xl border border-line bg-card p-6 text-sm text-muted">
          No itinerary yet. Once the group votes on WayWay&apos;s options, the plan appears here.
        </p>
      ) : (
        <div className="grid gap-4 lg:h-[calc(100vh-11rem)] lg:min-h-[520px] lg:grid-cols-[320px_1fr]">
          <ItineraryPanel
            days={days}
            day={day}
            onDay={changeDay}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            dateOf={dateOf}
            nameOf={(id) => memberNames[id] ?? "Someone"}
            myMemberId={myMemberId}
          />
          <div className="h-[420px] overflow-hidden rounded-2xl border border-line bg-card shadow-sm lg:h-auto">
            <MapView stops={plan?.stops ?? []} selectedKey={selectedKey} onSelect={setSelectedKey} />
          </div>
        </div>
      )}
    </main>
  );
}
