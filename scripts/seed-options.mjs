// LOCAL ONLY: puts three option sets "in progress" in the demo trip (invite code tokyo26), so the
// Spot Suggestions panel has something to show before /api/chat creates real ones.
//   1. Afternoon, day 1 — round 1, options A / B / C (C = split)
//   2. Dinner, day 1    — round 3, options A / B
//   3. Lunch, day 2     — round 2, options A / B
// Time left: with the mock AI (WAYWAY_AI_MODE unset or "mock") rounds last 30 s, so the sets end after
// 30 s (lunch), 60 s (afternoon) and 90 s (dinner) and you can watch them move on; with the real AI
// they end after 9, 25 and 40 min.
// Run: npm run local:seed:options   (again = reset: the demo trip's undecided sets, the private
// messages about them and WayWay's group messages about them are replaced)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Fill NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.development.local)");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
  throw new Error(`Refusing to seed sample option sets into ${url}: this script is for the LOCAL database only.`);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const { data: trip, error: e1 } = await admin.from("trips").select("id, name").eq("invite_code", "tokyo26").maybeSingle();
if (e1) throw e1;
if (!trip) throw new Error("Demo trip not found: run npm run local:seed first, then join it at /join/tokyo26.");
const { data: members, error: e2 } = await admin.from("trip_members").select("id, name, diet").eq("trip_id", trip.id).order("joined_at");
if (e2) throw e2;
if (members.length < 2) throw new Error("The demo trip needs at least 2 members (join /join/tokyo26 with two accounts).");

// Reset: remove the demo trip's undecided sets and the private messages about them
const { data: old } = await admin.from("option_sets").select("id").eq("trip_id", trip.id).in("status", ["collecting_feedback", "voting"]);
const oldIds = (old ?? []).map((r) => r.id);
if (oldIds.length) {
  await admin.from("private_messages").delete().in("option_set_id", oldIds);
  await admin.from("chat_messages").delete().in("option_set_id", oldIds).is("sender_member_id", null);   // WayWay's round messages
  await admin.from("option_sets").delete().in("id", oldIds);
}

const ids = members.map((m) => m.id);

// Meals must fit EVERY member's diet (like real options: Henry's code drops the others).
// Keep the preferred spot when it fits, otherwise take the next food spot that does.
const SPOTS = JSON.parse(readFileSync(new URL("../data/spots_tokyo.json", import.meta.url), "utf8"));
const diets = [...new Set(members.flatMap((m) => m.diet ?? []))];
const fits = (id) => diets.every((d) => SPOTS[id]?.dietTags?.includes(d));
const foodFits = Object.keys(SPOTS).filter((id) => SPOTS[id].category === "food" && fits(id));
// Two different places per meal (A and B); lunch and dinner may reuse the same place.
const mealPair = (preferredA, preferredB) => {
  const pick = (preferred, not) =>
    fits(preferred) && preferred !== not ? preferred : foodFits.find((f) => f !== not) ?? preferred;
  const a = pick(preferredA);
  const b = pick(preferredB, a);
  return [a, b].map((id) => ({ id, name: SPOTS[id].name, area: SPOTS[id].area }));
};
const [lunchA, lunchB] = mealPair("ichiran_shibuya", "afuri_harajuku");
const [dinnerA, dinnerB] = mealPair("daikokuya", "uobei_shibuya");
if (diets.length) console.log(`Members' diets: ${diets.join(", ")} -> meals: ${[lunchA, lunchB, dinnerA, dinnerB].map((m) => m.id).join(", ")}`);
const [first, ...rest] = ids;
const mock = (process.env.WAYWAY_AI_MODE ?? "mock") === "mock";
// [mock seconds, real minutes] -> ISO deadline
const endsIn = (mockSec, realMin) => new Date(Date.now() + (mock ? mockSec * 1000 : realMin * 60_000)).toISOString();
// Sample AI estimates (one per member, as the contract requires). Never shown on the cards.
const scores = (levels, reason) => ids.map((id, i) => ({ memberId: id, level: levels[i % levels.length], source: "ai_estimate", reason }));
const satisfied = (s) => s.filter((x) => ["must_go", "want_to_go", "same"].includes(x.level)).map((x) => x.memberId);
const option = (o) => ({ ...o, satisfiedMemberIds: satisfied(o.scores) });

