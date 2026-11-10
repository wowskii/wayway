// Context engineering: select and format only what the model needs.

import type { ChatMessage, MemberProfile, Option, SatisfactionLevel, Spot, TimeSlot, Trip, Vote } from "@/contracts/contract";
import { LEVEL_VALUE, SETTINGS } from "@/contracts/contract";
import { LIMITS } from "./config";

// ---------- Escaping ----------
// User-written text is inserted inside XML tags: escape it so a name like `Tom"` or a note
// containing `</private_note>` cannot break the prompt structure (prompt-injection hygiene).
export const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- Mentions ----------
// Team rule: members talk to WayWay in the group chat ONLY with "@WayWay". A message without it
// never reaches the model (no cost, no surprise interventions). Case-insensitive.
export const mentionsWayWay = (text: string) => /(^|[^\w@])@wayway\b/i.test(text);

// ---------- Satisfaction ----------
// "Satisfied" = SETTINGS.satisfiedLevel or better, derived from the contract (single source).
export const isSatisfied = (level: SatisfactionLevel) =>
  LEVEL_VALUE[level] >= LEVEL_VALUE[SETTINGS.satisfiedLevel];

// ---------- Private preference statements ----------
// Statements extracted from a private chat can be sensitive (money, health, personal situation).
// Convention (contract stays string[]): sensitive ones are stored with this prefix.
// They are given to the model in <private_preferences> and protected by findLeaks, like privateNote.
export const PRIVATE_PREFIX = "[private] ";
export const isPrivateStatement = (s: string) => s.startsWith(PRIVATE_PREFIX);
export const stripPrivate = (s: string) => (isPrivateStatement(s) ? s.slice(PRIVATE_PREFIX.length) : s);
export const storeStatement = (text: string, isPrivate: boolean) =>
  (isPrivate ? PRIVATE_PREFIX : "") + stripPrivate(text.trim());

// ---------- Member aliases ----------
// The model sees short ids (m1, m2...) instead of long uuids: fewer copy errors.
export interface Aliases {
  toAlias: Map<string, string>;   // uuid -> m1
  toId: Map<string, string>;      // m1 -> uuid
}

export function buildAliases(members: MemberProfile[]): Aliases {
  const toAlias = new Map<string, string>();
  const toId = new Map<string, string>();
  members.forEach((m, i) => {
    toAlias.set(m.id, `m${i + 1}`);
    toId.set(`m${i + 1}`, m.id);
  });
  return { toAlias, toId };
}

// ---------- Time helpers ----------
export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const hhmm = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const slotMinutes = (slot: TimeSlot) => toMin(slot.end) - toMin(slot.start);

// Opening window in minutes; a window crossing midnight ("18:00-02:00") ends after 1440.
export function openWindow(spot: Spot): [number, number] {
  const [open, close] = spot.openHours.split("-").map(toMin);
  return [open, close <= open ? close + 1440 : close];
}

// True if the spot is open for the whole visit [start, end] (minutes since midnight).
export function isOpenDuring(spot: Spot, start: number, end: number): boolean {
  const [open, close] = openWindow(spot);
  return (start >= open && end <= close) || (start + 1440 >= open && end + 1440 <= close);
}

// ---------- Slot kind ----------
// The contract's TimeSlot has no kind field: the kind is carried by the label. negotiateSlot decides
// the kind with the group and the code guarantees that meal labels name the meal ("Lunch, day 2")
// and activity labels never do. No fixed time windows.
export type SlotKind = "meal" | "activity";
export const MEAL_WORDS = /\b(breakfast|brunch|lunch|dinner|supper|meal|d[ée]jeuner|d[îi]ner|repas|petit[- ]d[ée]j)/i;
export function slotKind(slot: TimeSlot): SlotKind {
  return MEAL_WORDS.test(slot.label) ? "meal" : "activity";
}

// ---------- Travel time ----------
// Rough public-transport estimate, computed by code (the model only sees the rule):
// same area: 10 min; otherwise 10 min + 3 min per km (straight line), rounded up to 5 min.
export function travelMin(a: Spot, b: Spot): number {
  if (a.id === b.id) return 0;
  if (a.area === b.area) return 10;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  const km = 2 * 6371 * Math.asin(Math.sqrt(h));
  return Math.ceil((10 + 3 * km) / 5) * 5;
}

