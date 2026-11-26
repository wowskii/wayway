"use client";
// Spot Suggestions: one big card per option set still being decided, one card = the full panel
// height (no vertical scrolling between sets: ‹ › switches set). Unread sets come first, then
// the others; inside each group, least time left first.
//
//   ┌ Sat, Nov 21 · 14:00 – 17:30  [2 unread] ‹ 1/3 › ┐   date and time of the slot + pager
//   │ [Round 1 of 3]                    24:13 left │   round + time left in the round
//   │ ┌ A ─────┐ ┌ B ─────┐ ┌ C ─────┐              │   the option cards (what the group sees)
//   │ └────────┘ └────────┘ └────────┘              │
//   │ my private thread with WayWay about this set  │
//   │ [ Tell WayWay your thought            ] [↑]   │   -> POST /api/private/feedback
//   └───────────────────────────────────────────────┘    (Simon's extractPreferences, or the mock)
//
// After round 3 the set is in its FINAL VOTE (same big card, no chat with WayWay):
//   │ [Final vote]                      29:58 left │
//   │ Rate every option to count · 1 of 2 voted     │
//   │ ┌ A ───────────────────────────────────────┐ │
//   │ │ title, route, trade-off                   │ │   options from top to bottom
//   │ │ [Must go][Want to go][Same][Lean not][No] │ │   -> POST /api/chatbox/vote (Henry's rules)
//   │ └───────────────────────────────────────────┘ │
//   │ ┌ C (split) ... + "OK to split up?" Yes / No ┐ │
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { HardConstraints, SatisfactionLevel } from "@/contracts/contract";
import { Button } from "@/components/ui";
import { ConstraintCard } from "@/components/interview/ConstraintCard";
import { MessageBubble, TypingBubble } from "@/components/interview/MessageBubble";
import type { FeedbackTurnResponse } from "@/lib/chatbox-feedback/types";
import { LEVELS } from "@/lib/chatbox-trip-hub/levels";
import type { VoteResponse } from "@/lib/chatbox-vote/types";
import type { ConfirmResponse, InterviewMessage } from "@/lib/interview/types";
import { isUnread, parseSeen, readSeenRaw, stageOf, unreadCount, writeSeen, type Seen } from "@/lib/chatbox-trip-hub/seen";
import type { SuggestionOption, SuggestionSet } from "@/lib/chatbox-trip-hub/types";
import { PanelFrame } from "./PanelFrame";
import { phaseOf } from "./useRoundAdvance";

const MAX_LENGTH = 1000;
const MAX_ROUNDS = 3;

/** An API error with its HTTP status (404 = the set is gone, 409 = closed or changed). */
class RequestError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new RequestError(json.error ?? "Something went wrong. Please try again.", res.status);
  return json as T;
}

// ----- Countdown: one shared 1-second clock; null on the server render (no mismatch)
const subscribeClock = (tick: () => void) => {
  const t = setInterval(tick, 1000);
  return () => clearInterval(t);
};
const readClock = () => Math.floor(Date.now() / 1000) * 1000;

