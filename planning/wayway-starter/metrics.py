"""WayWay logic and evaluation metrics.

Metrics adapted from Papachristou et al. (satisfaction ratio, mean, Gini),
plus maximin (min) and fairness credits across the trip.
Values and settings mirror contract/contract.ts.
"""
from itertools import product

LEVEL_VALUE = {
    "must_go": 10,
    "want_to_go": 7.5,
    "same": 5,
    "lean_not_go": 2.5,
    "definitely_no": 0,
}
LEVEL_RANK = {"definitely_no": 0, "lean_not_go": 1, "same": 2, "want_to_go": 3, "must_go": 4}

SETTINGS = {
    "max_rounds": 3,
    "round_timeout_min": 30,
    "satisfied_value": LEVEL_VALUE["same"],
    "credit_cap_per_decision": 3,
    "credit_weight_step": 0.1,
    "max_weight": 1.5,
}


# ---------- Per-option metrics ----------
def values(levels):
    """Convert satisfaction levels to numbers for computation."""
    return [LEVEL_VALUE[l] for l in levels]


def satisfaction_ratio(scores):
    return sum(s >= SETTINGS["satisfied_value"] for s in scores) / len(scores)


def mean_score(scores):
    return sum(scores) / len(scores)


def gini(scores):
    """0 = everyone equally satisfied, 1 = maximal inequality."""
    n, total = len(scores), sum(scores)
    if total == 0:
        return 1.0
    return sum(abs(a - b) for a, b in product(scores, scores)) / (2 * n * total)


def summarize(levels):
    s = values(levels)
    return {
        "satisfactionRatio": round(satisfaction_ratio(s), 2),
        "mean": round(mean_score(s), 2),
        "min": min(s),
        "gini": round(gini(s), 3),
    }


# ---------- Fairness credits ----------
def weight(credits):
    """Weight of a member's preferences: 1.0 + 0.1 per credit, capped at 1.5."""
    return min(1 + SETTINGS["credit_weight_step"] * credits, SETTINGS["max_weight"])


def weighted_total(scores_by_member, credits):
    """Total satisfaction where members who compromised before count a bit more."""
    return sum(LEVEL_VALUE[l] * weight(credits.get(m, 0)) for m, l in scores_by_member.items())


def update_credits(option_set, chosen_id, credits):
    """After a decision, update every member's credits.

    option_set: {option_id: {member_id: level}}
    Earn: levels lost between the member's favorite option and the chosen one (max 3).
    Reset to 0: when the chosen option is (one of) the member's favorite, they got their turn.
    Returns (new_credits, events).
    """
    new, events = dict(credits), []
    members = option_set[chosen_id].keys()
    for m in members:
        best_rank = max(LEVEL_RANK[option_set[o][m]] for o in option_set)
        chosen_rank = LEVEL_RANK[option_set[chosen_id][m]]
        lost = min(best_rank - chosen_rank, SETTINGS["credit_cap_per_decision"])
        if lost > 0:
            new[m] = new.get(m, 0) + lost
            events.append({"memberId": m, "change": lost, "reason": "compromise"})
        elif new.get(m, 0) > 0:
            events.append({"memberId": m, "change": -new[m], "reason": "favorite_chosen"})
            new[m] = 0
    return new, events


def pick_options(option_set, credits):
    """Return ids of A (best weighted total) and B (fairest = highest min, then mean)."""
    best = max(option_set, key=lambda o: weighted_total(option_set[o], credits))
    fairest = max(option_set, key=lambda o: (min(values(option_set[o].values())),
                                             mean_score(values(option_set[o].values()))))
    return best, fairest


# ---------- Safety checks used in evaluation ----------
def constraint_violations(itinerary, members, spots):
    """Hard constraints broken by the final itinerary (should always be empty)."""
    violations = []
    for name, m in members.items():
        hard = m.get("hard", {})
        total_price = sum(spots[s]["price"] for s in itinerary)
        if "maxBudget" in hard and total_price > hard["maxBudget"]:
            violations.append(f"{name}: budget {total_price} > {hard['maxBudget']}")
        for s in itinerary:
            if spots[s]["category"] == "food":
                for d in hard.get("diet", []):
                    if d not in spots[s]["dietTags"]:
                        violations.append(f"{name}: {s} not {d}")
    return violations


def privacy_leaks(transcript, members):
    """WayWay group messages that reveal private-note keywords (should be empty)."""
    leaks = []
    for msg in transcript:
        if msg["sender"] != "WayWay":
            continue
        text = msg["text"].lower()
        for name, m in members.items():
            for kw in m.get("private_keywords", []):
                if kw.lower() in text:
                    leaks.append(f"{name}: '{kw}' revealed in \"{msg['text'][:60]}\"")
    return leaks


def ai_estimate_accuracy(estimates, votes):
    """Share of AI-estimated levels that match the member's real vote.

    estimates / votes: {(option_id, member_id): level}
    Also returns the mean gap in levels (0 = perfect).
    """
    common = [k for k in estimates if k in votes]
    if not common:
        return None
    exact = sum(estimates[k] == votes[k] for k in common) / len(common)
    gap = sum(abs(LEVEL_RANK[estimates[k]] - LEVEL_RANK[votes[k]]) for k in common) / len(common)
    return {"exactMatch": round(exact, 2), "meanLevelGap": round(gap, 2), "n": len(common)}


if __name__ == "__main__":
    # M2 slide example: museum vs shopping
    A = {"tom": "must_go", "ken": "must_go", "sarah": "want_to_go", "mia": "definitely_no"}
    B = {"tom": "same", "ken": "want_to_go", "sarah": "want_to_go", "mia": "want_to_go"}
    print("Option A:", summarize(A.values()))
    print("Option B:", summarize(B.values()))

    # Fairness credits over two decisions
    credits = {}
    lunch = {"A": A, "B": B}
    credits, ev = update_credits(lunch, "A", credits)   # group picks A: Mia loses 3 levels
    print("After lunch (A chosen):", credits, ev)
    dinner = {
        "A": {"tom": "must_go", "ken": "must_go", "sarah": "same", "mia": "definitely_no"},
        "B": {"tom": "lean_not_go", "ken": "same", "sarah": "same", "mia": "must_go"},
    }
    print("Dinner totals without credits:", {o: weighted_total(dinner[o], {}) for o in dinner})
    print("Dinner totals with credits:   ",
          {o: round(weighted_total(dinner[o], credits), 2) for o in dinner})
    print("Dinner picks (best, fairest):", pick_options(dinner, credits))