// ---------- Context selection ----------
// Keep spots that fit in the slot, can be visited at some point inside it, and match the slot kind
// (meal slot: food only; activity slot: no food). Hard constraints are filtered BEFORE this by
// role 4's filterHardConstraints.
export function selectSpots(allowed: Spot[], slot: TimeSlot): Spot[] {
  const s = toMin(slot.start);
  const e = toMin(slot.end);
  const meal = slotKind(slot) === "meal";
  return allowed.filter((spot) => {
    if ((spot.category === "food") !== meal) return false;
    const d = Math.min(spot.durationMin, e - s);
    if (spot.durationMin > e - s + LIMITS.slotSlackMin) return false;
    // Try every start time in the slot (15 min steps): is there one where the spot is open?
    for (let t = s; t + d <= e; t += 15) if (isOpenDuring(spot, t, t + d)) return true;
    return false;
  });
}

// ---------- Formatting ----------
// Public: diet (the team decided diets can be mentioned to the group).
// Private: allergies and budget, private statements, private note.
export function formatMembers(trip: Trip, a: Aliases, includePrivate: boolean): string {
  return trip.members
    .map((m) => {
      const recent = m.preferenceStatements.slice(-LIMITS.maxStatementsPerMember);
      const pub = recent.filter((s) => !isPrivateStatement(s));
      const priv = recent.filter(isPrivateStatement).map(stripPrivate);
      const lines = [
        `<member id="${a.toAlias.get(m.id)}" name="${esc(m.name)}">`,
        `  pace: ${esc(m.pace)}; sleep: ${esc(m.sleep)}; diet: ${esc(m.hard.diet.join(", ")) || "none"}; interests: ${esc(m.interests.join(", ")) || "unknown"}`,
        `  preferences: ${esc(pub.join(" | ")) || "none yet"}`,
      ];
      if (includePrivate) {
        const constraints = [
          m.hard.allergies.length ? `allergies: ${m.hard.allergies.join(", ")}` : "",
          m.hard.maxBudget ? `max budget for the whole trip: ${m.hard.maxBudget} JPY` : "",
        ].filter(Boolean).join("; ");
        if (constraints) lines.push(`  <private_constraints>${esc(constraints)}</private_constraints>`);
        if (priv.length) lines.push(`  <private_preferences>${esc(priv.join(" | "))}</private_preferences>`);
        if (m.privateNote) lines.push(`  <private_note>${esc(m.privateNote)}</private_note>`);
      }
      lines.push(`</member>`);
      return lines.join("\n");
    })
    .join("\n");
}

export function formatSpots(spots: Spot[]): string {
  return spots
    .map((s) =>
      `- ${s.id}: ${esc(s.name)} (${esc(s.category)}, ${esc(s.area)}) | ${s.price} JPY | ${s.durationMin} min | open ${s.openHours}` +
      (s.dietTags.length ? ` | diet: ${esc(s.dietTags.join(", "))}` : ""))
    .join("\n");
}

export function formatChat(chat: ChatMessage[], trip: Trip): string {
  const names = new Map(trip.members.map((m) => [m.id, m.name]));
  return chat
    .slice(-LIMITS.recentChatMessages)
    .map((c) => `${c.senderId === "wayway" ? "WayWay" : esc(names.get(c.senderId) ?? "Someone")}: ${esc(c.text)}`)
    .join("\n");
}

export function formatOptions(options: Option[], a: Aliases): string {
  return options
    .map((o) => {
      const where = o.branches
        ? o.branches.map((b) => `[${b.memberIds.map((id) => a.toAlias.get(id)).join(",")}: ${b.spots.join(" > ")}]`).join(" + ") +
          (o.rendezvous ? ` then meet at ${o.rendezvous.spotId} ${o.rendezvous.time}` : "")
        : o.spots.join(" > ");
      return `Option ${o.id} (${o.kind}): ${esc(o.title)} | ${where}`;
    })
    .join("\n");
}

// Private reaction of one member to one option (PreferenceUpdate.reactions, with the member).
export interface MemberReaction {
  memberId: string;
  optionId: "A" | "B" | "C";
  level: SatisfactionLevel;
  reason: string;
}

