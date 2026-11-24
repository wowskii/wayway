"use client";
// Layout of the trip page:
//
//   ┌ sidebar ─────┬──────────────────────────────────────────────┐
//   │ Your trips   │                 group chat                   │   no tool open
//   │ ...          │                                              │
//   │ [W][★][map]  │                                              │
//   └──────────────┴──────────────────────────────────────────────┘
//   ┌ sidebar ─────┬───────────── tool (2/3) ──────┬─ chat (1/3) ─┐   a tool is open
//
// Tapping a dock icon opens its tool in the middle and pushes the chat to the right;
// tapping it again (or the ✕) closes it. On phones the tool covers the chat instead.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChatMessage } from "@/contracts/contract";
import { GroupChat } from "@/components/chatbox-chat/GroupChat";
import type { ReadMap } from "@/components/chatbox-chat/useTripChannel";
import { InterviewChat } from "@/components/interview/InterviewChat";
import type { InterviewProgress } from "@/lib/ai/types";
import type { InterviewMessage } from "@/lib/interview/types";
import type { SuggestionSet } from "@/lib/chatbox-trip-hub/types";
import { parseSeen, readSeenRaw, unreadCount } from "@/lib/chatbox-trip-hub/seen";
import type { HubMember, HubTrip, ItineraryData, PanelId, SuggestionsData } from "@/lib/chatbox-trip-hub/types";
import { FeatureDock } from "./FeatureDock";
import { ItineraryPanel } from "./ItineraryPanel";
import { PanelFrame } from "./PanelFrame";
import { SuggestionsPanel } from "./SuggestionsPanel";
import { useRoundAdvance } from "./useRoundAdvance";
import { TripList } from "./TripList";

const seenKey = (tripId: string) => `wayway:itinerary-seen:${tripId}`;
const noSubscribe = () => () => {};

function readSeen(tripId: string): number {
  try {
    return Number(localStorage.getItem(seenKey(tripId)) ?? 0);
  } catch {
    return 0;
  }
}
function writeSeen(tripId: string, at: number) {
  try {
    localStorage.setItem(seenKey(tripId), String(at));
  } catch {
    // private window or blocked storage: the badge just resets on reload
  }
}

