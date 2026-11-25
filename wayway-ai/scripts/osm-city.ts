// EXPERIMENT (branch experiment/osm-cities): build a WayWay spots file for any city from OpenStreetMap.
//
//   npx tsx scripts/osm-city.ts fetch paris     -> queries Overpass ONCE, saves ../data/osm/raw_paris.json
//   npx tsx scripts/osm-city.ts convert paris   -> ../data/spots_paris.json (contract Spot) + ../data/osm/meta_paris.json
//
// The app would only read the converted snapshot, never OSM live (reproducible tests, no external dependency).
// Data © OpenStreetMap contributors, ODbL: attribution required, a published derived database stays ODbL.
//
// Rules: unknown = not safe (no diet tag -> no diet; allergens never known -> Henry's filter marks them
// "unverified"). Price, visit length and missing opening hours are ESTIMATES by category (listed in meta).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------- Cities ----------
interface City { name: string; bbox: [number, number, number, number]; currency: string }
const CITIES: Record<string, City> = {
  // Central Paris (arrondissements 1-8 and around): keeps the query light for the public Overpass servers.
  paris: { name: "Paris", bbox: [48.835, 2.27, 48.895, 2.39], currency: "EUR" },
};

const DATA = resolve(__dirname, "../../data");
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// ---------- Fetch ----------
function query(c: City): string {
  const b = `(${c.bbox.join(",")})`;
  return `[out:json][timeout:180];
(
  nwr["tourism"~"^(museum|gallery|attraction|viewpoint|zoo|aquarium)$"]["name"]["wikidata"]${b};
  nwr["historic"~"^(monument|castle|palace|memorial|archaeological_site|church)$"]["name"]["wikidata"]${b};
  nwr["amenity"="place_of_worship"]["name"]["wikidata"]${b};
  nwr["leisure"~"^(park|garden)$"]["name"]["wikidata"]${b};
  nwr["shop"~"^(mall|department_store)$"]["name"]${b};
  nwr["amenity"~"^(restaurant|cafe|fast_food)$"]["name"]["cuisine"]["opening_hours"]${b};
  nwr["amenity"~"^(restaurant|cafe|fast_food)$"]["name"]["diet:vegetarian"]${b};
  nwr["amenity"~"^(restaurant|cafe|fast_food)$"]["name"]["diet:vegan"]${b};
  nwr["amenity"~"^(restaurant|cafe|fast_food)$"]["name"]["diet:halal"]${b};
  nwr["amenity"~"^(bar|pub|nightclub)$"]["name"]["opening_hours"]["wikidata"]${b};
  node["place"~"^(suburb|quarter|neighbourhood)$"]["name"]${b};
);
out center tags;`;
}

async function fetchCity(key: string) {
  const c = CITIES[key];
  const body = new URLSearchParams({ data: query(c) });
  for (let attempt = 0, wait = 0; attempt < 6; attempt++, wait = wait ? wait * 2 : 20) {
    if (wait) await new Promise((r) => setTimeout(r, wait * 1000));
    for (const url of MIRRORS) {
      try {
        const res = await fetch(url, { method: "POST", body, headers: { "User-Agent": "wayway-student-prototype" }, signal: AbortSignal.timeout(200_000) });
        const text = await res.text();
        if (!res.ok || !text.startsWith("{")) { console.log(`  ${url}: HTTP ${res.status}`); continue; }
        const json = JSON.parse(text);
        mkdirSync(`${DATA}/osm`, { recursive: true });
        writeFileSync(`${DATA}/osm/raw_${key}.json`, JSON.stringify(json));
        console.log(`Saved ${json.elements.length} OSM elements -> data/osm/raw_${key}.json (via ${url})`);
        return;
      } catch (e) { console.log(`  ${url}: ${(e as Error).message}`); }
    }
    console.log(`attempt ${attempt + 1} failed, next wait ${wait ? wait * 2 : 20}s`);
  }
  throw new Error("All Overpass servers failed.");
}

// ---------- Convert ----------
type Cat = "museum" | "temple" | "landmark" | "food" | "shopping" | "nature" | "nightlife";
interface El { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags: Record<string, string> }

