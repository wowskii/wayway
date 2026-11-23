// GET /api/places/<placeId> — Google details for one of OUR spots, for the place card on the map page.
//
// - Logged-in users only; only Place IDs of our own spots (data/place_ids.json), so nobody can spend
//   the team's free calls looking up other places.
// - 2 Google calls, each counted in the shared daily limit:
//     place_details (rating, reviews, hours...: top "Enterprise + Atmosphere" tier, 30/day)
//     place_photo   (the first photo's URL, 30/day). If only the photo is over its limit, the card has no photo.
// - Nothing is stored (Google's terms): the browser keeps it while the page is open.
import { NextResponse } from "next/server";
import { GoogleError, googleFetch } from "@/lib/google/server";
import type { PlaceDetails } from "@/lib/places/types";
import { SPOTS } from "@/lib/spots";
import { createClient } from "@/lib/supabase/server";

const OUR_PLACE_IDS = new Set(SPOTS.map((s) => s.placeId).filter(Boolean));
const MAX_REVIEWS = 3;

// Only the fields the card shows (Google bills by the most expensive field requested).
const FIELDS = [
  "rating", "userRatingCount", "editorialSummary", "regularOpeningHours.weekdayDescriptions",
  "googleMapsUri", "photos.name", "photos.authorAttributions", "reviews",
].join(",");

interface GoogleText { text?: string }
interface GoogleAuthor { displayName?: string; uri?: string }
interface GooglePlace {
  rating?: number;
  userRatingCount?: number;
  editorialSummary?: GoogleText;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  googleMapsUri?: string;
  photos?: { name: string; authorAttributions?: GoogleAuthor[] }[];
  reviews?: { rating?: number; relativePublishTimeDescription?: string; text?: GoogleText; originalText?: GoogleText; authorAttribution?: GoogleAuthor }[];
}

export async function GET(_req: Request, { params }: { params: Promise<{ placeId: string }> }) {
  const { placeId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  if (!OUR_PLACE_IDS.has(placeId)) return NextResponse.json({ error: "Unknown place." }, { status: 404 });

  let place: GooglePlace;
  try {
    place = await googleFetch<GooglePlace>("place_details",
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en`, { fieldMask: FIELDS });
  } catch (err) {
    if (err instanceof GoogleError && err.kind === "limit") {
      return NextResponse.json({ error: "Google details are resting for today (free daily limit reached)." }, { status: 429 });
    }
    console.error("[places]", err);
    return NextResponse.json({ error: "Google details can't load right now." }, { status: 502 });
  }

  const details: PlaceDetails = {
    rating: place.rating,
    ratingCount: place.userRatingCount,
    summary: place.editorialSummary?.text,
    weekdayHours: place.regularOpeningHours?.weekdayDescriptions,
    mapsUrl: place.googleMapsUri,
    reviews: (place.reviews ?? [])
      .map((r) => ({
        author: r.authorAttribution?.displayName ?? "A Google user",
        authorUri: r.authorAttribution?.uri,
        rating: r.rating,
        when: r.relativePublishTimeDescription,
        text: r.text?.text ?? r.originalText?.text ?? "",
      }))
      .filter((r) => r.text)
      .slice(0, MAX_REVIEWS),
  };

  // First photo: ask Google for a short-lived image URL (skipHttpRedirect = answer JSON, not the image).
  // The URL contains no key, so the browser can load it directly.
  const photo = place.photos?.[0];
  if (photo) {
    try {
      const media = await googleFetch<{ photoUri?: string }>("place_photo",
        `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=640&skipHttpRedirect=true`);
      if (media.photoUri) {
        details.photo = {
          url: media.photoUri,
          authors: (photo.authorAttributions ?? []).map((a) => ({ name: a.displayName ?? "Google user", uri: a.uri })),
        };
      }
    } catch (err) {
      if (!(err instanceof GoogleError && err.kind === "limit")) console.error("[places] photo", err);
      // no photo: the rest of the card still works
    }
  }

  return NextResponse.json(details);
}
