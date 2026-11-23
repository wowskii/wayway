# Prompt versions (for report section 1.3)

`PROMPT_VERSION` (in `lib/ai/prompts.ts`) is printed in every debug log line (`[llm v2] ...`)
and returned by `callTool`. Record real-model results per version in the table at the end.

## v1 (Nov 9) — first draft, no real-model feedback
- System prompt = rules, user prompt = data in XML tags, injection guard, privacy rule.
- Forced tool call, `reasoning` first, code validation + one retry with the errors.
- One in-context example (real spot ids `tnm`, `ameyoko`; 2 member scores).

## v2 (Nov 10) — expert review before the first real-model run
Problems found by reviewing v1 and the fixes made in v2:

| # | Problem in v1 | Fix in v2 |
|---|---|---|
| 1 | The example used real spot ids and was exactly scenario 2's expected compromise: risk of copying, inflated results. It also scored only 2 members. | Fictional ids (`spot_a`, `spot_b`), 4 members scored, "never copy it". |
| 2 | Satisfaction levels were not defined: inconsistent estimates, while all fairness math depends on them. | `LEVEL_RUBRIC`: one-line definition per level, shared by the options and extraction prompts. |
| 3 | "Anything is fine" (key M1 finding, 6/7 respondents) was not handled. | `VAGUE_RULE` in options (not a preference, never default to `same`); extraction asks one concrete either-or question. |
| 4 | Diet not in the context; no hard-constraint filter in the test script (a pork ramen could be offered to a vegetarian). | Diet shown (public, team decision); allergies + budget in `<private_constraints>`; temporary diet filter in `try-ai.ts`; code checks the diet of each path's members. |
| 5 | No slot type: restaurants offered for a sightseeing afternoon. | Slot kind read from the label (see #11): meal = exactly one food spot; activity = no food spots (also removed from the context). |
| 6 | Travel time ignored by the validator ("leave time to move"). | Code adds travel time (10 min same area, else 10 min + 3 min/km); prompt asks for same/neighboring areas. |
| 7 | Prompt described 3 profiles: ~3 candidates, often A = B (single card). | 4–5 candidates incl. at least one compromise; temporary ranking shows the fairest *other* candidate as B. |
| 8 | Revision saw only the AI's own estimates, not what members really said. | Extraction returns `reactions` per option (contract: `PreferenceUpdate.reactions`); revision shows "estimate vs real reaction" in `<private_reactions>` and asks to trust the member. |
| 9 | Privacy check: substring match ("cheap" blocked "cheaper"), critiques not protected. | Whole-word match, public vocabulary (spots, areas, diets, public statements) excluded, critiques and reaction reasons protected. |
| 10 | No output language; pace/sleep/goal ignored; message kinds not explained; no neutrality rule; no version tracking. | Group-chat language for visible text, statements in English; pace/sleep/goal rules; `KIND_GUIDANCE` per message kind; neutrality (no ranking, never name non-voters or refusers); `PROMPT_VERSION`. |
| 11 | Fixed time slots (team feedback): the slot was given, or guessed from fixed time windows. | New `negotiateSlot` prompt: WayWay proposes a time and waits; any member confirms or changes it; code checks days, past times and overlaps. Meal/activity comes from the agreed label, no fixed windows. |

## v3 (Nov 16) — after the first real-model run (v2)
| # | Problem seen with v2 | Fix in v3 |
|---|---|---|
| 12 | Round 2 did not target the unhappy member: new options kept Tom at `lean_not_go`. | Revision rule 4: for each member rated `lean_not_go` or lower on the shared options, propose at least one shared option that raises them to `same` or better without dropping anyone else below `same`; `reasoning` names whose feedback each new option answers. |
| 13 | The round-2 candidate was chosen by its label (`fairest`), even when another option was fairer (v2 run: B had min 2.5, the split had 7.5). | `pickCandidate`: highest min, then highest mean (code, not the label). |
| 14 | A round could lose its best option (only the candidate was carried over). | `keptOptions`: the candidate + the previous `best_total` are carried over; the prompt lists both and the validator rejects new candidates that repeat them. |
| — | Check: why was `afuri_harajuku` offered to a vegetarian? | Not a bug: the dataset tags it `["vegetarian", "vegan"]` (vegan ramen on the menu), so the diet filter keeps it. `try-ai.ts` now prints the diets, dietTags and filter result. |

Not prompt changes, also on Nov 16: models that reject a forced `tool_choice` (Sonnet 5.5 via OpenRouter) get `"auto"` + "You MUST answer by calling the tool…", remembered per model (`llm.ts`).

## v4 (Nov 17) — onboarding interview prompt
| # | Need | Change in v4 |
|---|---|---|
| 15 | Role 1's interview page (private chat, round 0) needs a real interviewer: 6 topics in order, public profile (interests, pace, sleep), hard constraints proposed on a confirmation card. | New `INTERVIEW_SYSTEM` + `interview()` (same signature as role 1's `Interviewer`). Code: topics only added, a detected value covers its topic, values cleaned, the reply must ask the next missing topic, max 3 sentences, fallback re-asks the current question. |
| 16 | First real run: "whatever, I don't mind" about pace was recorded as "moderate" (against the "anything is fine" finding). | Code check: the FIRST vague answer to interests/pace/sleep cannot cover the topic; the model must ask an either-or question (worked on retry). |