const afternoon = [
  option({
    id: "A", kind: "best_total", title: "Ueno museum and park", spots: ["tnm", "ueno_park"],
    scores: scores(["must_go", "lean_not_go", "want_to_go"], "Museum-heavy afternoon"),
    explanation: "Mostly museum time, with a walk in the park at the end; no shopping.",
    assumptions: ["Both spots are in Ueno, on foot"],
  }),
  option({
    id: "B", kind: "fairest", title: "Art museum, then Ameyoko market", spots: ["nmwa", "ameyoko"],
    scores: scores(["want_to_go", "same", "want_to_go"], "A bit of art and a bit of shopping"),
    explanation: "A shorter museum visit, so there is time to stroll the market after.",
    assumptions: ["Both spots are in Ueno, on foot"],
  }),
  option({
    id: "C", kind: "split", title: "Museum and Shibuya, meet at Ameyoko", spots: [],
    branches: [{ memberIds: [first], spots: ["tnm", "ueno_park"] }, { memberIds: rest, spots: ["shibuya_shopping"] }],
    rendezvous: { spotId: "ameyoko", time: "17:00" },
    scores: scores(["must_go", "must_go", "want_to_go"], "Everyone does what they asked for"),
    explanation: "Everyone gets their first choice, but the group is apart for most of the afternoon.",
    assumptions: ["About 40 min by train from Shibuya to Ueno"],
  }),
];

const lunch = [
  option({
    id: "A", kind: "best_total", title: `Lunch at ${lunchA.name}`, spots: [lunchA.id],
    scores: scores(["want_to_go", "same"], "Fast and cheap"),
    explanation: `Quick lunch in ${lunchA.area}, close to the afternoon plans.`,
    assumptions: ["Short queue at noon"],
  }),
  option({
    id: "B", kind: "fairest", title: `Lunch at ${lunchB.name}`, spots: [lunchB.id],
    scores: scores(["same", "want_to_go"], "Lighter lunch"),
    explanation: `A lighter lunch in ${lunchB.area}.`,
    assumptions: ["Table for the whole group"],
  }),
];

const dinner = [
  option({
    id: "A", kind: "best_total", title: `Dinner at ${dinnerA.name}`, spots: [dinnerA.id],
    scores: scores(["want_to_go", "want_to_go"], "Sit-down dinner"),
    explanation: `A sit-down dinner in ${dinnerA.area}.`,
    assumptions: ["About 20 min by train from Ueno"],
  }),
  option({
    id: "B", kind: "fairest", title: `Dinner at ${dinnerB.name}`, spots: [dinnerB.id],
    scores: scores(["same", "must_go"], "Quick and casual"),
    explanation: `Quicker and more casual, in ${dinnerB.area}.`,
    assumptions: ["Short wait after 18:30"],
  }),
];

const rows = [
  { trip_id: trip.id, slot: { day: 1, start: "14:00", end: "17:30", label: "Afternoon, day 1" }, round: 1,
    options: afternoon, candidate_option_id: "B", status: "collecting_feedback", round_deadline: endsIn(60, 25) },
  { trip_id: trip.id, slot: { day: 1, start: "18:30", end: "20:00", label: "Dinner, day 1" }, round: 3,
    options: dinner, candidate_option_id: "A", status: "collecting_feedback", round_deadline: endsIn(90, 40) },
  { trip_id: trip.id, slot: { day: 2, start: "12:00", end: "13:30", label: "Lunch, day 2" }, round: 2,
    options: lunch, candidate_option_id: "B", status: "collecting_feedback", round_deadline: endsIn(30, 9) },
];
const { error: e3 } = await admin.from("option_sets").insert(rows);
if (e3) throw e3;

console.log(`${rows.length} option sets in progress for "${trip.name}" (${members.map((m) => m.name).join(", ")}).`);
console.log(mock ? "Mock AI: rounds last 30 s (lunch ends in 30 s, afternoon in 60 s, dinner in 90 s)." : "Real AI: rounds last 30 min.");
console.log(`Open http://localhost:3000/trips/${trip.id}?panel=suggestions`);
