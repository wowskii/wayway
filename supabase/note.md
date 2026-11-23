# WayWay database (Supabase / Postgres)

The tables are created by the SQL files in `migrations/` (run in order). They follow `src/contracts/contract.ts`.

## Commands
| Command | What it does |
|---|---|
| `npm run db:push` | Applies new migration files to the cloud database (needs `SUPABASE_DB_URL` in `.env.local`) |
| `npm run db:types` | Regenerates `src/lib/db/database.types.ts` (TypeScript types of the tables) |
| `npm run seed` | Creates the demo trip "Tokyo Spring Trip" (invite code `tokyo26`) |
| `npm run check:privacy` | Automatic test that one member cannot read another member's private data |
| `npm run check:interview` | Plays a full mock interview through the API and checks what was saved (app must be running) |

## Local database (Docker)
Work on schema changes locally first, push to the cloud only when they are done.
| Command | What it does |
|---|---|
| `npm run local:start` / `local:stop` | Starts / stops a local Supabase in Docker (Studio: http://127.0.0.1:54323) |
| `npm run local:reset` | Wipes the local database and re-applies every migration |
| `npm run local:types` | Regenerates `database.types.ts` from the LOCAL database |
| `npm run local:seed` / `local:check:privacy` | Same as `seed` / `check:privacy`, against the local database |

`npm run dev` uses the local database when `.env.development.local` exists (local URL and keys; not committed).
A migration may be edited freely until it is pushed to the cloud.

To change the schema: **add a new migration file** (never edit one that was already pushed), tell the team, push, regenerate types.

## Tables
| Table | Contract | Who can read | Who writes |
|---|---|---|---|
| `profiles` | account (display name) | yourself | sign-up trigger, yourself |
| `trips` | `Trip` | members + creator | creator |
| `trip_members` | public part of `MemberProfile` (name, diet, interests, pace, sleep) | everyone in the trip | `join_trip()`, yourself (some columns) |
| `member_private` | private part (allergies, max budget, private note, preference statements, interview topics covered) | **only you** | you, API |
| `member_state` | fairness credits, "definitely no" counter | **nobody** (server only) | API |
| `private_messages` | `PrivateMessage` (interview + private reactions; `option_set_id` = the decision a message is about, NULL for the interview) | **only you** | you (your own messages), API (WayWay replies) |
| `chat_messages` | `ChatMessage` (group chat, realtime) | everyone in the trip | members (as themselves), API (WayWay) |
| `slot_proposals` | `SlotProposal` | everyone in the trip | API |
| `option_sets` | `OptionSet` (options stored as JSON) | everyone in the trip | API |
| `votes` | `Vote` | **only your own votes** | API (checks the rules) |
| `decisions` | `Decision` | everyone in the trip | API |
| `credit_events` | `CreditEvent` | **nobody** (server only) | API |
| `itinerary_items` | `ItineraryItem` | everyone in the trip | API |
| `chat_reads` | read receipts: how far each member has read the group chat (one row per member) | everyone in the trip | `mark_chat_read()` (yourself, forward only) |

## Why this design
- **Privacy by the database, not just the UI.** A person's data is split by who may read it
  (public / private / server-only), and Row Level Security (RLS) rules make Postgres refuse other reads.
  Even a bug in the frontend cannot leak someone's allergies or budget.
- **The AI only proposes.** Hard constraints detected by WayWay are stored on the message as
  `constraints_to_confirm` (status `pending`) and copied to the profile only after the member confirms.
- **Rules enforced by code.** Votes, options and decisions are written by API routes with the server-only
  admin key, after the code checks quorum, limits and fairness.
- **Contract-friendly.** Nested contract objects (`TimeSlot`, `Option[]`, `Branch[]`) are `jsonb`, so small
  contract changes don't need a migration. Text + `CHECK` instead of enums for the same reason.
- **Realtime.** Group chat, slots, options, decisions and itinerary push live updates to the app (still filtered by RLS).

## Database functions
- `join_trip(invite_code)` → joins the trip (creates the 3 member rows) and returns the member id. Safe to call twice.
- `trip_preview(invite_code)` → name, city, dates and member count, shown on the join page before joining.
- `mark_chat_read(trip_id, last_read_at)` → saves how far you have read the group chat (only yours, never backwards).
- `is_trip_member(trip_id)`, `owns_member(member_id)` → helpers used by the RLS rules.
