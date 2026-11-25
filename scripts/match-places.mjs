// Finds the Google Place ID of each spot in data/spots_tokyo.json (Places API (New), Text Search).
//
// Output:
//   data/spots_tokyo.json (field placeId)    for confident matches only. Committed:
//                                            Google's terms allow keeping Place IDs (and nothing else).
//   scripts/output/match-places-report.md    one line per spot for a human to review: Google's name,
//                                            distance from our coordinates, status. Git-ignored and
//                                            temporary: it holds Google content, delete it after review.
//
// Status of each spot:
//   OK       Google's place is within 300 m of our coordinates and shares a word with our name -> saved
//   CHECK    plausible but not sure (300 m - 1.5 km, different name, or an area/street, not a place)
//   FAR      more than 1.5 km away: probably the wrong place, or our coordinates are wrong
//   NONE     no result
// CHECK / FAR / NONE are NOT saved: read the report, then either copy the right Place ID into
// data/spots_tokyo.json by hand ("placeId": "..."), rerun the spot with a better query (--query), or add
// the spot to NO_SINGLE_PLACE below (an area, no single Google place fits): never searched again.
//
// Every call goes through the shared daily counter (google_usage, limit text_search) like the app.
//
// Usage:
//   npm run match:places -- --dry-run                 show the queries, no Google call
//   npm run match:places                              all spots that have no Place ID yet
//   npm run match:places -- --only tnm,ghibli         only these spots (even if already matched)
//   npm run match:places -- --only ghibli --query "Ghibli Museum Mitaka"   custom search text
//   npm run match:places -- --city Paris --limit 95  another city of data/cities.json; --limit takes the best
//                                                      known spots first, one category after the other
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// Keep in sync with GOOGLE_DAILY_LIMITS.text_search in src/lib/google/limits.ts
const TEXT_SEARCH_DAILY_LIMIT = 100;
const CITIES = JSON.parse(readFileSync("data/cities.json", "utf8"));
// Areas: no single Google place fits, so they are never searched (and have no placeId).
const NO_SINGLE_PLACE = new Set(["shibuya_shopping", "shimokitazawa"]);
const REPORT_DIR = "scripts/output";
const REPORT_FILE = `${REPORT_DIR}/match-places-report.md`;

// ---------- Arguments ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = flag("--dry-run");
const only = value("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const customQuery = value("--query");
const CITY = value("--city") ?? "Tokyo";
if (!CITIES[CITY]) throw new Error(`Unknown city "${CITY}" (data/cities.json: ${Object.keys(CITIES).join(", ")})`);
const SPOTS_FILE = `data/${CITIES[CITY].spots}`;
const REGION = CITIES[CITY].region ?? "JP";
const LIMIT = value("--limit") ? Number(value("--limit")) : Infinity;
if (customQuery && only?.length !== 1) throw new Error("--query needs exactly one spot in --only");

// ---------- Data ----------
const spots = JSON.parse(readFileSync(SPOTS_FILE, "utf8"));
const saved = {};   // new Place IDs found in this run
for (const id of only ?? []) if (!spots[id]) throw new Error(`Unknown spot id "${id}"`);

// A spot that already has a placeId (or is an area) is skipped unless named in --only.
const pending = Object.values(spots).filter((s) => (only ? only.includes(s.id) : !s.placeId && !NO_SINGLE_PLACE.has(s.id)));
// --limit: round-robin over categories, in file order (OpenStreetMap cities are written best known first),
// so museums, landmarks, restaurants... all get some Google details.
const todo = [];
const byCat = Object.groupBy ? Object.groupBy(pending, (s) => s.category) : pending.reduce((a, s) => ((a[s.category] ??= []).push(s), a), {});
const queues = Object.values(byCat);
while (todo.length < Math.min(LIMIT, pending.length)) for (const q of queues) if (q.length && todo.length < LIMIT) todo.push(q.shift());

// "Ghibli Museum (advance tickets)" -> "Ghibli Museum, Mitaka, Tokyo": the brackets are our notes, not the name.
const queryFor = (s) => customQuery ?? `${s.name.replace(/\s*\([^)]*\)/g, "")}, ${s.area}, ${CITY}`;

if (dryRun) {
  console.log(`${todo.length} spot(s) would be searched (no Google call):`);
  for (const s of todo) console.log(`  ${s.id.padEnd(18)} "${queryFor(s)}"`);
  process.exit(0);
}
if (!todo.length) {
  console.log("Nothing to do: every spot already has a Place ID (or null). Use --only to redo some.");
  process.exit(0);
}

// ---------- Clients ----------
const key = process.env.GOOGLE_MAPS_SERVER_KEY;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error("Missing GOOGLE_MAPS_SERVER_KEY in .env.local");
if (!url || !serviceKey) throw new Error("Fill the Supabase values in .env.local");
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function takeBudget() {
  const { data, error } = await admin.rpc("google_usage_take", { p_api: "text_search", p_limit: TEXT_SEARCH_DAILY_LIMIT });
  if (error) throw new Error(`Usage counter failed: ${error.message}`);
  return data === true;
}

// Text Search (New). Field mask = only what the review needs; these fields are in the "Pro" tier.
async function search(s) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types",
    },
    body: JSON.stringify({
      textQuery: queryFor(s),
      languageCode: "en",
      regionCode: REGION,
      pageSize: 3,
      // Prefer results near our coordinates (a bias, not a filter): picks the right branch of a chain.
      locationBias: { circle: { center: { latitude: s.lat, longitude: s.lng }, radius: 1000 } },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).places ?? [];
}

