"use client";
// Live itinerary on the map: when the group decides a slot (save_decision writes itinerary_items),
// the open map page reloads its server data, without a full page reload.
//
// How: Supabase Realtime tells the browser about new / deleted itinerary_items rows (the database rules
// still decide who receives what). We don't use the row itself: router.refresh() asks the server page
// again, so the map is built by the same code as on a first load (buildDayPlans, legs...).
//
// Same pattern as useLocationSharing.ts:
//   - INSERT: filtered on this trip.
//   - DELETE: Realtime only sends the primary key (id) of a deleted row, so a trip_id filter would never
//     match. We listen without a filter and only refresh if the id is one of the stops on screen.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// save_decision inserts several rows at once (one per stop): wait a moment so they cause ONE refresh.
const DEBOUNCE_MS = 400;

export function useItineraryUpdates(tripId: string, itemIds: string[]) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  // The ids on screen change after each refresh; a ref lets the subscription read the latest ones
  // without unsubscribing / subscribing again.
  const shown = useRef(new Set(itemIds));
  useEffect(() => {
    shown.current = new Set(itemIds);
  }, [itemIds]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), DEBOUNCE_MS);
    };
    const channel = supabase
      .channel(`itinerary:${tripId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "itinerary_items", filter: `trip_id=eq.${tripId}` }, refresh)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "itinerary_items" }, (payload) => {
        const id = (payload.old as { id?: string }).id;
        if (id && shown.current.has(id)) refresh();
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, tripId, router]);
}
