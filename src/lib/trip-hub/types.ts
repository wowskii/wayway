// View models for the trip page (/trips/[tripId]): what the server loads and the browser shows.
// They are built from contract types on the server (lib/trip-hub/load.ts) and contain no private
// data of other members.
import type { SatisfactionLevel, Spot } from "@/contracts/contract";

/** The three tools in the bottom-left dock. */
export type PanelId = "private" | "rate" | "itinerary";
export const PANEL_IDS: readonly PanelId[] = ["private", "rate", "itinerary"];
export const isPanelId = (v: unknown): v is PanelId => PANEL_IDS.includes(v as PanelId);

export interface HubMember {
  id: string;
  name: string;
}

/** One trip in the "Your trips" list (group selection). */
export interface HubTrip {
  id: string;
  name: string;
  city: string;
  dates: string;          // "Nov 21 – 23"
  needsProfile: boolean;  // interview not finished yet
}

/** "live" = read from the database; "preview" = sample data while the server part is missing. */
export type DataSource = "live" | "preview";

// ---------------------------------------------------------------------------
// Rate panel: every member says how they feel about each suggested spot.
// counts = live totals of the whole group (who chose what stays private).
// ---------------------------------------------------------------------------
export interface RateSpot {
  id: string;                                             // Spot.id
  name: string;
  category: Spot["category"];
  area: string;
  link?: string;                                          // official page (not in the Spot contract yet)
  visitTime?: string;                                     // "18:00 – 20:00", once WayWay placed it
  durationMin: number;
  myLevel?: SatisfactionLevel;
  counts: Partial<Record<SatisfactionLevel, number>>;     // includes my own choice
}

export interface RateData {
  source: DataSource;
  spots: RateSpot[];
}

// ---------------------------------------------------------------------------
// Itinerary panel (contract: ItineraryItem)
// ---------------------------------------------------------------------------
export interface ItineraryEntry {
  id: string;
  start: string;          // "10:30"
  end: string;
  title: string;          // spot name, or "Split into 2 groups"
  branches?: { members: string[]; spots: string[] }[];
  createdAt: string;      // ISO, used for the "new" badge
}

export interface ItineraryDay {
  day: number;            // 1 = first day
  label: string;          // "Nov 21"
  entries: ItineraryEntry[];
}

export interface ItineraryData {
  source: DataSource;
  days: ItineraryDay[];
}
