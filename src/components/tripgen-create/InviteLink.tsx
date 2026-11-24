"use client";
// The invitation to paste in any chat app: who invites, to which trip, where and when, then the
// invite link (/join/<code>, Quentin's join page). Copy puts it on the clipboard as plain text
// (chat apps turn the URL into a link) and as HTML with a real link (email, docs).
// Used on the trip creation page and in the trip settings window.
import { useState } from "react";

export interface Invitation {
  code: string;
  host: string;        // the trip's creator
  tripName: string;
  city: string;
  startDate: string;   // YYYY-MM-DD
  endDate: string;
}

/** "Dec 4 – 6, 2026", "Dec 30, 2026 – Jan 2, 2027" */
export function inviteDates(start: string, end: string) {
  const month = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" });
  const day = (s: string) => Number(s.slice(8, 10));
  const year = (s: string) => s.slice(0, 4);
  if (start === end) return `${month(start)} ${day(start)}, ${year(start)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) return `${month(start)} ${day(start)} – ${day(end)}, ${year(end)}`;
  if (year(start) === year(end)) return `${month(start)} ${day(start)} – ${month(end)} ${day(end)}, ${year(end)}`;
  return `${month(start)} ${day(start)}, ${year(start)} – ${month(end)} ${day(end)}, ${year(end)}`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function InviteLink({ code, host, tripName, city, startDate, endDate }: Invitation) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? `/join/${code}` : `${window.location.origin}/join/${code}`;
  const line1 = `${host} invites you to join ${tripName}.`;
  const line2 = `${city} · ${inviteDates(startDate, endDate)}`;
  const text = `${line1}\n${line2}\n${url}`;
  const html = `${esc(line1)}<br>${esc(line2)}<br><a href="${esc(url)}">${esc(url)}</a>`;

  async function copy() {
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);   // no clipboard access: the text stays selectable
    }
  }

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">Invitation</span>
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-page p-3 sm:flex-row sm:items-start">
        <p className="min-w-0 flex-1 select-all break-words leading-relaxed">
          {line1}
          <br />
          <span className="text-muted">{line2}</span>
          <br />
          <a href={url} target="_blank" rel="noreferrer" className="break-all text-brand underline underline-offset-2">{url}</a>
        </p>
        <button type="button" onClick={copy}
          className="h-10 shrink-0 rounded-xl border border-line bg-card px-4 font-medium hover:bg-page">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <span className="text-xs text-muted">
        Anyone with this link can join after logging in. Invite code: <span className="font-mono text-ink">{code}</span>
      </span>
    </div>
  );
}