function TimeLeft({ deadline, moving, voting }: { deadline: string; moving: boolean; voting: boolean }) {
  const now = useSyncExternalStore(subscribeClock, readClock, () => null);
  if (now === null) return <span className="text-sm text-muted">&nbsp;</span>;
  const left = Date.parse(deadline) - now;
  // moving: the round's end was reported and WayWay is preparing the next one (the server pushes the
  // deadline a little while it works: don't show that as time left)
  if (voting && (left <= 0 || moving)) return <span className="text-sm font-medium text-muted">Voting time is up · counting votes…</span>;
  if (left <= 0 || moving) return <span className="text-sm font-medium text-muted">Time&apos;s up · moving to the next step…</span>;
  // Round UP to whole seconds: the last second shows 00:01, never "00:00 left" before "Time's up".
  const total = Math.ceil(left / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  const text = min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min` : `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return (
    <span className={`text-sm font-medium tabular-nums ${left < 5 * 60_000 ? "text-red-600" : "text-ink"}`} aria-live="off">
      ⏱ {text} left
    </span>
  );
}

// ----- One option (what the group's option card shows: no scores)
const KIND_LABEL: Record<SuggestionOption["kind"], string> = {
  best_total: "Most liked",
  fairest: "Fairest",
  split: "Split up",
};

function OptionCard({ o, children }: { o: SuggestionOption; children?: ReactNode }) {
  // One stop whose name starts with the title ("Ain Soph Journey" / "Ain Soph Journey (vegan cafe)"):
  // show the full name once, as the title, instead of the same name twice.
  const single = !o.groups && o.stops.length === 1 && o.stops[0].startsWith(o.title);
  return (
    <article className="flex min-w-0 snap-start flex-col gap-1.5 rounded-xl border border-line bg-page p-3">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white">{o.id}</span>
        <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-medium text-muted">{KIND_LABEL[o.kind]}</span>
      </div>
      <h4 className="line-clamp-2 font-semibold leading-snug">{single ? o.stops[0] : o.title}</h4>
      {o.groups ? (
        <div className="flex flex-col gap-0.5 text-sm">
          {o.groups.map((g, i) => (
            <p key={i} className="line-clamp-2">
              <span className="font-medium">{g.members.join(", ")}:</span> {g.stops.join(" → ")}
            </p>
          ))}
          {o.meet && <p className="text-muted">Meet at {o.meet.place}, {o.meet.time}</p>}
        </div>
      ) : single ? null : (
        <p className="line-clamp-3 text-sm">{o.stops.join(" → ")}</p>
      )}
      {o.worksFor.length > 0 && <p className="text-xs text-brand">Works for {o.worksFor.join(", ")}</p>}
      <p className="line-clamp-3 text-xs text-muted">{o.explanation}</p>
      {o.fairnessNote && <p className="line-clamp-2 text-xs italic text-muted">{o.fairnessNote}</p>}
      {children}
    </article>
  );
}

// ----- Final vote: every option from top to bottom, 5 levels under each (Henry's rules on the server)
function VoteList({
  set,
  tripId,
  onUpdateSet,
  onFresh,
  onRefresh,
}: {
  set: SuggestionSet;
  tripId: string;
  onUpdateSet: (update: (s: SuggestionSet) => SuggestionSet) => void;
  onFresh: (sets: SuggestionSet[]) => void;
  onRefresh: () => Promise<void>;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ballot = set.ballot;
  const mine = ballot?.mine ?? {};
  const rated = set.options.filter((o) => mine[o.id]).length;
  const done = rated === set.options.length;
  const noLeft = ballot?.definitelyNoLeft ?? 0;

  type Choice = NonNullable<typeof mine["A"]>;
  const setMine = (id: SuggestionOption["id"], value: Choice | undefined) =>
    onUpdateSet((s) => (s.ballot ? { ...s, ballot: { ...s.ballot, mine: { ...s.ballot.mine, [id]: value } } } : s));

  async function vote(o: SuggestionOption, change: { level?: SatisfactionLevel; acceptsSplit?: boolean }) {
    const before = mine[o.id];
    const level = change.level ?? before?.level;
    if (!level) {
      setError(`Rate option ${o.id} first, then say if you're OK to split up.`);
      return;
    }
    const acceptsSplit = o.kind === "split" ? (change.acceptsSplit ?? before?.acceptsSplit) : undefined;
    setMine(o.id, { level, ...(acceptsSplit !== undefined ? { acceptsSplit } : {}) });   // show it at once
    setSaving(o.id);
    setError(null);
    try {
      const res = await postJson<VoteResponse>("/api/chatbox/vote", {
        tripId, optionSetId: set.id, optionId: o.id, level, ...(acceptsSplit !== undefined ? { acceptsSplit } : {}),
      });
      onFresh(res.suggestions.sets);
    } catch (err) {
      setMine(o.id, before);   // refused (e.g. "definitely no" limit): back to what it was
      setError((err as Error).message);
      // The set is gone (404) or closed / changed (409): what I see is out of date, reload the sets
      if (err instanceof RequestError && (err.status === 404 || err.status === 409)) await onRefresh();
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-3 text-sm">
        <span className={done ? "font-medium text-brand" : "text-muted"}>
          {done ? "✓ Your vote counts" : `Rate every option to count · ${rated} of ${set.options.length} rated`}
        </span>
        {ballot && (
          <span className="text-muted">
            {ballot.voters} of {ballot.members} travelers have voted
          </span>
        )}
      </div>

      {(ballot?.extended || ballot?.attempt === 2) && (
        <p className="mx-4 mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          {ballot.attempt === 2
            ? "It was a perfect tie, so everyone votes again. If it's a tie again, the current best option wins."
            : "Not enough people voted in time, so the vote was extended once. Without enough votes now, there is no decision."}
        </p>
      )}

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-line px-4 py-3">
        <div className="flex flex-col gap-3">
          {set.options.map((o) => {
            const choice = mine[o.id];
            return (
              <OptionCard key={o.id} o={o}>
                <div role="radiogroup" aria-label={`How do you feel about option ${o.id}?`} className="mt-1 grid grid-cols-5 gap-1.5">
                  {LEVELS.map((l) => {
                    const on = choice?.level === l.id;
                    const blocked = l.id === "definitely_no" && !on && noLeft === 0;
                    const look = on
                      ? l.id === "definitely_no"
                        ? "border-red-500 bg-red-50 font-semibold text-red-700"
                        : "border-brand bg-brand-soft font-semibold text-brand"
                      : "border-line bg-card text-ink hover:border-brand";
                    return (
                      <button
                        key={l.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={saving === o.id || blocked}
                        title={blocked ? "No “Definitely no” left today" : undefined}
                        onClick={() => !on && vote(o, { level: l.id })}
                        className={`min-w-0 rounded-lg border px-1 py-2 text-center text-[11px] leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:text-xs ${look}`}
                      >
                        {l.label}
                      </button>
                    );
                  })}
                </div>
                {o.kind === "split" && (
                  <div className="flex items-center gap-2 pt-1 text-sm">
                    <span className="text-muted">OK to split up?</span>
                    {[true, false].map((yes) => {
                      const on = choice?.acceptsSplit === yes;
                      return (
                        <button
                          key={String(yes)}
                          type="button"
                          aria-pressed={on}
                          disabled={saving === o.id}
                          onClick={() => !on && vote(o, { acceptsSplit: yes })}
                          className={`rounded-lg border px-3 py-1 text-xs transition-colors disabled:opacity-40 ${
                            on ? "border-brand bg-brand-soft font-semibold text-brand" : "border-line bg-card hover:border-brand"
                          }`}
                        >
                          {yes ? "Yes" : "No"}
                        </button>
                      );
                    })}
                  </div>
                )}
              </OptionCard>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
          <span>🔒 Nobody sees what you voted, only how many have voted.</span>
          <span>“Definitely no” left today: {noLeft}</span>
        </div>
      </div>
    </>
  );
}

// ----- One option set = one full-height card
function SetCard({
  currency,
  set,
  tripId,
  draft,
  onDraft,
  onMessages,
  pager,
  moving,
  isNew,
  onSent,
  onUpdateSet,
  onFresh,
  onRefresh,
}: {
  currency: string;
  set: SuggestionSet;
  tripId: string;
  draft: string;
  onDraft: (text: string) => void;
  onMessages: (update: (messages: InterviewMessage[]) => InterviewMessage[]) => void;
  pager: ReactNode;
  moving: boolean;
  /** This round of the set has not been seen yet (e.g. it changed while I was looking at it). */
  isNew: boolean;
  /** Called after my message is saved: writing about a set counts as having seen it. */
  onSent: () => void;
  onUpdateSet: (update: (s: SuggestionSet) => SuggestionSet) => void;
  onFresh: (sets: SuggestionSet[]) => void;
  onRefresh: () => Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const open = set.status === "collecting_feedback";

  // Keep the latest message in view. Scrolls ONLY the thread box (scrollIntoView would also
  // scroll the panel and push the date row out of the card on short screens).
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [set.messages.length, sending]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending || !open) return;
    const tempId = `temp-${Date.now()}`;
    const temp: InterviewMessage = {
      id: tempId, tripId, memberId: "", sender: "member", text, createdAt: new Date().toISOString(), round: set.round,
    };
    onMessages((m) => [...m, temp]);
    onDraft("");
    setSending(true);
    setError(null);
    try {
      const res = await postJson<FeedbackTurnResponse>("/api/private/feedback", { tripId, optionSetId: set.id, text });
      onMessages((m) => [...m.filter((x) => x.id !== tempId), ...res.messages]);
      onSent();
      if (res.roundEnded) void onRefresh();   // everyone has reacted: the next round starts now
    } catch (err) {
      onMessages((m) => m.filter((x) => x.id !== tempId));
      onDraft(text);   // give the text back so nothing is lost
      setError((err as Error).message);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function answerCard(messageId: string, decision: "confirm" | "reject", edited?: Partial<HardConstraints>) {
    setError(null);
    try {
      const res = await postJson<ConfirmResponse>("/api/private/confirm", {
        tripId, messageId, decision, ...(edited ? { constraints: edited } : {}),
      });
      onMessages((m) => m.map((x) => (x.id === messageId ? res.message : x)));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <article className="@container flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      {/* Row 1: date and time of the slot */}
      <header className="flex items-start gap-3 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold">
            {set.date} · <span className="tabular-nums">{set.time}</span>
          </h3>
          {set.label && <p className="truncate text-xs text-muted">{set.label}</p>}
        </div>
        {pager}
      </header>

      {/* Row 2: round (green box) + time left */}
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <span className="flex items-center gap-2">
          <span className="rounded-lg border border-brand/30 bg-brand-soft px-2.5 py-1 text-sm font-semibold text-brand">
            {open ? `Round ${set.round} of ${MAX_ROUNDS}` : "Final vote"}
          </span>
          {!open && set.ballot?.extended && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Extended</span>
          )}
          {!open && set.ballot?.attempt === 2 && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Revote</span>
          )}
          {isNew && <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-semibold text-white">New</span>}
        </span>
        <TimeLeft deadline={set.deadline} moving={moving} voting={!open} />
      </div>

      {!open ? (
        <VoteList set={set} tripId={tripId} onUpdateSet={onUpdateSet} onFresh={onFresh} onRefresh={onRefresh} />
      ) : (
        <>
        {/* The A / B / C cards: side by side; on a narrow panel they scroll sideways. On a very short
            screen this row shrinks (and scrolls inside) so the whole set always fits one screen. */}
        <div className="grid min-h-0 shrink snap-x scroll-px-4 auto-cols-[85%] grid-flow-col gap-3 overflow-auto px-4 pt-3 pb-1 @xl:auto-cols-auto @xl:grid-flow-row @xl:grid-cols-3">
          {set.options.map((o) => (
            <OptionCard key={o.id} o={o} />
          ))}
        </div>

        {/* My private thread with WayWay about this set */}
        <div ref={threadRef} className="mt-3 min-h-24 flex-1 overflow-y-auto border-t border-line" aria-live="polite">
          <div className="flex flex-col gap-3 px-4 py-3">
            {set.messages.length === 0 && !sending && (
              <p className="py-2 text-center text-sm text-muted">
                🔒 Only WayWay sees what you write here, never your group.
                <br />
                Say what you like or don&apos;t like about A, B or C.
              </p>
            )}
            {set.messages.map((m) => (
              <div key={m.id} className="flex flex-col gap-2">
                <MessageBubble sender={m.sender} pending={m.id.startsWith("temp-")}>
                  {m.text}
                </MessageBubble>
                {m.constraintsToConfirm && m.constraintsStatus && (
                  <ConstraintCard
                    currency={currency}
                    constraints={m.constraintsToConfirm}
                    status={m.constraintsStatus}
                    onAnswer={(decision, edited) => answerCard(m.id, decision, edited)}
                  />
                )}
              </div>
            ))}
            {sending && <TypingBubble />}
          </div>
        </div>

        {/* Input: talks to WayWay privately about this set */}
        <form onSubmit={send} className="flex flex-col gap-2 border-t border-line px-4 py-3">
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!open}
              placeholder={open ? "Tell WayWay your thought" : "Voting is open: feedback on this set is closed"}
              aria-label={`Your thought to WayWay about ${set.date} ${set.time}`}
              rows={1}
              maxLength={MAX_LENGTH}
              className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-line bg-page px-3 py-2.5 text-[15px] outline-none placeholder:text-muted/60 focus:border-brand focus:bg-card disabled:opacity-60"
            />
            <Button type="submit" disabled={sending || !open || !draft.trim()} aria-label="Send" className="h-11 w-11 px-0">
              ↑
            </Button>
          </div>
        </form>
        </>
      )}
    </article>
  );
}

const noSubscribe = () => () => {};

function PagerButton({ dir, disabled, highlight, onClick }: { dir: "prev" | "next"; disabled: boolean; highlight: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous time slot" : "Next time slot"}
      className={`grid h-9 w-9 place-items-center rounded-full border-2 transition-colors disabled:cursor-not-allowed disabled:border-line disabled:bg-card disabled:text-line ${
        highlight ? "border-brand bg-brand text-white hover:bg-brand-dark" : "border-brand bg-card text-brand hover:bg-brand hover:text-white"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={dir === "prev" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
      </svg>
    </button>
  );
}

/**
 * The pages, client-only (it reads this browser's "seen" list). The order is decided ONCE, when the
 * panel first opens: unread sets first, then the rest; inside each group the server's order
 * (least time left first). It does not move while I read, so opening page 1 never reshuffles it.
 * The sets themselves come from TripHub (they change when a round changes); a new round makes a
 * set unread again, even the one on screen (it then shows "New" until I turn the page, reopen the
 * panel or write about it).
 */
function SuggestionsPager({
  currency,
  sets: liveSets,
  waiting,
  visible,
  tripId,
  onUnreadChange,
  onMessages,
  onUpdateSet,
  onFresh,
  onRefresh,
}: {
  sets: SuggestionSet[];
  waiting: Record<string, string>;
  visible: boolean;
  tripId: string;
  onUnreadChange: (count: number) => void;
  onMessages: (setId: string, update: (messages: InterviewMessage[]) => InterviewMessage[]) => void;
  onUpdateSet: (setId: string, update: (s: SuggestionSet) => SuggestionSet) => void;
  onFresh: (sets: SuggestionSet[]) => void;
  onRefresh: () => Promise<void>;
  currency: string;
}) {
  const [opened] = useState(() => {
    const stored = parseSeen(readSeenRaw(tripId));
    const ids = [...liveSets.filter((s) => isUnread(s, stored)), ...liveSets.filter((s) => !isUnread(s, stored))].map((s) => s.id);
    return { ids, stored };
  });
  // Opening order, with today's data; sets that appeared later go last
  const sets = useMemo(
    () => [...opened.ids.flatMap((id) => liveSets.filter((s) => s.id === id)), ...liveSets.filter((s) => !opened.ids.includes(s.id))],
    [opened.ids, liveSets],
  );
  const [index, setIndex] = useState(0);
  const [seen, setSeen] = useState<Seen>(opened.stored);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const count = sets.length;
  const current = sets[Math.min(index, count - 1)];
  const unread = unreadCount(sets, seen);
  const unreadAhead = sets.some((s, i) => i > index && isUnread(s, seen));

  // A page counts as seen when it comes on screen: when the panel opens and when I turn the page.
  // NOT when its round changes while I look at it: it stays "New" (unread) until I act on it.
  // (State adjusted during render when the page on screen changes, React's pattern for "derived"
  // state: no extra effect pass.)
  const onScreen = visible && current ? current.id : null;
  const [lastOnScreen, setLastOnScreen] = useState<string | null>(null);
  if (onScreen !== lastOnScreen) {
    setLastOnScreen(onScreen);
    if (onScreen && isUnread(current, seen)) setSeen((prev) => ({ ...prev, [current.id]: stageOf(current) }));
  }
  // The set I was on disappeared (decided, or removed) after a refresh: say why the page changed
  const [shownId, setShownId] = useState(current.id);
  const [notice, setNotice] = useState<string | null>(null);
  if (current.id !== shownId) {
    setShownId(current.id);
    if (!sets.some((s) => s.id === shownId)) setNotice("The time slot you were on is over (decided, closed or removed). Here is the next one.");
  }
  useEffect(() => onUnreadChange(unread), [unread, onUnreadChange]);
  // Save only the sets still in progress (old ids drop out of the list)
  useEffect(() => {
    writeSeen(tripId, Object.fromEntries(sets.filter((s) => s.id in seen).map((s) => [s.id, seen[s.id]])));
  }, [seen, sets, tripId]);

  function go(to: number) {
    setIndex(Math.max(0, Math.min(count - 1, to)));   // the new page is marked seen by the rule above
    setNotice(null);
  }

  const pager =
    count > 1 ? (
      <div className="flex shrink-0 items-center gap-2">
        {unread > 0 && (
          <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white" aria-live="polite">
            {unread} unread
          </span>
        )}
        <PagerButton dir="prev" disabled={index === 0} highlight={false} onClick={() => go(index - 1)} />
        <span className="min-w-10 text-center text-sm font-semibold tabular-nums text-ink">
          {index + 1} / {count}
        </span>
        <PagerButton dir="next" disabled={index >= count - 1} highlight={unreadAhead} onClick={() => go(index + 1)} />
      </div>
    ) : null;

  const card = (
    <SetCard
      currency={currency}
      key={current.id}
      set={current}
      tripId={tripId}
      draft={drafts[current.id] ?? ""}
      onDraft={(text) => setDrafts((d) => ({ ...d, [current.id]: text }))}
      onMessages={(update) => onMessages(current.id, update)}
      pager={pager}
      moving={waiting[current.id] === phaseOf(current)}
      isNew={isUnread(current, seen)}
      onSent={() => setSeen((prev) => ({ ...prev, [current.id]: stageOf(current) }))}
      onUpdateSet={(update) => onUpdateSet(current.id, update)}
      onFresh={onFresh}
      onRefresh={onRefresh}
    />
  );
  if (!notice) return card;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <p role="status" className="flex shrink-0 items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <span className="flex-1">{notice}</span>
        <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-amber-700 hover:text-amber-900">
          ✕
        </button>
      </p>
      <div className="min-h-0 flex-1">{card}</div>
    </div>
  );
}

export function SuggestionsPanel({
  sets,
  waiting,
  visible,
  tripId,
  onUnreadChange,
  onMessages,
  onUpdateSet,
  onFresh,
  onRefresh,
  onClose,
  currency = "JPY",
}: {
  /** The trip's currency, for the budget on a confirmation card. */
  currency?: string;
  sets: SuggestionSet[];
  /** Phases whose end was reported and that have not moved on yet (set id -> phase): "moving to the next step…" */
  waiting: Record<string, string>;
  /** The panel is on screen (it stays mounted when closed). */
  visible: boolean;
  tripId: string;
  /** Tells the parent how many sets I have not opened yet in their current stage (red dock badge). */
  onUnreadChange: (count: number) => void;
  onMessages: (setId: string, update: (messages: InterviewMessage[]) => InterviewMessage[]) => void;
  /** Changes one set right away (e.g. my vote, before the server answers). */
  onUpdateSet: (setId: string, update: (s: SuggestionSet) => SuggestionSet) => void;
  /** Fresh sets from the server (after a vote). */
  onFresh: (sets: SuggestionSet[]) => void;
  /** Ask the server for the current sets (what I see is out of date). */
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  // The pages need this browser's "seen" list, which the server does not have: render them on the
  // client only (no hydration mismatch when the page opens with ?panel=suggestions).
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const count = sets.length;

  return (
    <PanelFrame
      title="Spot Suggestions"
      subtitle={`${count} option ${count === 1 ? "set" : "sets"} in progress`}
      onClose={onClose}
    >
      <div className="h-full p-4">
        {count === 0 ? (
          <div className="grid h-full place-items-center rounded-2xl border border-dashed border-line bg-card p-6 text-center">
            <div>
              <p className="font-medium">No suggestions in progress</p>
              <p className="mt-1 text-sm text-muted">Ask @WayWay in the group chat to plan a time slot.</p>
            </div>
          </div>
        ) : isClient ? (
          <SuggestionsPager
            currency={currency}
            sets={sets}
            waiting={waiting}
            visible={visible}
            tripId={tripId}
            onUnreadChange={onUnreadChange}
            onMessages={onMessages}
            onUpdateSet={onUpdateSet}
            onFresh={onFresh}
            onRefresh={onRefresh}
          />
        ) : (
          <div className="h-full rounded-2xl border border-line bg-card" aria-busy="true" />
        )}
      </div>
    </PanelFrame>
  );
}
