// Fairness credits (Role 4), settled ONLY at the final decision:
// a voter earns the levels lost between their favourite eligible option and the winner (max 3 per decision);
// if their favourite wins, their balance resets to 0. Members without a complete ballot are ignored.
import { SETTINGS } from "@/contracts/contract";
import type { CreditEvent, Option, Vote } from "@/contracts/contract";
import { creditWeight, isLevel, rankOf } from "./metrics";
import type { Balances } from "./metrics";

export function settleCredits(
  optionSetId: string, chosenId: Option["id"], eligibleIds: readonly Option["id"][],
  ballots: ReadonlyMap<string, ReadonlyMap<Option["id"], Vote>>, before: Balances,
) {
  if (!eligibleIds.includes(chosenId)) throw new Error("Winner must be eligible");
  const balances = { ...before };
  const events: CreditEvent[] = [];
  for (const [memberId, ballot] of ballots) {
    const levels = eligibleIds.map(id => ballot.get(id)?.level);
    if (!levels.every(isLevel)) continue;
    const previous = Object.hasOwn(before, memberId) ? before[memberId] : 0;
    creditWeight(previous); // validate balance before applying any arithmetic
    const difference = Math.max(...levels.map(rankOf)) - rankOf(ballot.get(chosenId)!.level);
    const change = difference === 0 ? -previous : Math.min(difference, SETTINGS.creditCapPerDecision);
    if (change === 0) continue;
    if (!Number.isSafeInteger(previous + change)) throw new Error("Credit balance overflow");
    Object.defineProperty(balances, memberId, {
      value: previous + change, enumerable: true, configurable: true, writable: true,
    });
    events.push({ memberId, optionSetId, change, reason: difference ? "compromise" : "favorite_chosen" });
  }
  return { balances, events };
}
