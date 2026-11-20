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
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ChatMessage, SatisfactionLevel } from "@/contracts/contract";
import { GroupChat } from "@/components/chat/GroupChat";
import type { ReadMap } from "@/components/chat/useTripChannel";
import { InterviewChat } from "@/components/interview/InterviewChat";
import type { InterviewProgress } from "@/lib/ai/types";
import type { InterviewMessage } from "@/lib/interview/types";
import type { HubMember, HubTrip, ItineraryData, PanelId, RateData } from "@/lib/trip-hub/types";
import { FeatureDock } from "./FeatureDock";
import { ItineraryPanel } from "./ItineraryPanel";
import { PanelFrame } from "./PanelFrame";
import { RatePanel, unratedCount } from "./RatePanel";
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
  rate,
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
  rate: RateData;
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
  const [myRatings, setMyRatings] = useState<Record<string, SatisfactionLevel | undefined>>(() =>
    Object.fromEntries(rate.spots.map((s) => [s.id, s.myLevel])),
  );
  // When I last opened the itinerary: stored in this browser; null on the server render.
  const storedSeen = useSyncExternalStore(noSubscribe, () => readSeen(trip.id), () => null);
  const [openedAt, setItinerarySeen] = useState<number | null>(null);
  const itinerarySeen = openedAt ?? storedSeen;

  const newStops =
    itinerary.source !== "live" || itinerarySeen === null
      ? 0
      : itinerary.days.flatMap((d) => d.entries).filter((e) => Date.parse(e.createdAt) > itinerarySeen).length;

  const badges: Record<PanelId, number> = {
    private: privateStatus.pendingCards + (privateStatus.finished ? 0 : 1),
    rate: unratedCount(rate, myRatings),
    itinerary: newStops,
  };

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
          <FeatureDock active={panel} badges={badges} onToggle={toggle} />
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
          {mounted.has("rate") && (
            <div className={`${show("rate")} h-full min-h-0 flex-col`}>
              <RatePanel data={rate} tripId={trip.id} onMineChange={setMyRatings} onClose={close} />
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
            headerActions={
              <div className="md:hidden">
                <FeatureDock compact active={panel} badges={badges} onToggle={toggle} />
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
