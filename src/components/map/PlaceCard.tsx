"use client";
// Card shown over the map when a stop is selected.
//   Top: our own data (always there, free): category, price, usual visit length, diet tags.
//   Below: Google's data, loaded on click (photo, rating, description, hours of the trip day, reviews).
// Attribution (Google's terms): review authors and photo authors are named and linked, and the
// Google content is labelled as coming from Google.
import { currencyOfSpot, formatMoney } from "@/lib/cities";
import type { PlaceDetails } from "@/lib/places/types";
import type { PlanStop } from "@/lib/itinerary/view";

export type PlaceState = { status: "loading" } | { status: "ok"; data: PlaceDetails } | { status: "error"; message: string };

interface Props {
  stop: PlanStop;
  place?: PlaceState;           // undefined = this spot has no Google place (an area)
  tripDate: string;             // "Sat, Nov 21"
  weekdayIndex: number;         // 0 = Monday (Google's order)
  onClose: () => void;
}

const CATEGORY: Record<string, string> = {
  museum: "Museum", temple: "Temple or shrine", food: "Food", shopping: "Shopping",
  nature: "Park or garden", nightlife: "Nightlife", hotel: "Hotel",
};

export function PlaceCard({ stop, place, tripDate, weekdayIndex, onClose }: Props) {
  const { spot } = stop;
  const facts = [
    CATEGORY[spot.category] ?? spot.category,
    spot.price > 0 ? `≈ ${formatMoney(spot.price, currencyOfSpot(spot.id))} per person` : "Free",
    `usually ${duration(spot.durationMin)}`,
  ];

  return (
    <div className="absolute inset-x-3 bottom-3 z-10 flex max-h-[75%] flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-lg sm:right-auto sm:w-[340px]">
      {place?.status === "ok" && place.data.photo && (
        // Plain <img>: Google's photo URL is short-lived and must not be cached/optimised by Next.js.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={place.data.photo.url} alt={spot.name} className="h-36 w-full shrink-0 object-cover" />
      )}
      <div className="overflow-y-auto p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold leading-tight">{spot.name}</h3>
            <p className="mt-0.5 text-xs text-muted">{spot.area} · {facts.join(" · ")}</p>
            {spot.dietTags.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-1">
                {spot.dietTags.map((t) => (
                  <span key={t} className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">{t}</span>
                ))}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 rounded-lg px-2 py-1 text-muted hover:bg-page hover:text-ink">
            ×
          </button>
        </div>

        {!place && <p className="mt-3 text-xs text-muted">This stop is an area, not a single place: no Google details.</p>}
        {place?.status === "loading" && <p className="mt-3 text-xs text-muted">Loading details from Google…</p>}
        {place?.status === "error" && <p className="mt-3 text-xs text-muted">{place.message}</p>}
        {place?.status === "ok" && <GoogleDetails data={place.data} tripDate={tripDate} weekdayIndex={weekdayIndex} />}
      </div>
      {/* Outside the scrolling part: the Google credit and the main link stay visible. */}
      {place?.status === "ok" && <GoogleFooter data={place.data} />}
    </div>
  );
}

function GoogleFooter({ data }: { data: PlaceDetails }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-muted">
      <span className="min-w-0 truncate">
        Details from Google
        {data.photo && data.photo.authors.length > 0 && (
          <>
            {" "}· Photo:{" "}
            {data.photo.authors.map((a, i) => (
              <span key={i}>
                {i > 0 && ", "}
                {a.uri ? <a href={a.uri} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.name}</a> : a.name}
              </span>
            ))}
          </>
        )}
      </span>
      {data.mapsUrl && (
        <a href={data.mapsUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 font-medium text-brand hover:underline">
          Open in Google Maps
        </a>
      )}
    </div>
  );
}

function GoogleDetails({ data, tripDate, weekdayIndex }: { data: PlaceDetails; tripDate: string; weekdayIndex: number }) {
  // "Saturday: 9:30 AM – 5:00 PM" -> "9:30 AM – 5:00 PM"
  const hours = data.weekdayHours?.[weekdayIndex]?.replace(/^[^:]+:\s*/, "");
  return (
    <div className="mt-3 space-y-3 text-sm">
      {data.rating !== undefined && (
        <p className="flex items-center gap-2">
          <span className="font-semibold">{data.rating.toFixed(1)}</span>
          <Stars value={data.rating} />
          {data.ratingCount !== undefined && <span className="text-xs text-muted">({data.ratingCount.toLocaleString("en-US")} reviews)</span>}
        </p>
      )}
      {data.summary && <p className="text-muted">{data.summary}</p>}
      {hours && (
        <p className="text-xs">
          <span className="text-muted">Open on {tripDate}: </span>
          <span className="font-medium">{hours}</span>
        </p>
      )}

      {data.reviews.length > 0 && (
        <ul className="space-y-2 border-t border-line pt-3">
          {data.reviews.map((r, i) => (
            <li key={i} className="text-xs">
              <p className="flex flex-wrap items-center gap-x-2 text-muted">
                {r.authorUri ? (
                  <a href={r.authorUri} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:underline">{r.author}</a>
                ) : (
                  <span className="font-medium text-ink">{r.author}</span>
                )}
                {r.rating !== undefined && <Stars value={r.rating} small />}
                {r.when && <span>{r.when}</span>}
              </p>
              <p className="mt-0.5 line-clamp-3 text-ink">{r.text}</p>
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}

function Stars({ value, small }: { value: number; small?: boolean }) {
  const full = Math.round(value);
  return (
    <span aria-label={`${value} out of 5`} className={`tracking-tight text-amber-500 ${small ? "text-[10px]" : "text-sm"}`}>
      {"★".repeat(full)}
      <span className="text-line">{"★".repeat(5 - full)}</span>
    </span>
  );
}

function duration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}
