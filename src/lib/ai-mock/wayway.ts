// FAKE "@WayWay" brain used until the real AI is connected (WAYWAY_AI_MODE=mock). Same input /
// output shapes as Simon's negotiateSlot and generateOptions, so the route, the database and the
// panel can be tested without an API key. Deliberately simple:
//
//   mockNegotiate (when?)  understands a few words, in English and Chinese:
//     "lunch / 午餐", "dinner / 晚餐", "breakfast / 早餐", "afternoon / 下午", "morning / 上午",
//     "evening / 晚上", "tomorrow / 明天", "day 2 / 第2天", a time "15:00" / "3pm" / "3點",
//     and "ok / yes / 好 / 可以 / 👍" to confirm the pending proposal.
//   mockGenerate (what?)   picks spots that are open during the slot (food for a meal, no food
//     otherwise), alone or in pairs in the same area, and estimates each member from their interests.
import type { MemberScore, SatisfactionLevel, Spot, TimeSlot } from "@/contracts/contract";
import type { Generator, Negotiator } from "@/lib/ai/wayway";
import { mentionsWayWay, tripCalendar } from "../../../wayway-ai/lib/ai";

const MEAL = /\b(breakfast|brunch|lunch|dinner|supper|meal)\b/i;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// When: mockNegotiate
// ---------------------------------------------------------------------------
const WINDOWS: { re: RegExp; start: string; end: string; name: string }[] = [
  { re: /breakfast|早餐/i, start: "08:00", end: "09:00", name: "Breakfast" },
  { re: /lunch|午餐|中餐|午飯/i, start: "12:00", end: "13:30", name: "Lunch" },
  { re: /dinner|supper|晚餐|晚飯/i, start: "18:30", end: "20:00", name: "Dinner" },
  { re: /afternoon|下午/i, start: "14:00", end: "17:30", name: "Afternoon" },
  { re: /morning|上午|早上/i, start: "09:30", end: "12:00", name: "Morning" },
  { re: /evening|tonight|晚上/i, start: "19:00", end: "21:30", name: "Evening" },
];
const YES = /\b(ok|okay|yes|yep|sure|fine|perfect|great|sounds good)\b|好|可以|沒問題|👍/i;

