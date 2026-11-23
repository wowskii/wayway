"use client";
// Location sharing on the trip map (opt-in). Talks to the member_locations table directly from the
// browser, as the logged-in user: the database rules decide who can read/write (see migration 5).
//
//   mode "off"  : not sharing (no row in the database)
//   mode "live" : the browser's real position (asks permission), sent at most every 30 s, or sooner
//                 after moving 25 m, and refreshed every 5 min so it doesn't expire while standing still
//   mode "demo" : a fixed position near Tokyo Station (for testing / the demo video from outside Tokyo),
//                 flagged is_demo so it's never shown as real
// Friends' positions arrive live (Supabase Realtime). Positions older than 15 min are hidden.
// The chosen mode is remembered for this trip in the browser, so a reload keeps sharing on.
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type ShareMode = "off" | "live" | "demo";

export interface MemberLocation {
  memberId: string;
  lat: number;
  lng: number;
  isDemo: boolean;
  updatedAt: number;        // ms
}

const FRESH_MS = 15 * 60_000;          // same as the database read rule
const MIN_INTERVAL_MS = 30_000;
const MIN_MOVE_M = 25;
const HEARTBEAT_MS = 5 * 60_000;
const TOKYO_STATION = { lat: 35.6812, lng: 139.7671 };

const storageKey = (tripId: string) => `wayway:share:${tripId}`;
function readMode(tripId: string): ShareMode {
  try {
    const v = localStorage.getItem(storageKey(tripId));
    return v === "live" || v === "demo" ? v : "off";
  } catch {
    return "off";             // storage blocked (private window...): start not sharing
  }
}
function saveMode(tripId: string, mode: ShareMode) {
  try {
    if (mode === "off") localStorage.removeItem(storageKey(tripId));
    else localStorage.setItem(storageKey(tripId), mode);
  } catch { /* not remembered: fine */ }
}

function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

interface Row { member_id: string; lat: number; lng: number; is_demo: boolean; updated_at: string }
const toLocation = (r: Row): MemberLocation => ({
  memberId: r.member_id, lat: r.lat, lng: r.lng, isDemo: r.is_demo, updatedAt: new Date(r.updated_at).getTime(),
});

export function useLocationSharing(tripId: string, myMemberId?: string) {
  const [supabase] = useState(createClient);
  const [mode, setModeState] = useState<ShareMode>("off");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, MemberLocation>>({});
  const [now, setNow] = useState(() => Date.now());

  // ---- Everyone's positions: first load, then live changes ----
  useEffect(() => {
    let alive = true;
    supabase.from("member_locations").select("member_id, lat, lng, is_demo, updated_at").eq("trip_id", tripId)
      .then(({ data }) => {
        if (alive && data) setRows(Object.fromEntries(data.map((r) => [r.member_id, toLocation(r)])));
      });
    const upsert = (payload: { new: unknown }) => {
      const row = payload.new as Row;
      setRows((r) => ({ ...r, [row.member_id]: toLocation(row) }));
    };
    const channel = supabase
      .channel(`locations:${tripId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "member_locations", filter: `trip_id=eq.${tripId}` }, upsert)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "member_locations", filter: `trip_id=eq.${tripId}` }, upsert)
      // Deletions (someone stops sharing): Realtime only sends the primary key (member_id) of a deleted
      // row, so a trip_id filter never matches them. Listen without a filter; ids we don't show are ignored.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "member_locations" }, (payload) => {
        const id = (payload.old as Partial<Row>).member_id;
        if (id) setRows((r) => { if (!(id in r)) return r; const next = { ...r }; delete next[id]; return next; });
      })
      .subscribe();
    // Re-check freshness every minute (an expired position sends no event).
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      alive = false;
      clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [supabase, tripId]);

  // ---- Sending my position ----
  const last = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const send = useCallback(async (lat: number, lng: number, accuracy: number | null, isDemo: boolean) => {
    if (!myMemberId) return;
    last.current = { lat, lng, at: Date.now() };
    const { error: e } = await supabase.from("member_locations")
      .upsert({ member_id: myMemberId, trip_id: tripId, lat, lng, accuracy_m: accuracy, is_demo: isDemo });
    setError(e ? "Your position couldn't be shared. Try again." : null);
  }, [supabase, tripId, myMemberId]);

  useEffect(() => {
    if (mode === "off" || !myMemberId) return;
    let watchId: number | null = null;
    let first: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval>;

    if (mode === "demo") {
      // ±300 m around Tokyo Station, so several demo users don't sit on the same point
      const jitter = () => (Math.random() - 0.5) * 0.006;
      const pos = { lat: TOKYO_STATION.lat + jitter(), lng: TOKYO_STATION.lng + jitter() };
      // First send on the next tick (not inside the effect itself); cancelled if the mode changes at once.
      first = setTimeout(() => void send(pos.lat, pos.lng, null, true), 0);
      heartbeat = setInterval(() => void send(pos.lat, pos.lng, null, true), HEARTBEAT_MS);
    } else {
      if (!("geolocation" in navigator)) {
        queueMicrotask(() => setError("This browser can't share its location. You can use a demo position."));
        return;
      }
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          const here = { lat: p.coords.latitude, lng: p.coords.longitude };
          const prev = last.current;
          if (!prev || Date.now() - prev.at >= MIN_INTERVAL_MS || meters(prev, here) >= MIN_MOVE_M) {
            void send(here.lat, here.lng, p.coords.accuracy ?? null, false);
          }
        },
        (e) => setError(e.code === e.PERMISSION_DENIED
          ? "Location permission was refused. You can allow it in the browser, or use a demo position."
          : "Your location isn't available right now."),
        { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
      );
      heartbeat = setInterval(() => {
        navigator.geolocation.getCurrentPosition(
          (p) => {
            if (watchId !== null) {
              void send(p.coords.latitude, p.coords.longitude, p.coords.accuracy ?? null, false);
            }
          },
          () => {
            if (watchId !== null) setError("Your location isn't available right now.");
          },
          { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
        );
      }, HEARTBEAT_MS);
    }
    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      clearTimeout(first);
      clearInterval(heartbeat);
    };
  }, [mode, myMemberId, send]);

  // Resume the remembered choice after a reload.
  useEffect(() => {
    const saved = readMode(tripId);
    if (saved !== "off") queueMicrotask(() => setModeState(saved));
  }, [tripId]);

  const setMode = useCallback(async (next: ShareMode) => {
    setModeState(next);
    saveMode(tripId, next);
    setError(null);
    if (next === "off" && myMemberId) {
      last.current = null;
      setRows((r) => { const rest = { ...r }; delete rest[myMemberId]; return rest; });
      // Stop = delete my row: nothing about my position is kept.
      await supabase.from("member_locations").delete().eq("member_id", myMemberId);
    }
  }, [supabase, tripId, myMemberId]);

  const visible = Object.values(rows).filter((l) => now - l.updatedAt < FRESH_MS);
  return { mode, setMode, error, locations: visible };
}
