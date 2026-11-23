-- =====================================================================
-- WayWay · Migration 1 · People, trips and the onboarding interview
-- Shapes follow src/contracts/contract.ts (Trip, MemberProfile, PrivateMessage).
--
-- Privacy design: one person's data is split into 3 tables by WHO may read it:
--   trip_members   -> everyone in the trip   (name, diet, interests, pace, sleep)
--   member_private -> only that person       (allergies, budget, private note, preference statements)
--   member_state   -> nobody, server only    (fairness credits, "definitely no" counter)
-- Row Level Security (RLS) makes the database itself refuse other reads.
-- Text + CHECK is used instead of Postgres enums: easier to change when the contract changes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- profiles: one row per account (created automatically at sign-up)
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at   timestamptz not null default now()
);

-- Sign-up sends { display_name } as user metadata; this trigger copies it into profiles.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 40)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- trips  (contract: Trip, without members)
-- ---------------------------------------------------------------------
create table public.trips (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  city        text not null,
  start_date  date not null,
  end_date    date not null,
  timezone    text not null default 'Asia/Tokyo',
  goal        text not null default 'balanced' check (goal in ('relaxed', 'balanced', 'packed')),
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);

-- ---------------------------------------------------------------------
-- trip_members  (contract: public part of MemberProfile)
-- id = MemberProfile.id. pace / sleep are NULL until the interview finds them out.
-- ---------------------------------------------------------------------
create table public.trip_members (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references public.trips (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 40),
  diet              text[] not null default '{}',   -- public: "vegetarian-friendly" may be said to the group
  interests         text[] not null default '{}',
  pace              text check (pace in ('relaxed', 'moderate', 'packed')),
  sleep             text check (sleep in ('early_bird', 'night_owl', 'flexible')),
  onboarding_status text not null default 'not_started'
                    check (onboarding_status in ('not_started', 'in_progress', 'done')),
  joined_at         timestamptz not null default now(),
  unique (trip_id, user_id),
  unique (id, trip_id)            -- lets other tables check that member and trip match
);

create index trip_members_user_idx on public.trip_members (user_id);

-- ---------------------------------------------------------------------
-- member_private  (contract: private part of MemberProfile + HardConstraints)
-- ---------------------------------------------------------------------
create table public.member_private (
  member_id             uuid primary key references public.trip_members (id) on delete cascade,
  allergies             text[] not null default '{}',
  max_budget            integer check (max_budget > 0),   -- JPY per person for the trip; NULL = not known yet
  private_note          text not null default '',
  preference_statements text[] not null default '{}',     -- "[private] ..." = sensitive, never shown to the group
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- member_state  (contract: fields managed by code only, hidden from every user)
-- ---------------------------------------------------------------------
create table public.member_state (
  member_id                uuid primary key references public.trip_members (id) on delete cascade,
  fairness_credits         integer not null default 0 check (fairness_credits >= 0),
  definitely_no_used_today integer not null default 0 check (definitely_no_used_today >= 0),
  definitely_no_day        date               -- day (trip timezone) the counter refers to
);

-- ---------------------------------------------------------------------
-- private_messages  (contract: PrivateMessage) — the 1-to-1 chat with WayWay
-- round 0 = onboarding interview. When WayWay detects hard constraints it stores them in
-- constraints_to_confirm; they are applied to the profile ONLY after the member confirms.
-- ---------------------------------------------------------------------
create table public.private_messages (
  id                     uuid primary key default gen_random_uuid(),
  trip_id                uuid not null,
  member_id              uuid not null,
  sender                 text not null check (sender in ('member', 'wayway')),
  text                   text not null check (char_length(text) between 1 and 4000),
  round                  integer check (round >= 0),
  constraints_to_confirm jsonb,       -- Partial<HardConstraints>
  constraints_status     text check (constraints_status in ('pending', 'confirmed', 'rejected')),
  created_at             timestamptz not null default now(),
  foreign key (member_id, trip_id) references public.trip_members (id, trip_id) on delete cascade
);

create index private_messages_member_idx on public.private_messages (member_id, created_at);

-- =====================================================================
-- Helper functions used by the privacy rules
-- "security definer" = runs with the owner's rights, so the check itself is not blocked by RLS.
-- =====================================================================
create function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = (select auth.uid())
  );
$$;

