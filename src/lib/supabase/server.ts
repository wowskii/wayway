// Supabase client for code that runs ON THE SERVER (server components, API routes, server actions).
// It reads the login cookie of the current request, so it acts as the logged-in user and RLS still applies.
// Create a new one for every request (never share it between requests).
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db/database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server components cannot write cookies. That's fine: proxy.ts refreshes the session cookie.
        }
      },
    },
  });
}
