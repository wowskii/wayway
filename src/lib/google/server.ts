// The ONLY place the server calls Google (Places API (New), Routes API).
// Every call goes through googleFetch, which:
//   1. takes one unit from today's budget for that API (database counter, see limits.ts),
//      and refuses the call if the limit is reached;
//   2. sends the secret server key in a header (never in the URL, so it can't leak into logs);
//   3. asks only for the fields we need (field mask): Google bills by the most expensive field requested.
// "server-only" makes the build fail if a client component imports this file.
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { GOOGLE_DAILY_LIMITS, type GoogleApi } from "./limits";

export class GoogleError extends Error {
  constructor(
    // limit    = our daily limit is reached (try again tomorrow)
    // config   = a key is missing in .env.local
    // provider = Google or the database answered with an error, or timed out
    public kind: "limit" | "config" | "provider",
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

function serverKey(): string {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) throw new GoogleError("config", "Missing GOOGLE_MAPS_SERVER_KEY in .env.local.");
  return key;
}

// Takes one request from today's budget. Throws GoogleError("limit") when the limit is reached.
// If the counter itself fails (database down), we refuse too: better no map details than a bill.
export async function takeGoogleBudget(api: GoogleApi): Promise<void> {
  const { data: allowed, error } = await createAdminClient().rpc("google_usage_take", {
    p_api: api,
    p_limit: GOOGLE_DAILY_LIMITS[api],
  });
  if (error) throw new GoogleError("provider", `Usage counter failed: ${error.message}`);
  if (!allowed) {
    throw new GoogleError("limit", `Daily limit reached for ${api} (${GOOGLE_DAILY_LIMITS[api]}/day).`);
  }
}

interface GoogleFetchOptions {
  method?: "GET" | "POST";
  body?: unknown;            // sent as JSON (POST)
  fieldMask?: string;        // e.g. "id,displayName,rating"
  timeoutMs?: number;
}

export async function googleFetch<T>(api: GoogleApi, url: string, opts: GoogleFetchOptions = {}): Promise<T> {
  const key = serverKey();          // check the key BEFORE counting, so a config error costs nothing
  await takeGoogleBudget(api);

  const headers: Record<string, string> = { "X-Goog-Api-Key": key };
  if (opts.fieldMask) headers["X-Goog-FieldMask"] = opts.fieldMask;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      cache: "no-store",            // Google content must not be stored (terms), not even by Next's cache
    });
  } catch (e) {
    throw new GoogleError("provider", `Google ${api} request failed: ${(e as Error).message}`);
  }
  if (!res.ok) {
    // Google explains errors in the body (e.g. "API not enabled", "key restricted"): keep it short for logs.
    const detail = (await res.text()).slice(0, 300);
    throw new GoogleError("provider", `Google ${api} answered ${res.status}: ${detail}`, res.status);
  }
  return (await res.json()) as T;
}
