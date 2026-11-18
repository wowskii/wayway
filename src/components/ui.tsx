// Small shared UI pieces so every screen looks the same (style from the Figma "Simplified" frames).
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-line bg-card p-6 shadow-sm ${className}`}>{children}</div>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  const look =
    variant === "primary"
      ? "bg-brand text-white hover:bg-brand-dark disabled:opacity-60"
      : "border border-line bg-card text-ink hover:bg-page";
  return (
    <button
      className={`inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-medium transition-colors ${look} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="h-11 rounded-xl border border-line bg-page px-3 outline-none focus:border-brand focus:bg-card"
        {...props}
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {children}
    </p>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-brand text-sm text-white">W</span>
      WayWay
    </span>
  );
}
