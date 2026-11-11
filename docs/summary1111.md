# WayWay web skeleton + AI interview (branch `feature/web-skeleton`)

Author: Quentin · Date: Nov 11, 2026 · Status: 8 commits, not merged yet

This document explains everything added on this branch: what it does, how it works, how to run it,
and how the other parts of WayWay plug into it. Short version for the team: [`team-update.md`](team-update.md).

---

## 1. Why

- Milestone 3 needs a **working app** where the whole flow runs end to end. Nothing existed yet besides the
  contract (`src/contracts/contract.ts`) and the example JSON in `fixtures/`.
- The teacher's feedback on Milestone 2: the Figma prototype was **too complex**, and the welcome form
  **wasn't AI enough**. So onboarding is now a **private chat with WayWay** (an "AI interview") instead of a
  long form, with one main action per screen.

What this branch delivers:

1. The **foundation** everyone builds on: Next.js app, Supabase database built from the contract, accounts.
2. **Joining a trip** with an invite link.
3. The **AI interview**: page, API and database, working today with a **mock** interviewer and ready to
   switch to the real AI from the `feature/ai-module` branch.

---

## 2. How to run it

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local     # then paste the values (ask Quentin, never commit them)
npm run dev                    # http://localhost:3000
```

Then open **http://localhost:3000/join/tokyo26**, create an account, join the demo trip and do the interview.

### Environment variables (`.env.local`)
| Variable | What it is | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | API address of the Supabase project (`https://<id>.supabase.co`) | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public "publishable" key, used by the browser | no |
| `SUPABASE_SERVICE_ROLE_KEY` | secret key that bypasses privacy rules, **server only** | **yes** |
| `SUPABASE_DB_URL` | database connection string (Session pooler) for migrations | **yes** |
| `WAYWAY_AI_MODE` | `mock` (default, no key needed) or `real` | no |
| `OPENROUTER_API_KEY` | for the real AI later | **yes** |

### Commands
| Command | What it does |
|---|---|
| `npm run dev` | start the app |
| `npm run build` / `npm run lint` | production build / code checks |
| `npm run db:push` | apply new files from `supabase/migrations/` to the cloud database |
| `npm run db:types` | regenerate the TypeScript types of the tables |
| `npm run seed` | create the demo trip "Tokyo Spring Trip" (invite code `tokyo26`) |
| `npm run check:privacy` | 16 automatic privacy checks against the real database |
| `npm run check:interview` | 29 automatic checks of the interview API (app must be running; `APP_URL` to change port) |

---

## 3. Steps, one commit each

| # | Commit | What |
|---|---|---|
| 1 | `62c8f6b` | Next.js app |
| 2 | `fd5a8eb` + `3aa1469` | Supabase connection (+ fix: restore `.env.example`, ignore CLI cache) |
| 3 | `102a7f4` | Database tables from the contract, privacy rules, scripts |
| 4 | `8591e72` | Accounts and joining a trip |
| 5 | `ced82a9` | Interview API + mock interviewer |
| 6 | `2ea8f8e` | Interview chat page |

### Step 1 — Next.js app
- **Next.js 16.4.3 + React 19.2.9** (App Router, TypeScript, Tailwind CSS, ESLint), versions pinned exactly.
  The version first installed by the setup tool (16.0.1) had a **critical security flaw** (remote code
  execution in React Server Components), so it was upgraded to a patched version. `npm audit` on runtime
  dependencies: 0 vulnerabilities.
- The app lives at the **repo root** with a `src/` folder. The import alias `@/*` points to `src/*`, so
  `import ... from "@/contracts/contract"` works — **the same import the AI module already uses**.
- WayWay colors from the Figma "Simplified" screens are Tailwind tokens: `bg-brand`, `bg-brand-soft`,
  `bg-page`, `text-muted`, `border-line`… (in `src/app/globals.css`). Font: Inter.
- `tsconfig.json` ignores `planning/` and `wayway-ai/` (they have their own setup).

### Step 2 — Supabase connection
Cloud Supabase project (region Tokyo). Three ways to talk to the database, in `src/lib/supabase/`:

| File | Runs in | Acts as | Privacy rules |
|---|---|---|---|
| `client.ts` | browser (`"use client"` components) | the logged-in user | apply |
| `server.ts` | server (pages, API routes, server actions) | the logged-in user (reads the login cookie) | apply |
| `admin.ts` | server only | "master key" (secret key) | **bypassed** — only for trusted server code |

`admin.ts` imports `server-only`: if anyone imports it from browser code, the build fails on purpose.

