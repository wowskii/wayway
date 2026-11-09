"""Run one evaluation scenario: LLM-simulated personas plan a trip with WayWay.

Protocol (adapted from Papachristou et al.): each round, WayWay posts options in
the group chat; every persona reacts privately to WayWay (/api/private); after
that, WayWay refines the options (nextRound). After at most 3 rounds the group
votes and a decision is made.

Usage:
    python run_scenario.py scenarios/scenario2_conflict.json

The scenario's trip and members must exist in the app first (seed script),
with the ids given in the scenario file.

Environment variables (see .env.example):
    ANTHROPIC_API_KEY   key for the persona simulator
    WAYWAY_API_URL      e.g. http://localhost:3000/api/chat
"""
import json
import os
import sys
import uuid
from datetime import datetime

import requests
from anthropic import Anthropic

from metrics import ai_estimate_accuracy, constraint_violations, privacy_leaks, summarize

PERSONA_MODEL = "claude-haiku-5-5"  # a small model is enough to play a persona
WAYWAY_API_URL = os.environ.get("WAYWAY_API_URL", "http://localhost:3000/api/chat")
WAYWAY_PRIVATE_URL = WAYWAY_API_URL.replace("/api/chat", "/api/private")
LEVELS = "must_go, want_to_go, same, lean_not_go, definitely_no"
client = Anthropic()

STYLE_RULES = {
    "competing": "You defend your preference firmly and rarely give in.",
    "avoiding": "You avoid conflict, often say 'anything is fine', and sometimes don't answer.",
    "accommodating": "You are open to others' views and willing to compromise.",
}


def now():
    return datetime.now().isoformat()


