// Common frame of the tools opened in the middle: title, optional "Preview" tag, close button.
import type { ReactNode } from "react";
import { CloseIcon } from "./icons";

export function PanelFrame({
  title,
  subtitle,
  preview = false,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  preview?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-page" aria-label={title}>
      <header className="flex items-center gap-3 border-b border-line bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold">
            {title}
            {preview && (
              <span className="rounded-full border border-line bg-page px-2 py-0.5 text-[11px] font-medium text-muted">
                Preview · sample data
              </span>
            )}
          </h2>
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
