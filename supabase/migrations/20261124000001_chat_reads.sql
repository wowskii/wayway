-- =====================================================================
-- WayWay · Migration 4 · Read receipts of the group chat
-- One row per member per trip: "I have read every group message up to last_read_at".
-- (Not one row per message: the table stays as small as trip_members.)
-- Members of the trip can read everyone's position ("Read by 2 of 3");
-- a member moves ONLY their own position, ONLY forward, through mark_chat_read().
-- =====================================================================

create table public.chat_reads (
  trip_id      uuid not null references public.trips (id) on delete cascade,
  member_id    uuid not null,
  last_read_at timestamptz not null,
  updated_at   timestamptz not null default now(),
  primary key (trip_id, member_id),
  -- the member must belong to this same trip
  foreign key (member_id, trip_id) references public.trip_members (id, trip_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- mark_chat_read(trip_id, last_read_at): "I have read up to here".
-- Finds the caller's member in the trip itself (cannot be used for someone else),
-- never moves backwards (two tabs, late requests) and never into the future.
-- ---------------------------------------------------------------------
create function public.mark_chat_read(p_trip_id uuid, p_last_read_at timestamptz)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_member uuid;
  v_at     timestamptz := least(p_last_read_at, now());
begin
  select id into v_member
  from public.trip_members
  where trip_id = p_trip_id and user_id = (select auth.uid());
  if v_member is null then
    raise exception 'You are not a member of this trip';
  end if;

  insert into public.chat_reads (trip_id, member_id, last_read_at)
  values (p_trip_id, v_member, v_at)
  on conflict (trip_id, member_id) do update
    set last_read_at = excluded.last_read_at,
        updated_at   = now()
    where public.chat_reads.last_read_at < excluded.last_read_at;
end;
$$;

revoke execute on function public.mark_chat_read(uuid, timestamptz) from public, anon;
grant execute on function public.mark_chat_read(uuid, timestamptz) to authenticated;

-- =====================================================================
-- Privacy rules (RLS)
-- =====================================================================
alter table public.chat_reads enable row level security;
revoke all on public.chat_reads from anon;

create policy "reads: read same trip" on public.chat_reads
  for select to authenticated using (public.is_trip_member(trip_id));

-- Writes only through mark_chat_read()
revoke insert, update, delete on public.chat_reads from authenticated;

-- Live updates: everyone sees "Read by ..." change while the chat is open (still filtered by RLS)
alter publication supabase_realtime add table public.chat_reads;
