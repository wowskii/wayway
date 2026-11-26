"use client";
// The group chat of a trip, messenger style: stored messages + live updates, typing dots,
// "Read by N of M" under every message, and @WayWay mentions.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { ChatMessage } from "@/contracts/contract";
import { MAX_CHAT_LENGTH, mentionsWayWay, sendGroupMessage, sendToWayWay } from "@/lib/chatbox-chat/client";
import { WAYWAY_SENDER_ID } from "@/lib/db/mappers";
import { createClient } from "@/lib/supabase/client";
import type { HubMember } from "@/lib/chatbox-trip-hub/types";
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
  titleAction,
  onWayWayUpdate,
}: {
  tripId: string;
  tripName: string;
  timezone: string;       // trip timezone: times look the same for everyone (and on the server render)
  me: HubMember;
  members: HubMember[];
  initialMessages: ChatMessage[];
  initialReads: ReadMap;   // chat_reads: memberId -> read up to this createdAt
  headerActions?: ReactNode;
  /** Shown right after the title (the trip settings gear). */
  titleAction?: ReactNode;
  /** WayWay posted about an option set (new options, next round, vote, result): refresh the suggestions. */
  onWayWayUpdate?: () => void;
}) {
  const [supabase] = useState(createClient);
  const [messages, setMessages] = useState(initialMessages);
  // Someone was removed from the trip (their messages were deleted with them): hide theirs too
  const memberKey = members.map((m) => m.id).join();
  const [shownFor, setShownFor] = useState(memberKey);
  if (shownFor !== memberKey) {
    setShownFor(memberKey);
    const ids = new Set(members.map((m) => m.id));
    setMessages((list) => list.filter((m) => m.senderId === WAYWAY_SENDER_ID || ids.has(m.senderId)));
  }
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottomRef = useRef(true);

  const [waywayThinking, setWaywayThinking] = useState(false);
  const updateRef = useRef(onWayWayUpdate);
  useEffect(() => {
    updateRef.current = onWayWayUpdate;
  }, [onWayWayUpdate]);

  const addMessage = useCallback((m: ChatMessage) => {
    setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m].sort(byTime)));
    if (m.senderId === WAYWAY_SENDER_ID && m.optionSetId) updateRef.current?.();
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
    const forWayWay = mentionsWayWay(text);
    if (forWayWay) setWaywayThinking(true);   // "WayWay is typing…" while the server works
    try {
      const saved = forWayWay ? await sendToWayWay(tripId, text) : { message: await sendGroupMessage(supabase, tripId, me.id, text), replies: [] };
      setMessages((list) => {
        const rest = list.filter((x) => x.id !== temp.id);
        return rest.some((x) => x.id === saved.message.id) ? rest : [...rest, saved.message].sort(byTime);
      });
      saved.replies.forEach(addMessage);   // also arrive through Realtime: addMessage ignores duplicates
    } catch (err) {
      setMessages((list) => list.filter((x) => x.id !== temp.id));
      setDraft(text);
      setError((err as Error).message);
    } finally {
      setWaywayThinking(false);
      inputRef.current?.focus();
    }
  }

  // @-mention helper: typing "@" or "@wa…" at the end offers @WayWay (click it, or press Tab)
  const mention = draft.match(/(^|\s)@(\w*)$/);
  const offerWayWay = !!mention && "wayway".startsWith(mention[2].toLowerCase());
  function insertWayWay() {
    setDraft((d) => d.replace(/@(\w*)$/, "@WayWay "));
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;   // typing Chinese / Japanese: the keys belong to the IME
    if (e.key === "Tab" && !e.shiftKey && offerWayWay) {
      e.preventDefault();                   // complete the mention instead of leaving the box
      insertWayWay();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
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
  if (waywayThinking && !typingNames.includes("WayWay")) typingNames.push("WayWay");
  const onlineCount = online.length || 1;

  return (
    <section className="flex h-full min-h-0 flex-col bg-card" aria-label="Group chat">
      <header className="flex items-center gap-3 border-b border-line bg-brand-soft/60 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="truncate font-semibold">{tripName} · Group Chat</h1>
            {titleAction}
          </div>
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
        <TypingRow names={typingNames} wayway={waywayThinking || typists.some((t) => t.id === WAYWAY_SENDER_ID)} />
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
            <kbd className="rounded border border-line bg-page px-1.5 text-[10px] font-medium text-muted">Tab</kbd>
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
            placeholder="Message… @WayWay for help"
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
