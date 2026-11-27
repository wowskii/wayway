// Shown for an unknown address, or when a page calls notFound() (e.g. a trip id that doesn't exist).
import type { Metadata } from "next";
import { MyTripsLink, StatusPage } from "@/components/StatusPage";

export const metadata: Metadata = { title: "Page not found · WayWay" };

export default function NotFound() {
  return (
    <StatusPage title="Page not found" text="This link doesn't lead anywhere. The trip may have been deleted, or the address is wrong.">
      <MyTripsLink />
    </StatusPage>
  );
}
