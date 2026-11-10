# WayWay AI module (role 3)

The AI part of WayWay, working on its own before it is plugged into the app.
Principle: **the LLM proposes and explains, the code checks and decides.**

## Files
| File | Role |
|---|---|
| `../src/contracts/contract.ts` | Team JSON contract (single shared copy, imported as `@/contracts/contract`) |
| `lib/ai/config.ts` | OpenRouter URL, model ids (`anthropic/claude-sonnet-5.5`, `anthropic/claude-haiku-5.5`), temperatures, limits |
| `lib/ai/llm.ts` | The only file that calls the API (**OpenRouter**, chat completions): forced structured output (tool call), validation, **one retry with the errors** |
| `lib/ai/context.ts` | Context engineering: member aliases (m1, m2...), spot selection for the slot, last 20 messages, XML escaping, private statements, privacy check |
| `lib/ai/prompts.ts` | Prompt templates (`PROMPT_VERSION`): rules in the system prompt, data in XML tags, level rubric, "anything is fine" rule, prompt-injection guard, privacy rule, one fictional example |
| `PROMPTS_LOG.md` | What changed in each prompt version and why; results table for the report |
| `lib/ai/schemas.ts` | JSON schemas of each output (`reasoning` first = chain of thought, never shown) |
| `lib/ai/negotiateSlot.ts` | Agrees on the time first: proposes a time window in the group chat, then reads replies (confirm / change / none); code checks trip days, past times, overlaps |
| `lib/ai/extractPreferences.ts` | Private message → preference statements (+ private flag), reactions to the current options, hard constraints **to confirm** |
| `lib/ai/options.ts` | `generateOptions` (round 1) and `reviseOptions` (rounds 2–3) → validated `Candidate[]` |
| `lib/ai/writeMessage.ts` | Facts from the code → one chat message (+ fairness note), with fallbacks |
| `data/spots.ts` | Loads and checks the shared dataset `../data/spots_tokyo.json` (39 Tokyo spots, approximate test data) |
| `data/scenario2.ts` | Test trip (museum vs shopping), uses the shared spots |
| `scripts/try-ai.ts` | Runs the whole pipeline on scenario 2 |
| `scripts/mock.ts` | Fake model for free offline tests (first answer is deliberately wrong) |

## Run
```bash
npm install
npm run typecheck
npm run try:mock          # no API key needed: tests validation and retry
cp .env.example .env      # add the OpenRouter key from the course, then:
npm run try               # real model calls (reads .env)
```
Set `WAYWAY_DEBUG=1` to log every call and validation result.

## What the code checks after each LLM call
1. JSON shape and allowed values (satisfaction levels).
2. Every spot id exists in the allowed spots (no invented places).
3. Exactly one score per member, per candidate.
4. Visits fit in the time slot **including travel time** (10 min in the same area, otherwise 10 min + 3 min/km)
   and every spot is open during its visit. Meal slots: exactly one food spot per path; activity slots: no food.
   Food spots must fit the diet of every member of the path.
5. A split has exactly 2 branches, every known member in exactly one branch, nobody alone unless the AI
   estimates they want it (`want_to_go` or better), a rendezvous spot open at a time inside the slot.
6. No private words (notes, private statements, allergies, budget, critiques, reaction reasons) in group-visible text,
   matched as whole words; public vocabulary (spot names, areas, diets, public statements) is never flagged.
7. Rounds 2–3: a new candidate satisfies at least as many members as the current candidate.

Invalid candidates are dropped; if too few remain, the model gets **one retry** with the exact errors.
A cut-off answer (`finish_reason: "length"`), a missing tool call or broken JSON is retried from the clean prompt
(with twice the token budget when cut off). Provider failures (HTTP error, 60 s timeout, missing key) are not retried.
Every failure becomes an `AIOutputError` with a `kind` (`invalid_output`, `provider`, `internal`). If that happens: `reviseOptions` keeps the previous options, `extractPreferences` keeps the profile,
`writeMessage` uses a template message. `generateOptions` throws `AIOutputError` so the route can post a neutral message.

## Private statements
`extractPreferences` marks sensitive statements (money, health, personal situation, or asked to stay private).
They are stored in `preferenceStatements` with the prefix `[private] ` (the contract stays `string[]`),
given to the model inside `<private_preferences>`, and protected by the privacy check like `privateNote`.
**Team convention:** never display a `[private] ` statement in the group UI.

## Reactions and revision
In rounds 2–3, `extractPreferences` also returns `reactions` (option, level, neutral reason) for the options the member
talked about. `reviseOptions` gets them (`reactions: MemberReaction[]`) and shows the model its own estimate next to
each real reaction, so it can correct its picture of each member (per-member evaluation, Papachristou et al.).

## Interface with role 4
`generateOptions` / `reviseOptions` return `Candidate[]` (no id, no kind, no metrics).
Role 4's `rankOptions(candidates, credits)` turns them into `Option[]` (A best weighted total, B fairest, C split).
`scripts/try-ai.ts` contains a **temporary** ranking to replace with role 4's.

## Known limits
- The privacy check is word-based: a paraphrase can pass, and a neutral word like "budget" can be flagged.
- The package is CommonJS (no `"type": "module"`) so tsx can load the shared contract outside the package.
- Travel time is a straight-line estimate, not real transit times.
- The slot kind (meal/activity) is carried by the label (meal labels name the meal), set by `negotiateSlot`.
- Only group messages mentioning `@WayWay` reach the model (`mentionsWayWay`); a reply without it ("ok") is ignored.
  The private chat with WayWay and timer events (deadlines, reminders) do not need a mention.
- Spots come from a static test dataset for now; the team will probably switch to the Google Places API later.
  Only the spot source changes: the AI functions take `Spot[]`, so a Places → `Spot` adapter is enough.
- Any OpenRouter model that supports tool calls can be used: change `WAYWAY_MODEL_REASONING` / `WAYWAY_MODEL_FAST` in `.env`.
