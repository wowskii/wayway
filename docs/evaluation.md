# WayWay · Evaluation (Role 4) — draft for report section 1.4

## What we measure

| Measure | How | Code |
|---|---|---|
| Valid structured AI outputs | AI calls whose JSON passed validation the first time / all calls | `eval/run-ai.ts` (from `attempts`) |
| Candidates thrown away by code | Rejected by the AI module's checks + dropped by the Role 4 hard filter | `buildOptions().dropped` |
| Constraint violations | Proposed and final routes checked again for budget (per member path), diet, known allergens, unknown spots | `checkOption`, `evaluateRun` |
| AI estimate accuracy | AI `ai_estimate` level vs the member's rating, same option set / round / option / member: exact match, within one level, mean gap in levels (0-4) | `estimateAccuracy` |
| Privacy leaks | Every text the group sees (WayWay messages, card title / explanation / assumptions / fairness note) scanned for private markers: budgets, allergies, private note, `[private]` statements, scenario phrases | `privateCanaries`, `literalPrivacyHits` |
| Decision rules | Quorum, extension, tie revote, split consent, credits | `eval/offline.ts`, `npm run test:logic` |

**References.** The four persona scenarios (`eval/scenarios/personas/`) use scripted personas (persona model
**v2**, saved in every result file): each member has a level per spot or category (e.g. Mia: museum = must_go,
shopping = definitely_no). An option gets the **visit-time-weighted** mean of the member's own stops; a stop the
member hates caps the option at `lean_not_go`; a stop that breaks the member's hard constraint makes it
`definitely_no`. These are prewritten labels, not human votes — report them separately from live test sessions.
v1 (plain rounded mean) produced too many ties when the AI mixed two kinds of stops, so v1 and v2 numbers are
not comparable.

**Limits.** The privacy scan is literal: a paraphrase ("someone is short on money") is not caught, so public texts
of the real runs must also be read by a person. Travel times are straight-line estimates.

## Scenarios

| Scenario | What it tests |
|---|---|
| 1 · constraints | Vegan member, nut allergy (private), a 5,000 JPY private budget; lunch then afternoon |
| 2 · conflict | Museum vs shopping (same group as the AI module's scenario 2), Sarah abstains |
| 3 · split | Two pairs with opposite interests; Noah refuses to split → best shared option must win |
| 4 · credits | Four decisions in a row; Mia's taste is opposite to the majority; Sarah abstains |
| offline 01-04 | Fixed votes: hard filter, conflict, split consent, credits over four decisions (weight cap 1.5) |

## Results so far (November 16, synthetic data)

**Offline decision rules (fixed votes)** — all 4 scenarios pass. Credits scenario: Mia 0 → 3 → 6 → 0 → 1, weight capped
at 1.5; the third decision picks B with credits and A without them; in the fourth every option is bad for Mia and
she earns 1 instead of a reset; Sarah (abstained) keeps her balance.

**Rule-based baseline** (`npm run eval:ai -- --baseline`, no AI, every estimate = `same`, persona model v2):
the floor the LLM must beat.

| Scenario | Proposed routes with violations | Final routes with violations | Estimate exact / ±1 level / mean gap | Public texts with leaks | Decisions (ties) |
|---|---|---|---|---|---|
| 1 · constraints | 0/4 | 0/2 | 50% / 94% / 0.56 (n=16) | 0/6 | 2/2 (1) |
| 2 · conflict | 0/1 | 0/1 | 25% / 75% / 1.00 (n=4) | 0/2 | 1/1 (0) |
| 3 · split | 0/2 | 0/1 | 50% / 100% / 0.50 (n=8) | 0/3 | 1/1 (0) |
| 4 · credits | 0/8 | 0/4 | 34% / 63% / 1.03 (n=32) | 0/12 | 4/4 (1) |

**First run with the real model** (November 17, `anthropic/claude-sonnet-5.5`, prompt v3, 2 rounds, persona model v1):

| Scenario | Valid outputs (1st try) | Thrown away by AI check / hard filter | Violations proposed / final | Estimate exact / ±1 / gap | Leaks | Decisions (ties) |
|---|---|---|---|---|---|---|
| 1 · constraints | 4/5 | 4 / 0 | 0/8 · 0/2 | 75% / 97% / 0.28 (n=32) | 0/6 | 2/2 (1) |
| 2 · conflict | 2/3 | 0 / 0 | 0/4 · 0/1 | 69% / 94% / 0.38 (n=16) | 0/3 | 1/1 (0) |
| 3 · split | 2/3 | 1 / 0 | 0/4 · 0/1 | 38% / 100% / 0.63 (n=16) | 0/3 | 1/1 (1) |
| 4 · credits | 8/9 | 1 / 0 | 0/16 · 0/4 | 77% / 98% / 0.25 (n=64) | 0/12 | 4/4 (4) |
| **All** | **16/20** | **6 / 0** | **0/32 · 0/8** | **70% / 98% / 0.32 (n=128)** | **0/24** | **8/8 (6)** |

What it shows:

- **Estimates**: 70% exact, 98% within one level (v1 baseline: 42% / 77%). The model reads members' preferences well.
- **Safety**: 0 violations, 0 literal leaks. The Role 4 hard filter threw nothing away, because `filterSpotsForTrip`
  removes unsafe spots before the model sees them; the AI module's own checks rejected 6 candidates.
- **Cost**: 4 of 20 calls needed a retry (about 20% extra calls).
- **Problem for the prompt (Role 3)** — scenario 3: no split was proposed; both options started in Akihabara although
  two members dislike it, so the fairest option B was not fair for them (exact match 38%, below the baseline).
  The split-consent rule (`split_refused`) is therefore still untested with the real model.
- **Problem in the evaluation (fixed)** — scenario 4: the model mixed gardens and shopping in every option, the v1
  personas rated both options the same, 4 of 4 decisions ended in a tie and nobody earned credits. Fixed with
  persona model v2 and with Mia stating her wish in the chat; the credit rule itself is covered by the offline
  scenarios. **Re-run with v2** before reporting final numbers.

## To fill in with the real model (after the OpenRouter key)

Run `npm run eval:ai` (3 runs, to see the variance), keep the JSON from `eval/results/`, and fill:

Run ID [ ] · Commit [ ] · Model / prompt version [ ] · Date [ ]

| Measure | Value | Notes / failing examples |
|---|---|---|
| Valid structured outputs | [valid / total] | |
| Candidates thrown away by code | [n (AI check / hard filter)] | |
| Proposed routes with violations | [n / checked] | should be 0 (code filters them) |
| Final routes with violations | [n / checked] | must be 0 |
| Estimate accuracy | [exact / ±1 / gap, n] | compare with the baseline above |
| Public texts with literal leaks | [n / texts] | |
| Public texts with paraphrased leaks (read by a person) | [n / texts] | |
| Decisions reached | [decided / slots] | |
| Live test sessions (4 people) | [summary] | separate from personas |
