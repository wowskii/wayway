// Which option sets I already opened in the Spot Suggestions panel, per round. Stored in THIS
// browser only (like the itinerary's "new" badge): a per-viewer convenience, never shared.
// Used by the panel (order + "N unread") and by the dock (red unread badge). Browser-only:
// every function is safe to call when storage is blocked (it then behaves as "nothing seen").

/** option set id -> the last stage I opened. A new stage (next round, or the final vote) makes it unread. */
export type Seen = Record<string, number>;

type Staged = { id: string; round: number; status?: string; ballot?: { attempt: number } };
/** Rounds 1-3 are stages 1-3; the final vote (after round 3) is stage 4, its revote after a tie stage 5. */
export const stageOf = (s: Staged) => (s.status === "voting" ? s.round + (s.ballot?.attempt === 2 ? 2 : 1) : s.round);

const key = (tripId: string) => `wayway:suggestions-seen:${tripId}`;

/** Raw stored value (a string, so React can compare snapshots cheaply). "{}" when nothing is stored. */
export function readSeenRaw(tripId: string): string {
  try {
    return localStorage.getItem(key(tripId)) ?? "{}";
  } catch {
    return "{}";
  }
}

export function parseSeen(raw: string | null): Seen {
  try {
    const v = JSON.parse(raw ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Seen) : {};
  } catch {
    return {};
  }
}

export function writeSeen(tripId: string, seen: Seen) {
  try {
    localStorage.setItem(key(tripId), JSON.stringify(seen));
  } catch {
    // private window or blocked storage: everything just shows as unread again next time
  }
}

export const isUnread = (set: Staged, seen: Seen) => seen[set.id] !== stageOf(set);

export const unreadCount = (sets: Staged[], seen: Seen) =>
  sets.filter((s) => isUnread(s, seen)).length;
