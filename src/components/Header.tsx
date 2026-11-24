import Link from "next/link";
import { logOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/ui";

// Top bar: logo (back to my trips), the user's name and a log-out button.
// wide: full-width bar for the trip page (sidebar + chat), instead of the centered 5xl column
// (relative: the trip tabs line up with the sidebar's edge).
export function Header({ displayName, children, wide = false }: { displayName: string; children?: React.ReactNode; wide?: boolean }) {
  return (
    <header className="border-b border-line bg-card">
      <div className={`mx-auto flex h-16 items-center gap-4 px-4 ${wide ? "relative max-w-none" : "max-w-5xl"}`}>
        <Link href="/" aria-label="My trips">
          <Logo />
        </Link>
        <div className="flex-1">{children}</div>
        <span className="flex items-center gap-2" title={displayName}>
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand">
            {displayName.trim().slice(0, 1).toUpperCase() || "?"}
          </span>
          <span className="hidden text-sm font-medium sm:inline">{displayName}</span>
        </span>
        <form action={logOut}>
          <button className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-page hover:text-ink">Log out</button>
        </form>
      </div>
    </header>
  );
}
