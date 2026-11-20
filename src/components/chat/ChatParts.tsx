// Small pieces of the group chat: avatar, one message, the typing row, the day separator.
import type { ReactNode } from "react";

export function Avatar({ name, wayway = false, size = "md" }: { name: string; wayway?: boolean; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm";
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${box} ${
        wayway ? "bg-brand text-white" : "bg-brand-soft text-brand"
      }`}
    >
      {wayway ? "W" : name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

/** Shows "@WayWay" as a highlighted token inside a message. */
function withMentions(text: string, mine: boolean): ReactNode[] {
  return text.split(/(@wayway\b)/i).map((part, i) =>
    /^@wayway$/i.test(part) ? (
      <span key={i} className={`rounded px-1 font-semibold ${mine ? "bg-white/20" : "bg-brand-soft text-brand"}`}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function GroupMessage({
  text,
  senderName,
  time,
  mine,
  wayway,
  firstOfGroup,
  readLabel,
  pending,
}: {
  text: string;
  senderName: string;
  time: string;
  mine: boolean;
  wayway: boolean;
  firstOfGroup: boolean;   // first message of a run by the same sender: show name + avatar
  readLabel: string;
  pending: boolean;
}) {
  const bubble = mine
    ? "rounded-tr-sm bg-brand text-white"
    : wayway
      ? "rounded-tl-sm bg-brand-soft text-ink"
      : "rounded-tl-sm bg-page text-ink";

  return (
    <div className={`flex gap-2 ${mine ? "justify-end" : "justify-start"} ${firstOfGroup ? "mt-3" : "mt-1"}`}>
      {!mine && (firstOfGroup ? <Avatar name={senderName} wayway={wayway} size="sm" /> : <span className="w-7 shrink-0" />)}
      <div className={`flex min-w-0 max-w-[80%] flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
        {!mine && firstOfGroup && (
          <span className={`text-xs font-medium ${wayway ? "text-brand" : "text-muted"}`}>{senderName}</span>
        )}
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed ${bubble} ${
            pending ? "opacity-60" : ""
          }`}
        >
          {withMentions(text, mine)}
        </div>
        <span className="text-[11px] tabular-nums text-muted">
          {pending ? "Sending…" : `${time} · ${readLabel}`}
        </span>
      </div>
    </div>
  );
}

export function TypingRow({ names, wayway }: { names: string[]; wayway: boolean }) {
  if (!names.length) return null;
  const who =
    names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} others`;
  return (
    <div className="mt-3 flex items-center gap-2" aria-live="polite">
      <Avatar name={names[0]} wayway={wayway && names.length === 1} size="sm" />
      <div className={`rounded-2xl rounded-tl-sm px-3.5 py-2.5 ${wayway && names.length === 1 ? "bg-brand-soft" : "bg-page"}`}>
        <span className="flex gap-1" aria-hidden>
          {[0, 150, 300].map((d) => (
            <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-brand/60 motion-reduce:animate-none" style={{ animationDelay: `${d}ms` }} />
          ))}
        </span>
      </div>
      <span className="text-xs text-muted">{who} {names.length === 1 ? "is" : "are"} typing…</span>
    </div>
  );
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3 text-xs text-muted">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
