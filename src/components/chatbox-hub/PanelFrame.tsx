// Common frame of the tools opened in the middle: title, subtitle, close button.
import type { ReactNode } from "react";
import { CloseIcon } from "./icons";

export function PanelFrame({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-page" aria-label={title}>
      <header className="flex items-center gap-3 border-b border-line bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-page hover:text-ink"
        >
          <CloseIcon />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}
