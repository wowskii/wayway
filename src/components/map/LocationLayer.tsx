"use client";
// What location sharing adds to the map: one round marker per member sharing their position, and a
// small control at the top-left (Figma: "3 friends sharing location") to turn my sharing on / off.
import { useState } from "react";
import { AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import type { MemberLocation, ShareMode } from "./useLocationSharing";

interface Props {
  mode: ShareMode;
  setMode: (m: ShareMode) => void;
  error: string | null;
  locations: MemberLocation[];
  myMemberId?: string;
  nameOf: (memberId: string) => string;
  cityName?: string;
}

export function LocationMarkers({ locations, myMemberId, nameOf }: Pick<Props, "locations" | "myMemberId" | "nameOf">) {
  return locations.map((l) => {
    const me = l.memberId === myMemberId;
    const name = me ? "You" : nameOf(l.memberId);
    return (
      <AdvancedMarker key={l.memberId} position={{ lat: l.lat, lng: l.lng }} zIndex={2000}
        title={`${name}${l.isDemo ? " (demo position)" : ""} · ${ago(l.updatedAt)}`}>
        <div className="flex flex-col items-center">
          <span
            className={`grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-semibold text-white shadow ${
              l.isDemo ? "border-dashed border-white" : "border-white"} ${me ? "bg-ink" : "bg-[#5b6472]"}`}
          >
            {nameOf(l.memberId).slice(0, 1).toUpperCase()}
          </span>
          <span className="mt-0.5 rounded bg-card/90 px-1 text-[10px] font-medium text-ink">{name}</span>
        </div>
      </AdvancedMarker>
    );
  });
}

export function LocationControl({ mode, setMode, error, locations, myMemberId, nameOf, cityName = "the city" }: Props) {
  const map = useMap();
  const [open, setOpen] = useState(false);
  const others = locations.filter((l) => l.memberId !== myMemberId);
  const label = others.length === 0 ? "No friends sharing location"
    : `${others.length} friend${others.length > 1 ? "s" : ""} sharing location`;

  return (
    <div className="absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] text-xs">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="rounded-full border border-line bg-card px-3 py-1.5 font-medium text-ink shadow-sm hover:bg-page"
        >
          {label}
        </button>
        {mode !== "off" && (
          // Always visible while sharing, with a one-tap stop (privacy: never share without knowing it).
          <span className="flex items-center gap-2 rounded-full bg-brand px-3 py-1.5 font-medium text-white shadow-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden />
            {mode === "demo" ? "Sharing a demo position" : "Sharing your location"}
            <button onClick={() => setMode("off")} className="underline underline-offset-2">Stop</button>
          </span>
        )}
      </div>

      {open && (
        <div className="mt-2 w-72 max-w-full rounded-2xl border border-line bg-card p-3 shadow-lg">
          {others.length > 0 && (
            <ul className="mb-3 space-y-1">
              {others.map((l) => (
                <li key={l.memberId}>
                  <button
                    onClick={() => map?.panTo({ lat: l.lat, lng: l.lng })}
                    className="flex w-full justify-between rounded-lg px-2 py-1 text-left hover:bg-page"
                  >
                    <span className="font-medium">{nameOf(l.memberId)}{l.isDemo && <span className="font-normal text-muted"> · demo</span>}</span>
                    <span className="text-muted">{ago(l.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mode === "off" ? (
            <div className="space-y-2">
              <button onClick={() => { setMode("live"); setOpen(false); }}
                className="w-full rounded-xl bg-brand px-3 py-2 font-medium text-white hover:bg-brand-dark">
                Share my location
              </button>
              <button onClick={() => { setMode("demo"); setOpen(false); }}
                className="w-full rounded-xl border border-line px-3 py-2 hover:bg-page">
                Use a demo position in {cityName}
              </button>
            </div>
          ) : (
            <button onClick={() => { setMode("off"); setOpen(false); }}
              className="w-full rounded-xl border border-line px-3 py-2 font-medium hover:bg-page">
              Stop sharing
            </button>
          )}
          <p className="mt-2 text-muted">
            Only members of this trip can see it. Only your latest position is kept, it disappears after 15 minutes
            without an update, and stopping deletes it.
          </p>
        </div>
      )}
      {error && <p role="alert" className="mt-2 w-72 max-w-full rounded-lg bg-red-50 px-3 py-2 text-red-700 shadow-sm">{error}</p>}
    </div>
  );
}

function ago(ms: number) {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  return min === 0 ? "just now" : `${min} min ago`;
}
