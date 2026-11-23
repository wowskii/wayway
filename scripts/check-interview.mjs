// End-to-end test of the interview API with the MOCK interviewer.
// Needs the app running (npm run dev, or set APP_URL). Creates a throwaway user, plays a full
// interview through /api/private, checks what was saved, then deletes the user.
// Run: npm run check:interview
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !extra ? "" : `  (${extra})`}`);
  if (!ok) failures++;
};

// Log in like the app does and keep the cookies
async function login(email, password) {
  const jar = new Map();
  const sb = createServerClient(url, anon, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)),
    },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { sb, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}

async function api(cookie, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const stamp = Date.now();
const password = "Interview-test-pw1";
const users = [];
try {
  for (const name of ["Mia", "Ken"]) {
    const email = `interview-${name.toLowerCase()}-${stamp}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
    if (error) throw error;
    users.push({ id: data.user.id, email });
  }
  const mia = await login(users[0].email, password);
  const ken = await login(users[1].email, password);
  const { data: trip } = await admin.from("trips").select("id").eq("invite_code", "tokyo26").single();
  if (!trip) throw new Error("Run npm run seed first");
  const tripId = trip.id;
  const { data: memberId } = await mia.sb.rpc("join_trip", { p_invite_code: "tokyo26" });
  await ken.sb.rpc("join_trip", { p_invite_code: "tokyo26" });

  // --- Start
  let r = await api(mia.cookie, "GET", `/api/private?tripId=${tripId}`);
  check("GET starts the interview with WayWay's greeting", r.status === 200 && r.json.messages?.length === 1 && r.json.messages[0].sender === "wayway", `status ${r.status}`);
  check("greeting asks about interests", /enjoy/.test(r.json.messages?.[0]?.text ?? ""));
  r = await api(mia.cookie, "GET", `/api/private?tripId=${tripId}`);
  check("reloading does not repeat the greeting", r.json.messages?.length === 1);

  const say = (text) => api(mia.cookie, "POST", "/api/private", { tripId, memberId, message: { text } });

  // --- Turns
  r = await say("I love ramen and temples, maybe some museums");
  check("turn 1: reply + next question (pace)", r.status === 200 && r.json.messages?.length === 2 && /busy/.test(r.json.messages[1].text), JSON.stringify(r.json).slice(0, 200));
  check("turn 1: interests understood", r.json.interview?.covered?.includes("interests"));

  r = await say("Relaxed please, with breaks");
  check("turn 2: pace covered", r.json.interview?.covered?.includes("pace"));
  r = await say("I'm a night owl, I like to sleep in");
  check("turn 3: sleep covered", r.json.interview?.covered?.includes("sleep"));

  r = await say("I'm vegetarian");
  const dietCard = r.json.messages?.[1];
  check("turn 4: diet -> confirmation card (pending)", dietCard?.constraintsStatus === "pending" && dietCard?.constraintsToConfirm?.diet?.[0] === "vegetarian");
  let { data: pub } = await admin.from("trip_members").select("diet").eq("id", memberId).single();
  check("diet NOT applied before confirming", pub.diet.length === 0);

  r = await api(mia.cookie, "POST", "/api/private/confirm", { tripId, messageId: dietCard.id, decision: "confirm" });
  check("confirm card", r.status === 200 && r.json.message?.constraintsStatus === "confirmed", `status ${r.status}`);
  ({ data: pub } = await admin.from("trip_members").select("diet").eq("id", memberId).single());
  check("diet applied after confirming", pub.diet.includes("vegetarian"));
  r = await api(mia.cookie, "POST", "/api/private/confirm", { tripId, messageId: dietCard.id, decision: "confirm" });
  check("same card cannot be answered twice", r.status === 409);

  r = await say("Yes, peanuts. Please don't tell the group, it's a bit embarrassing");
  const allergyCard = r.json.messages?.[1];
  check("turn 5: allergy card", allergyCard?.constraintsToConfirm?.allergies?.includes("peanuts"));
  check("turn 5: sensitive statement marked [private]", r.json.preferenceUpdate?.statements?.some((s) => s.startsWith("[private] ")));
  r = await api(mia.cookie, "POST", "/api/private/confirm", {
    tripId, messageId: allergyCard.id, decision: "confirm", constraints: { allergies: ["peanuts", "  SESAME "] },
  });
  check("confirm an EDITED card", r.status === 200 && r.json.applied?.allergies?.join() === "peanuts,sesame", JSON.stringify(r.json));

  r = await api(mia.cookie, "POST", "/api/private/finish", { tripId });
  check("cannot finish before every topic is covered", r.status === 409);

  r = await say("Around 40k yen, I'm a student so cheap is better");
  const budgetCard = r.json.messages?.[1];
  check("turn 6: budget card 40000", budgetCard?.constraintsToConfirm?.maxBudget === 40000);
  check("turn 6: interview done", r.json.interview?.done === true);
  r = await api(mia.cookie, "POST", "/api/private/confirm", { tripId, messageId: budgetCard.id, decision: "reject" });
  check("reject card", r.json.message?.constraintsStatus === "rejected");
  const { data: priv } = await admin.from("member_private").select("*").eq("member_id", memberId).single();
  check("rejected budget NOT applied", priv.max_budget === null);
  check("allergies saved privately", priv.allergies.join() === "peanuts,sesame");

  r = await api(mia.cookie, "POST", "/api/private/finish", { tripId });
  check("finish", r.status === 200);
  const { data: done } = await admin.from("trip_members").select("*").eq("id", memberId).single();
  check("profile saved: interests, pace, sleep, status done",
    done.interests.includes("food") && done.pace === "relaxed" && done.sleep === "night_owl" && done.onboarding_status === "done",
    JSON.stringify(done));

  // --- Security
  r = await api(ken.cookie, "POST", "/api/private", { tripId, memberId, message: { text: "hi, I'm Mia" } });
  check("Ken CANNOT write in Mia's interview", r.status === 403, `status ${r.status}`);
  r = await api(ken.cookie, "POST", "/api/private/confirm", { tripId, messageId: allergyCard.id, decision: "reject" });
  check("Ken CANNOT answer Mia's cards", r.status === 404, `status ${r.status}`);
  r = await api(ken.cookie, "GET", `/api/private?tripId=${tripId}`);
  check("Ken's GET only returns his own chat", r.json.messages?.every((m) => m.memberId !== memberId));
  r = await api("", "POST", "/api/private", { tripId, memberId, message: { text: "hello" } });
  check("logged out -> 401", r.status === 401, `status ${r.status}`);
  r = await say("x".repeat(1001));
  check("too long message -> 400", r.status === 400);
  r = await api(mia.cookie, "POST", "/api/private", { tripId: "nope" });
  check("bad request -> 400", r.status === 400);
} finally {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  console.log("Cleaned up test users.");
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll interview checks passed.");
process.exit(failures ? 1 : 0);
