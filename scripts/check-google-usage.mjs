// Automatic test of the Google safety counter (table google_usage, function google_usage_take).
// Checks that it counts, stops at the limit, survives simultaneous calls, and is server-only.
// Uses a fake API name ("test_<time>"), so it never touches the real counters, and cleans up after.
// Does NOT call Google. Run: npm run check:google
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Fill the Supabase values in .env.local");

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, opts);
const anon = createClient(url, anonKey, opts);
const api = `test_${Date.now()}`;
let failures = 0;

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const take = (client, name, limit) => client.rpc("google_usage_take", { p_api: name, p_limit: limit });

try {
  // 1. Counts up to the limit, then refuses
  const results = [];
  for (let i = 0; i < 4; i++) results.push((await take(admin, api, 3)).data);
  check("allows 3 calls with limit 3, refuses the 4th", JSON.stringify(results) === "[true,true,true,false]",
    JSON.stringify(results));

  const { data: row } = await admin.from("google_usage").select("count").eq("api", api).single();
  check("counter stops at the limit", row?.count === 3, `count = ${row?.count}`);

  // 2. 10 calls at the same time with limit 5: exactly 5 must be allowed
  const api2 = `${api}_parallel`;
  const parallel = await Promise.all(Array.from({ length: 10 }, () => take(admin, api2, 5)));
  const allowed = parallel.filter((r) => r.data === true).length;
  check("10 simultaneous calls, limit 5: exactly 5 allowed", allowed === 5, `${allowed} allowed`);

  // 3. Server-only: the public (anon) key can neither call the function nor read the table
  const anonTake = await take(anon, api, 1000);
  check("anon key cannot call google_usage_take", anonTake.error !== null && anonTake.data === null,
    anonTake.error?.message ?? "no error");
  const anonRead = await anon.from("google_usage").select("*");
  check("anon key cannot read google_usage", anonRead.error !== null || anonRead.data?.length === 0,
    anonRead.error?.message ?? `${anonRead.data?.length} rows`);
} finally {
  await admin.from("google_usage").delete().like("api", `${api}%`);
  console.log("Cleaned up test counters.");
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll Google usage checks passed.");
process.exit(failures ? 1 : 0);
