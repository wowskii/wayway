"use client";
// Email search box with a dropdown: type an email, the accounts whose email starts with it show up
// (from the first character on), click one (or ↑ ↓ + Enter) to pick it.
// Used by the trip creation page (adds to the list) and the trip settings window (adds to the trip).
import { useRef, useState } from "react";
import { searchUsers } from "@/lib/tripgen-create/search";
import { MIN_SEARCH, type FoundUser } from "@/lib/tripgen-create/types";

const DEBOUNCE_MS = 200;

export function FriendSearch({
  onPick, excludeIds = [], tripId, disabled = false, placeholder = "Type your friend's email", label = "Add friends", hint, noMatch,
}: {
  onPick: (user: FoundUser) => void;
  excludeIds?: string[];       // user ids not to offer (already picked)
  tripId?: string;             // leave out people already in this trip
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  hint?: string;
  noMatch?: string;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; users: FoundUser[] } | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef("");
  const input = useRef<HTMLInputElement>(null);

  const q = query.trim();
  const skip = new Set(excludeIds);
  const results = found && found.query === q ? found.users.filter((u) => !skip.has(u.userId)) : null;

  function type(value: string) {
    setQuery(value);
    setOpen(true);
    setActive(0);
    setError(false);
    clearTimeout(timer.current);
    const next = value.trim();
    latest.current = next;
    if (next.length < MIN_SEARCH) return;
    timer.current = setTimeout(async () => {
      try {
        const users = await searchUsers(next, tripId);
        if (latest.current === next) setFound({ query: next, users });   // ignore answers to older text
      } catch {
        if (latest.current === next) setError(true);
      }
    }, DEBOUNCE_MS);
  }

  function pick(user: FoundUser) {
    onPick(user);
    setQuery("");
    setFound(null);
    latest.current = "";
    setOpen(false);
    input.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && open && q) {
      e.stopPropagation();   // close the dropdown only, not the window around it
      return setOpen(false);
    }
    if (!results?.length) {
      if (e.key === "Enter") e.preventDefault();   // never submit the whole form from this box
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % results.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length); }
    if (e.key === "Enter") { e.preventDefault(); pick(results[Math.min(active, results.length - 1)]); }
  }

  const showList = open && q.length > 0;
  const listId = `${tripId ?? "new"}-friend-results`;

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor={`${listId}-input`} className="font-medium">{label}</label>
      <div className="relative">
        <input
          ref={input}
          id={`${listId}-input`}
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder={placeholder}
          disabled={disabled}
          value={query}
          onChange={(e) => type(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          className="h-11 w-full rounded-xl border border-line bg-page px-3 outline-none focus:border-brand focus:bg-card disabled:opacity-60"
        />
        {showList && (
          <div
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-card shadow-lg"
          >
            {q.length < MIN_SEARCH ? (
              <p className="px-3 py-2.5 text-muted">Keep typing…</p>
            ) : error ? (
              <p className="px-3 py-2.5 text-red-700">Search failed. Try again.</p>
            ) : results === null ? (
              <p className="px-3 py-2.5 text-muted">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-2.5 text-muted">{noMatch ?? "No account found."}</p>
            ) : (
              results.map((u, i) => (
                <button
                  key={u.userId}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}   // keep the focus in the box
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(u)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === active ? "bg-brand-soft" : ""}`}
                >
                  <Initial name={u.displayName} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{u.displayName}</span>
                    <span className="block truncate text-xs text-muted">{u.email}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

export function Initial({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-brand-soft font-semibold text-brand ${small ? "h-6 w-6 text-xs" : "h-8 w-8 text-sm"}`}
    >
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
