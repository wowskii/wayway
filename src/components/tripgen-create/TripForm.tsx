"use client";
// The trip creation form (/trips/new), then the "trip created" card with the invite link.
import Link from "next/link";
import { useState, useTransition } from "react";
import { createTrip } from "@/app/trips/new/actions";
import { Button, Card, ErrorText, Field } from "@/components/ui";
import { GOALS, MAX_FRIENDS, type FoundUser, type Goal } from "@/lib/tripgen-create/types";
import { CityInput, matchCity } from "./CityInput";
import { DateField } from "./DateField";
import { FriendSearch, Initial } from "./FriendSearch";
import { InviteLink } from "./InviteLink";

/** today: YYYY-MM-DD, the earliest "today" among the cities' time zones (computed on the server, so both sides agree). */
export function TripForm({ today, hostName }: { today: string; hostName: string }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [goal, setGoal] = useState<Goal>("balanced");
  const [friends, setFriends] = useState<FoundUser[]>([]);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<CreatedTrip>();
  const [pending, startTransition] = useTransition();

  if (created) return <Created {...created} />;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const knownCity = matchCity(city);
    if (!knownCity) return setError("Pick a city from the list.");
    if (!startDate || !endDate) return setError("Enter the first and last day as yyyy/mm/dd.");
    if (startDate < today) return setError("The first day can't be in the past.");
    if (endDate < startDate) return setError("The last day can't be before the first day.");
    startTransition(async () => {
      const res = await createTrip({ name, city: knownCity, startDate, endDate, goal, friendIds: friends.map((f) => f.userId) });
      if (res.error !== undefined) setError(res.error);
      else setCreated({ ...res, name: name.trim(), friends, city: knownCity, startDate, endDate, host: hostName });
    });
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">New trip</h1>
        <p className="mt-1 text-sm text-muted">Set the basics and bring your friends. WayWay plans the rest with you.</p>
      </div>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <Field label="Trip name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80}
            placeholder="Tokyo with friends" />

          <CityInput value={city} onChange={setCity} />

          <div className="grid grid-cols-2 gap-3">
            <DateField label="First day" value={startDate} min={today}
              onChange={(d) => {
                setStartDate(d);
                if (d && endDate && d > endDate) setEndDate(d);
              }} />
            <DateField label="Last day" value={endDate} min={startDate || today} onChange={setEndDate} />
          </div>

          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="mb-1.5 font-medium">Pace</legend>
            <div className="grid grid-cols-3 gap-2">
              {GOALS.map((g) => (
                <button key={g.id} type="button" onClick={() => setGoal(g.id)} aria-pressed={goal === g.id}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${goal === g.id ? "border-brand bg-brand-soft" : "border-line hover:bg-page"}`}>
                  <span className={`block font-medium ${goal === g.id ? "text-brand" : ""}`}>{g.label}</span>
                  <span className="block text-xs text-muted">{g.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-3">
            <FriendSearch
              onPick={(u) => setFriends((f) => [...f, u])}
              excludeIds={friends.map((f) => f.userId)}
              disabled={friends.length >= MAX_FRIENDS}
              placeholder={friends.length >= MAX_FRIENDS ? "Share the invite link to add more" : undefined}
              hint="They join the trip right away. You can also share an invite link later."
              noMatch="No account found. Send them the invite link once the trip is created."
            />
            {friends.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Friends added">
                {friends.map((f) => (
                  <li key={f.userId} title={f.email}
                    className="flex items-center gap-2 rounded-full border border-line bg-card py-1 pl-1 pr-2 text-sm">
                    <Initial name={f.displayName} small />
                    {f.displayName}
                    <button type="button" onClick={() => setFriends((all) => all.filter((x) => x.userId !== f.userId))}
                      aria-label={`Remove ${f.displayName}`}
                      className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-page hover:text-ink">
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create trip"}</Button>
        </form>
      </Card>
    </>
  );
}

interface CreatedTrip {
  tripId: string; inviteCode: string; name: string; friends: FoundUser[];
  city: string; startDate: string; endDate: string; host: string;
}

function Created({ tripId, inviteCode, name, friends, city, startDate, endDate, host }: CreatedTrip) {
  return (
    <Card className="flex flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-brand">Trip created</p>
        <h1 className="mt-1 text-2xl font-semibold">{name}</h1>
        <p className="mt-1 text-sm text-muted">
          {friends.length === 0
            ? "It's just you for now."
            : `${friends.map((f) => f.displayName).join(", ")} ${friends.length === 1 ? "is" : "are"} in the trip with you.`}
        </p>
      </div>
      <InviteLink code={inviteCode} host={host} tripName={name} city={city} startDate={startDate} endDate={endDate} />
      <div className="flex flex-col gap-2 sm:flex-row">
        {/* One next step: the trip page sends a new member to the interview first, then to the chat */}
        <Link href={`/trips/${tripId}`}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-brand px-5 text-sm font-medium text-white hover:bg-brand-dark">
          Next: tell WayWay what you enjoy
        </Link>
      </div>
    </Card>
  );
}
