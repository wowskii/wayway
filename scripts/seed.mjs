// Creates (or keeps) a demo Tokyo trip that anyone can join at /join/tokyo26
// Run: npm run seed
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Fill NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

const admin = createClient(url, key, { auth: { persistSession: false } });

const demo = {
  name: "Tokyo Spring Trip",
  city: "Tokyo",
  start_date: "2026-11-21",
  end_date: "2026-11-23",
  timezone: "Asia/Tokyo",
  goal: "balanced",
  invite_code: "tokyo26",
};

const { data, error } = await admin
  .from("trips")
  .upsert(demo, { onConflict: "invite_code" })
  .select("id, name, invite_code")
  .single();
if (error) throw error;

console.log(`Demo trip ready: ${data.name} (${data.id})`);
console.log(`Join it at http://localhost:3000/join/${data.invite_code}`);
