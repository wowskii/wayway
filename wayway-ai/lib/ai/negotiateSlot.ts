// negotiateSlot: WayWay agrees on WHEN before proposing WHAT.
//
// Flow (decided by the team): when someone asks @WayWay for a plan, WayWay proposes ONE time window
// and asks the group to confirm or change it. Options are generated only once the time is agreed.
// Any member can confirm ("@WayWay ok") or change it ("@WayWay rather 15h-18h").
// Team rule: only messages mentioning @WayWay reach the model; others return "none" without any call.
//
//   no pending proposal + request       -> "propose" (slot + question)  or "confirm" if exact times were given
//   pending proposal   + agreement      -> "confirm" (the pending slot)
//   pending proposal   + other time     -> "change"  (new slot, counts as agreement)
//   pending proposal   + vague change   -> "propose" (adjusted slot + question)
//   anything unrelated                  -> "none"    (nothing to post)
//
// The LLM interprets the chat; the code checks the slot (trip days, HH:MM, duration, not in the past,
// no overlap with slots already decided) and retries once with the errors.

import type { ChatMessage, TimeSlot, Trip } from "@/contracts/contract";
import { MAX_TOKENS, MODELS, TEMPERATURE } from "./config";
import { esc, formatChat, MEAL_WORDS, mentionsWayWay, slotKind, toMin, type SlotKind } from "./context";
import { AIOutputError, callTool, type Validation } from "./llm";
import { SLOT_SYSTEM, slotUser } from "./prompts";
import { SLOT_SCHEMA } from "./schemas";

export type SlotAction = "propose" | "confirm" | "change" | "none" | "ask";

export interface SlotInput {
  trip: Trip;
  message: ChatMessage;              // the new group message
  recentChat: ChatMessage[];         // context (may include the message)
  pending?: TimeSlot;                // slot WayWay proposed and is waiting on
  decided: TimeSlot[];               // slots already decided or being decided (no overlap)
  now?: Date;                        // injectable for tests; default: current time
}

export interface SlotOutput {
  action: SlotAction;
  slot?: TimeSlot;                   // propose / confirm / change
  kind?: SlotKind;
  reply?: string;                    // group message to post (propose / ask)
}

