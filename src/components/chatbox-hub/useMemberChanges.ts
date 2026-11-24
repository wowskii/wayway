"use client";
// Live changes to the trip's members (Supabase Realtime on trip_members):
//   INSERT  someone joined (invite link, or added in the settings window)   -> onJoined()
//   DELETE  someone was removed (the event only carries the row id)         -> onLeft(memberId)
//           also when it is ME: the page then says I'm no longer a member.
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useMemberChanges({ tripId, memberIds, onJoined, onLeft }: {
  tripId: string;
  memberIds: string[];
  onJoined: () => void;
  onLeft: (memberId: string) => void;
}) {
  const [supabase] = useState(createClient);
  const latest = useRef({ memberIds, onJoined, onLeft });
  useEffect(() => {
    latest.current = { memberIds, onJoined, onLeft };
  });

  useEffect(() => {
    const channel = supabase
      .channel(`trip-members:${tripId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_members", filter: `trip_id=eq.${tripId}` },
        () => latest.current.onJoined())
      // DELETE events can't be filtered: keep only ids of this trip's members
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "trip_members" }, (payload) => {
        const id = (payload.old as { id?: string }).id;
        if (id && latest.current.memberIds.includes(id)) latest.current.onLeft(id);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, tripId]);
}
