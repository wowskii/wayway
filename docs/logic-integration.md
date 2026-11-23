# Logic & evaluation (Role 4) — how to plug it in

Branch `feature/logic-evaluation` (based on `feature/web-skeleton`). Everything is in TypeScript, pure functions
(no database or network calls), imported as `@/lib/logic`. Principle from the roles doc: **the LLM proposes and
explains, the code enforces constraints, computes fairness and applies the vote rules.**

```bash
npm install
npm run test:logic        # 28 tests: rules, AI-module adapter, DB round trip, real dataset
npm run eval:offline      # 4 decision scenarios with fixed votes (no AI)
npm run eval:ai -- --baseline   # full pipeline on 4 persona scenarios, rule-based generator (no AI)
npm run eval:ai -- --mock       # same with Simon's AI module + fake model (after merging feature/ai-module)
npm run eval:ai                 # same with the real model (needs OPENROUTER_API_KEY in .env.local)
```

## Files

| File | What it does |
|---|---|
| `src/lib/logic/constraints.ts` | Hard constraints. `filterSpotsForTrip` (before the AI) and `checkOption` (each proposed route). |
| `src/lib/logic/options.ts` | `buildOptions`: AI candidates → option cards A / B / C with metrics and fairness sentence. |
| `src/lib/logic/metrics.ts` | Satisfaction metrics (mean, min, Gini, satisfied ratio, credit-weighted total). |
| `src/lib/logic/credits.ts` | Fairness credits at the final decision. |
| `src/lib/logic/voting.ts` | Final vote: quorum, 30-min extension, tie revote, daily "definitely_no" limit, split consent. |
| `src/lib/logic/itinerary.ts` | Itinerary items for the chosen option; money already committed per member. |
| `src/lib/logic/persistence.ts` | Supabase rows ↔ voting state (no DB calls, just translation). |
| `src/lib/logic/dataset.ts` | Loads and validates `data/spots_tokyo.json` + `data/spots_evidence.json`. |
| `src/lib/logic/evaluation.ts` | Estimate accuracy, privacy scan, scripted personas, run report. |
| `eval/` | Offline scenarios, persona scenarios and the evaluation runner. |
| `supabase/migrations/20261123000001_vote_extension_flag.sql` | One new column, `option_sets.vote_extended`. |

## For Simon (AI module): replace the two temporary functions

`wayway-ai/scripts/try-ai.ts` has `tempFilterHardConstraints` and `tempRank`. Tested replacement, on a local
merge of the three branches (`npm run try:mock` and `npm run typecheck` in `wayway-ai/` both pass). One line to
change first in `wayway-ai/tsconfig.json`, so `@/lib/...` resolves too:
`"paths": { "@/*": ["../src/*"] }` (instead of only `@/contracts/*`).

```ts
import { buildOptions, filterSpotsForTrip } from "@/lib/logic";
import { EVIDENCE, SPOT_INDEX } from "@/lib/logic/dataset";

const allowed = filterSpotsForTrip(SPOTS, TRIP.members, { evidence: EVIDENCE, spentByMember }).allowed;
const gen = await generateOptions({ trip, slot, allowedSpots: allowed, recentChat });
const { options, candidateOptionId, privateWarnings } =
  buildOptions(gen.candidates, trip.members, SPOT_INDEX, credits, { spentByMember });
// round 2-3: buildOptions([candidate, ...rev.candidates], ...) keeps the candidate unless a new route beats it
```

`buildOptions` takes your `Candidate[]` as is (same shape) and:

1. drops a candidate that breaks a hard constraint (budget per member path, diet, known allergen, unknown spot);
2. drops a route already proposed (same stops), keeping the first one — so pass the kept candidate first;
3. **A** = best credit-weighted total, **B** = fairest of the *other* shared routes (highest minimum, then mean),
   **C** = split, only if no shared route keeps everyone at `same` or better (same rule as your `tempRank`);
4. recomputes `satisfiedMemberIds` and `metrics` (never trusted from the model);
5. writes `fairnessNote` on A **only** when credits changed which route is A, e.g. *"Tom's choice is favored a
   little this time: they compromised on an earlier decision."* (no numbers). Pass its name to `writeMessage`
   as `favoredMemberName` if you want the chat message to say it too;
