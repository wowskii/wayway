"use client";
// Browser side of a Spot Suggestions round change. Lives in TripHub, so it works even when the
// panel is closed. When the earliest round of the trip ends (or the page opens after a deadline),
// it asks POST /api/chatbox/next-round; the SERVER checks the time and changes the round once
// (lib/chatbox-rounds/service.ts), then this hook hands the fresh sets to the page.
//
// Every member's browser asks at about the same second; only one request changes the round, the
// others get the current state. A set comes back in one of three ways:
//   - in a new phase (next round, or the final vote)          -> done
//   - same phase, deadline pushed by about the claim window   -> another request is changing it right
//     now (or the server's clock is a little behind): ask again in RETRY_MS, show "moving on…"
//   - same phase, deadline pushed further (a whole round)     -> the server extended the round (e.g. no
//     safe option to vote on yet): done, the countdown shows the new time
import { useCallback, useEffect, useRef, useState } from "react";
import type { NextRoundResult } from "@/lib/chatbox-rounds/types";
import type { SuggestionSet } from "@/lib/chatbox-trip-hub/types";

const AFTER_DEADLINE_MS = 500;    // ask just after the countdown reaches 0
const RETRY_MS = 5_000;           // round not changed yet: ask again
const MAX_TIMER_MS = 2 ** 31 - 1; // setTimeout limit (~24 days)
const REFRESH_GAP_MS = 10_000;    // coming back to the tab refreshes the sets, at most this often

/** A set's phase: "collecting_feedback:2", "voting:3:1"... Changes with the next round, the vote and a revote. */
export const phaseOf = (s: Pick<SuggestionSet, "status" | "round" | "ballot">) =>
  s.status === "voting" ? `voting:${s.round}:${s.ballot?.attempt ?? 1}` : `${s.status}:${s.round}`;

/**
 * Returns:
 *   moving  - set id -> phase whose end was reported and that has not moved on yet. The panel shows
 *             "moving to the next step…" while `moving[set.id] === phaseOf(set)`.
 *   refresh - asks the server for the current sets (also changes any round that has ended). Called
 *             when I come back to the tab, and by the panel when what I see is out of date (a vote
 *             refused because the set is gone or closed).
 */
export function useRoundAdvance(tripId: string, sets: SuggestionSet[], onFresh: (sets: SuggestionSet[]) => void) {
  const [moving, setMoving] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);   // re-plans the timer after each check
  const lastRefresh = useRef(0);

  const refresh = useCallback(async () => {
    lastRefresh.current = Date.now();
    try {
      const res = await fetch("/api/chatbox/next-round", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId }),
      });
      if (res.ok) onFresh(((await res.json()) as NextRoundResult).suggestions.sets);
    } catch {
      // offline: the next check or the next visit tries again
    }
  }, [tripId, onFresh]);

  // Back on the tab (or the window) after a while: the sets may have changed meanwhile
  useEffect(() => {
    const onBack = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh.current > REFRESH_GAP_MS) void refresh();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [refresh]);

  useEffect(() => {
    // Rounds AND final votes: when either ends, the server takes the next step (next round, vote, result)
    const open = sets.filter((s) => s.status === "collecting_feedback" || s.status === "voting");
    if (!open.length) return;
    const isMoving = (s: SuggestionSet) => moving[s.id] === phaseOf(s);
    const delay = open.some(isMoving)
      ? RETRY_MS
      : Math.max(0, Math.min(...open.map((s) => Date.parse(s.deadline))) - Date.now()) + AFTER_DEADLINE_MS;

    const timer = setTimeout(async () => {
      const due = open.filter((s) => isMoving(s) || Date.parse(s.deadline) <= Date.now());
      if (due.length) {
        setMoving((m) => ({ ...m, ...Object.fromEntries(due.map((s) => [s.id, phaseOf(s)])) }));
        try {
          const res = await fetch("/api/chatbox/next-round", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tripId }),
          });
          if (res.ok) {
            const { suggestions, claimWindowMs } = (await res.json()) as NextRoundResult;
            const now = Date.now();
            const stillMoving: Record<string, string> = {};
            for (const s of due) {
              const fresh = suggestions.sets.find((f) => f.id === s.id);
              if (!fresh || phaseOf(fresh) !== phaseOf(s)) continue;              // moved on, or decided
              if (Date.parse(fresh.deadline) - now <= claimWindowMs + 2_000) stillMoving[s.id] = phaseOf(fresh);
            }
            setMoving((m) => {
              const next = { ...m };
              for (const s of due) delete next[s.id];
              return { ...next, ...stillMoving };
            });
            onFresh(suggestions.sets);
          }
        } catch {
          // offline or server down: still "moving", asked again in RETRY_MS
        }
      }
      setTick((t) => t + 1);
    }, Math.min(delay, MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [tripId, sets, moving, tick, onFresh]);

  return { moving, refresh };
}