// ---------- Time in the trip's time zone ----------
function localParts(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function tripCalendar(trip: Trip, now: Date) {
  const nDays = dayDiff(trip.startDate, trip.endDate) + 1;
  const local = localParts(now, trip.timezone);
  const today = dayDiff(trip.startDate, local.date) + 1;        // < 1 before the trip, > nDays after
  const days = Array.from({ length: nDays }, (_, i) => {
    const d = new Date(Date.parse(trip.startDate) + i * 86_400_000);
    const weekday = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    return `Day ${i + 1} = ${d.toISOString().slice(0, 10)} (${weekday})`;
  });
  return { nDays, today, nowTime: local.time, localDate: local.date, days };
}

// ---------- Validation ----------
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

function checkSlot(raw: any, trip: Trip, cal: ReturnType<typeof tripCalendar>, decided: TimeSlot[]): string[] {
  const s = raw?.slot;
  const e: string[] = [];
  if (!s || typeof s !== "object") return ["slot is required for this action."];
  if (!Number.isInteger(s.day) || s.day < 1 || s.day > cal.nDays) e.push(`slot.day must be between 1 and ${cal.nDays}.`);
  if (!HHMM.test(s.start ?? "") || !HHMM.test(s.end ?? "")) e.push("slot.start and slot.end must be HH:MM (24h).");
  if (typeof s.label !== "string" || !s.label.trim() || s.label.length > 40) e.push("slot.label must be a short English label, e.g. \"Lunch, day 2\".");
  if (raw?.kind !== "meal" && raw?.kind !== "activity") e.push('kind must be "meal" or "activity".');
  if (e.length) return e;

  const start = toMin(s.start);
  const end = toMin(s.end);
  if (end <= start) e.push("slot.end must be after slot.start (same day).");
  else if (end - start < 30 || end - start > 600) e.push("A slot lasts between 30 minutes and 10 hours.");
  if (raw.kind === "meal" && !MEAL_WORDS.test(s.label)) e.push('A meal slot label must name the meal, e.g. "Lunch, day 2".');
  if (raw.kind === "activity" && MEAL_WORDS.test(s.label)) e.push('An activity slot label must not name a meal; use kind "meal" instead.');
  if (cal.today >= 1 && cal.today <= cal.nDays) {
    if (s.day < cal.today || (s.day === cal.today && start < toMin(cal.nowTime) - 5)) {
      e.push(`This time is already past (now: day ${cal.today}, ${cal.nowTime}).`);
    }
  }
  for (const d of decided) {
    if (d.day === s.day && start < toMin(d.end) && toMin(d.start) < end) {
      e.push(`Overlaps "${d.label}" (${d.start}-${d.end}), already planned. Choose another time.`);
    }
  }
  return e;
}

// ---------- Main ----------
export async function negotiateSlot(input: SlotInput): Promise<SlotOutput> {
  const { trip, message, recentChat, pending, decided } = input;
  if (!mentionsWayWay(message.text)) return { action: "none" };   // no @WayWay: no model call
  const cal = tripCalendar(trip, input.now ?? new Date());
  const sender = trip.members.find((m) => m.id === message.senderId)?.name ?? "Someone";

  const validate = (raw: any): Validation<SlotOutput> => {
    const errors: string[] = [];
    const action = raw?.action;
    if (!["propose", "confirm", "change", "none"].includes(action)) {
      return { ok: false, errors: ['action must be "propose", "confirm", "change" or "none".'] };
    }
    if (action === "change" && !pending) errors.push('"change" needs a pending proposal: use "propose" or "confirm".');
    // "confirm" of the pending proposal: the code reuses the pending slot, the model's slot is ignored.
    const usesModelSlot = action === "propose" || action === "change" || (action === "confirm" && !pending);
    if (usesModelSlot) errors.push(...checkSlot(raw, trip, cal, decided));
    if (action === "propose" && (typeof raw?.reply !== "string" || !raw.reply.trim())) {
      errors.push("propose needs a reply that states the time and asks the group to confirm or change it.");
    } else if (typeof raw?.reply === "string" && raw.reply.length > 300) errors.push("reply is too long: 1-2 short sentences.");
    if (errors.length) return { ok: false, errors };

    if (action === "none") return { ok: true, value: { action } };
    if (action === "confirm" && pending) return { ok: true, value: { action, slot: pending, kind: slotKind(pending) } };
    const slot: TimeSlot = { day: raw.slot.day, start: raw.slot.start, end: raw.slot.end, label: raw.slot.label.trim() };
    return { ok: true, value: { action, slot, kind: raw.kind, ...(action === "propose" ? { reply: raw.reply.trim() } : {}) } };
  };

  try {
    const res = await callTool<SlotOutput>({
      model: MODELS.fast,
      temperature: TEMPERATURE.extract,
      maxTokens: MAX_TOKENS.slot,
      system: SLOT_SYSTEM,
      user: slotUser({
        trip: `name="${esc(trip.name)}" city="${esc(trip.city)}" timezone="${esc(trip.timezone)}"`,
        days: cal.days.join("\n"),
        now: cal.today < 1
          ? `${cal.localDate} ${cal.nowTime}: before the trip (day 1 is in ${1 - cal.today} day(s))`
          : cal.today > cal.nDays
            ? `${cal.localDate} ${cal.nowTime}: after the trip`
            : `${cal.localDate} ${cal.nowTime}: day ${cal.today} of the trip`,
        decided: decided.map((d) => `- ${esc(d.label)}: day ${d.day}, ${d.start}-${d.end}`).join("\n"),
        pending: pending ? `${esc(pending.label)}: day ${pending.day}, ${pending.start}-${pending.end}` : "",
        chat: formatChat(recentChat.filter((c) => c.id !== message.id), trip),
        message: `${esc(sender)}: ${esc(message.text)}`,
      }),
      tool: { name: "handle_time", description: "Propose, confirm or change the time window, or do nothing.", schema: SLOT_SCHEMA },
      validate,
    });
    return res.value;
  } catch (e) {
    if (!(e instanceof AIOutputError)) throw e;   // only our own programming errors get through
    console.warn(`[negotiateSlot] fallback (${e.kind}):`, e.errors);
    // Fallback: never guess a time. With a pending proposal, do nothing; otherwise ask for the time.
    if (pending) return { action: "none" };
    return { action: "ask", reply: "What time should I plan this for? For example 14:00-17:30, or tell me the meal." };
  }
}
