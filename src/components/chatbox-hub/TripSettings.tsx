"use client";
// Trip settings: the floating window behind the gear next to the trip name in the group chat.
//   top:    add people (email search, added right away; any member may) + the invite link
//   bottom: the members. The trip's creator (organizer) can remove someone with the ✕, after two
//           confirmations; their group chat messages, private data, votes and credits go with them.
// The trip page updates the members at once (onAdded / onRemoved), then reloads its data.
import { useEffect, useRef, useState } from "react";
import { FriendSearch, Initial } from "@/components/tripgen-create/FriendSearch";
import { InviteLink } from "@/components/tripgen-create/InviteLink";
import type { HubMember, HubTripInfo } from "@/lib/chatbox-trip-hub/types";
import { addTripMember, removeTripMember } from "@/lib/tripgen-create/search";
import type { FoundUser } from "@/lib/tripgen-create/types";
import { CloseIcon } from "./icons";

type Confirm = { member: HubMember; step: 1 | 2 } | null;

export function TripSettings({
  trip, me, members, onAdded, onRemoved, onClose,
}: {
  trip: HubTripInfo;
  me: HubMember;
  members: HubMember[];
  onAdded: (member: HubMember) => void;
  onRemoved: (memberId: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [added, setAdded] = useState<string[]>([]);   // user ids added here, until the page data catches up
  const closeRef = useRef<HTMLButtonElement>(null);
  const { id: tripId, organizerId } = trip;
  const canRemove = organizerId === me.id;
  // The invitation is signed by the trip's creator (the sharer if the trip has none)
  const host = members.find((m) => m.id === organizerId)?.name ?? me.name;

  useEffect(() => closeRef.current?.focus(), []);

  async function add(user: FoundUser) {
    setBusy(true);
    setNotice(undefined);
    try {
      const id = await addTripMember(tripId, user.userId);
      setAdded((ids) => [...ids, user.userId]);
      setNotice({ text: `${user.displayName} is now in the trip.` });
      onAdded({ id, name: user.displayName });
    } catch {
      setNotice({ text: `${user.displayName} could not be added. Try again.`, error: true });
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: HubMember) {
    setBusy(true);
    setNotice(undefined);
    try {
      await removeTripMember(member.id);
      setConfirm(null);
      setNotice({ text: `${member.name} was removed from the trip.` });
      onRemoved(member.id);
    } catch {
      setNotice({ text: `${member.name} could not be removed. Try again.`, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-16"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();   // don't also close the open tool behind
        if (confirm) setConfirm(null);
        else onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="trip-settings-title"
        className="flex w-full max-w-md flex-col gap-6 rounded-2xl border border-line bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="trip-settings-title" className="text-lg font-semibold">Trip settings</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-page hover:text-ink">
            <CloseIcon />
          </button>
        </div>

        <section className="flex flex-col gap-4">
          <FriendSearch
            label="Add people"
            tripId={tripId}
            onPick={add}
            excludeIds={added}
            disabled={busy}
            hint="They join right away and get the trip on their home page."
            noMatch="No account found. Send them the invite link instead."
          />
          <InviteLink code={trip.inviteCode} host={host} tripName={trip.name} city={trip.city}
            startDate={trip.startDate} endDate={trip.endDate} />
        </section>

        <section className="flex flex-col gap-2 border-t border-line pt-5">
          <h3 className="text-sm font-medium">Members · {members.length}</h3>
          <ul className="flex flex-col">
            {members.map((m) => {
              const asking = confirm?.member.id === m.id ? confirm.step : 0;
              const removable = canRemove && m.id !== me.id && m.id !== organizerId;
              return (
                <li key={m.id} className={`rounded-xl px-2 py-2 ${asking ? "bg-red-50" : ""}`}>
                  <div className="flex items-center gap-3">
                    <Initial name={m.name} />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {m.name}
                      {m.id === me.id && <span className="text-muted"> (you)</span>}
                    </span>
                    {m.id === organizerId && (
                      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">Organizer</span>
                    )}
                    {removable && !asking && (
                      <button type="button" onClick={() => setConfirm({ member: m, step: 1 })} disabled={busy}
                        aria-label={`Remove ${m.name}`} title={`Remove ${m.name}`}
                        className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-red-50 hover:text-red-700 disabled:opacity-50">
                        <CloseIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {asking === 1 && (
                    <ConfirmRow
                      text={`Remove ${m.name} from the trip?`}
                      yes="Remove"
                      onYes={() => setConfirm({ member: m, step: 2 })}
                      onNo={() => setConfirm(null)}
                    />
                  )}
                  {asking === 2 && (
                    <ConfirmRow
                      text={`Are you sure? ${m.name}'s group chat messages, private chat with WayWay, votes and credits will be deleted. This can't be undone.`}
                      yes={busy ? "Removing…" : `Yes, remove ${m.name}`}
                      disabled={busy}
                      onYes={() => remove(m)}
                      onNo={() => setConfirm(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {!canRemove && <p className="text-xs text-muted">Only the person who created the trip can remove members.</p>}
        </section>

        {notice && (
          <p role="status" className={`rounded-lg px-3 py-2 text-sm ${notice.error ? "bg-red-50 text-red-700" : "bg-brand-soft text-brand"}`}>
            {notice.text}
          </p>
        )}
      </div>
    </div>
  );
}

function ConfirmRow({ text, yes, onYes, onNo, disabled = false }: {
  text: string; yes: string; onYes: () => void; onNo: () => void; disabled?: boolean;
}) {
  return (
    <div className="mt-2 flex flex-col gap-2 pl-11">
      <p className="text-sm text-red-700">{text}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onYes} disabled={disabled}
          className="h-9 rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
          {yes}
        </button>
        <button type="button" onClick={onNo} disabled={disabled}
          className="h-9 rounded-lg border border-line bg-card px-3 text-sm hover:bg-page">
          Cancel
        </button>
      </div>
    </div>
  );
}