// ---------- Matching ----------
function meters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

// "Sensō-ji" -> ["senso", "ji"]: lowercase, accents removed, small filler words ignored.
const STOP = new Set([CITY.toLowerCase(), "the", "of", "and", "a", "de", "du", "des", "la", "le", "les", "l"]);
const words = (t) =>
  new Set(t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)));
const sharesWord = (a, b) => [...words(a)].some((w) => words(b).has(w));

// Types that describe an area or a road rather than a single place.
const AREA_TYPES = ["locality", "sublocality", "sublocality_level_1", "sublocality_level_2", "neighborhood", "political", "route"];

function judge(spot, place) {
  if (!place) return { status: "NONE", why: "no result" };
  const d = meters(spot, { lat: place.location.latitude, lng: place.location.longitude });
  const name = place.displayName?.text ?? "";
  const why = [];
  if (place.types?.some((t) => AREA_TYPES.includes(t))) why.push("area or street, not a single place");
  if (!sharesWord(spot.name, name)) why.push("different name");
  if (d > 1500) return { status: "FAR", d, name, why: [`${d} m away`, ...why].join("; ") };
  if (d > 300) why.unshift(`${d} m away`);
  return { status: why.length ? "CHECK" : "OK", d, name, why: why.join("; ") };
}

// ---------- Run ----------
const rows = [];
let stoppedAt;
for (const s of todo) {
  if (!(await takeBudget())) {
    stoppedAt = s.id;
    console.log(`Daily text_search limit (${TEXT_SEARCH_DAILY_LIMIT}) reached: stopping before "${s.id}". Run again tomorrow.`);
    break;
  }
  let places;
  try {
    places = await search(s);
  } catch (e) {
    console.log(`ERROR ${s.id}: ${e.message}`);
    rows.push({ s, status: "ERROR", why: e.message.slice(0, 120) });
    continue;
  }
  const best = places[0];
  const verdict = judge(s, best);
  rows.push({ s, ...verdict, placeId: best?.id, address: best?.formattedAddress, others: places.slice(1) });
  if (verdict.status === "OK") saved[s.id] = best.id;
  console.log(`${verdict.status.padEnd(5)} ${s.id.padEnd(18)} ${verdict.name ?? ""}${verdict.why ? `  (${verdict.why})` : ""}`);
}

// Only Place IDs are written to the committed dataset. The file keeps one spot per line, so the line of
// each spot is edited in place (small, readable diffs).
const text = readFileSync(SPOTS_FILE, "utf8").split("\n").map((line) => {
  const id = line.match(/^  "([a-z0-9_]+)": \{/)?.[1];
  if (!id || !saved[id]) return line;
  const spot = JSON.parse(line.trim().replace(/^"[a-z0-9_]+":\s*/, "").replace(/,$/, ""));
  spot.placeId = saved[id];
  return `  ${JSON.stringify(id)}: ${JSON.stringify(spot).replace(/":/g, '": ').replace(/,"/g, ', "')}${line.endsWith(",") ? "," : ""}`;
});
writeFileSync(SPOTS_FILE, text.join("\n"));

mkdirSync(REPORT_DIR, { recursive: true });
const esc = (t) => String(t ?? "").replace(/\|/g, "\\|");
const report = [
  "# Place ID matching report (temporary: contains Google content, delete after review)",
  "",
  `Run: ${new Date().toISOString()} · ${rows.length} spot(s) searched${stoppedAt ? ` · stopped at ${stoppedAt} (daily limit)` : ""}`,
  "",
  "| Status | Spot | Our name | Google's best match | Address | Why | Place ID | Other results |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map((r) =>
    `| ${r.status} | \`${r.s.id}\` | ${esc(r.s.name)} | ${esc(r.name)} | ${esc(r.address)} | ${esc(r.why)} | ${r.placeId ? `\`${r.placeId}\`` : ""} | ${esc(
      (r.others ?? []).map((o) => o.displayName?.text).join(" · "))} |`),
  "",
].join("\n");
writeFileSync(REPORT_FILE, report);

const count = (st) => rows.filter((r) => r.status === st).length;
console.log(`\nOK ${count("OK")} · CHECK ${count("CHECK")} · FAR ${count("FAR")} · NONE ${count("NONE")} · ERROR ${count("ERROR")}`);
console.log(`Saved ${Object.keys(saved).length} new Place ID(s) to ${SPOTS_FILE}. Review: ${REPORT_FILE}`);
