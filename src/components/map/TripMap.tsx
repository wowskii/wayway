"use client";
// The map page's body, full screen like the trip page: itinerary panel (left, same width as the trip
// page's sidebar, so the tabs line up with its edge) + Google map (rest), sharing two pieces of state:
// the selected day and the selected stop. Data comes ready from the server page (buildDayPlans).
import { useEffect, useMemo, useRef, useState } from "react";
import { dayLegs, type WalkRoute } from "@/lib/itinerary/legs";
import type { DayPlan } from "@/lib/itinerary/view";
import { ItineraryPanel } from "./ItineraryPanel";
import { MapView } from "./MapView";
import { PlaceCard, type PlaceState } from "./PlaceCard";
import { useLocationSharing } from "./useLocationSharing";

interface Props {
  tripId: string;
  days: DayPlan[];
  startDate: string;                       // trip start "2026-11-21": day 1
  memberNames: Record<string, string>;
  myMemberId?: string;
}

export function TripMap({ tripId, days, startDate, memberNames, myMemberId }: Props) {
  const [day, setDay] = useState(days[0]?.day ?? 1);
  const sharing = useLocationSharing(tripId, myMemberId);
  const nameOf = (id: string) => memberNames[id] ?? "Someone";
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const plan = days.find((d) => d.day === day);

  // Trips between the day's stops. Short ones get a real walking route from Google (one call per leg,
  // asked once per page: switching back to a day reuses the answers). Long ones never call Google.
  const legs = useMemo(() => (plan ? dayLegs(plan) : []), [plan]);
  const [walks, setWalks] = useState<Record<string, WalkRoute | null>>({});
  const requested = useRef(new Set<string>());     // also stops React's dev double-run from asking twice
  useEffect(() => {
    const todo = [...new Map(legs.filter((l) => l.mode === "walk" && !requested.current.has(l.id)).map((l) => [l.id, l])).values()];
    if (!todo.length) return;
    todo.forEach((l) => requested.current.add(l.id));
    for (let i = 0; i < todo.length; i += 12) {          // the route accepts 12 legs per request
      const chunk = todo.slice(i, i + 12).map((l) => ({ from: l.from.spot.id, to: l.to.spot.id }));
      fetch("/api/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ legs: chunk }) })
        .then((res) => (res.ok ? res.json() : { routes: {} }))
        .then((body) => setWalks((w) => ({ ...w, ...body.routes })))
        .catch(() => {});                                 // no route = straight line + estimate, still usable
    }
  }, [legs]);

  // Google details for the place card: asked when a stop is selected (list or pin), once per place
  // per page. This is the most expensive Google call (30/day), so it never happens without a click.
  const [places, setPlaces] = useState<Record<string, PlaceState>>({});
  const askedPlaces = useRef(new Set<string>());
  const selectStop = (key: string) => {
    setSelectedKey(key);
    const placeId = plan?.stops.find((s) => s.key === key)?.spot.placeId;
    if (!placeId || askedPlaces.current.has(placeId)) return;
    askedPlaces.current.add(placeId);
    setPlaces((p) => ({ ...p, [placeId]: { status: "loading" } }));
    fetch(`/api/places/${encodeURIComponent(placeId)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        const state: PlaceState = res.ok ? { status: "ok", data: body } : { status: "error", message: body.error ?? "Google details can't load right now." };
        setPlaces((p) => ({ ...p, [placeId]: state }));
        if (!res.ok) askedPlaces.current.delete(placeId);   // a later click may try again
      })
      .catch(() => {
        setPlaces((p) => ({ ...p, [placeId]: { status: "error", message: "Google details can't load right now (network)." } }));
        askedPlaces.current.delete(placeId);
      });
  };
  const selectedStop = plan?.stops.find((s) => s.key === selectedKey);

  const changeDay = (d: number) => {
    setDay(d);
    setSelectedKey(null);
  };
  const dateOfDay = (d: number) => {
    const date = new Date(`${startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + d - 1);
    return date;
  };
  // "Nov 21": the trip's first date + (day - 1)
  const dateOf = (d: number) => dateOfDay(d).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

  return (
    // Phones: map on top (half the screen), the day's plan under it, the page scrolls.
    // md and up: fills the screen under the header, nothing scrolls but the plan list.
    <main className="flex flex-col bg-page md:h-[calc(100dvh-4rem-1px)] md:flex-row md:overflow-hidden">
      <h1 className="sr-only">Trip map</h1>
      {days.length === 0 ? (
        <p className="m-auto max-w-sm px-6 py-16 text-center text-sm text-muted">
          No itinerary yet. Once the group votes on WayWay&apos;s options, the plan appears here.
        </p>
      ) : (
        <>
          <ItineraryPanel
            days={days}
            day={day}
            onDay={changeDay}
            selectedKey={selectedKey}
            onSelect={selectStop}
            dateOf={dateOf}
            nameOf={nameOf}
            myMemberId={myMemberId}
            legs={legs}
            walks={walks}
          />
          <div className="relative order-first h-[50dvh] min-h-0 border-b border-line bg-card md:order-none md:h-auto md:flex-1 md:border-b-0">
            <MapView stops={plan?.stops ?? []} legs={legs} walks={walks} selectedKey={selectedKey} onSelect={selectStop}
              sharing={{ ...sharing, myMemberId, nameOf }} />
            {selectedStop && (
              <PlaceCard
                stop={selectedStop}
                place={selectedStop.spot.placeId ? (places[selectedStop.spot.placeId] ?? { status: "loading" }) : undefined}
                tripDate={dateOfDay(day).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })}
                weekdayIndex={(dateOfDay(day).getUTCDay() + 6) % 7}
                onClose={() => setSelectedKey(null)}
              />
            )}
          </div>
        </>
      )}
    </main>
  );
}