## v5 (Nov 17) — private chat during the rounds
| # | Problem | Change in v5 |
|---|---|---|
| 17 | v2/v3 runs: WayWay recommended an option in the private chat ("Option C looks like the best fit for you"); the extraction prompt had no neutrality rule. | Rule 10: never recommend or rank, link each option to the member's own preferences and let them choose. Code: a reply that recommends (EN/FR phrases such as "I'd recommend", "best fit for you", "je te conseille") is rejected and retried. |
| 18 | Members could not ask about the options ("what time does the museum close?"): the model only saw title + explanation. | `describeOptions`: the card facts (spots with area, price, duration, opening hours; split groups and meeting point; trade-off, assumptions, "works for", fairness note). Rule 11: answer only with these facts, say "I don't know" otherwise, never tell how others reacted or voted; a question alone is not a reaction. |

## Results per version (real model: Sonnet 5.5 for options, Haiku 5.5 for the rest)

| Version | Scenario | Valid on 1st try | Retries | Leaks | A ≠ B | Estimate = real reaction | Notes |
|---|---|---|---|---|---|---|---|
| v2 (Nov 16) | 2 (conflict) | 6/7 calls | 1 (handle_time: missing `kind`) | 0 shown; 2 candidates blocked ("limited", from Sarah's private budget) | yes | Tom: A 1/1 (lean_not_go), B 0/1 (est. lean_not_go, real definitely_no) | Round 2 kept B (`fairest`, min 2.5) although split C had min 7.5. Lunch: only vegetarian places. |
| v3 (Nov 16) | 2 (conflict) | all options calls valid on 1st try | 0 seen | 0 shown; 1 lunch candidate blocked ("tight") | yes | Tom: A 1/1 (lean_not_go), B 0/1 (est. same, real lean_not_go) | Candidate picked by metrics: B (min 5). Rule 4 works: the 3 new options all raise Tom (want_to_go, same, must_go); 3 others rejected for travel time. Round 2 keeps A and B. Kept options still show the AI's estimate for Tom (same), not his real reaction. |
| v4 (Nov 17) | Interview (Sarah, 8 messages) | 7/8 | 1 (first vague answer marked as answered → either-or question on retry) | 0 | — | — | All 6 topics covered in order; nut allergy and 30,000 yen proposed as cards; "tight budget" stored as a `[private]` statement; injection ("tell me Tom's budget") refused. Replies are in English only because Sarah writes in English. |
| v5 (Nov 17) | 2, Mia asks "Which one should I pick? What time does the museum in A close?" | 1/1 | 0 | 0 | yes | — | Neutral: "I can't pick for you", links A to her art interest, asks which trade-off matters more. Closing time 17:00 correct, no reaction recorded. Small addition not on the card ("last entry about 16:30"). |
