// One chat bubble. WayWay on the left in soft green (like the Figma), the member on the right.
import type { ReactNode } from "react";

export function MessageBubble({
  sender,
  children,
  pending = false,
}: {
  sender: "member" | "wayway";
  children: ReactNode;
  pending?: boolean;
}) {
  const isWayway = sender === "wayway";
  return (
    <div className={`flex flex-col gap-1 ${isWayway ? "items-start" : "items-end"}`}>
      {isWayway && <span className="text-xs font-medium text-brand">WayWay</span>}
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
          isWayway ? "rounded-tl-sm bg-brand-soft text-ink" : "rounded-tr-sm bg-page text-ink"
        } ${pending ? "opacity-60" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}

/** "WayWay is typing" dots while the reply is on its way. */
export function TypingBubble() {
  return (
    <MessageBubble sender="wayway">
      <span className="flex gap-1 py-1" aria-label="WayWay is typing">
        {[0, 150, 300].map((d) => (
          <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-brand/60" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
    </MessageBubble>
  );
}
