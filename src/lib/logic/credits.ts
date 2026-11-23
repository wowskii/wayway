// Fairness credits (Role 4), settled ONLY at the final decision:
// a voter earns the levels lost between their favourite eligible option and the winner (max 3 per decision);
// if their favourite wins, their balance resets to 0. Members without a complete ballot are ignored.
// Exception (team decision 2026-11-23): if the winner is below "same" for a voter, they compromised even when
// every option was equally bad for them (their "favourite" ties with the winner): +1 at least, never a reset.
import { LEVEL_VALUE, SETTINGS } from "@/contracts/contract";
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
    const winnerLevel = ballot.get(chosenId)!.level;
    const difference = Math.max(...levels.map(rankOf)) - rankOf(winnerLevel);
    const unhappy = LEVEL_VALUE[winnerLevel] < LEVEL_VALUE.same;
    const change = difference === 0 && !unhappy ? -previous
      : Math.min(Math.max(difference, 1), SETTINGS.creditCapPerDecision);
    if (change === 0) continue;
    if (!Number.isSafeInteger(previous + change)) throw new Error("Credit balance overflow");
    Object.defineProperty(balances, memberId, {
      value: previous + change, enumerable: true, configurable: true, writable: true,
    });
    events.push({ memberId, optionSetId, change, reason: change > 0 ? "compromise" : "favorite_chosen" });
  }
  return { balances, events };
}
