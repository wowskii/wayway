// Automatic privacy test for location sharing (table member_locations, migration 5).
// Creates Alice and Bob in a throwaway trip and Eve outside it, runs the checks, then deletes everything.
// Not tested here: the 15-minute expiry (the database always sets the time to "now", so a script can't
// create an old row); it is the "updated_at > now() - 15 minutes" condition in the read rule.
// Run: npm run check:locations
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Fill the Supabase values in .env.local");

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, opts);
const stamp = Date.now();
const password = `Test-${stamp}-pw`;
let failures = 0;

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function makeUser(name) {
  const email = `loc-test-${name.toLowerCase()}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
  if (error) throw error;
  const client = createClient(url, anonKey, opts);
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, client };
}

const users = [];
let tripId;
try {
  const alice = await makeUser("Alice");
  const bob = await makeUser("Bob");
  const eve = await makeUser("Eve");
  users.push(alice, bob, eve);

  const { data: trip, error: tErr } = await admin.from("trips")
    .insert({ name: "Location test", city: "Tokyo", start_date: "2026-11-21", end_date: "2026-11-22", created_by: alice.id })
    .select("id, invite_code").single();
  if (tErr) throw tErr;
  tripId = trip.id;
  const { data: aliceMember } = await alice.client.rpc("join_trip", { p_invite_code: trip.invite_code });
  const { data: bobMember } = await bob.client.rpc("join_trip", { p_invite_code: trip.invite_code });

  // 1. Alice shares; the client tries to backdate the time, the database must ignore it
  const { error: shareErr } = await alice.client.from("member_locations")
    .upsert({ member_id: aliceMember, trip_id: tripId, lat: 35.7148, lng: 139.7967, updated_at: "2000-01-01T00:00:00Z" });
  check("Alice can share her own position", !shareErr, shareErr?.message);
  const { data: stored } = await admin.from("member_locations").select("updated_at").eq("member_id", aliceMember).single();
  check("the database sets the time (backdating ignored)", Date.now() - new Date(stored?.updated_at).getTime() < 60_000, stored?.updated_at);

  // 2. Sharing again (update path of the upsert) works
  const { error: again } = await alice.client.from("member_locations")
    .upsert({ member_id: aliceMember, trip_id: tripId, lat: 35.7150, lng: 139.7970 });
  check("Alice can update her position", !again, again?.message);

  // 3. Who can read it
  const bobSees = await bob.client.from("member_locations").select("member_id, lat").eq("trip_id", tripId);
  check("Bob (same trip) sees Alice's position", bobSees.data?.length === 1 && bobSees.data[0].lat === 35.715, JSON.stringify(bobSees.data));
  const eveSees = await eve.client.from("member_locations").select("member_id").eq("trip_id", tripId);
  check("Eve (other trip) sees nothing", (eveSees.data?.length ?? 0) === 0, eveSees.error?.message ?? `${eveSees.data?.length} rows`);
  const anonSees = await createClient(url, anonKey, opts).from("member_locations").select("member_id");
  check("logged-out visitor sees nothing", !!anonSees.error || anonSees.data.length === 0, anonSees.error?.message ?? `${anonSees.data.length} rows`);

  // 4. Nobody can write someone else's row
  const fake = await bob.client.from("member_locations").upsert({ member_id: aliceMember, trip_id: tripId, lat: 0, lng: 0 });
  check("Bob cannot write Alice's position", !!fake.error, fake.error?.message ?? "no error");
  await bob.client.from("member_locations").update({ lat: 1 }).eq("member_id", aliceMember);
  await bob.client.from("member_locations").delete().eq("member_id", aliceMember);
  const { data: still } = await admin.from("member_locations").select("lat").eq("member_id", aliceMember).single();
  check("Bob cannot change or delete Alice's position", still?.lat === 35.715, JSON.stringify(still));
  const wrongTrip = await bob.client.from("member_locations").insert({ member_id: bobMember, trip_id: crypto.randomUUID(), lat: 1, lng: 1 });
  check("a position can't claim another trip", !!wrongTrip.error, wrongTrip.error?.message ?? "no error");

  // 5. Turning sharing off deletes the row
  await alice.client.from("member_locations").delete().eq("member_id", aliceMember);
  const { data: gone } = await admin.from("member_locations").select("member_id").eq("member_id", aliceMember);
  check("turning sharing off deletes the position", gone?.length === 0, `${gone?.length} rows`);
} finally {
  if (tripId) await admin.from("trips").delete().eq("id", tripId);
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  console.log("Cleaned up test users and trip.");
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll location checks passed.");
process.exit(failures ? 1 : 0);
