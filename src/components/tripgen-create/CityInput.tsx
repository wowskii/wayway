"use client";
// City box of the trip creation page: type freely, the matching cities WayWay knows show up
// below (all of them while the box is empty); click one, or ↑ ↓ + Enter. Only these cities can be
// used (the spot dataset decides), so typing one exactly (any case) also counts as picking it.
import { useState } from "react";
import { CITIES } from "@/lib/tripgen-create/types";

/** The known city this text means (case and spaces ignored), or undefined. */
export const matchCity = (text: string) => CITIES.find((c) => c.toLowerCase() === text.trim().toLowerCase());

export function CityInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = value.trim().toLowerCase();
  const options = CITIES.filter((c) => c.toLowerCase().includes(q));
  const picked = matchCity(value);
  const showList = open && !picked;

  function choose(city: string) {
    onChange(city);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) return;
    if (e.key === "Escape") { e.stopPropagation(); return setOpen(false); }
    if (!options.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % options.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + options.length) % options.length); }
    if (e.key === "Enter") { e.preventDefault(); choose(options[Math.min(active, options.length - 1)]); }
  }

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor="trip-city" className="font-medium">City</label>
      <div className="relative">
        <input
          id="trip-city"
          autoComplete="off"
          placeholder="Where are you going?"
          required
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); if (picked && picked !== value) onChange(picked); }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showList}
          aria-controls="trip-city-options"
          aria-autocomplete="list"
          className="h-11 w-full rounded-xl border border-line bg-page px-3 outline-none focus:border-brand focus:bg-card"
        />
        {showList && (
          <div id="trip-city-options" role="listbox"
            className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-card shadow-lg">
            {options.length === 0 ? (
              <p className="px-3 py-2.5 text-muted">WayWay doesn&apos;t know this city yet. For now: {CITIES.join(", ")}.</p>
            ) : (
              options.map((c, i) => (
                <button key={c} type="button" role="option" aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(c)}
                  className={`block w-full px-3 py-2.5 text-left ${i === active ? "bg-brand-soft" : ""}`}>
                  {c}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <span className="text-xs text-muted">Available now: {CITIES.join(", ")}.</span>
    </div>
  );
}
