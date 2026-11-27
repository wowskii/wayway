"use client";
// The Google map on the right of the map page: one numbered pin per stop of the selected day.
//
// Free-tier guard: before loading Google Maps, we ask /api/google/map-load for one unit of the shared
// daily limit. If refused, a placeholder is shown and Google is never contacted.
// Counting here (in the browser, once per page load) rather than in the server page matters: in
// development the server page re-renders on every file save, which would count loads that never happen.
import { useEffect, useRef, useState } from "react";
import { AdvancedMarker, APIProvider, ControlPosition, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import { walkPath, type Leg, type WalkRoute } from "@/lib/itinerary/legs";
import type { PlanStop } from "@/lib/itinerary/view";
import type { MapCity } from "./TripMap";
import { GROUP_COLOR } from "./colors";
import { LocationControl, LocationMarkers } from "./LocationLayer";
import type { MemberLocation, ShareMode } from "./useLocationSharing";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;

interface Props {
  city: MapCity;
  stops: PlanStop[];
  legs: Leg[];
  walks: Record<string, WalkRoute | null>;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  sharing: {
    mode: ShareMode;
    setMode: (m: ShareMode) => void;
    error: string | null;
    locations: MemberLocation[];
    myMemberId?: string;
    nameOf: (memberId: string) => string;
  };
}

export function MapView(props: Props) {
  const [gate, setGate] = useState<{ ok: boolean; message?: string } | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    // React (dev "strict mode") runs effects twice; the ref keeps it to one request = one count.
    if (asked.current || !API_KEY || !MAP_ID) return;
    asked.current = true;
    fetch("/api/google/map-load", { method: "POST" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        setGate(res.ok && body.allowed ? { ok: true } : { ok: false, message: body.error ?? "The map can't load right now." });
      })
      .catch(() => setGate({ ok: false, message: "The map can't load right now (network)." }));
  }, []);

  if (!API_KEY || !MAP_ID) return <Placeholder text="Map not configured: add the Google values to .env.local (see .env.example)." />;
  if (!gate) return <Placeholder text="Loading the map…" />;
  if (!gate.ok) return <Placeholder text={gate.message!} />;

  return (
    <APIProvider apiKey={API_KEY} language="en" region={props.city.region}>
      <Map
        mapId={MAP_ID}
        defaultCenter={props.city.base}     // the city's starting point, until the pins are fitted
        defaultZoom={13}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl
        zoomControlOptions={{ position: ControlPosition.RIGHT_TOP }}   // bottom right = the group chat button
        clickableIcons={false}       // no Google pop-ups on other places: our pins are the content
        className="h-full w-full"
      >
        {props.legs.map((leg) => (
          <LegLine key={`${leg.id}-${leg.group}`} leg={leg} walk={props.walks[leg.id]} />
        ))}
        {props.stops.map((s) => (
          <AdvancedMarker
            key={s.key}
            position={{ lat: s.spot.lat, lng: s.spot.lng }}
            title={`${s.number}. ${s.spot.name}`}
            zIndex={props.selectedKey === s.key ? 1000 : 100 - s.number}
            onClick={() => props.onSelect(s.key)}
          >
            <StopPin stop={s} selected={props.selectedKey === s.key} />
          </AdvancedMarker>
        ))}
        <LocationMarkers locations={props.sharing.locations} myMemberId={props.sharing.myMemberId} nameOf={props.sharing.nameOf} />
        <FitToStops stops={props.stops} />
        <PanToSelected stops={props.stops} selectedKey={props.selectedKey} />
      </Map>
      {/* Over the map, top-left (APIProvider adds no element, so this sits in the map's box). */}
      <LocationControl {...props.sharing} cityName={props.city.name} />
      {/* OpenStreetMap's licence (ODbL) asks for a visible credit wherever its data is used: always on, not
          only in the place card. Bottom-left, just above Google's logo. */}
      {props.city.osm && (
        <p className="absolute bottom-7 left-2 z-10 rounded bg-card/90 px-1.5 py-0.5 text-[10px] text-muted shadow-sm">
          Places ©{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="hover:underline">
            OpenStreetMap contributors
          </a>
        </p>
      )}
    </APIProvider>
  );
}

// Numbered circle; the selected one also shows its name (only one label at a time: nearby spots
// like the Ueno museums would otherwise cover each other).
function StopPin({ stop, selected }: { stop: PlanStop; selected: boolean }) {
  const color = GROUP_COLOR[stop.group];
  return (
    <div className="flex flex-col items-center">
      {selected && (
        <span className="mb-1 whitespace-nowrap rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink shadow">
          {stop.spot.name}
        </span>
      )}
      <span
        className={`grid place-items-center rounded-full border-2 border-white font-semibold text-white shadow ${selected ? "h-9 w-9 text-sm" : "h-7 w-7 text-xs"}`}
        style={{ background: color, outline: stop.isRendezvous ? `2px solid ${color}` : undefined, outlineOffset: 2 }}
      >
        {stop.number}
      </span>
    </div>
  );
}

// One trip between two stops:
//   real walking route from Google -> solid line following the streets
//   train/subway leg, or walk not loaded (yet) -> dashed straight line ("roughly this way")
function LegLine({ leg, walk }: { leg: Leg; walk?: WalkRoute | null }) {
  const color = GROUP_COLOR[leg.group];
  if (walk) return <Polyline path={walkPath(leg, walk)} strokeColor={color} strokeOpacity={0.85} strokeWeight={4} clickable={false} />;
  return (
    <Polyline
      path={[{ lat: leg.from.spot.lat, lng: leg.from.spot.lng }, { lat: leg.to.spot.lat, lng: leg.to.spot.lng }]}
      strokeOpacity={0}                         // the line itself is invisible: the dashes below draw it
      icons={[{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: color, scale: 3 }, offset: "0", repeat: "14px" }]}
      clickable={false}
    />
  );
}

// When the day changes, zoom so that every pin of the day is visible.
function FitToStops({ stops }: { stops: PlanStop[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !stops.length) return;
    if (stops.length === 1) {
      map.setCenter({ lat: stops[0].spot.lat, lng: stops[0].spot.lng });
      map.setZoom(15);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const s of stops) bounds.extend({ lat: s.spot.lat, lng: s.spot.lng });
    map.fitBounds(bounds, 64);
  }, [map, stops]);
  return null;
}

// When a stop is selected, move the map to it and zoom in to street level if we're further out:
// stops in the same area (the Ueno museums, Asakusa) overlap at the day view and separate up close.
const STREET_ZOOM = 15;
function PanToSelected({ stops, selectedKey }: { stops: PlanStop[]; selectedKey: string | null }) {
  const map = useMap();
  useEffect(() => {
    const s = stops.find((x) => x.key === selectedKey);
    if (!map || !s) return;
    if ((map.getZoom() ?? 0) < STREET_ZOOM) map.setZoom(STREET_ZOOM);
    map.panTo({ lat: s.spot.lat, lng: s.spot.lng });
    // The place card covers the bottom-left of the map (the whole bottom on a phone): shift the view so
    // the pin sits to the right of and above the card. panBy(x, y) moves the CENTER, so the pin moves
    // the opposite way.
    const wide = map.getDiv().clientWidth >= 640;
    map.panBy(wide ? -170 : 0, wide ? 60 : 110);
  }, [map, stops, selectedKey]);
  return null;
}

function Placeholder({ text }: { text: string }) {
  return <div className="grid h-full place-items-center p-6 text-center text-sm text-muted">{text}</div>;
}
