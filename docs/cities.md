# Cities (OpenStreetMap) — plan in Paris, not only Tokyo

WayWay plans in every city listed in `data/cities.json`. **Tokyo** keeps its hand-made dataset (with Henry's
allergen evidence); **other cities** come from an **OpenStreetMap snapshot** built once by a script.
The app never calls OpenStreetMap live: it reads `data/spots_<city>.json` (reproducible, no external dependency
during a demo). Google stays for the map only (place card on click, by `placeId`, never stored).

## How it fits
```
trip.city ──► src/lib/cities.ts ──► spotsForCity(city) ──► filterSpotsForTrip (Henry) ──► selectSpots (AI module)
                │                                                                          │ open THAT weekday,
                │ currency, timezone, base point (data/cities.json)                        │ slot type, ~40 most
                ▼                                                                          ▼ relevant spots
          Trip.currency / Trip.base (toTrip)                                     generateOptions / reviseOptions
```
- Spot ids are unique across cities, so `SPOTS_BY_ID`, `SPOT_INDEX`, `getSpot` find the spots of any trip
  (votes, itinerary, map). `SPOTS` stays the Tokyo list (the evaluation runs on Tokyo).
- Trip creation lists the cities of `data/cities.json`; a non-Tokyo trip gets its city's timezone.
- Prices and budgets are in the trip's currency (`formatMoney`): ¥ in Tokyo, € in Paris.

## Contract (additive only, Tokyo unchanged)
- `Spot.category`: new `"landmark"` (monument, tower, square, viewpoint).
- `Spot.openHoursByDay?`: per weekday `"HH:MM-HH:MM"` or `"closed"` (the Louvre is closed on Tuesday).
- `Trip.currency?` (default `JPY`) and `Trip.base?` (where the group starts), filled from `data/cities.json`.

## Add a city
1. Add it to `CITIES` in `wayway-ai/scripts/osm-city.ts` (bounding box, currency).
2. `cd wayway-ai && npm run city:fetch -- <key>` (one Overpass query; public servers are often busy, the script retries),
   then `npm run city:convert -- <key>` → `data/spots_<key>.json` + `data/osm/meta_<key>.json` + a quality report.
3. Add the city to `data/cities.json` (file, currency, timezone, base point) and one import line in `src/lib/cities.ts`.
4. Optional: `scripts/match-places.mjs` to add Google `placeId`s (photos / reviews on the map card).
5. `npm run test:logic` (each city file is validated) and `cd wayway-ai && npm run try:city -- <City>`.

## What the conversion does
- Category from OSM tags; places marked `opening_hours=closed` (e.g. Centre Pompidou, closed for works) are dropped.
- `opening_hours` → usual window + per-day table (holidays ignored; lunch + dinner → the window around 12:30).
- Diet from `diet:*` / `cuisine`; **unknown = not safe** (no tag = no diet). Allergens are never in OSM: Henry's
  filter marks food spots `allergy_unverified`, WayWay reminds the member privately (not blocked).
- Area = nearest OSM quarter (travel time uses "same area"). Fame (number of name translations + Wikidata) orders
  the file, so the best known places come first.
- **Estimates** by category: price, visit length, and opening hours when OSM has none. Listed per spot in
  `data/osm/meta_<key>.json` (`estimated`). Landmarks are often 0 € (e.g. Eiffel Tower): the budget check is
  less precise than in Tokyo.

## Paris snapshot (Nov 25, central Paris)
5,109 usable OSM places → 330 kept · real opening hours 87% (museums 100%, landmarks 20%) · hours that differ
by weekday 54% · food with a diet tag 68% (105 vegetarian, 38 vegan, 5 halal) · 44 areas.
Real model (`npm run try:city`): both slots valid, ~40 spots sent instead of 161, ≈ €0.02 per options call.

Data © OpenStreetMap contributors, available under the Open Database License (ODbL). `data/spots_paris.json`
is a derived database: it stays under ODbL and the attribution must be shown where the data is used.
