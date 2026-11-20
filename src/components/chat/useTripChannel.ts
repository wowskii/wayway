"use client";
// One Supabase Realtime channel per trip page. It carries four things:
//   1. postgres_changes chat_messages : new stored messages (filtered by the database rules)
//   2. postgres_changes chat_reads    : read receipts, "member X has read up to time T"
//   3. broadcast "typing"             : "<name> is typing" signals (not stored anywhere)
//   4. presence                       : who has the chat open right now
//
// Read receipts are stored in chat_reads (one row per member), so they survive reloads and are
// known even for members who read and left before you opened the chat. The page loads them with
// the messages (initialReads); this hook keeps them live and saves my own progress through the
// mark_chat_read() database function (at most once every READ_SAVE_MS).
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/contracts/contract";
import { toChatMessage, type ChatMessageRow } from "@/lib/db/mappers";
import type { Tables } from "@/lib/db/database.types";
import type { createClient } from "@/lib/supabase/client";
import type { HubMember } from "@/lib/trip-hub/types";

const TYPING_TTL_MS = 4000;       // a typing signal shows for 4 s unless renewed
const TYPING_THROTTLE_MS = 2500;  // send at most one signal every 2.5 s while typing
const READ_SAVE_MS = 2000;        // save my read position at most once every 2 s

type PresencePayload = { memberId: string; name: string };
export type Typist = { id: string; name: string };
/** memberId -> createdAt of the newest message that member has read */
export type ReadMap = Record<string, string>;

const later = (a: string | undefined, b: string | undefined) =>
  !a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b;

export function useTripChannel({
  supabase,
  tripId,
  me,
  initialReads,
  onMessage,
}: {
  supabase: ReturnType<typeof createClient>;
  tripId: string;
  me: HubMember;
  initialReads: ReadMap;
  onMessage: (message: ChatMessage) => void;
}) {
  const [online, setOnline] = useState<string[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [reads, setReads] = useState<ReadMap>(initialReads);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastReadRef = useRef(initialReads[me.id] ?? "");
  const lastTypingRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  });

  // ----- Saving my read position (throttled; the database also refuses to move it backwards)
  const pendingReadRef = useRef<string | null>(null);
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveRef = useRef(0);

  const saveRead = useCallback(() => {
    readTimerRef.current = null;
    const at = pendingReadRef.current;
    pendingReadRef.current = null;
    if (!at) return;
    lastSaveRef.current = Date.now();
    void supabase.rpc("mark_chat_read", { p_trip_id: tripId, p_last_read_at: at }).then(({ error }) => {
      if (error) console.warn("Could not save the read position:", error.message);
    });
  }, [supabase, tripId]);

  // Leaving the page: save what is still waiting
  useEffect(
    () => () => {
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
      saveRead();
    },
    [saveRead],
  );

  useEffect(() => {
    const channel = supabase.channel(`trip-chat:${tripId}`, {
      config: { presence: { key: me.id }, broadcast: { self: false } },
    });

    channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `trip_id=eq.${tripId}` },
        (payload) => {
          const message = toChatMessage(payload.new as ChatMessageRow);
          onMessageRef.current(message);
          // Their message arrived: they stopped typing
          setTyping((t) => {
            if (!(message.senderId in t)) return t;
            const next = { ...t };
            delete next[message.senderId];
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_reads", filter: `trip_id=eq.${tripId}` },
        (payload) => {
          const row = payload.new as Partial<Tables<"chat_reads">>;
          if (!row?.member_id || !row.last_read_at) return;
          const { member_id, last_read_at } = row;
          setReads((r) => {
            const next = later(r[member_id], last_read_at)!;
            return next === r[member_id] ? r : { ...r, [member_id]: next };
          });
        },
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const p = payload as Partial<Typist>;
        if (!p?.id || p.id === me.id) return;
        setTyping((t) => ({ ...t, [p.id!]: { name: p.name ?? "Someone", until: Date.now() + TYPING_TTL_MS } }));
      })
      .on("presence", { event: "sync" }, () => {
        setOnline(Object.keys(channel.presenceState<PresencePayload>()));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ memberId: me.id, name: me.name } satisfies PresencePayload);
        }
      });

    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [supabase, tripId, me.id, me.name]);

  // Drop typing signals that were not renewed
  useEffect(() => {
    const timer = setInterval(() => {
      setTyping((t) => {
        const now = Date.now();
        const alive = Object.entries(t).filter(([, v]) => v.until > now);
        return alive.length === Object.keys(t).length ? t : Object.fromEntries(alive);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  /** Call on every keystroke; it sends at most one signal per TYPING_THROTTLE_MS. */
  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingRef.current < TYPING_THROTTLE_MS) return;
    lastTypingRef.current = now;
    void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { id: me.id, name: me.name } satisfies Typist });
  }, [me.id, me.name]);

  /** I have seen every message up to `createdAt`. Shown at once, saved at most every READ_SAVE_MS. */
  const markRead = useCallback(
    (createdAt: string) => {
      if (lastReadRef.current && Date.parse(createdAt) <= Date.parse(lastReadRef.current)) return;
      lastReadRef.current = createdAt;
      setReads((r) => ({ ...r, [me.id]: createdAt }));
      pendingReadRef.current = createdAt;
      if (readTimerRef.current) return;
      const wait = Math.max(0, lastSaveRef.current + READ_SAVE_MS - Date.now());
      readTimerRef.current = setTimeout(saveRead, wait);
    },
    [me.id, saveRead],
  );

  const typists: Typist[] = Object.entries(typing).map(([id, v]) => ({ id, name: v.name }));
  return { online, typists, reads, sendTyping, markRead };
}