`src/proxy.ts` (Next.js 16 renamed "middleware" to "proxy") runs before every page: it refreshes the
login cookie, and sends logged-out visitors of `/trips/...` and `/join/...` to `/login?next=...`.

### Step 3 — Database (Supabase / Postgres)
SQL files in `supabase/migrations/`, applied with `npm run db:push`. Full table reference: `supabase/note.md`.

**Main idea: privacy is enforced by the database, not only by the UI.** One person's data is split into
three tables according to who may read it, and every table has Row Level Security (RLS) rules
("a bouncer per table"):

| Table | Contract type | Who can read |
|---|---|---|
| `profiles` | account (display name) | yourself |
| `trips` | `Trip` | members + creator |
| `trip_members` | public part of `MemberProfile`: name, diet, interests, pace, sleep, onboarding status | everyone in the trip |
| `member_private` | allergies, max budget, private note, preference statements, interview topics | **only you** |
| `member_state` | fairness credits, "definitely no" counter | **nobody — server only** |
| `private_messages` | `PrivateMessage` (+ confirmation card fields) | **only you** |
| `chat_messages` | `ChatMessage` (realtime) | everyone in the trip; you can post as yourself |
| `slot_proposals`, `option_sets`, `decisions`, `itinerary_items` | contract types (nested parts as JSON) | everyone in the trip; written by the server |
| `votes` | `Vote` | only your own votes; written by the server |
| `credit_events` | `CreditEvent` | **nobody — server only** |

Design choices:
- **The AI only proposes.** Diet / allergies / budget detected by WayWay are stored on its message as
  `constraints_to_confirm` with status `pending`, and copied to the profile only after the member confirms.
- **Rules are enforced by code.** Votes, options, decisions and credits are written by API routes with
  the admin key, after the code checks the rules (quorum, "definitely no" limit, fairness).
- **Contract-friendly.** Nested objects (`TimeSlot`, `Option[]`, `Branch[]`) are `jsonb`, and text + `CHECK`
  is used instead of enums, so small contract changes don't need a database change.
- **Realtime** is on for `chat_messages`, `slot_proposals`, `option_sets`, `decisions`, `itinerary_items`.
- **Integrity:** composite foreign keys guarantee that a message's member belongs to the same trip.

Database functions:
- `join_trip(code)` — joins the trip with its invite code, creates the member's 3 rows, returns the member id.
  Calling it twice is safe.
- `trip_preview(code)` — name, city, dates and member count for the join page (no private data).
- `is_trip_member(trip_id)`, `owns_member(member_id)` — helpers used by the privacy rules.
- A trigger creates the `profiles` row at sign-up from the name typed in the form.

Code side:
- `src/lib/db/database.types.ts` — generated TypeScript types of every table (`npm run db:types`).
- `src/lib/db/mappers.ts` — translators between database rows (`max_budget`) and contract types (`maxBudget`):
  `toMemberProfile`, `toTrip`, `toPrivateMessage`, `toChatMessage`. The rest of the app uses contract types only.

Migrations:
1. `…01_people_and_onboarding.sql` — profiles, trips, members (3 tables), private messages, functions, rules.
2. `…02_group_decisions.sql` — group chat, slots, option sets, votes, decisions, credits, itinerary, realtime.
3. `…03_interview_topics.sql` — `member_private.interview_topics` (so "no allergies" ≠ "not asked yet").

**Rule:** never edit a migration that was already pushed; add a new file.

Privacy test (`npm run check:privacy`, 16 checks, all passing): creates Alice and Bob in a trip and Eve
outside it, then checks that Bob cannot read or write Alice's private data or chat, cannot post as Alice or
as WayWay, nobody can read fairness credits, Eve sees nothing, logged-out visitors see nothing.

### Step 4 — Accounts and joining a trip
- `/signup` (name, email, password) and `/login` — server actions in `src/app/(auth)/actions.ts`.
  Supabase stores the password (hashed) and sets the login cookie. "Confirm email" is turned off for development.
- `?next=` brings the user back to where they were (e.g. the invite) after login. Links to other websites
  (`//evil.com`) are ignored.
- `/join/[code]` — shows the trip (`trip_preview`) and one action, **Join the trip** (`join_trip`), then opens
  the interview. Members who open the link again go straight to the trip.
- `/` — welcome screen when logged out; **My trips** when logged in, with a "Finish your profile" badge.
- Shared UI: `src/components/ui.tsx` (`Card`, `Button`, `Field`, `ErrorText`, `Logo`) and
  `src/components/Header.tsx` (logo, name, log out). `src/lib/auth.ts`: `getCurrentUser`, `requireUser`, `formatTripDates`.

