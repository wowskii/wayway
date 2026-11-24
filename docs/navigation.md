# Navigation

How the pages of WayWay fit together (Quentin's pages + Patrick's trip page).

## Pages

| URL | What it is |
|---|---|
| `/` | My trips + "New trip" (logged out: welcome) |
| `/trips/new` | Create a trip → invite link → "Next: tell WayWay what you enjoy" |
| `/join/<code>` | Invite link → "Join the trip" |
| `/trips/<id>/interview` | One-time AI interview (full page). Closed once finished |
| `/trips/<id>` | **Group chat** (Patrick's trip page: trips list, WayWay tools, group chat). `?panel=private\|suggestions\|itinerary` opens a tool |
| `/trips/<id>/map` | Trip map |
| `/trips/<id>/me` | What WayWay learned about me: "Your group can see" / "Only you can see" |

Every link to a trip points to `/trips/<id>`. A member who has not finished the interview is sent to
`/trips/<id>/interview` from every trip page, so the interview always comes first.

## The interview rule

- interview not finished → only `/interview` is open; the trip page, map and Me redirect to it
- interview finished → `/interview` redirects to the group chat

My pages use `loadTripPage(tripId, page)` (`src/lib/trip.ts`: login, membership, this rule). The trip page
does its own loading (`loadHub`) and applies the same rule with `needsProfile`.

After the interview, the private chat with WayWay stays open as the **WayWay** tool of the trip page
(bottom left): what a member adds there still updates their profile. "Me" → **Update with WayWay**
opens it (`/trips/<id>?panel=private`).

## Header (one for the whole app)

```
WayWay | Tokyo Spring Trip | Group chat · Map                       Me · Log out
```

- `<TripHeader tripId tripName dates active="chat" | "map" | "me">` on every trip page.
- `<Header>` alone on pages without a trip (home, new trip, join); `<Header wide>` + trip name on the interview.
- `TripTabs` (Group chat | Map) replaces Patrick's `ChatboxTabs`. From md up the tabs start at the trip
  page's sidebar edge, on every page, so they never move. On phones "Group chat" becomes "Chat".
- The user's name is not shown in the bar.

## AI

All AI calls go through the switches in `src/lib/ai/` (`interviewer`, `wayway`, `feedback`, `rounds`),
set by `WAYWAY_AI_MODE` in `.env.local`: `mock` (default, free) or `real` (needs `OPENROUTER_API_KEY`).
No page imports the mock directly. The group chat shows "WayWay is typing…" during a call (the real AI can
take ~30 s for options) and an error line if it fails.

## Next: the Me page

"Start a new interview" is still disabled. Idea: start the interview again in the private chat; the old
answers stay until the new interview is finished, then they are replaced. Profiles are per trip for now.
