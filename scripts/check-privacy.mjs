// Automatic privacy test: proves the database rules (RLS) hide one member's private data from another.
// Creates 2 throwaway users (Alice, Bob) in a throwaway trip, runs the checks, then deletes everything.
// Run: npm run check:privacy
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
  const email = `privacy-test-${name.toLowerCase()}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: name },
  });
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
  const eve = await makeUser("Eve");          // not in the trip
  users.push(alice, bob, eve);

  // Alice creates a trip (as herself), both join with the invite code
  const { data: trip, error: tErr } = await alice.client
    .from("trips")
    .insert({ name: "Privacy test", city: "Tokyo", start_date: "2026-11-21", end_date: "2026-11-22" })
    .select("id, invite_code")
    .single();
  if (tErr) throw tErr;
  tripId = trip.id;

  const { data: aliceMember, error: jA } = await alice.client.rpc("join_trip", { p_invite_code: trip.invite_code });
  const { data: bobMember, error: jB } = await bob.client.rpc("join_trip", { p_invite_code: trip.invite_code });
  if (jA || jB) throw jA || jB;
  check("profile created from sign-up name", (await alice.client.from("profiles").select("display_name").single()).data?.display_name === "Alice");

  // Alice writes private data
  await admin.from("member_private").update({ allergies: ["peanuts"], max_budget: 30000 }).eq("member_id", aliceMember);
  const { error: pmErr } = await alice.client.from("private_messages").insert({
    trip_id: tripId, member_id: aliceMember, sender: "member", text: "I'm allergic to peanuts", round: 0,
  });
  check("Alice can send her own private message", !pmErr, pmErr?.message);

  // --- What Alice sees
  const aPriv = await alice.client.from("member_private").select("allergies").eq("member_id", aliceMember);
  check("Alice reads her own private data", aPriv.data?.length === 1 && aPriv.data[0].allergies[0] === "peanuts");

  // --- What Bob sees
  const bMembers = await bob.client.from("trip_members").select("id, name").eq("trip_id", tripId);
  check("Bob sees both members' public profiles", bMembers.data?.length === 2);
  const bPriv = await bob.client.from("member_private").select("*").eq("member_id", aliceMember);
  check("Bob CANNOT read Alice's private data", (bPriv.data?.length ?? 0) === 0);
  const bPm = await bob.client.from("private_messages").select("*").eq("member_id", aliceMember);
  check("Bob CANNOT read Alice's private chat", (bPm.data?.length ?? 0) === 0);
  const bFake = await bob.client.from("private_messages").insert({
    trip_id: tripId, member_id: aliceMember, sender: "member", text: "spoof",
  });
  check("Bob CANNOT write in Alice's private chat", !!bFake.error);
  const bState = await bob.client.from("member_state").select("*");
  check("Bob CANNOT read fairness credits (server only)", !!bState.error || (bState.data?.length ?? 0) === 0);
  const aState = await alice.client.from("member_state").select("*");
  check("Alice CANNOT read even her own credits", !!aState.error || (aState.data?.length ?? 0) === 0);
  const bWayway = await bob.client.from("private_messages").insert({
    trip_id: tripId, member_id: bobMember, sender: "wayway", text: "fake WayWay reply",
  });
  check("Bob CANNOT pretend to be WayWay", !!bWayway.error);
  const bHack = await bob.client.from("trip_members").update({ trip_id: tripId, user_id: alice.id }).eq("id", bobMember);
  check("Bob CANNOT move his membership to another user", !!bHack.error);

  // --- Group chat
  const bChat = await bob.client.from("chat_messages").insert({ trip_id: tripId, sender_member_id: bobMember, text: "hi all" });
  check("Bob can post in the group chat as himself", !bChat.error, bChat.error?.message);
  const bChatSpoof = await bob.client.from("chat_messages").insert({ trip_id: tripId, sender_member_id: aliceMember, text: "spoof" });
  check("Bob CANNOT post as Alice", !!bChatSpoof.error);

  // --- Outsider
  const eTrip = await eve.client.from("trips").select("*").eq("id", tripId);
  check("Eve (not in the trip) CANNOT see the trip", (eTrip.data?.length ?? 0) === 0);
  const eChat = await eve.client.from("chat_messages").select("*").eq("trip_id", tripId);
  check("Eve CANNOT read the group chat", (eChat.data?.length ?? 0) === 0);

  // --- Logged out
  const anon = createClient(url, anonKey, opts);
  const anonTrips = await anon.from("trips").select("*");
  check("Logged-out visitors see nothing", !!anonTrips.error || (anonTrips.data?.length ?? 0) === 0);
} finally {
  if (tripId) await admin.from("trips").delete().eq("id", tripId);
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  console.log("Cleaned up test users and trip.");
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll privacy checks passed.");
process.exit(failures ? 1 : 0);
