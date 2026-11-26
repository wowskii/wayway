"use client"; // Next.js: error pages must run in the browser (they are React error boundaries)
// Shown instead of a page when its server code fails (database or AI down...), for every page of the
// app. "Try again" asks the server for the page again (`retry`, Next 16); the details stay in the
// console, never on screen (they can contain internal information).
import { useEffect } from "react";
import { Button } from "@/components/ui";
import { MyTripsLink, StatusPage } from "@/components/StatusPage";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusPage title="Something went wrong" text="WayWay couldn't load this page. It's usually temporary: try again in a moment.">
      <Button onClick={() => retry()}>Try again</Button>
      <MyTripsLink ghost />
    </StatusPage>
  );
}
