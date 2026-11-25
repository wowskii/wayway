// Cities WayWay can plan in (data/cities.json) and their spots (one file per city).
// Tokyo: hand-made dataset (Role 4). Other cities: OpenStreetMap snapshots built ONCE by
// wayway-ai/scripts/osm-city.ts (the app never calls OpenStreetMap live).
//
// Spot ids are unique across all cities, so a lookup by id (votes, itinerary, map) works for any trip,
// and only the list sent to the AI is chosen by city (spotsForCity).
// Not server-only on purpose: the data is public and the map page uses it in the browser.
import type { Spot, Trip } from "@/contracts/contract";
import citiesJson from "../../data/cities.json";
import paris from "../../data/spots_paris.json";
import tokyo from "../../data/spots_tokyo.json";

export interface CityConfig {
  name: string;                      // "Paris" (as stored in trips.city)
  spots: string;                     // data file name
  source: string;
  currency: string;                  // "EUR"
  timezone: string;                  // "Europe/Paris"
  base: { lat: number; lng: number; label?: string };
}

// A new city = its file in data/, an entry in data/cities.json and one line here.
const FILES: Record<string, Record<string, unknown>> = {
  "spots_tokyo.json": tokyo,
  "spots_paris.json": paris,
};

export const CITY_CONFIG: Readonly<Record<string, CityConfig>> = Object.fromEntries(
  Object.entries(citiesJson as Record<string, Omit<CityConfig, "name">>).map(([name, c]) => [name, { name, ...c }]),
);
/** City names for the trip creation page, Tokyo first. */
export const CITY_NAMES: string[] = Object.keys(CITY_CONFIG);

/** The configured city for a trips.city value (case and spaces ignored), or undefined. */
export function cityConfig(city: string | null | undefined): CityConfig | undefined {
  const key = (city ?? "").trim().toLowerCase();
  return Object.values(CITY_CONFIG).find((c) => c.name.toLowerCase() === key);
}

const byCity: Record<string, Spot[]> = {};
const byId: Record<string, Spot> = {};
for (const c of Object.values(CITY_CONFIG)) {
  const file = FILES[c.spots];
  if (!file) throw new Error(`data/cities.json: ${c.name} uses ${c.spots}, which is not imported in src/lib/cities.ts`);
  byCity[c.name] = Object.values(file) as Spot[];
  for (const s of byCity[c.name]) {
    if (Object.hasOwn(byId, s.id)) throw new Error(`Spot id "${s.id}" is used in two cities: ids must be unique.`);
    byId[s.id] = s;
  }
}

/** The raw spot file of a city, keyed by id (for validation). */
export const cityFile = (c: CityConfig): Record<string, unknown> => FILES[c.spots];
/** Every spot of every city, by id. */
export const ALL_SPOTS_BY_ID: Readonly<Record<string, Spot>> = byId;
/** The spots of a trip's city (what the AI may propose). Unknown city: none. */
export const spotsForCity = (city: string | null | undefined): Spot[] => byCity[cityConfig(city)?.name ?? ""] ?? [];

/** The contract Trip with its city's currency and starting point filled in. */
export function withCityDefaults(trip: Trip): Trip {
  const c = cityConfig(trip.city);
  return c ? { ...trip, currency: trip.currency ?? c.currency, base: trip.base ?? c.base } : trip;
}

/** The currency of a city ("JPY" if unknown). */
export const currencyOf = (city: string | null | undefined): string => cityConfig(city)?.currency ?? "JPY";

const spotCity: Record<string, string> = {};
for (const [name, spots] of Object.entries(byCity)) for (const s of spots) spotCity[s.id] = name;
/** The currency a spot's price is in (its city's). */
export const currencyOfSpot = (spotId: string): string => currencyOf(spotCity[spotId]);

/** True if the spot comes from an OpenStreetMap snapshot (its card must credit OpenStreetMap, ODbL). */
export const fromOpenStreetMap = (spotId: string): boolean => /OpenStreetMap/.test(cityConfig(spotCity[spotId])?.source ?? "");

/** "¥30,000", "€500": a whole amount in a currency (same look as before for yen). */
export function formatMoney(amount: number, currency = "JPY"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-US")} ${currency}`;
  }
}

/** Distance in km (flat approximation, fine inside a city). */
export const kmBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));
