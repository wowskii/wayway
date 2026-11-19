// Turns the contract's ItineraryItem[] into what the map page shows: one plan per day, with numbered
// stops, split cards and "your group". Pure functions (no React, no Google, no database) so the
// logic is easy to read and test.
//
// How a split is stored (contract + Henry's itineraryFromOption):
//   { day, start, end, branches: [{ memberIds, spots }, { memberIds, spots }] }   <- both groups
//   { day, start: <end of the split>, end, spotId }                                <- where they meet
// The contract has no "rendezvous" field on items, so a shared stop that starts exactly when the
// split before it ends is shown as the meeting point.
import type { ItineraryItem, Spot } from "@/contracts/contract";

export interface PlanStop {
  key: string;            // unique on the page, e.g. "1-3"
  number: number;         // pin number, in reading order for the day
  spot: Spot;
  start?: string;         // shared stops only: inside a branch we only know the branch's window
  end?: string;
  group: Group;           // colour of the pin and of the line leading to it
  isRendezvous?: boolean;
}

// shared = everyone · mine = my group in a split · other = the other group.
// other2: when the viewer is in NEITHER group (e.g. joined after the vote), the two groups still need
// two different colours, so the second one is "other2".
export type Group = "shared" | "mine" | "other" | "other2";

export interface PlanBranch {
  memberIds: string[];
  isMine: boolean;
  group: Group;
  stops: PlanStop[];
}

export type PlanEntry =
  | { kind: "stop"; stop: PlanStop }
  | { kind: "split"; start: string; end: string; branches: PlanBranch[] };

export interface DayPlan {
  day: number;
  entries: PlanEntry[];   // the list, in time order
  stops: PlanStop[];      // every pin of the day (shared + both groups)
}

/**
 * @param items        the trip's itinerary items (any order)
 * @param getSpot      spot lookup (unknown ids are skipped and reported in `missing`)
 * @param myMemberId   the viewer, to put "your group" first in a split
 */
export function buildDayPlans(
  items: ItineraryItem[],
  getSpot: (id: string) => Spot | undefined,
  myMemberId?: string,
): { days: DayPlan[]; missing: string[] } {
  const missing: string[] = [];
  const sorted = [...items].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  const days = new Map<number, DayPlan>();

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const plan = days.get(item.day) ?? { day: item.day, entries: [], stops: [] };
    days.set(item.day, plan);
    const nextNumber = () => plan.stops.length + 1;

    if (item.branches?.length) {
      // Mine first, so "Your group" is at the top of the card.
      const ordered = [...item.branches].sort(
        (a, b) => Number(b.memberIds.includes(myMemberId ?? "")) - Number(a.memberIds.includes(myMemberId ?? "")),
      );
      const anyMine = !!myMemberId && ordered.some((b) => b.memberIds.includes(myMemberId));
      const branches: PlanBranch[] = ordered.map((b, j) => {
        const isMine = !!myMemberId && b.memberIds.includes(myMemberId);
        const group: Group = isMine ? "mine" : !anyMine && j === 1 ? "other2" : "other";
        const stops: PlanStop[] = [];
        for (const id of b.spots) {
          const spot = getSpot(id);
          if (!spot) {
            missing.push(id);
            continue;
          }
          const stop: PlanStop = { key: `${item.day}-${nextNumber()}`, number: nextNumber(), spot, group };
          stops.push(stop);
          plan.stops.push(stop);
        }
        return { memberIds: b.memberIds, isMine, group, stops };
      });
      plan.entries.push({ kind: "split", start: item.start, end: item.end, branches });
      continue;
    }

    if (!item.spotId) continue;
    const spot = getSpot(item.spotId);
    if (!spot) {
      missing.push(item.spotId);
      continue;
    }
    const prev = sorted[i - 1];
    const isRendezvous = !!prev?.branches?.length && prev.day === item.day && prev.end === item.start;
    const stop: PlanStop = {
      key: `${item.day}-${nextNumber()}`, number: nextNumber(), spot,
      start: item.start, end: item.end, group: "shared", isRendezvous,
    };
    plan.stops.push(stop);
    plan.entries.push({ kind: "stop", stop });
  }

  return { days: [...days.values()].sort((a, b) => a.day - b.day), missing: [...new Set(missing)] };
}

/** "Sarah & Tom", "Sarah, Ken & Tom", "Sarah, Ken & 2 others" */
export function namesLabel(ids: string[], nameOf: (id: string) => string): string {
  const names = ids.map(nameOf);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
  return `${names.slice(0, 2).join(", ")} & ${names.length - 2} others`;
}
