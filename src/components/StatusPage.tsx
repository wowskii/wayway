// Full-page message in the app's style (logo, then a white card): used by the loading, error and
// "not found" pages, so they look like the rest of WayWay instead of Next's plain defaults.
// No hooks: works in server and client components.
import type { ReactNode } from "react";
import Link from "next/link";
import { Card, Logo } from "@/components/ui";

export function StatusPage({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-page px-4 py-10">
      <Link href="/" aria-label="My trips">
        <Logo />
      </Link>
      <Card className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        {text && <p className="mt-2 text-sm text-muted">{text}</p>}
        {children && <div className="mt-5 flex flex-col gap-2">{children}</div>}
      </Card>
    </main>
  );
}

/** The green "My trips" link used as the way out of an error. */
export function MyTripsLink({ ghost = false }: { ghost?: boolean }) {
  return (
    <Link
      href="/"
      className={`inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-medium transition-colors ${
        ghost ? "border border-line bg-card text-ink hover:bg-page" : "bg-brand text-white hover:bg-brand-dark"
      }`}
    >
      Back to my trips
    </Link>
  );
}