6. returns `privateWarnings` (e.g. allergen data missing for a member on a food stop): tell that member
   **privately**, never in the group.

## For the API routes (/api/chat): order of calls

1. **Options** (after a slot is confirmed): `filterSpotsForTrip` → `generateOptions` → `buildOptions` →
   save `option_sets` (`options`, `candidate_option_id = candidateOptionId`).
2. **Final vote opens**: `startPoll(optionSet, guard, trip.timezone, credits)` throws if an option became unsafe.
3. **Each vote**: `pollFromRows(...)` → `castVote(poll, vote, attempt, now)` →
   on `error`, answer that member with `contractErrorCode(error)`; otherwise upsert `voteToRow(v)` and
   `memberStateUpdates(before, after)` (the "definitely_no" counter).
4. **At the deadline** (timer or next request after it): `advancePoll(poll, now, guard)`, then
   - still `open` with a later deadline → save `optionSetUpdate(poll)`, WayWay posts `no_quorum` or `tie_revote`;
   - `decided` → `itineraryFromOption(chosen, slot, SPOTS_BY_ID)`, then insert `decisionRows(...)` and
     `memberStateUpdates(...)` (credits) **in one transaction** (or an RPC), WayWay posts `decision` / `split_refused`;
   - `no_quorum`, `no_split_fallback`, `constraints_changed` → no decision; WayWay tells the group and the slot can
     be asked again.
5. **Budget**: pass `spentByMember = spentFromItinerary(items, memberIds, SPOTS_BY_ID)` everywhere, so later
   options respect what is already planned.

Use server time and the authenticated member id, never values sent by the browser. `member_state`,
`credit_events`, `privateWarnings` and `filterSpotsForTrip(...).removed` are server-only (they reveal budgets and
allergies).

## For Quentin (database)

- New migration `20261123000001_vote_extension_flag.sql`: `option_sets.vote_extended boolean default false`.
  Needed for "extend **once** by 30 min". Please `npm run db:push` and `npm run db:types` when you merge.
  `persistence.ts` already works before the types are regenerated.
- `max_budget NULL` → mapper gives `maxBudget: 0` → the logic treats 0 as "not known yet" (no budget check).
- Votes keep `vote_attempt`; a revote does not delete attempt-1 rows, the logic only counts the current attempt.
- Merge note: `feature/web-skeleton` and `feature/ai-module` both add `.gitignore`, so merging them gives one
  small conflict (keep both lists). `data/spots_tokyo.json` is identical in this branch and in `feature/ai-module`
  (no conflict).

## Dataset

- `data/spots_tokyo.json` (39 spots, contract `Spot`) is the single shared dataset, the one the AI module already
  uses. Checked against last week's sourced catalog: the 15 spots both lists have agree on price and position
  (within ~300 m). One fix to make in the file: `ts_tantan` hours are 10:00-22:00 per the venue, not 07:00-22:30.
- `data/spots_evidence.json`: source URL, date checked and **allergens** for those 15 spots (the `Spot` type
  has no allergen field). Today only `ts_tantan` has a known allergen (sesame).
- `dataset.ts` validates both files at startup (ids, categories, `HH:MM-HH:MM` hours, Tokyo coordinates).

## Rules that need a team "ok" (current defaults)

| Question | Default in the code |
|---|---|
| When is B shown if A is also the fairest? | B = fairest among the *other* routes (Simon's suggestion). |
| Which option is the "candidate" carried to the next round / winning a second tie? | A (best credit-weighted total). |
| When is a split shown? | Only if no shared route keeps everyone at `same` or better. |
| Allergen data missing for a food stop | Not blocked; that member gets a private reminder. `strictEvidence: true` blocks instead. |
| Does a ballot count if a member rated only some cards? | No: a member must rate every card of the vote. |
| Missing split consent | Counts as "no" → best shared option wins (`split_refused`). |
| Changing a vote away from "definitely_no" | Does not give the use back (max 2 per member per local day). |
| Still below quorum after the 30-min extension | No decision (`no_quorum`), WayWay asks the group to try again. |
