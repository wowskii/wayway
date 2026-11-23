// The onboarding interview page: /trips/<tripId>/interview
// The server loads the chat (and posts WayWay's greeting the first time), then hands it to
// the InterviewChat component which runs in the browser.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { InterviewChat } from "@/components/interview/InterviewChat";
import { requireUser } from "@/lib/auth";
import { getInterviewState, InterviewError } from "@/lib/interview/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Get to know you · WayWay" };

export default async function InterviewPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const user = await requireUser(`/trips/${tripId}/interview`);

  // RLS only returns the trip if the user is a member (or its creator)
  const supabase = await createClient();
  const { data: trip } = await supabase.from("trips").select("id, name").eq("id", tripId).maybeSingle();
  if (!trip) notFound();

  let state;
  try {
    state = await getInterviewState(tripId);
  } catch (err) {
    if (err instanceof InterviewError && err.status === 403) notFound();
    throw err;
  }

  return (
    <>
      <Header displayName={user.displayName}>
        <span className="text-sm font-medium">{trip.name}</span>
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
