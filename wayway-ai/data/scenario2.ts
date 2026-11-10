// Test data: scenario 2 (museum vs shopping, one vegetarian member, one private budget note).
// No fixed time slot: the time is agreed with negotiateSlot (see scripts/try-ai.ts).
// Spots come from the shared dataset data/spots_tokyo.json (see data/spots.ts).

import type { Trip } from "@/contracts/contract";
import { ALL_SPOTS } from "./spots";

export const SPOTS = ALL_SPOTS;

const empty = { interests: [] as string[], fairnessCredits: 0, definitelyNoUsedToday: 0 };

export const TRIP: Trip = {
  id: "5b2f9e10-0000-4c00-8000-000000000002",
  name: "Tokyo Spring Trip",
  city: "Tokyo",
  startDate: "2026-11-21",
  endDate: "2026-11-23",
  timezone: "Asia/Tokyo",
  goal: "balanced",
  members: [
    { ...empty, id: "7c1e0c3a-0001-4a00-9000-000000000001", name: "Mia", pace: "relaxed", sleep: "early_bird",
      hard: { diet: ["vegetarian"], allergies: [], maxBudget: 40000 },
      interests: ["art", "history"], privateNote: "",
      preferenceStatements: ["Loves art museums", "Dislikes crowded malls"] },
    { ...empty, id: "7c1e0c3a-0002-4a00-9000-000000000002", name: "Tom", pace: "packed", sleep: "night_owl",
      hard: { diet: [], allergies: [], maxBudget: 80000 },
      interests: ["fashion", "street culture"], privateNote: "",
      preferenceStatements: ["Wants shopping in Shibuya", "Finds museums boring"] },
    { ...empty, id: "7c1e0c3a-0003-4a00-9000-000000000003", name: "Sarah", pace: "relaxed", sleep: "flexible",
      hard: { diet: [], allergies: [], maxBudget: 30000 },
      interests: ["museums"], privateNote: "My budget is really tight this month, please don't tell the group.",
      preferenceStatements: ["Slightly prefers the museum"] },
    { ...empty, id: "7c1e0c3a-0004-4a00-9000-000000000004", name: "Ken", pace: "moderate", sleep: "flexible",
      hard: { diet: [], allergies: [], maxBudget: 60000 },
      interests: ["souvenirs", "food"], privateNote: "",
      preferenceStatements: ["Wants to buy souvenirs", "Open to a short museum visit"] },
  ],
};

