// Pin and label colours on the map page.
// shared = the whole group (WayWay green) · mine = my group during a split (green too: it's my route)
// other = the other group during a split (blue, so the two routes are easy to tell apart).
import type { PlanStop } from "@/lib/itinerary/view";

export const GROUP_COLOR: Record<PlanStop["group"], string> = {
  shared: "#1e7f3c",
  mine: "#1e7f3c",
  other: "#2f6fdb",
};
