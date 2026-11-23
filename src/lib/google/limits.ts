// Daily limits for our Google Maps Platform calls: the app's own safety net to stay in the free tier.
// Google's free usage is per MONTH and per pricing tier. Each daily limit here is the monthly free
// amount / 31 (rounded down), so even 31 days at the limit stay free:
//   monthly free usage >= daily limit x 31
// These limits are shared by the whole team (counted in the database table google_usage).
// The Google Cloud quotas set in the console are the real hard cap; this one also protects us
// from our own bugs (e.g. a React effect that keeps calling the API).
export const GOOGLE_DAILY_LIMITS = {
  map_load: 300,       // Maps JavaScript API, map loads: 10,000 free / month
  route: 300,          // Routes API, compute routes (Essentials): 10,000 free / month
  text_search: 100,    // Places API (New), Text Search (Pro fields): 5,000 free / month
  place_details: 30,   // Places API (New), Place Details with reviews (Enterprise + Atmosphere): 1,000 free / month
  place_photo: 30,     // Places API (New), Place Photos: 1,000 free / month
} as const;

export type GoogleApi = keyof typeof GOOGLE_DAILY_LIMITS;
