// What GET /api/places/<placeId> returns to the map page's place card.
// Google content: shown while the page is open, never stored (Google's terms). The names of review
// authors and photo authors MUST be shown with the content (attribution rule).

export interface PlaceReview {
  author: string;
  authorUri?: string;        // link to the author's Google Maps profile
  rating?: number;           // 1-5
  when?: string;             // "2 months ago"
  text: string;
}

export interface PlaceDetails {
  rating?: number;           // 1-5, one decimal
  ratingCount?: number;
  summary?: string;          // Google's one-line description
  weekdayHours?: string[];   // 7 lines, Monday first: "Monday: 9:30 AM – 5:00 PM"
  mapsUrl?: string;          // "Open in Google Maps"
  photo?: { url: string; authors: { name: string; uri?: string }[] };
  reviews: PlaceReview[];
}
