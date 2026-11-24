// Shown instead of the trip page when I'm not (or no longer) in this trip:
// the organizer removed me, the trip was deleted, or the link is someone else's trip.
import Link from "next/link";

export function NotMember() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">You&apos;re not a member of this trip</h1>
      <p className="mt-2 text-sm text-muted">
        The organizer may have removed you, or the trip no longer exists.
      </p>
      <Link href="/"
        className="mt-6 inline-flex h-11 items-center rounded-xl bg-brand px-5 text-sm font-medium text-white hover:bg-brand-dark">
        Back to My trips
      </Link>
    </main>
  );
}
