"use client";
// Rate the suggested spots. Each card is one spot: the 5 buttons are how I feel about it,
// the number on each button is how many people in the group chose that level (live totals).
// Tapping a button saves my choice right away; tapping it again removes it.
import { useEffect, useState } from "react";
import type { SatisfactionLevel } from "@/contracts/contract";
import { saveSpotRating } from "@/lib/chat/client";
import { CATEGORY_LABEL, LEVELS } from "@/lib/trip-hub/levels";
import type { RateData, RateSpot } from "@/lib/trip-hub/types";
import { PanelFrame } from "./PanelFrame";

type Mine = Record<string, SatisfactionLevel | undefined>;   // spotId -> my level

/** Spots I have not rated yet (the badge on the dock). Sample data never counts. */
export function unratedCount(data: RateData, mine: Mine) {
  if (data.source !== "live") return 0;
  return data.spots.filter((s) => !mine[s.id]).length;
}

/** "https://www.meijijingu.or.jp/en/" -> "meijijingu.or.jp/en" */
function shortUrl(link: string) {
  try {
    const u = new URL(link);
    return (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, "");
  } catch {
    return link;
  }
}

const duration = (min: number) => (min % 60 === 0 ? `${min / 60} h` : min > 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

/** Moves my vote in the totals: -1 on the old level, +1 on the new one. */
function moveCount(counts: RateSpot["counts"], from?: SatisfactionLevel, to?: SatisfactionLevel) {
  const next = { ...counts };
  if (from) next[from] = Math.max(0, (next[from] ?? 0) - 1);
  if (to) next[to] = (next[to] ?? 0) + 1;
  return next;
}

export function RatePanel({
  data,
  tripId,
  onMineChange,
  onClose,
}: {
  data: RateData;
  tripId: string;
  onMineChange: (mine: Mine) => void;
  onClose: () => void;
}) {
  const live = data.source === "live";
  const [spots, setSpots] = useState(data.spots);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onMineChange(Object.fromEntries(spots.map((s) => [s.id, s.myLevel]))), [spots, onMineChange]);

  async function rate(spot: RateSpot, level: SatisfactionLevel) {
    const to = spot.myLevel === level ? undefined : level;   // same button again = undo
    const apply = (from?: SatisfactionLevel, next?: SatisfactionLevel) =>
      setSpots((list) => list.map((s) => (s.id === spot.id ? { ...s, myLevel: next, counts: moveCount(s.counts, from, next) } : s)));

    apply(spot.myLevel, to);   // update at once; undo if the server refuses
    setError(null);
    if (!live || !to) return;  // sample data: local only. Removing a rating needs the server too (TODO with the route).
    try {
      await saveSpotRating(tripId, spot.id, to);
    } catch (err) {
      apply(to, spot.myLevel);
      setError((err as Error).message);
    }
  }

  const rated = spots.filter((s) => s.myLevel).length;

  return (
    <PanelFrame
      title="Spot suggestions"
      subtitle={`${spots.length} spots · ${rated} rated by you · totals update live`}
      preview={!live}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted">
          Tap how you feel about each spot. The numbers show the whole group; nobody sees who chose what.
        </p>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {spots.map((s) => (
          <article key={s.id} className="rounded-2xl border border-line bg-card p-4 shadow-sm">
            <h3 className="text-lg font-semibold">{s.name}</h3>
            <p className="text-sm text-muted">
              {CATEGORY_LABEL[s.category]} · {s.area}
            </p>
            {s.link && (
              <a
                href={s.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex max-w-full items-center gap-1 text-sm text-brand underline-offset-2 hover:underline"
              >
                <span className="truncate">{shortUrl(s.link)}</span>
                <span aria-hidden>↗</span>
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}

            <dl className="mt-3 flex gap-6 text-sm">
              {s.visitTime && (
                <div>
                  <dt className="text-xs text-muted">Visit time</dt>
                  <dd className="tabular-nums">{s.visitTime}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted">Duration</dt>
                <dd>{duration(s.durationMin)}</dd>
              </div>
            </dl>

            <div role="radiogroup" aria-label={`How do you feel about ${s.name}?`} className="mt-3 grid grid-cols-5 gap-1.5 sm:gap-2">
              {LEVELS.map((l) => {
                const on = s.myLevel === l.id;
                const count = s.counts[l.id] ?? 0;
                return (
                  <button
                    key={l.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`${l.label}, ${count} ${count === 1 ? "person" : "people"}`}
                    onClick={() => rate(s, l.id)}
                    className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2.5 transition-colors ${
                      on ? "border-brand bg-brand-soft text-brand" : "border-line bg-page text-ink hover:border-brand"
                    }`}
                  >
                    <span className="text-center text-[11px] leading-tight sm:text-xs">{l.label}</span>
                    <span className={`text-base tabular-nums ${on ? "font-bold" : "font-semibold"}`}>{count}</span>
                  </button>
                );
              })}
            </div>
          </article>
        ))}

        {!live && (
          <p className="text-center text-xs text-muted">
            Sample spots: your taps change the numbers on this screen only, nothing is saved yet.
          </p>
        )}
      </div>
    </PanelFrame>
  );
}