How the invite link works:
- **Backend:** each trip gets a random 8-character `invite_code` automatically (column default).
  `trip_preview` and `join_trip` find the trip by that code.
- **Frontend:** in Next.js, folders are URLs. `src/app/join/[code]/page.tsx` handles `/join/<anything>`
  and receives `<anything>` as `code`.
- **Missing:** a page to *create* a trip and *show/share* its link or QR code (Role 1 in the roles PDF).
  The demo trip's code `tokyo26` comes from `npm run seed`.

### Step 5 — Interview API + mock interviewer
**The plug (`src/lib/ai/types.ts`).** `ExtractInput` / `ExtractOutput` are exact copies of the types of
Simon's `extractPreferences` (`feature/ai-module`, `wayway-ai/lib/ai/extractPreferences.ts`). The interview
adds two things on top (`InterviewOutput`), **to be agreed with Simon before touching the contract**:
- `profileUpdate` — `interests`, `pace`, `sleep` found in the answer (fields of `MemberProfile` that
  `extractPreferences` does not return today);
- `interview` — topics covered / missing and `done`.

Topics, in order: interests → pace → sleep → diet → allergies → budget.

**The switch (`src/lib/ai/interviewer.ts`).** `WAYWAY_AI_MODE=mock` uses the fake interviewer;
`real` is the place to call the real AI once the AI module is merged. The route and page don't change.

**The mock (`src/lib/ai-mock/interview.ts`).** Asks the 6 topics in order and recognises keywords
(e.g. "ramen" → food, "night owl", "vegetarian", "peanuts", "40k yen"). "Don't tell the group…" creates a
`[private] ` statement. "No" / "anything is fine" counts as an answer. Replies are 1–2 short sentences,
following the AI module's rules. It's deliberately simple: free, offline, predictable for tests.

**The logic (`src/lib/interview/service.ts`).** Each turn: check who you are (with your own login, so the
database rules apply) → save your message → ask the interviewer → save statements and topics
(`member_private`) and interests/pace/sleep (`trip_members`) → save WayWay's reply, with a confirmation
card if diet/allergies/budget were detected → send both messages back.

**The routes** (`src/app/api/private/...`):
| Route | Body | Does |
|---|---|---|
| `GET /api/private?tripId=` | — | chat history + progress; posts WayWay's greeting the first time |
| `POST /api/private` | contract `PrivateChatRequest` (`tripId`, `memberId`, `message.text`) | one interview turn; returns contract `PrivateChatResponse` + `interview` progress |
| `POST /api/private/confirm` | `tripId`, `messageId`, `decision: "confirm" \| "reject"`, optional edited `constraints` | applies the card only on confirm (diet → public, allergies/budget → private); a card can be answered once |
| `POST /api/private/finish` | `tripId` | marks onboarding done, only when every topic is covered |

Inputs are checked (ids, message length ≤ 1000, clean card values). Errors return clear JSON messages
(400 / 401 / 403 / 404 / 409); unexpected errors are logged and hidden from the user.