export function TripHub({
  trip,
  me,
  members,
  trips,
  messages,
  reads,
  privateChat,
  suggestions,
  itinerary,
  initialPanel,
}: {
  trip: { id: string; name: string; timezone: string };
  me: HubMember;
  members: HubMember[];
  trips: HubTrip[];
  messages: ChatMessage[];
  reads: ReadMap;
  privateChat: { messages: InterviewMessage[]; progress: InterviewProgress; finished: boolean };
  suggestions: SuggestionsData;
  itinerary: ItineraryData;
  initialPanel: PanelId | null;
}) {
  const [panel, setPanel] = useState<PanelId | null>(initialPanel);
  // Panels stay mounted after their first opening, so a draft or a scroll position is kept.
  const [mounted, setMounted] = useState<Set<PanelId>>(() => new Set(initialPanel ? [initialPanel] : []));

  // ----- Badges
  const [privateStatus, setPrivateStatus] = useState({
    pendingCards: privateChat.messages.filter((m) => m.constraintsStatus === "pending").length,
    finished: privateChat.finished,
  });
  // ----- Spot Suggestions: the sets live here (not in the panel) so a round can change while the
  // panel is closed. useRoundAdvance asks the server when a round ends and hands back fresh sets.
  const [suggestionSets, setSuggestionSets] = useState<SuggestionSet[]>(suggestions.sets);
  const applyFreshSets = useCallback((fresh: SuggestionSet[]) => {
    setSuggestionSets((prev) => [
      ...prev.flatMap((s) => fresh.filter((f) => f.id === s.id)),   // same order, new data; decided sets drop out
      ...fresh.filter((f) => !prev.some((s) => s.id === f.id)),
    ]);
  }, []);
  const updateSetMessages = useCallback(
    (setId: string, update: (messages: InterviewMessage[]) => InterviewMessage[]) =>
      setSuggestionSets((list) => list.map((s) => (s.id === setId ? { ...s, messages: update(s.messages) } : s))),
    [],
  );
  const updateSet = useCallback(
    (setId: string, update: (s: SuggestionSet) => SuggestionSet) =>
      setSuggestionSets((list) => list.map((s) => (s.id === setId ? update(s) : s))),
    [],
  );
  const { moving: roundsWaiting, refresh: refreshSuggestions } = useRoundAdvance(trip.id, suggestionSets, applyFreshSets);
  // A set left the list (its vote was decided or closed): reload the page's server data so the
  // itinerary panel shows the new stops. (The sets themselves live in state and are not reset.)
  const router = useRouter();
  // WayWay posted about an option set (several messages can arrive together): refresh once
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onWayWayUpdate = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void refreshSuggestions(), 400);
  }, [refreshSuggestions]);
  const setIds = useRef(new Set(suggestions.sets.map((s) => s.id)));
  useEffect(() => {
    const now = new Set(suggestionSets.map((s) => s.id));
    const left = [...setIds.current].some((id) => !now.has(id));
    setIds.current = now;
    if (left) router.refresh();
  }, [suggestionSets, router]);
  // Unread sets (this browser's "seen" list; null on the server render). Once the panel is open it
  // reports the live number itself, as pages get opened.
  const storedSuggestionsSeen = useSyncExternalStore(noSubscribe, () => readSeenRaw(trip.id), () => null);
  const [liveUnread, setLiveUnread] = useState<number | null>(null);
  const unreadSets =
    liveUnread ?? (storedSuggestionsSeen === null ? 0 : unreadCount(suggestionSets, parseSeen(storedSuggestionsSeen)));
  // When I last opened the itinerary: stored in this browser; null on the server render.
  const storedSeen = useSyncExternalStore(noSubscribe, () => readSeen(trip.id), () => null);
  const [openedAt, setItinerarySeen] = useState<number | null>(null);
  const itinerarySeen = openedAt ?? storedSeen;

  const newStops =
    itinerarySeen === null
      ? 0
      : itinerary.days.flatMap((d) => d.entries).filter((e) => Date.parse(e.createdAt) > itinerarySeen).length;

  const badges: Record<PanelId, number> = {
    private: privateStatus.pendingCards + (privateStatus.finished ? 0 : 1),
    suggestions: unreadSets,
    itinerary: newStops,
  };
  // Quieter top-right number: how many option sets are in progress.
  const counts: Partial<Record<PanelId, number>> = { suggestions: suggestionSets.length };

  const toggle = useCallback(
    (id: PanelId) => {
      setPanel((p) => (p === id ? null : id));
      setMounted((m) => (m.has(id) ? m : new Set(m).add(id)));
      if (id === "itinerary") {
        const now = Date.now();
        writeSeen(trip.id, now);
        setItinerarySeen(now);
      }
    },
    [trip.id],
  );
  const close = useCallback(() => setPanel(null), []);

  // Escape closes the open tool
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  const show = (id: PanelId) => (panel === id ? "flex" : "hidden");

  return (
    <div className="flex h-[calc(100dvh-4rem-1px)] overflow-hidden bg-page">
      {/* Left: group selection + WayWay tools */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-card md:flex">
        <TripList trips={trips} currentId={trip.id} />
        <div className="border-t border-line p-4">
          <p className="pb-3 text-xs font-medium uppercase tracking-wide text-muted">WayWay tools</p>
          <FeatureDock active={panel} badges={badges} counts={counts} onToggle={toggle} />
        </div>
      </aside>

      {/* Middle + right: open tool (2/3) and group chat (1/3) */}
      <div
        className="relative grid min-w-0 flex-1 grid-cols-1 transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none md:[grid-template-columns:var(--hub-cols)]"
        style={{ "--hub-cols": panel ? "minmax(0,2fr) minmax(320px,1fr)" : "minmax(0,0fr) minmax(320px,1fr)" } as React.CSSProperties}
      >
        <div
          className={`${panel ? "flex" : "hidden md:flex"} absolute inset-0 z-20 min-w-0 flex-col overflow-hidden border-line md:relative md:inset-auto md:z-auto md:border-r`}
        >
          {mounted.has("private") && (
            <div className={`${show("private")} h-full min-h-0 flex-col`}>
              <PanelFrame title="WayWay · private chat" subtitle="Only WayWay sees this chat, never your group." onClose={close}>
                <InterviewChat
                  embedded
                  tripId={trip.id}
                  memberId={me.id}
                  initialMessages={privateChat.messages}
                  initialProgress={privateChat.progress}
                  initiallyFinished={privateChat.finished}
                  onStatusChange={setPrivateStatus}
                />
              </PanelFrame>
            </div>
          )}
          {mounted.has("suggestions") && (
            <div className={`${show("suggestions")} h-full min-h-0 flex-col`}>
              <SuggestionsPanel
                sets={suggestionSets}
                waiting={roundsWaiting}
                visible={panel === "suggestions"}
                tripId={trip.id}
                onUnreadChange={setLiveUnread}
                onMessages={updateSetMessages}
                onUpdateSet={updateSet}
                onFresh={applyFreshSets}
                onRefresh={refreshSuggestions}
                onClose={close}
              />
            </div>
          )}
          {mounted.has("itinerary") && (
            <div className={`${show("itinerary")} h-full min-h-0 flex-col`}>
              <ItineraryPanel data={itinerary} onClose={close} />
            </div>
          )}
        </div>

        <div className="min-h-0 min-w-0">
          <GroupChat
            tripId={trip.id}
            tripName={trip.name}
            timezone={trip.timezone}
            me={me}
            members={members}
            initialMessages={messages}
            initialReads={reads}
            onWayWayUpdate={onWayWayUpdate}
            headerActions={
              <div className="md:hidden">
                <FeatureDock compact active={panel} badges={badges} counts={counts} onToggle={toggle} />
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
