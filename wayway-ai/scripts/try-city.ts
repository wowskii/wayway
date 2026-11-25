// Runs the real AI module + Henry's logic on a city built from OpenStreetMap (data/spots_<city>.json).
//   npm run try:city              (Paris, real model, 2 option calls)
//   npm run try:city -- --no-ai   (only the filters and the spot selection, free)
//
// Same 4-member group as scenario 2 (museum lovers vs shoppers, Mia vegetarian, Sarah's private budget),
// plus a nut allergy for Ken. The trip starts on a TUESDAY: the Louvre (closed on Tuesday) must never appear.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Option, Spot, TimeSlot, Trip } from "@/contracts/contract";
import { buildOptions, filterSpotsForTrip, spotIndex } from "@/lib/logic";
import { generateOptions, PROMPT_VERSION } from "../lib/ai";
import { hoursOn, selectSpots, weekdayOf } from "../lib/ai/context";
import { TRIP as TOKYO_TRIP } from "../data/scenario2";

const args = process.argv.slice(2);
const noAI = args.includes("--no-ai");
const city = args.find((a) => !a.startsWith("--")) ?? "Paris";
const cities = JSON.parse(readFileSync(resolve(__dirname, "../../data/cities.json"), "utf8"));
const conf = cities[city];
if (!conf) throw new Error(`Unknown city "${city}" (data/cities.json: ${Object.keys(cities).join(", ")})`);
const SPOTS: Spot[] = Object.values(JSON.parse(readFileSync(resolve(__dirname, `../../data/${conf.spots}`), "utf8")));

const TRIP: Trip = {
  ...structuredClone(TOKYO_TRIP),
  name: `${city} weekend`, city, timezone: conf.timezone, currency: conf.currency, base: conf.base,
  startDate: "2026-12-01", endDate: "2026-12-03",   // day 1 = Tuesday
};
const [, tom, , ken] = TRIP.members;
tom.preferenceStatements = ["Wants shopping in big department stores", "Finds museums boring"];
ken.hard.allergies = ["nuts"];
for (const m of TRIP.members) if (m.hard.maxBudget) m.hard.maxBudget = Math.round(m.hard.maxBudget / 160);   // yen -> EUR for the test
const names = new Map(TRIP.members.map((m) => [m.id, m.name]));

function show(options: Option[]) {
  for (const o of options) {
    const path = o.branches ? o.branches.map((b) => `[${b.memberIds.map((id) => names.get(id)).join("+")}: ${b.spots.join(" > ")}]`).join(" / ") : o.spots.join(" > ");
    console.log(`  ${o.id} (${o.kind}) ${o.title}\n     ${path}\n     ${o.scores.map((s) => `${names.get(s.memberId)}=${s.level}`).join(", ")} | min ${o.metrics?.min}, mean ${o.metrics?.mean.toFixed(2)}`);
  }
}

async function slot(s: TimeSlot, allowed: Spot[]) {
  const weekday = weekdayOf(TRIP, s.day);
  const sel = selectSpots(allowed, s, { weekday, trip: TRIP });
  const byCat = sel.reduce<Record<string, number>>((a, x) => ({ ...a, [x.category]: (a[x.category] ?? 0) + 1 }), {});
  const louvre = allowed.find((x) => x.id === "louvre_museum");
  console.log(`\n== ${s.label} ${s.start}-${s.end} (${weekday}): ${sel.length} spots sent to the AI`, byCat);
  if (louvre) console.log(`   Louvre on ${weekday}: ${hoursOn(louvre, weekday)} -> ${sel.includes(louvre) ? "SENT (bug!)" : "not sent"}`);
  if (noAI) return;
  const gen = await generateOptions({ trip: TRIP, slot: s, allowedSpots: allowed, recentChat: [] });
  console.log(`   ${gen.candidates.length} valid candidates after ${gen.attempts} attempt(s), ${gen.rejected.length} rejected`);
  for (const r of gen.rejected.slice(0, 5)) console.log("   rejected:", r.slice(0, 170));
  const built = buildOptions(gen.candidates, TRIP.members, spotIndex(allowed));
  for (const d of built.dropped) console.log(`   dropped by role 4: ${d.title} (${d.reason})`);
  show(built.options);
  const food = new Set(gen.candidates.flatMap((c) => (c.branches ? c.branches.flatMap((b) => b.spots) : c.spots))
    .filter((id) => allowed.find((x) => x.id === id)?.category === "food"));
  if (food.size) console.log(`   Ken (nuts): ${[...food].join(", ")} -> "allergy_unverified" (no allergen data in OSM): WayWay reminds him privately`);
}

async function main() {
  console.log(`Prompt ${PROMPT_VERSION} | ${city}: ${SPOTS.length} spots (${conf.source}) | currency ${TRIP.currency}`);
  const filtered = filterSpotsForTrip(SPOTS, TRIP.members, {});
  console.log(`Henry's hard filter: ${filtered.allowed.length}/${SPOTS.length} spots allowed (food fitting Mia's vegetarian diet: ${filtered.allowed.filter((s) => s.category === "food").length})`);
  await slot({ day: 1, start: "14:00", end: "17:30", label: "Afternoon, day 1" }, filtered.allowed);
  await slot({ day: 2, start: "12:00", end: "13:30", label: "Lunch, day 2" }, filtered.allowed);
}

main().catch((e) => { console.error("FAILED:", e?.kind ?? "", e?.message ?? e, e?.errors ?? ""); process.exit(1); });
