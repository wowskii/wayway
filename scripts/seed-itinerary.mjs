// Puts a demo itinerary (2 days, one group split) into a trip, so the map page has something real to
// show before the full vote flow writes itineraries. Uses fixtures/example_itinerary.json as the template.
//
// The fixture's 4 fake people are replaced by the trip's REAL members: in the order they joined, they
// alternate between the two groups of the split (1st -> group A, 2nd -> group B, 3rd -> group A...).
// Run it again after people join, to include them.
//
// Seeded stops look DECIDED: the map and the chat's itinerary panel only show stops written by a group
// decision (they carry an option_set_id). So each time slot gets a "decided" option set, like a vote
// would leave it, and its stops point to it. WayWay then also sees these slots as already planned.
// How seeded sets are told apart from real ones: they have NO options (options = []); a real decision
// always keeps the options that were voted on.
//
// Safety:
//   - Re-running only replaces seeded sets (and their stops) + rows from older seeds with no option set.
//   - Refuses a trip that already has a real (voted) itinerary.
//   - Needs at least 2 members (a split needs 2 groups).
//
// Run: npm run seed:itinerary                (demo trip, invite code tokyo26)
//      npm run seed:itinerary -- <inviteCode>
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Fill NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
const admin = createClient(url, key, { auth: { persistSession: false } });

const inviteCode = process.argv[2] ?? "tokyo26";
const fixture = JSON.parse(readFileSync("fixtures/example_itinerary.json", "utf8"));
const spots = JSON.parse(readFileSync("data/spots_tokyo.json", "utf8"));

const { data: trip, error: tErr } = await admin.from("trips").select("id, name").eq("invite_code", inviteCode).maybeSingle();
if (tErr) throw tErr;
if (!trip) throw new Error(`No trip with invite code "${inviteCode}" (run npm run seed first for tokyo26).`);

// Decided sets of the trip: seeded ones (no options) are ours to replace; real ones stop the script.
const { data: decidedSets, error: rErr } = await admin
  .from("option_sets").select("id, options").eq("trip_id", trip.id).eq("status", "decided");
if (rErr) throw rErr;
const seededSetIds = decidedSets.filter((s) => !s.options?.length).map((s) => s.id);
const realSetIds = decidedSets.filter((s) => s.options?.length).map((s) => s.id);
if (realSetIds.length) {
  const { count: realRows, error: cErr } = await admin
    .from("itinerary_items").select("id", { count: "exact", head: true }).in("option_set_id", realSetIds);
  if (cErr) throw cErr;
  if (realRows) throw new Error(`"${trip.name}" already has a real itinerary (${realRows} decided items): not seeding.`);
}

const { data: members, error: mErr } = await admin
  .from("trip_members").select("id, name").eq("trip_id", trip.id).order("joined_at");
if (mErr) throw mErr;
if (members.length < 2) throw new Error(`"${trip.name}" has ${members.length} member(s): join with at least 2 accounts first.`);

// Groups for the split: alternate in join order.
const groups = [members.filter((_, i) => i % 2 === 0), members.filter((_, i) => i % 2 === 1)];

// Time slots = one per item, except that a split and its meeting point (the item right after it) are one
// slot, like a real split option. Labels follow the contract's rule: a meal label names the meal, an
// activity label never does.
const slots = [];
for (const item of fixture.items) {
  const prev = slots.at(-1);
  if (prev && prev.items[0].branches && prev.items.length === 1 && item.day === prev.day) prev.items.push(item);
  else slots.push({ day: item.day, items: [item] });
}
const label = (slot) => {
  const first = slot.items[0];
  const food = first.spotId && spots[first.spotId].category === "food";
  if (food) return `${first.start < "15:00" ? "Lunch" : "Dinner"}, day ${slot.day}`;
  const part = first.start < "12:00" ? "Morning" : first.start < "17:00" ? "Afternoon" : "Evening";
  return `${part}, day ${slot.day}`;
};

// Remove the previous seed: its sets (their stops lose the link: "on delete set null"), then every stop
// without a set (those + rows from older versions of this script).
if (seededSetIds.length) {
  const { error } = await admin.from("option_sets").delete().in("id", seededSetIds);
  if (error) throw error;
}
const { error: dErr } = await admin.from("itinerary_items").delete().eq("trip_id", trip.id).is("option_set_id", null);
if (dErr) throw dErr;

const now = new Date().toISOString();
const { data: sets, error: sErr } = await admin.from("option_sets").insert(slots.map((slot) => ({
  trip_id: trip.id,
  slot: { day: slot.day, start: slot.items[0].start, end: slot.items.at(-1).end, label: label(slot) },
  options: [],                           // = seeded (see the top of the file)
  candidate_option_id: "A",
  chosen_option_id: "A",
  status: "decided",
  voter_ids: members.map((m) => m.id),
  round_deadline: now,
}))).select("id");
if (sErr) throw sErr;
const setOf = new Map(slots.flatMap((slot, i) => slot.items.map((item) => [item, sets[i].id])));

const rows = fixture.items.map((item) => {
  for (const id of [item.spotId, ...(item.branches ?? []).flatMap((b) => b.spots)].filter(Boolean)) {
    if (!spots[id]) throw new Error(`Fixture uses unknown spot "${id}"`);
  }
  return {
    trip_id: trip.id,
    option_set_id: setOf.get(item),      // the seeded "decided" set of its time slot
    day: item.day,
    start_time: item.start,
    end_time: item.end,
    spot_id: item.spotId ?? null,
    branches: item.branches
      ? item.branches.map((b, i) => ({ memberIds: groups[i % 2].map((m) => m.id), spots: b.spots }))
      : null,
  };
});

const { error: iErr } = await admin.from("itinerary_items").insert(rows);
if (iErr) throw iErr;

console.log(`Seeded ${rows.length} itinerary items in ${slots.length} decided slots into "${trip.name}" (${trip.id}).`);
console.log(`Split groups: A = ${groups[0].map((m) => m.name).join(", ")} | B = ${groups[1].map((m) => m.name).join(", ")}`);
console.log(`Map: http://localhost:3000/trips/${trip.id}/map`);
