// SAMPLE data shown while the server part of options / itinerary does not exist yet.
// The panels show a "Preview" label whenever this is used, so nobody mistakes it for real plans.
// Delete this file once /api/chat creates real option sets and itinerary items.
import type { ItineraryData, RateData } from "./types";

export function previewRate(): RateData {
  return {
    source: "preview",
    spots: [
      {
        id: "shibuya-crossing", name: "Shibuya Crossing", category: "shopping", area: "Shibuya",
        link: "https://www.gotokyo.org/en/spot/78/index.html", visitTime: "18:00 – 20:00", durationMin: 120,
        counts: { must_go: 2, want_to_go: 2, same: 1 },
      },
      {
        id: "meiji-jingu", name: "Meiji Shrine", category: "temple", area: "Harajuku",
        link: "https://www.meijijingu.or.jp/en/", visitTime: "09:00 – 10:30", durationMin: 90,
        counts: { must_go: 2, want_to_go: 2, same: 1 },
      },
      {
        id: "tsukiji", name: "Tsukiji Outer Market", category: "food", area: "Tsukiji",
        link: "https://www.tsukiji.or.jp/english/", visitTime: "06:00 – 08:00", durationMin: 120,
        counts: { must_go: 2, want_to_go: 1, same: 1, lean_not_go: 1 },
      },
      {
        id: "sensoji", name: "Asakusa Kannon Temple", category: "temple", area: "Asakusa",
        link: "https://www.senso-ji.jp/english/", visitTime: "10:00 – 11:30", durationMin: 90,
        counts: { must_go: 2, want_to_go: 3, same: 1 },
      },
      {
        id: "tnm", name: "Tokyo National Museum", category: "museum", area: "Ueno",
        link: "https://www.tnm.jp/?lang=en", durationMin: 90,
        counts: { must_go: 1, want_to_go: 2, lean_not_go: 2 },
      },
    ],
  };
}

export function previewItinerary(days: { day: number; label: string }[]): ItineraryData {
  const at = "2026-11-01T00:00:00Z";
  const sample = [
    [
      { id: "p1", start: "09:30", end: "11:00", title: "Tokyo National Museum", createdAt: at },
      { id: "p2", start: "11:15", end: "12:45", title: "Ameyoko Market (lunch)", createdAt: at },
      {
        id: "p3",
        start: "13:30",
        end: "17:00",
        title: "Split into 2 groups",
        createdAt: at,
        branches: [
          { members: ["Tom", "Ken"], spots: ["Shibuya shopping"] },
          { members: ["Mia", "Sarah"], spots: ["Tokyo National Museum"] },
        ],
      },
    ],
    [{ id: "p4", start: "06:30", end: "08:30", title: "Tsukiji Outer Market", createdAt: at }],
  ];
  return {
    source: "preview",
    days: days.map((d, i) => ({ ...d, entries: sample[i] ?? [] })),
  };
}
