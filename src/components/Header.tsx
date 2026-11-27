import Link from "next/link";
import { logOut } from "@/app/(auth)/actions";
import { TripTabs } from "@/components/TripTabs";
import { Logo } from "@/components/ui";

// Top bar of every page: logo (back to my trips) · page content (trip name + tabs) · [Me] · Log out.
// me:   link to my profile for this trip (trip pages only); `active` when the Me page is open.
// The bar is full width on EVERY page (the logo never jumps when you move between pages). It is
// `relative` so the trip tabs (TripTabs) can line up with the trip page's sidebar edge.
export function Header({
  me,
  children,
}: {
  me?: { href: string; active: boolean };
  children?: React.ReactNode;
}) {
  return (
    <header className="border-b border-line bg-card">
      <div className="relative flex h-16 items-center gap-2 px-4 sm:gap-4">
        <Link href="/" aria-label="My trips" className="shrink-0">
          <Logo />
        </Link>
        <div className="min-w-0 flex-1">{children}</div>
        {me && (
          <Link
            href={me.href}
            aria-current={me.active ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${me.active ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-page hover:text-ink"}`}
          >
            Me
          </Link>
        )}
        <form action={logOut}>
          <button className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-page hover:text-ink">Log out</button>
        </form>
      </div>
    </header>
  );
}

/** The header of every trip page (after the interview): trip tabs in the middle, "Me" on the right. */
export function TripHeader({
  tripId,
  tripName,
  dates,
  active,
}: {
  tripId: string;
  tripName: string;
  dates?: string;
  active: "chat" | "map" | "me";
}) {
  return (
    <Header me={{ href: `/trips/${tripId}/me`, active: active === "me" }}>
      <TripTabs tripId={tripId} tripName={tripName} dates={dates} active={active === "me" ? undefined : active} />
    </Header>
  );
}
