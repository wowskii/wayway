"use client";
// Date box that always reads yyyy/mm/dd (the browser's own date input follows the browser's
// language: 年/月/日, mm/dd/yyyy...). Type the digits (the slashes come by themselves), or open the
// calendar with the button. value / onChange use YYYY-MM-DD ("" while incomplete or not a real date).
import { useRef, useState } from "react";

const toText = (iso: string) => iso.replaceAll("-", "/");

function fromDigits(digits: string) {
  const d = digits.slice(0, 8);
  const text = d.slice(0, 4) + (d.length > 4 ? `/${d.slice(4, 6)}` : "") + (d.length > 6 ? `/${d.slice(6, 8)}` : "");
  if (d.length < 8) return { text, iso: "" };
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const real = new Date(`${iso}T00:00:00Z`).toISOString().startsWith(iso);   // no 2026/02/31
  return { text, iso: real ? iso : "" };
}

export function DateField({ label, value, min, onChange }: {
  label: string;
  value: string;            // YYYY-MM-DD or ""
  min?: string;             // YYYY-MM-DD
  onChange: (iso: string) => void;
}) {
  const [text, setText] = useState(toText(value));
  const [shownFor, setShownFor] = useState(value);
  const picker = useRef<HTMLInputElement>(null);

  // Changed from outside (the last day follows the first day): show the new date
  if (value !== shownFor) {
    setShownFor(value);
    if (value) setText(toText(value));
  }

  function type(raw: string) {
    const { text: t, iso } = fromDigits(raw.replace(/\D/g, ""));
    setText(t);
    setShownFor(iso);
    onChange(iso);
  }

  const complete = text.length === 10;
  const problem = complete && !value ? "Not a real date" : value && min && value < min ? `Pick ${toText(min)} or later` : "";

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <div className="relative">
        <input
          aria-label={`${label} (yyyy/mm/dd)`}
          inputMode="numeric"
          autoComplete="off"
          placeholder="yyyy/mm/dd"
          required
          value={text}
          onChange={(e) => type(e.target.value)}
          className={`h-11 w-full rounded-xl border bg-page pl-3 pr-11 outline-none focus:bg-card ${problem ? "border-red-400" : "border-line focus:border-brand"}`}
        />
        <button
          type="button"
          aria-label={`Pick the ${label.toLowerCase()} on a calendar`}
          onClick={() => {
            try {
              picker.current?.showPicker();
            } catch {
              picker.current?.focus();
            }
          }}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-muted hover:text-ink"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-5 w-5" aria-hidden>
            <rect x="3.5" y="5" width="17" height="15" rx="2" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
          </svg>
        </button>
        {/* The browser's calendar, opened by the button; its own text box is never shown */}
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden
          min={min}
          value={value}
          onChange={(e) => {
            setText(toText(e.target.value));
            setShownFor(e.target.value);
            onChange(e.target.value);
          }}
          className="pointer-events-none absolute bottom-0 right-0 h-0 w-11 opacity-0"
        />
      </div>
      {problem && <span className="text-xs text-red-700">{problem}</span>}
    </div>
  );
}