Interview test (`npm run check:interview`, 29 checks, all passing): a full interview with Mia (cards
confirmed, edited and rejected, `[private]` statement, finish rules) plus security (Ken cannot write in or
answer Mia's interview, logged-out → 401, bad input → 400).

### Step 6 — Interview chat page
`/trips/[tripId]/interview` (`src/components/interview/`):
- **Top:** "Get to know you", the privacy line "🔒 Only WayWay sees this chat, never your group",
  6 topic chips that turn green, and **Finish** when everything is covered and no card is waiting.
- **Chat:** WayWay bubbles on the left (soft green, like the Figma), member on the right. Messages appear
  immediately; typing dots while WayWay answers; Enter sends, Shift+Enter = new line; on error the text is
  given back. The chat reloads from the database, so it continues on another device.
- **Confirmation card** (`ConstraintCard.tsx`): "Did I get this right?" with **Confirm / Edit / That's wrong**,
  and for each item **who will see it** ("Your group can see this" for diet, "Private: only WayWay" for
  allergies and budget). This is the human-AI collaboration point: the user reviews and corrects the AI.
- **End:** "You're all set!" and back to My trips (the badge disappears).

---

## 4. How it fits with the rest of the team

### Simon — AI (`feature/ai-module`)
- Same contract import (`@/contracts/contract` → `src/contracts/contract.ts`), so `wayway-ai/lib/ai` can move
  to `src/lib/ai/` with no import changes.
- **To connect the interview:** in `src/lib/ai/interviewer.ts`, for `WAYWAY_AI_MODE=real`, call
  `extractPreferences` (round 0) and return the interview extras. Nothing else changes.
- **To discuss:** `extractPreferences` doesn't return interests / pace / sleep or "which topics are done";
  the page needs both (see `InterviewOutput`). Options: extend its schema, or an interview-specific prompt.
  Quentin can help write it. Any `contract.ts` change → tell the team first.
- `/api/private` already follows the contract (`PrivateChatRequest` / `PrivateChatResponse`) for round 0;
  rounds 1–3 (reactions to options) can use the same route and the same `private_messages` table.
- `toMemberProfile()` builds the full `MemberProfile` (including private fields and credits) from the database
  for the AI context — server only.
- `[private] ` statements are stored as the AI module does, in `member_private.preference_statements`.
- Merge note: both branches add a root `.gitignore` → small conflict, keep both lists.

### Patrick — group chat
- Table `chat_messages` with **realtime** and privacy rules: members read their trip's messages and can post
  **as themselves** directly from the browser (`src/lib/supabase/client.ts`). WayWay's messages
  (`sender_member_id = null` → `senderId "wayway"`) are written by `/api/chat` with the admin key.
- `toChatMessage()` converts rows to the contract `ChatMessage`.
- Reuse `Header`, `Card`, `Button`, the color tokens and the bubble style (`MessageBubble.tsx`).
- After the interview, members should land on the group chat page (e.g. `/trips/[tripId]`) — today they go
  back to My trips. `trip_members.onboarding_status` tells whether someone finished the interview.

### Henry — logic & evaluation
- Fairness credits and the "definitely no" counter live in `member_state`, audit trail in `credit_events`:
  **server only** (admin key), invisible to every user, as the contract requires.
- `votes` (private per member), `option_sets`, `decisions`, `itinerary_items` are ready for the vote rules
  and metrics; nested contract objects are `jsonb`.
- Test scenarios: create users and trips the way `scripts/check-privacy.mjs` / `scripts/check-interview.mjs`
  do (admin creates users, `join_trip` adds them). Those scripts are good templates for scenario runners and
  give real ids for `run_scenario.py`. Both tests can also feed report section 1.4 (privacy, constraints).
- Spots are not in the database yet (still `spots_tokyo.json`).

### Quentin — itinerary (next)
- `itinerary_items` (day, start/end time, `spot_id` or `branches` for a split) is ready, with realtime.

### Everyone
- Get the `.env.local` values from Quentin privately (not through Git), then `npm install` and `npm run dev`.
- Database changes = a **new** migration file + `npm run db:push` + `npm run db:types` + tell the team.
- Run `npm run check:privacy` after any change to the rules.
- `contract.ts` was **not** changed by this branch.

---

## 5. Known limits / next steps
- The interviewer is a **mock** (keywords only): "I like seeing old stuff" is not understood. Real AI next.
- If the AI fails in the middle of a turn, the member's message stays saved without a reply (to handle when
  the real AI is connected).
- No trip creation / share link / QR code page yet.
- No group chat page, options, votes or itinerary UI yet (other roles + next steps).
- Email confirmation is off (development setting).
- Not tested visually in an automated way (no browser automation); all checks are HTTP/API level.

## 6. File map
```
src/
  app/
    page.tsx                         home: welcome / My trips
    (auth)/login, (auth)/signup      account pages; actions.ts = sign up / log in / log out
    join/[code]/                     invite page + join action
    trips/[tripId]/interview/        interview page
    api/private/                     GET/POST, confirm/, finish/
  components/
    ui.tsx, Header.tsx               shared UI
    interview/                       InterviewChat, MessageBubble, ConstraintCard, TopicProgress
  contracts/contract.ts              team contract (unchanged)
  lib/
    supabase/                        client.ts, server.ts, admin.ts, env.ts
    db/                              database.types.ts (generated), mappers.ts
    ai/                              types.ts (the plug), interviewer.ts (mock/real switch)
    ai-mock/interview.ts             fake interviewer
    interview/                       service.ts (logic), http.ts, types.ts
    auth.ts                          current user helpers
  proxy.ts                           login refresh + redirects
supabase/
  migrations/                        3 SQL files
  note.md                            database reference
scripts/                             db.mjs, seed.mjs, check-privacy.mjs, check-interview.mjs
```
