// FAKE round change used until the real AI is connected (WAYWAY_AI_MODE=mock).
//   mockRevise:       keeps what Simon's code keeps (keptOptions) and proposes ONE new route: the
//                     current best route with its last stop swapped for an unused spot of the same
//                     category, estimated one level better for everyone (members who privately
//                     disliked the route: "same"). So it usually becomes the new A, and the panel
//                     visibly changes between rounds.
//   mockWriteMessage: a template sentence per message kind, from the facts the code computed.
// Deliberately simple, same output shapes as reviseOptions / writeMessage, so the round logic,
// the database and the panel can be tested without an API key.
import type { MemberScore, SatisfactionLevel } from "@/contracts/contract";
import type { MessageWriter, Reviser } from "@/lib/ai/rounds";
import { getSpot } from "@/lib/spots";
import { keptOptions } from "../../../wayway-ai/lib/ai";

const SATISFIED = new Set(["must_go", "want_to_go", "same"]);
const UP: Record<SatisfactionLevel, SatisfactionLevel> = {
  definitely_no: "lean_not_go", lean_not_go: "same", same: "want_to_go", want_to_go: "must_go", must_go: "must_go",
};

export const mockRevise: Reviser = async ({ previousOptions, candidate, reactions, allowedSpots }) => {
  const kept = keptOptions(previousOptions, candidate);
  const base = candidate.kind === "split" ? previousOptions.find((o) => o.kind !== "split") : candidate;
  const used = new Set(previousOptions.flatMap((o) => [...o.spots, ...(o.branches ?? []).flatMap((b) => b.spots)]));
  const last = base?.spots.at(-1);
  const lastSpot = last ? getSpot(last) : undefined;   // may no longer be allowed (that's often WHY it changes)
  const swap = lastSpot && allowedSpots.find((s) => !used.has(s.id) && s.category === lastSpot.category);
  if (!base || !last || !swap) {
    return { candidates: [], kept, reasoning: "mock: nothing to adjust", attempts: 1, rejected: [] };
  }

  const disliked = new Set(
    reactions.filter((r) => r.optionId === base.id && (r.level === "lean_not_go" || r.level === "definitely_no")).map((r) => r.memberId),
  );
  const scores: MemberScore[] = base.scores.map((s) => ({
    ...s,
    level: disliked.has(s.memberId) ? "same" : UP[s.level],
    source: "ai_estimate",
    reason: "Adjusted after private feedback",
  }));
  return {
    candidates: [{
      // Named after the new route itself (not "old title + change"), so titles don't grow round after round
      title: [...base.spots.slice(0, -1), swap.id].map((id) => (getSpot(id)?.name ?? id).replace(/\s*\(.*\)$/, "")).join(", then "),
      spots: [...base.spots.slice(0, -1), swap.id],
      scores,
      satisfiedMemberIds: scores.filter((s) => SATISFIED.has(s.level)).map((s) => s.memberId),
      explanation: `Like option ${base.id}, but ends at ${swap.name} instead of ${lastSpot.name}.`,
      assumptions: base.assumptions,
    }],
    kept,
    reasoning: "mock: swapped the last stop of the current best route",
    attempts: 1,
    rejected: [],
  };
};

export const mockWriteMessage: MessageWriter = async ({ kind, facts }) => {
  const f = facts as {
    slot?: string; round?: number; options?: string[]; deadline?: string;
    chosen?: string; stops?: string[]; decided?: boolean; reason?: string; next?: string;
  };
  const list = f.options?.join(" · ") ?? "";
  const plan = f.stops?.length ? ` (${f.stops.join(" → ")})` : "";
  switch (kind) {
    case "options_round":
      return { text: `Here are the options for ${f.slot}: ${list}. Open Spot Suggestions and tell me privately what you think before ${f.deadline}!` };
    case "next_round":
      return { text: `Round ${f.round} for ${f.slot}: I updated the options (${list}). Tell me privately what you think before ${f.deadline}!` };
    case "voting_open":
      return { text: `Time to vote for ${f.slot}! Rate every option (${list}) before ${f.deadline}.` };
    case "decision":
      return f.decided === false
        ? { text: `No decision for ${f.slot}: ${f.reason}. ${f.next ?? ""}`.trim() }
        : { text: `Decided for ${f.slot}: ${f.chosen}${plan}. It's in the itinerary!` };
    case "split_refused":
      return { text: `Not everyone wanted to split up, so ${f.slot} is ${f.chosen}${plan}. It's in the itinerary!` };
    case "no_quorum":
      return f.decided === false
        ? { text: `No decision for ${f.slot}: ${f.reason}. ${f.next ?? ""}`.trim() }
        : { text: `Not enough votes yet for ${f.slot}, so everyone has until ${f.deadline} to vote.` };
    case "tie_revote":
      return { text: `It's a perfect tie for ${f.slot}! Please vote again before ${f.deadline}.` };
    default:
      return { text: "Here is an update on your plans." };
  }
};
