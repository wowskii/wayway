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

**References.** The four persona scenarios (`eval/scenarios/personas/`) use scripted personas: each member rates a
stop by spot or category (e.g. Mia: museum = must_go, shopping = lean_not_go); an option gets the rounded mean of the
member's own stops, and `definitely_no` if a stop breaks that member's hard constraint. These are prewritten
labels, not human votes — report them separately from live test sessions.

**Limits.** The privacy scan is literal: a paraphrase ("someone is short on money") is not caught, so public texts
of the real runs must also be read by a person. Travel times are straight-line estimates.

## Scenarios

| Scenario | What it tests |
|---|---|
| 1 · constraints | Vegan member, nut allergy (private), a 5,000 JPY private budget; lunch then afternoon |
| 2 · conflict | Museum vs shopping (same group as the AI module's scenario 2), Sarah abstains |
| 3 · split | Two pairs with opposite interests; Noah refuses to split → best shared option must win |
| 4 · credits | Four decisions in a row; Mia's taste is opposite to the majority; Sarah abstains |
| offline 01-04 | Fixed votes: hard filter, conflict, split consent, credits over three decisions (weight cap 1.5) |

## Results so far (November 16, synthetic data)

**Offline decision rules (fixed votes)** — all 4 scenarios pass. Credits scenario: Mia 0 → 3 → 6 → 0, weight capped
at 1.5; the third decision picks B with credits and A without them; Sarah (abstained) keeps her balance.

**Rule-based baseline** (`npm run eval:ai -- --baseline`, no AI, every estimate = `same`): the floor the LLM must beat.

| Scenario | Proposed routes with violations | Final routes with violations | Estimate exact / ±1 level / mean gap | Public texts with leaks | Decisions |
|---|---|---|---|---|---|
| 1 · constraints | 0/4 | 0/2 | 50% / 94% / 0.56 (n=16) | 0/6 | 2/2 |
| 2 · conflict | 0/1 | 0/1 | 25% / 75% / 1.00 (n=4) | 0/2 | 1/1 |
| 3 · split | 0/2 | 0/1 | 63% / 100% / 0.38 (n=8) | 0/3 | 1/1 |
| 4 · credits | 0/8 | 0/4 | 34% / 63% / 1.03 (n=32) | 0/12 | 4/4 |

**Pipeline check with the AI module's fake model** (`--mock`, on a local merge of the three branches): the whole
chain runs (generate → revise → buildOptions → vote → decision → credits → itinerary) on all 4 scenarios; 0 violations
and 0 leaks reach the group; the AI module's own checks threw away 22 bad candidates (invented spots, missing scores,
a private-word leak) before Role 4's filter. These numbers say nothing about the real model's quality — the fake
model returns canned answers.

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
