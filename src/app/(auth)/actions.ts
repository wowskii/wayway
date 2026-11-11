"use server";
// Server actions for accounts. They run on the server when a form is submitted.
// Supabase stores the password (hashed) and sets the login cookie; we never see or keep passwords.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; info?: string };

/** Only allow redirects to our own pages (blocks "//evil.com" style links). */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const displayName = String(form.get("displayName") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");

  if (!displayName || displayName.length > 40) return { error: "Choose a name between 1 and 40 characters." };
  if (password.length < 8) return { error: "Use a password of at least 8 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },   // copied to profiles by a DB trigger
  });
  if (error) return { error: error.message };

  // If "Confirm email" is ON in Supabase, there is no session yet.
  if (!data.session) return { info: "Check your inbox to confirm your email, then log in." };

  redirect(safeNext(form.get("next")));
}

export async function logIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("password") ?? ""),
  });
  if (error) return { error: "Wrong email or password." };

  redirect(safeNext(form.get("next")));
}

export async function logOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
