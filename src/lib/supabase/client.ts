// Supabase client for code that runs IN THE BROWSER (components with "use client").
// It acts as the logged-in user, so the database privacy rules (RLS) apply to everything it does.
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
