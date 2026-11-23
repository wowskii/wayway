// Itinerary items for a decided option, and how much each member has already committed (budget).
import type { ItineraryItem, Option, Spot, TimeSlot } from "@/contracts/contract";

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Same rough rule as the AI module (travelMin): 10 min in the same area, else 10 + 3 min/km, rounded up to 5. */
export function travelMin(a: Pick<Spot, "id" | "area" | "lat" | "lng">, b: Pick<Spot, "id" | "area" | "lat" | "lng">): number {
  if (a.id === b.id) return 0;
  if (a.area === b.area) return 10;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.ceil((10 + 3 * 2 * 6371 * Math.asin(Math.sqrt(h))) / 5) * 5;
}

/**
 * Shared option: one item per stop, in order, with travel time between stops (never past the slot end).
 * Split: one item with both branches from the slot start to the rendezvous time, then the rendezvous stop.
 */
export function itineraryFromOption(option: Option, slot: TimeSlot, spots: Readonly<Record<string, Spot>>): ItineraryItem[] {
  const slotEnd = toMin(slot.end);
  if (option.kind === "split" && option.branches && option.rendezvous) {
    const meet = toMin(option.rendezvous.time);
    const meetSpot = spots[option.rendezvous.spotId];
    const items: ItineraryItem[] = [];
    if (meet > toMin(slot.start)) {
      items.push({ day: slot.day, start: slot.start, end: option.rendezvous.time,
        // The rendezvous gets its own item below, so it is not repeated at the end of a branch.
        branches: option.branches.map(b => ({ memberIds: [...b.memberIds],
          spots: b.spots.filter((s, i) => !(i === b.spots.length - 1 && s === option.rendezvous!.spotId)) })) });
    }
    const end = Math.min(slotEnd, meet + (meetSpot?.durationMin ?? 30));
    if (end > meet) items.push({ day: slot.day, start: option.rendezvous.time, end: hhmm(end), spotId: option.rendezvous.spotId });
    return items;
  }
  const items: ItineraryItem[] = [];
  let t = toMin(slot.start);
  let prev: Spot | undefined;
  for (const id of option.spots) {
    const spot = spots[id];
    if (!spot) continue;
    if (prev) t += travelMin(prev, spot);
    const end = Math.min(slotEnd, t + spot.durationMin);
    if (end <= t) break;
    items.push({ day: slot.day, start: hhmm(t), end: hhmm(end), spotId: id });
    t = end;
    prev = spot;
  }
  return items;
}

/** Money already committed by each member = sum of the prices of their itinerary stops. */
export function spentFromItinerary(
  items: readonly ItineraryItem[], memberIds: readonly string[], spots: Readonly<Record<string, Pick<Spot, "price">>>,
): Record<string, number> {
  const spent: Record<string, number> = Object.fromEntries(memberIds.map(id => [id, 0]));
  const price = (id: string) => (Object.hasOwn(spots, id) && Number.isFinite(spots[id].price) ? spots[id].price : 0);
  for (const item of items) {
    if (item.spotId) for (const id of memberIds) spent[id] += price(item.spotId);
    for (const branch of item.branches ?? []) {
      for (const id of branch.memberIds) if (Object.hasOwn(spent, id)) for (const s of branch.spots) spent[id] += price(s);
    }
  }
  return spent;
}