create function public.owns_member(p_member_id uuid)
returns boolean
language sql stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members
    where id = p_member_id and user_id = (select auth.uid())
  );
$$;

-- Join page: show the trip behind an invite code before joining (no private data).
create function public.trip_preview(p_invite_code text)
returns table (trip_id uuid, name text, city text, start_date date, end_date date, member_count bigint)
language sql stable
security definer set search_path = ''
as $$
  select t.id, t.name, t.city, t.start_date, t.end_date,
         (select count(*) from public.trip_members m where m.trip_id = t.id)
  from public.trips t
  where t.invite_code = p_invite_code;
$$;

-- Join a trip with its invite code. Creates the 3 rows of the member and returns the member id.
-- Calling it again returns the existing member (safe to refresh the page).
create function public.join_trip(p_invite_code text)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_trip   uuid;
  v_member uuid;
  v_name   text;
begin
  if v_user is null then
    raise exception 'You must be signed in to join a trip';
  end if;

  select id into v_trip from public.trips where invite_code = p_invite_code;
  if v_trip is null then
    raise exception 'Invalid invite code';
  end if;

  select id into v_member from public.trip_members where trip_id = v_trip and user_id = v_user;
  if v_member is not null then
    return v_member;
  end if;

  select display_name into v_name from public.profiles where id = v_user;

  insert into public.trip_members (trip_id, user_id, name)
  values (v_trip, v_user, coalesce(v_name, 'Traveler'))
  returning id into v_member;

  insert into public.member_private (member_id) values (v_member);
  insert into public.member_state (member_id) values (v_member);
  return v_member;
end;
$$;

-- Only logged-in users may call these functions.
revoke execute on function public.is_trip_member(uuid), public.owns_member(uuid),
  public.trip_preview(text), public.join_trip(text) from public, anon;
grant execute on function public.is_trip_member(uuid), public.owns_member(uuid),
  public.trip_preview(text), public.join_trip(text) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- =====================================================================
-- Privacy rules (RLS)
-- Logged-out visitors (anon) get nothing. Writes that need checks (AI replies, confirmed
-- constraints, credits) are done by our API routes with the server-only admin key.
-- =====================================================================
alter table public.profiles         enable row level security;
alter table public.trips            enable row level security;
alter table public.trip_members     enable row level security;
alter table public.member_private   enable row level security;
alter table public.member_state     enable row level security;
alter table public.private_messages enable row level security;

revoke all on public.profiles, public.trips, public.trip_members,
  public.member_private, public.member_state, public.private_messages from anon;

-- profiles: see and rename yourself
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- trips: members (and the creator) can read; any user can create; the creator can edit
create policy "trips: read if member or creator" on public.trips
  for select to authenticated
  using (created_by = (select auth.uid()) or public.is_trip_member(id));
create policy "trips: create as yourself" on public.trips
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy "trips: creator edits" on public.trips
  for update to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
revoke update on public.trips from authenticated;
grant update (name, city, start_date, end_date, timezone, goal) on public.trips to authenticated;

-- trip_members: everyone in the trip sees the public profile; you edit only your own,
-- and only these columns (not trip_id / user_id). Joining goes through join_trip().
create policy "members: read same trip" on public.trip_members
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "members: update own" on public.trip_members
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, update on public.trip_members from authenticated;
grant update (name, diet, interests, pace, sleep, onboarding_status) on public.trip_members to authenticated;

-- member_private: only the owner
create policy "private: read own" on public.member_private
  for select to authenticated using (public.owns_member(member_id));
create policy "private: update own" on public.member_private
  for update to authenticated
  using (public.owns_member(member_id)) with check (public.owns_member(member_id));
revoke insert, update on public.member_private from authenticated;
grant update (allergies, max_budget, private_note, preference_statements) on public.member_private to authenticated;

-- member_state: no policy at all = no user can read or write it (server only)
revoke all on public.member_state from authenticated;

-- private_messages: only the owner reads; the owner may write their own "member" messages.
-- WayWay's replies are written by the API route (admin key).
create policy "pm: read own" on public.private_messages
  for select to authenticated using (public.owns_member(member_id));
create policy "pm: send own" on public.private_messages
  for insert to authenticated
  with check (public.owns_member(member_id) and sender = 'member'
              and constraints_to_confirm is null and constraints_status is null);
revoke update, delete on public.private_messages from authenticated;
