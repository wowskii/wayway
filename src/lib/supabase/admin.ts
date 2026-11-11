// "Admin" Supabase client: uses the secret service-role key and IGNORES all privacy rules (RLS).
// Only for trusted server code that must touch server-only data (e.g. fairness credits) or
// write on behalf of WayWay. Never import this from a client component: "server-only" makes
// the build fail if someone tries.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
