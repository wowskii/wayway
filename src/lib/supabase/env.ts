// Reads the Supabase settings from .env.local and fails loudly if one is missing.
// NEXT_PUBLIC_* values are safe in the browser; they must be read with their full name
// (process.env.NEXT_PUBLIC_X) so Next.js can inline them in client code.

export const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}: copy .env.example to .env.local and fill it in.`);
  return value;
}
