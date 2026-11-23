import Link from "next/link";
import { logOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/ui";

// Top bar: logo (back to my trips), the user's name and a log-out button.
export function Header({ displayName, children }: { displayName: string; children?: React.ReactNode }) {
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4">
        <Link href="/" aria-label="My trips">
          <Logo />
        </Link>
        <div className="flex-1">{children}</div>
        <span className="hidden text-sm text-muted sm:inline">{displayName}</span>
        <form action={logOut}>
          <button className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-page hover:text-ink">Log out</button>
        </form>
      </div>
    </header>
  );
}
