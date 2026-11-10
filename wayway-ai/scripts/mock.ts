// Fake LLM for offline tests. Some answers are deliberately WRONG to check validation + retry:
// - first afternoon answer: invented spot, private info leaked, missing scores;
// - lunch answer: a non-vegetarian restaurant (removed by the hard-constraint filter) and a two-spot meal.

import type { LLMClient } from "../lib/ai/llm";

let optionCalls = 0;
let slotCalls = 0;

const tool = (name: string, input: unknown) => {
  const id = `call_${Math.random().toString(36).slice(2)}`;
  const args = JSON.stringify(input);
  return {
    toolCall: { id, arguments: args },
    assistantMessage: { role: "assistant", tool_calls: [{ id, type: "function", function: { name, arguments: args } }] },
    truncated: false,
    usage: { input: 1000, output: 300 },
  };
};

const score = (member: string, level: string, reason: string) => ({ member, level, reason });
const all = (level: string, reason: string) => ["m1", "m2", "m3", "m4"].map((m) => score(m, level, reason));

export const mockClient: LLMClient = {
  async chat(body: any) {
    const name = body.tool_choice.function.name;
    const user: string = body.messages[1].content;

    if (name === "save_preferences") {
      if (user.includes("reacting privately")) {
        return tool(name, {
          statements: [
            { text: "Wants shopping in Shibuya", private: false },
            { text: "Finds long museum visits boring", private: false },
            { text: "Wants real shopping time this afternoon", private: false },
          ],
          reactions: [
            { option: "A", level: "lean_not_go", reason: "Too much museum time" },
            { option: "B", level: "lean_not_go", reason: "Not enough shopping" },
          ],
          reply: "Got it, more shopping time! I'll take it into account for the next options.",
        });
      }
      return tool(name, {
        statements: [
          { text: "Slightly prefers the museum", private: false },
          { text: "Prefers cheap activities today", private: true },
        ],
        hardConstraintsToConfirm: { allergies: ["nuts"] },
        reply: "Got it! Just to be sure: should I always avoid places with nuts for you?",
      });
    }

    if (name === "handle_time") {
      if (user.includes("<pending_proposal>none")) {
        slotCalls++;
        // First answer deliberately wrong: an activity whose label names a meal.
        if (slotCalls === 1) {
          return tool(name, { action: "propose", kind: "activity", slot: { day: 1, start: "14:00", end: "17:30", label: "Lunch and visits" },
            reply: "Je propose cet après-midi de 14:00 à 17:30. Ça vous va, ou vous préférez un autre horaire ?" });
        }
        return tool(name, { action: "propose", kind: "activity", slot: { day: 1, start: "14:00", end: "17:30", label: "Afternoon, day 1" },
          reply: "Je propose cet après-midi de 14:00 à 17:30. Ça vous va, ou vous préférez un autre horaire ?" });
      }
      return tool(name, { action: "change", kind: "activity", slot: { day: 1, start: "15:00", end: "18:00", label: "Afternoon, day 1" } });
    }

    if (name === "post_message") {
      return tool(name, { text: "You're split between the museum and shopping, so here are a few options. Tell me privately what you think within 30 minutes!" });
    }

    // propose_options
    if (user.includes("type: meal")) {
      return tool(name, {
        reasoning: "Mia is vegetarian: only vegetarian places work for the whole group.",
        candidates: [
          { title: "Ramen at Ichiran", spots: ["ichiran_shibuya"], explanation: "Classic ramen.", assumptions: [], scores: all("want_to_go", "Loves ramen") },
          { title: "Vegan ramen then cafe", spots: ["ts_tantan", "ain_soph"], explanation: "Two stops.", assumptions: [], scores: all("same", "Fine") },
          { title: "Vegan ramen at Tokyo Station", spots: ["ts_tantan"], explanation: "Vegetarian-friendly and quick.", assumptions: ["Short queue at noon"],
            scores: [score("m1", "must_go", "Fully vegan menu"), score("m2", "same", "Quick lunch"), score("m3", "want_to_go", "Simple and quick"), score("m4", "want_to_go", "Near souvenir shops")] },
          { title: "Yuzu ramen in Harajuku", spots: ["afuri_harajuku"], explanation: "Vegetarian option, close to the shops.", assumptions: ["Vegan ramen on the menu"],
            scores: [score("m1", "want_to_go", "Has a vegan ramen"), score("m2", "want_to_go", "Next to Harajuku shops"), score("m3", "same", "Fine for lunch"), score("m4", "same", "Fine for lunch")] },
        ],
      });
    }

    optionCalls++;
    const isRevision = user.includes("<round_feedback>");
    if (optionCalls === 1) {
      return tool(name, {
        reasoning: "m1 and m3 want the museum, m2 and m4 want shopping.",
        candidates: [
          { title: "Everyone to Shibuya", spots: ["shibuya_shopping"], explanation: "Most fun for shoppers.", assumptions: [],
            scores: [score("m1", "lean_not_go", "Dislikes malls"), score("m2", "must_go", "Wants Shibuya"), score("m3", "same", "Fine"), score("m4", "want_to_go", "Souvenirs")] },
          { title: "Ginza luxury tour", spots: ["ginza"], explanation: "Fancy shopping.", assumptions: [],
            scores: [score("m1", "same", "ok"), score("m2", "must_go", "Shopping"), score("m3", "same", "ok"), score("m4", "same", "ok")] },
          { title: "Cheap museum day", spots: ["tnm"], explanation: "Good for Sarah's tight budget.", assumptions: [],
            scores: [score("m1", "must_go", "Art"), score("m2", "lean_not_go", "Boring")] },
        ],
      });
    }
    if (!isRevision) {
      return tool(name, {
        reasoning: "Fixed: only allowed spots, one score per member, neutral wording.",
        candidates: [
          { title: "Everyone to Shibuya", spots: ["shibuya_shopping"], explanation: "The shoppers are thrilled, Mia much less.", assumptions: ["Subway to Shibuya, 25 min"],
            scores: [score("m1", "definitely_no", "Dislikes crowded malls"), score("m2", "must_go", "Wants Shibuya"), score("m3", "same", "Fits everyone's constraints"), score("m4", "must_go", "Souvenir shopping")] },
          { title: "Museum first, then Ameyoko market", spots: ["tnm", "ameyoko"], explanation: "Less shopping for Tom, but nobody is left out.", assumptions: ["Museum visit limited to 90 minutes"],
            scores: [score("m1", "want_to_go", "Loves art museums"), score("m2", "same", "Gets shopping at the end"), score("m3", "want_to_go", "Prefers the museum"), score("m4", "want_to_go", "Souvenirs at Ameyoko")] },
          { title: "Split, then meet in Ueno", spots: [],
            branches: [{ members: ["m1", "m3"], spots: ["tnm", "ueno_park"] }, { members: ["m2", "m4"], spots: ["ameyoko"] }],
            rendezvous: { spot: "ueno_park", time: "17:45" },
            explanation: "Everyone does what they like, then we reunite.", assumptions: ["Both groups stay in Ueno"],
            scores: [score("m1", "must_go", "Museum time"), score("m2", "want_to_go", "Shopping"), score("m3", "want_to_go", "Museum, free park"), score("m4", "must_go", "Souvenirs")] },
          { title: "Western art, then Ameyoko", spots: ["nmwa", "ameyoko"], explanation: "A shorter museum and more market time.", assumptions: ["10 min walk inside Ueno"],
            scores: [score("m1", "want_to_go", "Art museum"), score("m2", "same", "Market time"), score("m3", "same", "Shorter visit"), score("m4", "want_to_go", "Souvenirs")] },
        ],
      });
    }
    return tool(name, {
      reasoning: "Tom said both options had too little shopping; keep a short museum for Mia and Sarah.",
      candidates: [
        { title: "Park walk, then Ameyoko", spots: ["ueno_park", "ameyoko"], explanation: "More shopping time, a walk through the park.", assumptions: ["Ueno Park instead of the full museum"],
          scores: [score("m1", "same", "Park, but no museum"), score("m2", "want_to_go", "More shopping"), score("m3", "same", "Free walk"), score("m4", "want_to_go", "Souvenirs")] },
      ],
    });
  },
};