// Estimates by category, in the city currency (EUR for Paris).
const EST: Record<string, { eur: number; min: number; hours: string }> = {
  museum:     { eur: 15, min: 120, hours: "10:00-18:00" },
  gallery:    { eur: 8,  min: 60,  hours: "10:00-18:00" },
  landmark:   { eur: 0,  min: 45,  hours: "09:00-19:00" },
  temple:     { eur: 0,  min: 30,  hours: "08:00-19:00" },
  nature:     { eur: 0,  min: 60,  hours: "07:30-21:00" },
  shopping:   { eur: 0,  min: 60,  hours: "10:00-20:00" },
  restaurant: { eur: 25, min: 75,  hours: "12:00-22:30" },
  cafe:       { eur: 10, min: 40,  hours: "08:00-19:00" },
  fast_food:  { eur: 12, min: 30,  hours: "11:00-23:00" },
  nightlife:  { eur: 12, min: 90,  hours: "18:00-02:00" },
};

function classify(t: Record<string, string>): { cat: Cat; est: string } | undefined {
  if (["restaurant", "cafe", "fast_food"].includes(t.amenity)) return { cat: "food", est: t.amenity };
  if (["bar", "pub", "nightclub"].includes(t.amenity)) return { cat: "nightlife", est: "nightlife" };
  if (t.tourism === "museum") return { cat: "museum", est: "museum" };
  if (t.tourism === "gallery") return { cat: "museum", est: "gallery" };
  if (t.amenity === "place_of_worship" || t.historic === "church") return { cat: "temple", est: "temple" };
  if (t.leisure === "park" || t.leisure === "garden" || t.tourism === "zoo") return { cat: "nature", est: "nature" };
  if (t.shop === "mall" || t.shop === "department_store") return { cat: "shopping", est: "shopping" };
  if (t.tourism || t.historic) return { cat: "landmark", est: "landmark" };
  return undefined;
}

// opening_hours -> hours per weekday + the usual daily window (contract: openHours + openHoursByDay).
// Handles the common forms: "24/7", "Mo-Su 10:00-18:00", "Mo,Th,Sa-Su 09:00-18:00; Tu off; We,Fr 09:00-21:00",
// "12:00-14:30,19:00-22:30". Holidays and months (PH, "Dec 25 off") are ignored. Later rules win (OSM rule).
// With several ranges in a day (lunch + dinner), keeps the one that covers 12:30, else the longest
// (the contract has one window per day).
const HHMM = /([01]?\d|2[0-4]):([0-5]\d)\s*-\s*([01]?\d|2[0-4]|2[5-9]):([0-5]\d)/g;
const toMin = (h: string, m: string) => Number(h) * 60 + Number(m);
const fmt = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const OSM_DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const MONTHS = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\bPH\b|\bSH\b|week|easter/i;
function windowOf(times: string): string | undefined {
  if (/^\s*(off|closed)\s*$/i.test(times)) return "closed";
  const ranges = [...times.matchAll(HHMM)].map((m) => {
    const s = toMin(m[1], m[2]);
    let e = toMin(m[3], m[4]);
    if (e <= s) e += 1440;
    return [s, e] as const;
  });
  if (!ranges.length) return undefined;
  const pick = ranges.find(([s, e]) => s <= 750 && e >= 780) ?? [...ranges].sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0];
  return `${fmt(pick[0])}-${pick[1] === 1440 ? "24:00" : fmt(pick[1])}`;
}
function daysOf(sel: string): number[] {
  const out = new Set<number>();
  for (const part of sel.split(",")) {
    const [a, b] = part.trim().split("-").map((d) => OSM_DAYS.indexOf(d.trim()));
    if (a < 0) continue;
    if (b === undefined) out.add(a);
    else if (b >= 0) for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; }
  }
  return [...out];
}
interface Hours { daily: string; byDay: Record<string, string> }
function parseHours(oh: string | undefined): Hours | undefined {
  if (!oh) return undefined;
  if (/^\s*24\/7\s*$/.test(oh)) return { daily: "00:00-24:00", byDay: {} };
  const day: (string | undefined)[] = Array(7).fill(undefined);
  let any = false;
  for (const rule of oh.split(";").map((r) => r.trim()).filter(Boolean)) {
    if (MONTHS.test(rule)) continue;
    const m = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*[-,]\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s+(.*)$/);
    const days = m ? daysOf(m[1].replace(/\s/g, "")) : [0, 1, 2, 3, 4, 5, 6];
    const w = windowOf(m ? m[2] : rule);
    if (!w || !days.length) continue;
    for (const d of days) day[d] = w;
    any = true;
  }
  if (!any) return undefined;
  const filled = day.map((w) => w ?? "closed");             // OSM: a day not listed is closed
  const open = filled.filter((w) => w !== "closed");
  if (!open.length) return undefined;                        // closed every day: not a usable place
  const counts = new Map<string, number>();
  for (const w of open) counts.set(w, (counts.get(w) ?? 0) + 1);
  const daily = [...counts].sort((x, y) => y[1] - x[1])[0][0];
  // Only keep the per-day table when it differs from the usual window on some day.
  const byDay = filled.some((w) => w !== daily) ? Object.fromEntries(WEEK.map((d, i) => [d, filled[i]])) : {};
  return { daily, byDay };
}

