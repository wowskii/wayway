# Team update — web skeleton + AI interview (Quentin)

Branch `feature/web-skeleton`. Details: [`web-skeleton.md`](web-skeleton.md).

**What's done**
- **App:** Next.js 16 + Tailwind at the repo root. `@/contracts/contract` works, same import as the AI module.
- **Database:** Supabase (cloud), all tables built from the contract. Privacy is enforced by the database
  itself: group data / private data / server-only data (credits) are in separate tables. 16 automatic privacy checks pass.
- **Accounts + invites:** sign-up / login (email + password), invite link `/join/<code>`
  (demo: `/join/tokyo26`), "My trips".
- **AI interview** (replaces the old profile form, teacher's feedback): private chat with WayWay covering
  interests, pace, sleep, diet, allergies and budget. Diet / allergies / budget are saved only after
  the user **confirms a card**, which shows who will see each item. Runs on a **mock** AI for now, with the
  same input/output as Simon's `extractPreferences`. 29 automatic checks pass.

**How it plugs into your work**
- **Simon (AI):** switch to the real AI in one place (`src/lib/ai/interviewer.ts`, `WAYWAY_AI_MODE=real`).
  The interview needs 2 extras that `extractPreferences` doesn't return yet: interests/pace/sleep and
  "which topics are done" (`src/lib/ai/types.ts`). Let's agree on them. `/api/private` already follows the contract.
- **Patrick (group chat):** `chat_messages` table is ready, with realtime. Members can post as themselves
  straight from the browser; WayWay posts through the API. Reuse the header, buttons, colors and bubbles.
  After the interview, users should land on your chat page.
- **Henry (logic & evaluation):** credits / "definitely no" counter (`member_state`, `credit_events`) are
  server-only. `votes`, `option_sets`, `decisions` are ready. The test scripts in `scripts/` show how to
  create test users and trips for your scenarios.
- **Everyone:** ask me for the `.env.local` values (private), then `npm install` and `npm run dev`.
  DB changes = new migration file + tell the team. `contract.ts` was not changed.

**Still open:** who builds trip creation + share link/QR? · real AI connection · group chat, options, votes, itinerary pages.
