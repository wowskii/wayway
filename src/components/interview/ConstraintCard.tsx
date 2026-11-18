"use client";
// The confirmation card: WayWay shows what it understood about diet / allergies / budget,
// and nothing is saved until the member taps Confirm (or edits it first, or says it's wrong).
// It also says WHO will see each item, so the member knows what stays private.
import { useState } from "react";
import type { HardConstraints } from "@/contracts/contract";
import { Button } from "@/components/ui";

type Constraints = Partial<HardConstraints>;
type Status = "pending" | "confirmed" | "rejected";

const yen = (n: number) => `¥${n.toLocaleString("en-US")}`;
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function ConstraintCard({
  constraints,
  status,
  onAnswer,
}: {
  constraints: Constraints;
  status: Status;
  onAnswer: (decision: "confirm" | "reject", edited?: Constraints) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [diet, setDiet] = useState((constraints.diet ?? []).join(", "));
  const [allergies, setAllergies] = useState((constraints.allergies ?? []).join(", "));
  const [budget, setBudget] = useState(constraints.maxBudget ? String(constraints.maxBudget) : "");

  async function answer(decision: "confirm" | "reject", edited?: Constraints) {
    setBusy(true);
    try {
      await onAnswer(decision, edited);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  function saveEdit() {
    const edited: Constraints = {};
    if (constraints.diet) edited.diet = list(diet);
    if (constraints.allergies) edited.allergies = list(allergies);
    if (constraints.maxBudget !== undefined) {
      const n = Number(budget.replace(/[^\d]/g, ""));
      if (n) edited.maxBudget = n;
    }
    void answer("confirm", edited);
  }

  const rows: { label: string; value: string; who: string; field?: [string, (v: string) => void] }[] = [];
  if (constraints.diet)
    rows.push({ label: "Diet", value: constraints.diet.join(", ") || "none", who: "Your group can see this", field: [diet, setDiet] });
  if (constraints.allergies)
    rows.push({ label: "Allergies", value: constraints.allergies.join(", ") || "none", who: "Private: only WayWay", field: [allergies, setAllergies] });
  if (constraints.maxBudget !== undefined)
    rows.push({ label: "Budget for the trip", value: yen(constraints.maxBudget), who: "Private: only WayWay", field: [budget, setBudget] });

  return (
    <div className="ml-0 w-full max-w-[85%] rounded-2xl border border-line bg-card p-4 shadow-sm">
      <p className="text-sm font-medium">
        {status === "pending" ? "Did I get this right?" : status === "confirmed" ? "Saved to your profile" : "Not saved"}
      </p>
      <dl className="mt-3 flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted">{r.label}</dt>
            <dd className="text-sm">
              {editing && r.field ? (
                <input
                  aria-label={r.label}
                  value={r.field[0]}
                  onChange={(e) => r.field![1](e.target.value)}
                  inputMode={r.label.startsWith("Budget") ? "numeric" : "text"}
                  className="h-9 w-full rounded-lg border border-line bg-page px-2 outline-none focus:border-brand"
                />
              ) : (
                <span className={status === "rejected" ? "text-muted line-through" : "font-medium"}>{r.value}</span>
              )}
              <span className="ml-2 text-xs text-muted">{r.who}</span>
            </dd>
          </div>
        ))}
      </dl>
      {editing && <p className="mt-2 text-xs text-muted">Separate several items with commas.</p>}

      {status === "pending" && (
        <div className="mt-4 flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button onClick={saveEdit} disabled={busy} className="h-9">Save</Button>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy} className="h-9">Cancel</Button>
            </>
          ) : (
            <>
              <Button onClick={() => answer("confirm")} disabled={busy} className="h-9">Confirm</Button>
              <Button variant="ghost" onClick={() => setEditing(true)} disabled={busy} className="h-9">Edit</Button>
              <Button variant="ghost" onClick={() => answer("reject")} disabled={busy} className="h-9">That&apos;s wrong</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