// For each option and member: the AI's earlier estimate next to the member's real private reaction.
// This is the per-member evaluation step of Papachristou et al.: the model recalibrates its estimates.
export function formatEstimatesVsReactions(options: Option[], reactions: MemberReaction[], a: Aliases): string {
  return options
    .map((o) => {
      const rows = o.scores.map((s) => {
        const r = reactions.find((x) => x.memberId === s.memberId && x.optionId === o.id);
        const real = r ? `${r.level} (${esc(r.reason)})` : "no reaction";
        return `  ${a.toAlias.get(s.memberId)}: you estimated ${s.level} -> member said ${real}`;
      });
      return `Option ${o.id}:\n${rows.join("\n")}`;
    })
    .join("\n");
}

export function formatCritiques(votes: Vote[], a: Aliases): string {
  return votes
    .filter((v) => v.critique)
    .map((v) => `${a.toAlias.get(v.memberId)} on option ${v.optionId}: ${esc(v.critique)}`)
    .join("\n") || "none";
}

// ---------- Privacy ----------
// Private words = distinctive words (>= 5 letters) and numbers (>= 3 digits) from private sources
// (notes, private statements, allergies, budget, critiques, reaction reasons),
// MINUS common words and the public vocabulary (spot names, areas, categories, member names,
// diets, public statements). Matching is on whole words, so "cheap" does not flag "cheaper"
// and a critique saying "museum" does not block every museum option.
const COMMON = new Set([
  "about", "after", "again", "being", "could", "doesn", "don't", "every", "group", "other", "please",
  "really", "should", "there", "their", "these", "thing", "think", "those", "would", "month", "today",
  "anyone", "people", "prefers", "prefer", "likes", "loves", "wants", "dislikes", "enjoys", "avoids",
  "avoid", "activities", "activity", "places", "place", "tomorrow", "morning", "evening", "afternoon",
  "during", "slightly", "mostly", "rather", "maybe", "enough", "doesn't", "can't", "cannot",
  "where", "which", "while", "something", "anything", "everything", "always", "never", "little",
  "option", "options", "great", "nice", "fine", "better", "worse", "maybe", "first", "later",
]);

const words = (text: string) =>
  text.toLowerCase().replace(/(\d)[ ,.](?=\d{3}\b)/g, "$1").match(/[a-zà-ÿ'’]+|\d+/g) ?? [];
const distinctive = (text: string) =>
  words(text).filter((w) => (/^\d+$/.test(w) ? w.length >= 3 : w.length >= 5) && !COMMON.has(w));

export interface PrivacyExtras {
  critiques?: string[];       // vote critiques (treated as private)
  reactionReasons?: string[]; // private reaction reasons
}

export function privateTokens(trip: Trip, spots: Spot[] = [], extras: PrivacyExtras = {}): Map<string, string[]> {
  const publicWords = new Set(words([
    ...spots.flatMap((s) => [s.name, s.area, s.category, ...s.dietTags]),
    ...trip.members.flatMap((m) => [m.name, ...m.hard.diet, ...m.interests,
      ...m.preferenceStatements.filter((s) => !isPrivateStatement(s))]),
  ].join(" ")));
  const out = new Map<string, string[]>();
  for (const m of trip.members) {
    const sources = [
      m.privateNote,
      ...m.preferenceStatements.filter(isPrivateStatement).map(stripPrivate),
      ...m.hard.allergies,
      m.hard.maxBudget ? String(m.hard.maxBudget) : "",
    ];
    out.set(m.id, [...new Set(sources.flatMap(distinctive).filter((w) => !publicWords.has(w)))]);
  }
  const shared = [...(extras.critiques ?? []), ...(extras.reactionReasons ?? [])]
    .flatMap(distinctive).filter((w) => !publicWords.has(w));
  if (shared.length) out.set("_shared", [...new Set(shared)]);
  return out;
}

// Returns the private words found (as whole words) in a text meant for the group.
export function findLeaks(text: string, tokens: Map<string, string[]>): string[] {
  const present = new Set(words(text));
  const found: string[] = [];
  for (const list of tokens.values()) for (const w of list) if (present.has(w)) found.push(w);
  return [...new Set(found)];
}