function dietTags(t: Record<string, string>): string[] {
  const yes = (k: string) => t[k] === "yes" || t[k] === "only";
  const cuisine = (t.cuisine ?? "").split(";");
  const out = new Set<string>();
  if (yes("diet:vegan") || cuisine.includes("vegan")) { out.add("vegan"); out.add("vegetarian"); }
  if (yes("diet:vegetarian") || cuisine.includes("vegetarian")) out.add("vegetarian");
  if (yes("diet:halal")) out.add("halal");
  if (yes("diet:kosher")) out.add("kosher");
  if (yes("diet:gluten_free")) out.add("gluten_free");
  return [...out];
}

const slug = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 28).replace(/_$/, "");

function convert(key: string) {
  const c = CITIES[key];
  const raw: { elements: El[] } = JSON.parse(readFileSync(`${DATA}/osm/raw_${key}.json`, "utf8"));
  const pos = (e: El) => (e.center ? e.center : { lat: e.lat!, lon: e.lon! });
  const places = raw.elements.filter((e) => e.tags?.place && e.lat !== undefined);
  // Prefer quarters (finer) over suburbs for the "area": travel time uses "same area = 10 min".
  const rank: Record<string, number> = { quarter: 0, suburb: 1, neighbourhood: 2 };
  const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180));
  const areaOf = (e: El) => {
    if (e.tags["addr:suburb"]) return e.tags["addr:suburb"];
    const p = pos(e);
    const near = places.map((pl) => ({ pl, d: km(p, { lat: pl.lat!, lon: pl.lon! }) }))
      .filter((x) => x.d < 1.2).sort((a, b) => rank[a.pl.tags.place] - rank[b.pl.tags.place] || a.d - b.d)[0];
    return near?.pl.tags.name ?? "";
  };

  interface Row { spot: any; score: number; estimated: string[]; osm: string }
  const rows: Row[] = [];
  const seenNames = new Set<string>();
  for (const e of raw.elements) {
    if (!e.tags?.name || e.tags.place) continue;
    const k = classify(e.tags);
    if (!k) continue;
    // "closed" / "off" for the whole value = closed for now (e.g. Centre Pompidou, closed for works): never propose it.
    if (/^\s*(closed|off)\s*$/i.test(e.tags.opening_hours ?? "")) continue;
    const name = e.tags["name:en"] ?? e.tags.name;
    if (seenNames.has(name.toLowerCase())) continue;   // same place mapped as node + building
    seenNames.add(name.toLowerCase());
    const est = EST[k.est];
    const hours = parseHours(e.tags.opening_hours);
    const fee = e.tags.fee === "no" ? 0 : undefined;
    const estimated = ["durationMin", ...(fee === undefined ? ["price"] : []), ...(hours ? [] : ["openHours"])];
    const p = pos(e);
    const diet = k.cat === "food" ? dietTags(e.tags) : [];
    rows.push({
      osm: `${e.type}/${e.id}`,
      estimated,
      // Fame: number of name translations (the Louvre has dozens, a small museum a few). Ties otherwise.
      score: Math.min(6, Object.keys(e.tags).filter((t) => t.startsWith("name:")).length / 8) + (e.tags.wikidata ? 3 : 0) + (hours ? 2 : 0) + (diet.length ? 1.5 : 0) + (e.tags.cuisine ? 0.5 : 0) + (e.tags.website ? 0.5 : 0),
      spot: {
        id: "", name, category: k.cat,
        price: Math.round(fee ?? est.eur),                    // in the city's currency (Trip.currency)
        dietTags: diet, durationMin: est.min, openHours: hours?.daily ?? est.hours,
        ...(hours && Object.keys(hours.byDay).length ? { openHoursByDay: hours.byDay } : {}),
        area: areaOf(e), lat: Number(p.lat.toFixed(5)), lng: Number(p.lon.toFixed(5)),
      },
    });
  }

  // Keep the best places per family (the AI later gets only the 30-50 relevant ones for a slot).
  const CAPS: Record<string, number> = { food: 160, nightlife: 25, museum: 45, landmark: 45, temple: 25, nature: 30, shopping: 15 };
  const kept: Row[] = [];
  for (const [cat, cap] of Object.entries(CAPS)) {
    kept.push(...rows.filter((r) => r.spot.category === cat && r.spot.area).sort((a, b) => b.score - a.score).slice(0, cap));
  }
  // Ids must be unique across ALL cities (src/lib/cities.ts looks spots up by id for any trip).
  const ids = new Set<string>(Object.keys(JSON.parse(readFileSync(`${DATA}/spots_tokyo.json`, "utf8"))));
  // Google Place IDs already matched (scripts/match-places.mjs) survive a re-conversion.
  let previous: Record<string, { placeId?: string }> = {};
  try { previous = JSON.parse(readFileSync(`${DATA}/spots_${key}.json`, "utf8")); } catch { /* first run */ }
  const spots: Record<string, any> = {};
  const meta: Record<string, any> = {};
  for (const r of kept) {
    let id = slug(r.spot.name) || "spot";
    for (let n = 2; ids.has(id); n++) id = `${slug(r.spot.name).slice(0, 25)}_${n}`;
    ids.add(id);
    spots[id] = { ...r.spot, id, ...(previous[id]?.placeId ? { placeId: previous[id].placeId } : {}) };
    meta[id] = { osm: r.osm, estimated: r.estimated };
  }
  // One spot per line, same layout as spots_tokyo.json (small diffs; match-places.mjs edits lines in place).
  const line = (v: unknown) => JSON.stringify(v).replace(/":/g, '": ').replace(/,"/g, ', "');
  writeFileSync(`${DATA}/spots_${key}.json`,
    `{\n${Object.entries(spots).map(([id, s]) => `  ${JSON.stringify(id)}: ${line(s)}`).join(",\n")}\n}\n`);
  writeFileSync(`${DATA}/osm/meta_${key}.json`, JSON.stringify({ source: "© OpenStreetMap contributors (ODbL)", currency: c.currency, spots: meta }, null, 1));

  // ---------- Quality report ----------
  const list = Object.values(spots);
  const pct = (n: number, d: number) => `${n}/${d} (${d ? Math.round((100 * n) / d) : 0}%)`;
  const by = (cat: string) => list.filter((s) => s.category === cat);
  const real = (id: string, f: string) => !meta[id].estimated.includes(f);
  console.log(`\n${c.name}: ${rows.length} usable OSM places -> ${list.length} kept in data/spots_${key}.json`);
  console.log("per category:", Object.fromEntries(Object.keys(CAPS).map((k) => [k, by(k).length])));
  console.log("real opening hours (not estimated):", pct(list.filter((s) => real(s.id, "openHours")).length, list.length));
  for (const k of ["food", "museum", "landmark", "temple", "nature"]) {
    console.log(`  ${k.padEnd(9)}`, pct(by(k).filter((s) => real(s.id, "openHours")).length, by(k).length));
  }
  console.log("hours that differ by weekday (openHoursByDay):", pct(list.filter((s) => s.openHoursByDay).length, list.length));
  const food = by("food");
  console.log("food with a diet tag:", pct(food.filter((s) => s.dietTags.length).length, food.length),
    "| vegetarian:", food.filter((s) => s.dietTags.includes("vegetarian")).length,
    "| vegan:", food.filter((s) => s.dietTags.includes("vegan")).length,
    "| halal:", food.filter((s) => s.dietTags.includes("halal")).length);
  console.log("areas:", new Set(list.map((s) => s.area)).size, "distinct, e.g.", [...new Set(list.map((s) => s.area))].slice(0, 8).join(", "));
}

const [cmd, key = "paris"] = process.argv.slice(2);
if (!CITIES[key]) throw new Error(`Unknown city "${key}" (known: ${Object.keys(CITIES).join(", ")})`);
if (cmd === "fetch") fetchCity(key).catch((e) => { console.error(e.message); process.exit(1); });
else if (cmd === "convert") convert(key);
else console.log("usage: npx tsx scripts/osm-city.ts fetch|convert <city>");
