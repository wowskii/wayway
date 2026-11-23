-- =====================================================================
-- WayWay · Migration 4 · Google API safety counter
-- Counts our calls to each Google Maps Platform API per day, so the app refuses
-- to call Google once a daily limit is reached and we stay inside the free tier.
-- Shared by everyone: all teammates use the same Google keys and the same database,
-- so one counter here covers every machine (an in-memory counter would not).
-- Server-only: RLS on and no policy, so only the service-role key (our server) can use it.
-- =====================================================================
create table public.google_usage (
  day   date    not null,          -- UTC day
  api   text    not null,          -- e.g. 'place_details' (see src/lib/google/limits.ts)
  count integer not null default 0 check (count >= 0),
  primary key (day, api)
);

alter table public.google_usage enable row level security;
revoke all on public.google_usage from anon, authenticated;

-- Takes one request from today's budget for this API.
-- Returns true if the call is allowed (and counts it), false if the limit is already reached.
-- Done in ONE statement so two requests at the same time cannot both take the last unit:
-- the row is created or incremented only while count < limit.
create function public.google_usage_take(p_api text, p_limit integer)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  taken integer;
begin
  insert into public.google_usage as u (day, api, count)
  values ((now() at time zone 'utc')::date, p_api, 1)
  on conflict (day, api) do update
    set count = u.count + 1
    where u.count < p_limit
  returning u.count into taken;
  -- No row returned = the WHERE blocked the update = limit reached.
  return taken is not null and taken <= p_limit;
end;
$$;

revoke execute on function public.google_usage_take(text, integer) from public, anon, authenticated;
grant execute on function public.google_usage_take(text, integer) to service_role;
