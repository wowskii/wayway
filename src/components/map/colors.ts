// Pin, line and label colours on the map page.
// shared = the whole group (WayWay green) · mine = my group during a split (green too: it's my route)
// other = the other group during a split (blue, so the two routes are easy to tell apart)
// other2 = second group when the viewer is in neither (purple, so the two groups still differ).
import type { Group } from "@/lib/itinerary/view";

export const GROUP_COLOR: Record<Group, string> = {
  shared: "#1e7f3c",
  mine: "#1e7f3c",
  other: "#2f6fdb",
  other2: "#8b3fc6",
};
