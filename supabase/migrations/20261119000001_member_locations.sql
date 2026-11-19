-- =====================================================================
-- WayWay · Migration 5 · Location sharing on the trip map (opt-in)
-- Each member can share their CURRENT position with the members of the same trip.
-- Privacy, enforced here (not only in the page):
--   - opt-in: no row = not sharing. Turning sharing off DELETES the row.
--   - one row per member = only the latest position, never a history (each update overwrites it).
--   - members of the same trip can read; only the owner can write their own row.
--   - a position older than 15 minutes can no longer be read (the read rule checks the time),
--     and the time is set by the database, so a client can't make an old position look fresh.
--   - is_demo marks a fake position (testing / demo video from outside Tokyo): never shown as real.
-- =====================================================================
create table public.member_locations (
  member_id   uuid primary key references public.trip_members (id) on delete cascade,
  trip_id     uuid not null,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  accuracy_m  real check (accuracy_m >= 0),          -- how precise the browser says it is
  is_demo     boolean not null default false,
  updated_at  timestamptz not null default now(),
  -- member and trip must match (same pattern as the other tables)
  foreign key (member_id, trip_id) references public.trip_members (id, trip_id) on delete cascade
);
create index member_locations_trip_idx on public.member_locations (trip_id);

-- The database sets the time on every write (the client's value is ignored).
create function public.member_locations_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger member_locations_touch
  before insert or update on public.member_locations
  for each row execute function public.member_locations_touch();

-- ---------------------------------------------------------------------
-- Privacy rules (RLS)
-- ---------------------------------------------------------------------
alter table public.member_locations enable row level security;
revoke all on public.member_locations from anon;
grant select, insert, update, delete on public.member_locations to authenticated;

-- Others: only fresh positions. Yourself: always your own row (an "insert or update" also checks this
-- rule on the existing row, so without it an old own row would block sharing again).
create policy "locations: read same trip, fresh only" on public.member_locations
  for select to authenticated
  using (
    public.owns_member(member_id)
    or (public.is_trip_member(trip_id) and updated_at > now() - interval '15 minutes')
  );

create policy "locations: insert own" on public.member_locations
  for insert to authenticated
  with check (public.owns_member(member_id));

-- An update must stay on the member's own row (USING) and can't move it to someone else (WITH CHECK).
create policy "locations: update own" on public.member_locations
  for update to authenticated
  using (public.owns_member(member_id))
  with check (public.owns_member(member_id));

create policy "locations: delete own" on public.member_locations
  for delete to authenticated
  using (public.owns_member(member_id));

-- Live updates on the map (Supabase Realtime applies the read rule above to each change).
alter publication supabase_realtime add table public.member_locations;
