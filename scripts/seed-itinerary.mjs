// Puts a demo itinerary (2 days, one group split) into a trip, so the map page has something real to
// show before the full vote flow writes itineraries. Uses fixtures/example_itinerary.json as the template.
//
// The fixture's 4 fake people are replaced by the trip's REAL members: in the order they joined, they
// alternate between the two groups of the split (1st -> group A, 2nd -> group B, 3rd -> group A...).
// Run it again after people join, to include them.
//
// Safety:
//   - Real itinerary rows (written by a decision) have an option_set_id. This script only deletes rows
//     WITHOUT one (earlier seeds), and refuses to touch a trip that already has a real itinerary.
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

const { count: realRows, error: rErr } = await admin
  .from("itinerary_items").select("id", { count: "exact", head: true })
  .eq("trip_id", trip.id).not("option_set_id", "is", null);
if (rErr) throw rErr;
if (realRows) throw new Error(`"${trip.name}" already has a real itinerary (${realRows} decided items): not seeding.`);

const { data: members, error: mErr } = await admin
  .from("trip_members").select("id, name").eq("trip_id", trip.id).order("joined_at");
if (mErr) throw mErr;
if (members.length < 2) throw new Error(`"${trip.name}" has ${members.length} member(s): join with at least 2 accounts first.`);

// Groups for the split: alternate in join order.
const groups = [members.filter((_, i) => i % 2 === 0), members.filter((_, i) => i % 2 === 1)];

const rows = fixture.items.map((item) => {
  for (const id of [item.spotId, ...(item.branches ?? []).flatMap((b) => b.spots)].filter(Boolean)) {
    if (!spots[id]) throw new Error(`Fixture uses unknown spot "${id}"`);
  }
  return {
    trip_id: trip.id,
    option_set_id: null,                 // = seeded, not decided by a vote
    day: item.day,
    start_time: item.start,
    end_time: item.end,
    spot_id: item.spotId ?? null,
    branches: item.branches
      ? item.branches.map((b, i) => ({ memberIds: groups[i % 2].map((m) => m.id), spots: b.spots }))
      : null,
  };
});

const { error: dErr } = await admin.from("itinerary_items").delete().eq("trip_id", trip.id).is("option_set_id", null);
if (dErr) throw dErr;
const { error: iErr } = await admin.from("itinerary_items").insert(rows);
if (iErr) throw iErr;

console.log(`Seeded ${rows.length} itinerary items into "${trip.name}" (${trip.id}).`);
console.log(`Split groups: A = ${groups[0].map((m) => m.name).join(", ")} | B = ${groups[1].map((m) => m.name).join(", ")}`);
console.log(`Map: http://localhost:3000/trips/${trip.id}/map`);