def ask_persona(system, prompt, max_tokens=150):
    resp = client.messages.create(
        model=PERSONA_MODEL, max_tokens=max_tokens, system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip()


def history(transcript, n=15):
    return "\n".join(f"{m['sender']}: {m['text']}" for m in transcript[-n:])


def group_message(name, member, transcript):
    """The persona's next message in the group chat, or None (silent)."""
    text = ask_persona(
        f"You are {name}, a friend in a group chat planning a trip to Tokyo.\n"
        f"Preferences: {member['preferences']}\n"
        f"Conflict style: {STYLE_RULES[member['style']]}\n"
        "Write ONE short, casual chat message. If you would stay silent, answer exactly SKIP.",
        f"Chat so far:\n{history(transcript)}\n\nYour message:",
    )
    return None if text == "SKIP" else text


def private_feedback(trip_id, name, member, transcript, round_no):
    """The persona reacts privately to WayWay (PrivateChatRequest)."""
    text = ask_persona(
        f"You are {name}. Preferences: {member['preferences']}. "
        f"Private note: {member['private_note'] or 'none'}. "
        "In a PRIVATE message to the trip assistant, say honestly what you think of the options. "
        "In private you are more honest than in the group.",
        f"Group chat:\n{history(transcript, 10)}\n\nYour private message:",
    )
    payload = {"tripId": trip_id, "memberId": member["id"],
               "message": {"id": str(uuid.uuid4()), "tripId": trip_id, "memberId": member["id"],
                           "sender": "member", "text": text, "createdAt": now(), "round": round_no}}
    r = requests.post(WAYWAY_PRIVATE_URL, json=payload, timeout=60)
    r.raise_for_status()
    return r.json()


def persona_votes(name, member, option_set):
    """The persona votes a level on every option (for the final vote)."""
    cards = "\n".join(f"{o['id']}: {o['title']} ({o['explanation']})" for o in option_set["options"])
    votes = []
    for o in option_set["options"]:
        level = ask_persona(
            f"You are {name}. Preferences: {member['preferences']}. "
            f"Private note: {member['private_note'] or 'none'}. "
            f"Answer with exactly one of: {LEVELS}.",
            f"Options:\n{cards}\n\nHow do you feel about option {o['id']}?", max_tokens=10,
        ).lower().strip(" .")
        if level in LEVELS.split(", "):
            votes.append({"optionSetId": option_set["id"], "optionId": o["id"],
                          "memberId": member["id"], "level": level})
    return votes


def post_chat(payload):
    r = requests.post(WAYWAY_API_URL, json=payload, timeout=90)
    r.raise_for_status()
    return r.json()


def run(path):
    scenario = json.load(open(path))
    spots = json.load(open("spots_tokyo.json"))
    members = scenario["members"]
    by_id = {m["id"]: n for n, m in members.items()}
    trip_id = scenario["tripId"]

    first = {"id": str(uuid.uuid4()), "tripId": trip_id, "senderId": members["Tom"]["id"],
             "text": scenario["opening_message"], "createdAt": now()}
    transcript = [{"sender": "Tom", "text": first["text"]}]
    payload = {"tripId": trip_id, "message": first}

    rounds, estimates, real_votes = [], {}, {}
    decision, itinerary, last_set = None, None, None

    for _ in range(scenario["max_turns"]):
        bot = post_chat(payload)
        for msg in bot.get("messages", []):
            transcript.append({"sender": "WayWay", "text": msg["text"]})

        if bot.get("decision"):
            decision, itinerary = bot["decision"], bot.get("itinerary")
            break

        os_ = bot.get("optionSet")
        if os_:
            last_set = os_
            cand = next(o for o in os_["options"] if o["id"] == os_["candidateOptionId"])
            rounds.append({"round": os_["round"], **summarize([s["level"] for s in cand["scores"]])})
            for o in os_["options"]:
                for s in o["scores"]:
                    if s["source"] == "ai_estimate":
                        estimates[(o["id"], s["memberId"])] = s["level"]

            if os_["status"] == "collecting_feedback":
                for name, member in members.items():
                    private_feedback(trip_id, name, member, transcript, os_["round"])
                payload = {"tripId": trip_id, "nextRound": True}
                continue
            if os_["status"] == "voting":
                votes = [v for n, m in members.items() for v in persona_votes(n, m, os_)]
                for v in votes:
                    real_votes[(v["optionId"], v["memberId"])] = v["level"]
                payload = {"tripId": trip_id, "votes": votes}
                continue

        # otherwise, personas keep chatting in the group
        for name, member in members.items():
            text = group_message(name, member, transcript)
            if text:
                transcript.append({"sender": name, "text": text})
                payload = {"tripId": trip_id, "message": {
                    "id": str(uuid.uuid4()), "tripId": trip_id, "senderId": member["id"],
                    "text": text, "createdAt": now()}}

    final_spots = []
    for item in itinerary or []:
        if item.get("spotId"):
            final_spots.append(item["spotId"])
        for b in item.get("branches", []):
            final_spots += b["spots"]

    report = {
        "scenario": scenario["id"],
        "date": now(),
        "reached_decision": decision is not None,
        "rounds_used": len(rounds),
        "candidate_by_round": rounds,          # should improve over rounds
        "final_options": [
            {"id": o["id"], "kind": o["kind"], **summarize([s["level"] for s in o["scores"]])}
            for o in (last_set or {}).get("options", [])
        ],
        "credit_events": [
            {**e, "member": by_id.get(e["memberId"], e["memberId"])}
            for e in (decision or {}).get("creditEvents", [])
        ],
        "ai_estimate_accuracy": ai_estimate_accuracy(estimates, real_votes),
        "constraint_violations": constraint_violations(final_spots, members, spots) if final_spots else None,
        "privacy_leaks": privacy_leaks(transcript, members),
        "transcript": transcript,
    }
    os.makedirs("results", exist_ok=True)
    out = f"results/{scenario['id']}.json"
    json.dump(report, open(out, "w"), indent=2, ensure_ascii=False)
    print(json.dumps({k: v for k, v in report.items() if k != "transcript"}, indent=2, ensure_ascii=False))
    print(f"Full transcript saved to {out}")


if __name__ == "__main__":
    run(sys.argv[1])
