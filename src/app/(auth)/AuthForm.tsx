"use client";
// One form for both login and sign-up. useActionState sends the form to the server action
// and gives back its result (an error message) without reloading the page.
import Link from "next/link";
import { useActionState } from "react";
import { Button, Card, ErrorText, Field, Logo } from "@/components/ui";
import { logIn, signUp, type AuthState } from "./actions";

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next: string }) {
  const isSignup = mode === "signup";
  const [state, action, pending] = useActionState<AuthState, FormData>(isSignup ? signUp : logIn, {});
  const otherHref = `${isSignup ? "/login" : "/signup"}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <div>
        <h1 className="text-2xl font-semibold">{isSignup ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1 text-sm text-muted">
          {isSignup ? "Plan trips with your friends, fairly." : "Log in to continue planning."}
        </p>
      </div>

      <Card>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          {isSignup && (
            <Field label="Your name" name="displayName" required maxLength={40} autoComplete="nickname"
              hint="How your friends will see you." />
          )}
          <Field label="Email" name="email" type="email" required autoComplete="email" />
          <Field label="Password" name="password" type="password" required minLength={isSignup ? 8 : undefined}
            autoComplete={isSignup ? "new-password" : "current-password"}
            hint={isSignup ? "At least 8 characters." : undefined} />
          <ErrorText>{state.error}</ErrorText>
          {state.info && <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">{state.info}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Please wait…" : isSignup ? "Create account" : "Log in"}
          </Button>
        </form>
      </Card>

      <p className="text-center text-sm text-muted">
        {isSignup ? "Already have an account?" : "New to WayWay?"}{" "}
        <Link href={otherHref} className="font-medium text-brand hover:underline">
          {isSignup ? "Log in" : "Create an account"}
        </Link>
      </p>
    </main>
  );
}
