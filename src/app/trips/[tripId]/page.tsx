// The trip page: /trips/<tripId>
// Group chat in the middle, "Your trips" + WayWay tools on the left. ?panel=private|suggestions|itinerary
// opens a tool directly ("Me" -> "Update with WayWay" uses ?panel=private).
// Members who have not finished the interview are sent to the one-time interview page first.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Header, TripHeader } from "@/components/Header";
import { NotMember } from "@/components/chatbox-hub/NotMember";
import { TripHub } from "@/components/chatbox-hub/TripHub";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/interview/http";
import { getInterviewState } from "@/lib/interview/service";
import { loadHub } from "@/lib/chatbox-trip-hub/load";
import { isPanelId } from "@/lib/chatbox-trip-hub/types";
import { interviewPath } from "@/lib/trip";

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
  if (!hub) {
    // Not in this trip (removed by the organizer, trip deleted, or someone else's link): say so
    return (
      <>
        <Header />
        <NotMember />
      </>
    );
  }

  // Interview not finished: the rest of the trip opens after it (same rule as src/lib/trip.ts)
  const current = hub.trips.find((t) => t.id === hub.trip.id);
  if (!current || current.needsProfile) redirect(interviewPath(tripId));

  // The private chat with WayWay, still open after the interview: what you add there updates your profile
  const privateState = await getInterviewState(tripId);
  const finished = privateState.onboardingStatus === "done";
  const initialPanel = isPanelId(panel) ? panel : null;

  return (
    <>
      <TripHeader tripId={hub.trip.id} tripName={hub.trip.name} dates={current.dates} active="chat" />
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
