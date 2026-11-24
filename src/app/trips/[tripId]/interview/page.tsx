// The onboarding interview page: /trips/<tripId>/interview — a one-time step: the rest of the trip
// opens once it is finished, and then this page sends you to the group chat (src/lib/trip.ts).
// The server loads the chat (and posts WayWay's greeting the first time), then hands it to
// the InterviewChat component which runs in the browser.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { InterviewChat } from "@/components/interview/InterviewChat";
import { getInterviewState, InterviewError } from "@/lib/interview/service";
import { loadTripPage } from "@/lib/trip";

export const metadata: Metadata = { title: "Get to know you · WayWay" };

export default async function InterviewPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { trip } = await loadTripPage(tripId, "interview");   // login, membership, not finished yet

  let state;
  try {
    state = await getInterviewState(tripId);
  } catch (err) {
    if (err instanceof InterviewError && err.status === 403) notFound();
    throw err;
  }

  return (
    <>
      <Header wide>
        <span className="border-l border-line pl-4 text-sm font-medium">{trip.name}</span>
      </Header>
      <InterviewChat
        tripId={tripId}
        memberId={state.memberId}
        initialMessages={state.messages}
        initialProgress={state.interview}
        initiallyFinished={state.onboardingStatus === "done"}
      />
    </>
  );
}
