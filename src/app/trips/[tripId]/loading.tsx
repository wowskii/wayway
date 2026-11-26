// Shown right away while a trip page (group chat, map, me, interview) is prepared on the server,
// instead of a frozen screen. Next.js uses it automatically for this folder and the ones under it.
// It keeps the top bar (logo, Log out) so switching tabs doesn't flash a different page: only the
// body is replaced by a small spinner for a moment.
import { Header } from "@/components/Header";

export default function TripLoading() {
  return (
    <>
      <Header />
      <main className="grid min-h-[calc(100dvh-4rem-1px)] place-items-center bg-page" aria-busy="true">
        <span className="flex items-center gap-3 text-sm text-muted">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden />
          Loading your trip…
        </span>
      </main>
    </>
  );
}