function parseTime(text: string): number | null {
  const m = text.match(/\b(\d{1,2}):(\d{2})\b/) ?? text.match(/\b(\d{1,2})\s*(am|pm)\b/i) ?? text.match(/(\d{1,2})\s*點/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] && /^\d+$/.test(m[2]) ? Number(m[2]) : 0;
  if (/pm/i.test(m[2] ?? "") && h < 12) h += 12;
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

const overlaps = (a: TimeSlot, b: TimeSlot) => a.day === b.day && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

export const mockNegotiate: Negotiator = async ({ trip, message, pending, decided, now }) => {
  if (!mentionsWayWay(message.text)) return { action: "none" };
  const text = message.text;
  const time = parseTime(text);
  const kindOf = (s: TimeSlot) => (MEAL.test(s.label) ? "meal" : "activity") as "meal" | "activity";

  // A pending proposal: "ok" confirms it, a time changes it (same length)
  if (pending && YES.test(text) && time === null) return { action: "confirm", slot: pending, kind: kindOf(pending) };
  if (pending && time !== null) {
    const length = toMin(pending.end) - toMin(pending.start);
    const slot = { ...pending, start: hhmm(time), end: hhmm(Math.min(time + length, 23 * 60 + 59)) };
    return { action: "change", slot, kind: kindOf(slot) };
  }

  // A new request: which window, which day
  const window = WINDOWS.find((w) => w.re.test(text));
  if (!window && time === null) {
    return { action: "ask", reply: "What should I plan? For example \"@WayWay lunch tomorrow\" or \"@WayWay this afternoon\"." };
  }
  const start = time ?? toMin(window!.start);
  const end = time !== null && !window ? Math.min(start + 180, 23 * 60 + 59) : time !== null ? start + (toMin(window!.end) - toMin(window!.start)) : toMin(window!.end);
  const cal = tripCalendar(trip, now ?? new Date());
  const asked = text.match(/\bday\s*(\d+)\b|第\s*(\d+)\s*天/i);
  let day = asked ? Number(asked[1] ?? asked[2])
    : /tomorrow|明天/i.test(text) ? Math.max(cal.today, 0) + 1
      : cal.today < 1 ? 1
        : cal.today > cal.nDays ? cal.nDays
          : start > toMin(cal.nowTime) ? cal.today : cal.today + 1;
  day = Math.min(Math.max(day, 1), cal.nDays);
  const name = window?.name ?? "Activity";
  const make = (d: number): TimeSlot => ({ day: d, start: hhmm(start), end: hhmm(end), label: `${name}, day ${d}` });
  let slot = make(day);
  while (decided.some((d) => overlaps(d, slot)) && slot.day < cal.nDays) slot = make(slot.day + 1);   // never on top of a planned slot
  return {
    action: "propose",
    slot,
    kind: kindOf(slot),
    reply: `How about ${slot.label}, ${slot.start}–${slot.end}? Reply "@WayWay ok" to confirm, or give me another time.`,
  };
};

// ---------------------------------------------------------------------------
// What: mockGenerate
// ---------------------------------------------------------------------------
const INTEREST_CATEGORY: [RegExp, Spot["category"]][] = [
  [/museum|art|galler/i, "museum"],
  [/temple|shrine|history/i, "temple"],
  [/shop|market|fashion|anime|game/i, "shopping"],
  [/nature|park|garden|hik/i, "nature"],
  [/food|eat|ramen|sushi|cafe/i, "food"],
  [/night|bar|club|karaoke/i, "nightlife"],
];

/** Is the spot open from `from` for `minutes` (handles "19:00-02:00" and "00:00-24:00")? */
function openDuring(spot: Spot, from: number, minutes: number) {
  const [o, c] = spot.openHours.split("-");
  const open = toMin(o);
  let close = toMin(c);
  if (close <= open) close += 24 * 60;
  return from >= open && from + minutes <= close;
}

export const mockGenerate: Generator = async ({ trip, slot, allowedSpots }) => {
  const meal = MEAL.test(slot.label);
  const start = toMin(slot.start);
  const length = toMin(slot.end) - start;
  const pool = allowedSpots.filter((s) =>
    (meal ? s.category === "food" : s.category !== "food" && s.category !== "hotel") &&
    s.durationMin <= length && openDuring(s, start, s.durationMin));

  // Routes: every spot alone, and pairs in the same area that fit (10 min to walk between them)
  const routes: Spot[][] = pool.map((s) => [s]);
  if (!meal) {
    for (const a of pool) for (const b of pool) {
      if (a.id >= b.id || a.area !== b.area) continue;
      const second = start + a.durationMin + 10;
      if (second + b.durationMin <= start + length && openDuring(b, second, b.durationMin)) routes.push([a, b]);
    }
  }

  const levelFor = (interests: string[], route: Spot[]): { level: SatisfactionLevel; reason: string } => {
    const liked = INTEREST_CATEGORY.filter(([re]) => interests.some((i) => re.test(i))).map(([, c]) => c);
    const hits = route.filter((s) => liked.includes(s.category)).length;
    if (!interests.length) return { level: "same", reason: "No interests known yet" };
    if (hits >= 2) return { level: "must_go", reason: "Matches several interests" };
    if (hits === 1) return { level: "want_to_go", reason: "Matches an interest" };
    return { level: "same", reason: "Not among stated interests" };
  };
  const value: Record<SatisfactionLevel, number> = { must_go: 4, want_to_go: 3, same: 2, lean_not_go: 1, definitely_no: 0 };

  const scored = routes.map((route) => {
    const scores: MemberScore[] = trip.members.map((m) => ({ memberId: m.id, source: "ai_estimate", ...levelFor(m.interests, route) }));
    return { route, scores, total: scores.reduce((n, s) => n + value[s.level], 0) };
  });
  scored.sort((a, b) => b.total - a.total || b.route.length - a.route.length);

  // Up to 4 different routes (never twice the same first stop)
  const picked: typeof scored = [];
  for (const s of scored) {
    if (picked.length === 4) break;
    if (!picked.some((p) => p.route[0].id === s.route[0].id)) picked.push(s);
  }

  return {
    candidates: picked.map(({ route, scores }) => ({
      title: route.map((s) => s.name.replace(/\s*\(.*\)$/, "")).join(", then "),
      spots: route.map((s) => s.id),
      scores,
      satisfiedMemberIds: scores.filter((s) => value[s.level] >= value.same).map((s) => s.memberId),
      explanation: route.length > 1 ? `Two stops in ${route[0].area}, a short walk apart.` : `One relaxed stop in ${route[0].area}.`,
      assumptions: ["Everyone travels together"],
    })),
    kept: [],   // nothing carried over in round 1
    reasoning: "mock: spots open during the slot, scored from the members' interests",
    attempts: 1,
    rejected: [],
  };
};
