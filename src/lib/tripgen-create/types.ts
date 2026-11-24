// Shapes shared by the trip creation page (/trips/new) and its server action.

/** Cities WayWay has spots for (the spot dataset is Tokyo only for now). */
export const CITIES = ["Tokyo"];

/** trips.goal: how full the days should be. */
export const GOALS = [
  { id: "relaxed", label: "Relaxed", hint: "Few stops, long breaks" },
  { id: "balanced", label: "Balanced", hint: "A good mix" },
  { id: "packed", label: "Packed", hint: "See as much as possible" },
] as const;
export type Goal = (typeof GOALS)[number]["id"];

/** One account in the "add friends" dropdown (database function search_users). */
export interface FoundUser {
  userId: string;
  displayName: string;
  email: string;
}

export interface CreateTripInput {
  name: string;
  city: string;
  startDate: string;   // YYYY-MM-DD
  endDate: string;
  goal: Goal;
  friendIds: string[];
}

export type CreateTripResult = { tripId: string; inviteCode: string; error?: undefined } | { error: string };

/** Fewest characters before the dropdown searches (also checked by search_users). */
export const MIN_SEARCH = 1;
/** Friends that can be added on this page (create_trip checks it too); more join with the link. */
export const MAX_FRIENDS = 11;
