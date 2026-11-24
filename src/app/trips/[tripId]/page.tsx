// The trip page: /trips/<tripId>
// Group chat in the middle, "Your trips" + WayWay tools on the left. ?panel=private|suggestions|itinerary
// opens a tool directly. Members who have not finished the interview land on the private chat.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { ChatboxTabs } from "@/components/chatbox-hub/ChatboxTabs";
import { TripHub } from "@/components/chatbox-hub/TripHub";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/interview/http";
import { getInterviewState } from "@/lib/interview/service";
import { loadHub } from "@/lib/chatbox-trip-hub/load";
import { isPanelId } from "@/lib/chatbox-trip-hub/types";

export const metadata: Metadata = { title: "Group chat · WayWay" };

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { tripId } = await params;
  const { panel } = await searchParams;
  if (!isUuid(tripId)) notFound();

  const user = await requireUser(`/trips/${tripId}`);
  const hub = await loadHub(tripId, user.id);
  if (!hub) notFound();

  // The private chat with WayWay (posts WayWay's greeting the first time, like the interview page)
  const privateState = await getInterviewState(tripId);
  const finished = privateState.onboardingStatus === "done";
  const initialPanel = isPanelId(panel) ? panel : finished ? null : "private";

  return (
    <>
      <Header displayName={user.displayName} wide>
        <ChatboxTabs
          tripId={hub.trip.id}
          tripName={hub.trip.name}
          dates={hub.trips.find((t) => t.id === hub.trip.id)?.dates}
          active="chat"
        />
      </Header>
      <TripHub
        trip={hub.trip}
        me={hub.me}
        members={hub.members}
        trips={hub.trips}
        messages={hub.messages}
        reads={hub.reads}
        privateChat={{ messages: privateState.messages, progress: privateState.interview, finished }}
        suggestions={hub.suggestions}
        itinerary={hub.itinerary}
        initialPanel={initialPanel}
      />
    </>
  );
}
