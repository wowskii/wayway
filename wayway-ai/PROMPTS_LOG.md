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

## Results per version (fill in with the real model)

| Version | Scenario | Valid on 1st try | Retries | Leaks | A ≠ B | Estimate = real reaction | Notes |
|---|---|---|---|---|---|---|---|
| v2 | 2 (conflict) | | | | | | |
