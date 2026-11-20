"use client";
// The group chat of a trip, messenger style: stored messages + live updates, typing dots,
// "Read by N of M" under every message, and @WayWay mentions.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { ChatMessage } from "@/contracts/contract";
import { MAX_CHAT_LENGTH, sendGroupMessage } from "@/lib/chat/client";
import { WAYWAY_SENDER_ID } from "@/lib/db/mappers";
import { createClient } from "@/lib/supabase/client";
import type { HubMember } from "@/lib/trip-hub/types";
import { DaySeparator, GroupMessage, TypingRow } from "./ChatParts";
import { useTripChannel, type ReadMap } from "./useTripChannel";

const GROUP_GAP_MS = 5 * 60_000;   // same sender within 5 min = one visual group

function byTime(a: ChatMessage, b: ChatMessage) {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

export function GroupChat({
  tripId,
  tripName,
  timezone,
  me,
  members,
  initialMessages,
  initialReads,
  headerActions,
}: {
  tripId: string;
  tripName: string;
  timezone: string;       // trip timezone: times look the same for everyone (and on the server render)
  me: HubMember;
  members: HubMember[];
  initialMessages: ChatMessage[];
  initialReads: ReadMap;   // chat_reads: memberId -> read up to this createdAt
  headerActions?: ReactNode;
}) {
  const [supabase] = useState(createClient);
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottomRef = useRef(true);

  const addMessage = useCallback((m: ChatMessage) => {
    setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m].sort(byTime)));
  }, []);

  const { online, typists, reads, sendTyping, markRead } = useTripChannel({ supabase, tripId, me, initialReads, onMessage: addMessage });

  const nameOf = useMemo(() => {
    const names = new Map(members.map((m) => [m.id, m.name]));
    return (id: string) => (id === WAYWAY_SENDER_ID ? "WayWay" : (names.get(id) ?? "A traveler"));
  }, [members]);

  const fmtTime = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    [timezone],
  );
  const fmtDay = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }),
    [timezone],
  );

  // ----- Read receipts: "Read by N of M" (M = everyone in the trip except the sender)
  function readLabel(m: ChatMessage) {
    const others = members.filter((x) => x.id !== m.senderId);
    if (!others.length) return "Sent";
    const sent = Date.parse(m.createdAt);
    const n = others.filter((x) => reads[x.id] && Date.parse(reads[x.id]) >= sent).length;
    if (n === 0) return "Sent";
    return n === others.length ? "Read by everyone" : `Read by ${n} of ${others.length}`;
  }

  // Mark as read when the page is visible and the newest message is on screen
  const lastStored = [...messages].reverse().find((m) => !m.id.startsWith("temp-"));
  const readIfVisible = useCallback(() => {
    if (lastStored && atBottomRef.current && document.visibilityState === "visible") markRead(lastStored.createdAt);
  }, [lastStored, markRead]);

  useEffect(() => {
    readIfVisible();
    document.addEventListener("visibilitychange", readIfVisible);
    window.addEventListener("focus", readIfVisible);
    return () => {
      document.removeEventListener("visibilitychange", readIfVisible);
      window.removeEventListener("focus", readIfVisible);
    };
  }, [readIfVisible]);

  // Follow new messages when already at the bottom (or when the new message is mine)
  const last = messages[messages.length - 1];
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (atBottomRef.current || last?.senderId === me.id) el.scrollTop = el.scrollHeight;
  }, [messages.length, typists.length, last?.senderId, me.id]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottomRef.current) readIfVisible();
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const temp: ChatMessage = { id: `temp-${Date.now()}`, tripId, senderId: me.id, text, createdAt: new Date().toISOString() };
    setMessages((list) => [...list, temp]);
    setDraft("");
    setError(null);
    atBottomRef.current = true;
    try {
      const saved = await sendGroupMessage(supabase, tripId, me.id, text);
      setMessages((list) => {
        const rest = list.filter((x) => x.id !== temp.id);
        return rest.some((x) => x.id === saved.id) ? rest : [...rest, saved].sort(byTime);
      });
    } catch (err) {
      setMessages((list) => list.filter((x) => x.id !== temp.id));
      setDraft(text);
      setError((err as Error).message);
    } finally {
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  // @-mention helper: typing "@" or "@wa…" at the end offers @WayWay
  const mention = draft.match(/(^|\s)@(\w*)$/);
  const offerWayWay = !!mention && "wayway".startsWith(mention[2].toLowerCase());
  function insertWayWay() {
    setDraft((d) => d.replace(/@(\w*)$/, "@WayWay "));
    inputRef.current?.focus();
  }

  // ----- Rendering with day separators and sender groups
  const rows: ReactNode[] = [];
  let prev: ChatMessage | undefined;
  for (const m of messages) {
    const day = fmtDay.format(new Date(m.createdAt));
    const newDay = !prev || fmtDay.format(new Date(prev.createdAt)) !== day;
    if (newDay) rows.push(<DaySeparator key={`day-${m.id}`} label={day} />);
    const firstOfGroup =
      newDay || !prev || prev.senderId !== m.senderId || Date.parse(m.createdAt) - Date.parse(prev.createdAt) > GROUP_GAP_MS;
    rows.push(
      <GroupMessage
        key={m.id}
        text={m.text}
        senderName={nameOf(m.senderId)}
        time={fmtTime.format(new Date(m.createdAt))}
        mine={m.senderId === me.id}
        wayway={m.senderId === WAYWAY_SENDER_ID}
        firstOfGroup={firstOfGroup}
        readLabel={readLabel(m)}
        pending={m.id.startsWith("temp-")}
      />,
    );
    prev = m;
  }

  const typingNames = typists.map((t) => (t.id === WAYWAY_SENDER_ID ? "WayWay" : t.name));
  const onlineCount = online.length || 1;

  return (
    <section className="flex h-full min-h-0 flex-col bg-card" aria-label="Group chat">
      <header className="flex items-center gap-3 border-b border-line bg-brand-soft/60 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">{tripName} · Group chat</h1>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2 w-2 rounded-full bg-brand" aria-hidden />
            {members.length} {members.length === 1 ? "traveler" : "travelers"} · {onlineCount} online · WayWay assistant
          </p>
        </div>
        {headerActions}
      </header>

      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {messages.length === 0 ? (
          <div className="mx-auto mt-16 max-w-xs text-center text-sm text-muted">
            <p className="font-medium text-ink">No messages yet</p>
            <p className="mt-1">Say hi to your group, or type @WayWay to ask the assistant for a plan.</p>
          </div>
        ) : (
          rows
        )}
        <TypingRow names={typingNames} wayway={typists.some((t) => t.id === WAYWAY_SENDER_ID)} />
      </div>

      <form onSubmit={send} className="border-t border-line px-3 py-3">
        {error && (
          <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {offerWayWay && (
          <button
            type="button"
            onClick={insertWayWay}
            className="mb-2 inline-flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-1.5 text-sm shadow-sm hover:border-brand"
          >
            <span className="grid h-5 w-5 place-items-center rounded-full bg-brand text-[10px] font-semibold text-white">W</span>
            @WayWay <span className="text-xs text-muted">AI assistant</span>
          </button>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            id="group-chat-input"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value.trim()) sendTyping();
            }}
            onKeyDown={onKeyDown}
            placeholder="Message… (type @WayWay to ask the assistant)"
            aria-label="Message to your group"
            rows={1}
            maxLength={MAX_CHAT_LENGTH}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-page px-4 py-2.5 text-[15px] outline-none focus:border-brand focus:bg-card"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Send"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22l-4-9-9-4z" />
            </svg>
          </button>
        </div>
      </form>
    </section>
  );
}
