# Trip map (Role 2) — Google Maps, itinerary, place cards, location sharing

Branch `feature/map`. Page: **`/trips/<tripId>/map`** (Figma `288:2015` "Trip map · Simplified", decluttered).
Try it: join `localhost:3000/join/tokyo26`, then open the **Map** tab (the demo trip has a seeded itinerary).

## What the page does
- **Itinerary panel** (left): day tabs, stops with times, a **split card** ("Your group · with …" / the other
  group), the **meeting point** after a split, and the trip between stops ("Walk · 5 min",
  "Train or subway · ≈ 25 min · Directions").
- **Map** (right): numbered pins (green = everyone / your group, blue = the other group, purple = second group
  when you are in neither), route lines (solid = real walking path, dashed = train/subway estimate).
- **Place card** on click (list or pin): our data (category, price, usual visit length, diet tags) + Google's
  (photo, rating, description, opening hours **on that trip day**, 3 reviews, "Open in Google Maps").
- **Location sharing** (opt-in, top-left of the map): share your real position or a demo position in Tokyo;
  members see each other live.

## How the data flows
```
itinerary_items (Supabase, RLS: members only)          data/spots_tokyo.json (with placeId)
        │ src/lib/itinerary/source.ts                          │ src/lib/spots.ts (SPOTS, getSpot)
        ▼                                                      ▼
  ItineraryItem[] ──► buildDayPlans (view.ts) ──► dayLegs (legs.ts) ──► TripMap (panel + map + card)
                                                                     │
           browser asks:  /api/google/map-load   (1 map load per page)
                          /api/route             (walking routes, short legs only)
                          /api/places/<placeId>  (place card, on click only)
                          member_locations       (location sharing, direct Supabase + Realtime)
```
A split is stored like Henry's `itineraryFromOption` writes it: one item with 2 `branches`, then the meeting
point as its own item that starts when the split ends (the contract has no rendezvous field on items).

## Google Maps Platform: what we use and the free tier
| API | Used for | Our daily limit | Free per month |
|---|---|---|---|
| Maps JavaScript | the map | 300 map loads | 10,000 |
| Routes (WALK, basic fields) | walking paths ≤ 1.2 km | 300 | 10,000 |
| Places (New) Text Search | `match:places` script only | 100 | 5,000 |
| Places (New) Place Details | place card (reviews = top tier) | 30 | 1,000 |
| Places (New) Photos | place card photo | 30 | 1,000 |

- **Every call is counted** in the shared table `google_usage` (migration 4) through `src/lib/google/server.ts`
  (`googleFetch`). Daily limit × 31 stays under the free monthly amount. Over the limit, the app refuses the
  call (no bill) and the page still works (placeholder, straight lines, our data only).
- **No public transport routes in Japan** through the Routes API (tested: empty answer). Legs over 1.2 km never
  call Google: dashed line + the same travel estimate as the AI (`travelMin`: 10 min in an area, else
  10 + 3 min/km) + a free Google Maps directions link (which does show trains).
- **Terms:** only Place IDs are stored (`placeId` in `data/spots_tokyo.json`). Details, reviews and photos are fetched on click
  and never saved; review authors, photo authors and "Details from Google" are always shown.

## Setup (once per machine)
1. `.env.local` needs the 3 Google values (see `.env.example`; ask Quentin, never commit them):
   `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (browser key, restricted to `http://localhost:3000/*` + Maps JavaScript API),
   `NEXT_PUBLIC_GOOGLE_MAP_ID` (needed for the pins), `GOOGLE_MAPS_SERVER_KEY` (Places + Routes, server only).
2. The app must run on **port 3000** (the browser key only works there).
3. Migrations 4 and 5 are already applied to the shared Supabase.

## Scripts
| Command | What it does |
|---|---|
| `npm run seed:itinerary [inviteCode]` | Puts the 2-day demo itinerary into a trip (default `tokyo26`), with the trip's **real members** alternating between the two groups. Re-run after people join. Only replaces seeded rows; refuses a trip with a real (voted) itinerary. |
| `npm run match:places` | Finds Google Place IDs for spots without one (`--dry-run`, `--only id1,id2`, `--query "…"`). Writes `placeId` into `data/spots_tokyo.json`; the review report goes to git-ignored `scripts/output/` (delete it after reading). |
| `npm run check:google` | 5 checks of the Google usage counter (limit, simultaneous calls, server-only). |
| `npm run check:locations` | 10 privacy checks of location sharing. |

## Location sharing: privacy rules (migration 5, `member_locations`)
Off by default · one row per member = latest position only, no history · same-trip members only ·
only the owner writes · others can't read it after 15 min without an update · the database sets the time ·
"Stop" deletes it · demo positions are flagged. The green "Sharing your location · Stop" indicator is always
visible while sharing. Browsers only give the location on `localhost` or HTTPS.

## Files
| File | Role |
|---|---|
| `src/app/trips/[tripId]/map/page.tsx` | Server page: user + trip check, loads the itinerary |
| `src/components/map/TripMap.tsx` | Page body: day, selected stop, walking routes, place details |
| `src/components/map/ItineraryPanel.tsx` · `MapView.tsx` · `PlaceCard.tsx` · `LocationLayer.tsx` | The UI pieces |
| `src/components/map/useLocationSharing.ts` | Sharing logic (geolocation, Supabase, Realtime) |
| `src/components/TripTabs.tsx` | Trip name + Group chat / Map tabs (**Patrick:** reuse it with `active="chat"`) |
| `src/lib/itinerary/view.ts` · `legs.ts` · `source.ts` | Day plans, legs, data source (pure logic except `source.ts`) |
| `src/lib/google/` | Daily limits + `googleFetch` (the only server code that calls Google) |
| `src/app/api/google/map-load` · `api/route` · `api/places/[placeId]` | The 3 Google routes (logged-in users only) |
| `src/lib/spots.ts` | Spots with their Place IDs, for the map |

## To do after the other branches are merged
- **Henry's PR** (`feature/logic-evaluation`): `data/spots_tokyo.json` is identical on both branches (no
  conflict). `package.json` / `package-lock.json` will conflict (both add scripts): keep **both** sets of
  scripts, then run `npm install` to rebuild the lock file.
  Done (Nov 25): the Place IDs are in `spots_tokyo.json` as `placeId` (`data/place_ids.json` deleted).
  Still open: replace `src/lib/spots.ts` by `@/lib/logic/dataset` (same `SPOTS` / `SPOTS_BY_ID` names),
  and import `travelMin` from `@/lib/logic/itinerary` in `legs.ts`.
- **Decision step** (Simon's `/api/chat`): when a vote decides, write the `itinerary_items` rows with their
  `option_set_id` (Henry's `itineraryFromOption` builds them). The map then shows them with no change.
- **Group chat** (Patrick): the "Group chat" tab links to the trip page `/trips/<id>` (see `docs/navigation.md`).

## Known limits
- Routes from Google's walking path start at the place's entrance (Place ID), so a line can start a little
  away from our pin (e.g. Meiji Shrine).
- Google's own points of interest make the map busy; they can be hidden with a Map Style attached to the Map ID
  in Google Cloud (no code change).
- Closing the page while sharing leaves the last position stored (unreadable after 15 min, replaced or deleted
  on the next share/stop).
