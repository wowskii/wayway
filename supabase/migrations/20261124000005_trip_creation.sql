-- Trip creation page (/trips/new) and the trip settings window (gear on the trip page).
--
--   search_users(query, trip) the "add friends" dropdown: accounts whose email STARTS WITH what was
--                            typed (from the first character, at most 5 results, never yourself, never
--                            someone already in that trip). Emails live in auth.users, which the
--                            browser can't read: hence this function.
--   create_trip(..., friends) one transaction: the trip + you + the friends you picked, each with
--                            their member_private / member_state rows (like join_trip does).
--                            Friends are added directly (no accept step); they see the trip on
--                            their home page with "Finish your profile".
--   add_trip_member(trip, user)  settings window: any member adds someone directly (like sharing
--                            the invite link, which any member can do).
--   remove_trip_member(member)   settings window: ONLY the trip's creator removes someone (not
--                            themselves). Their group chat messages are deleted too (otherwise
--                            sender_member_id becomes null, which means "WayWay"); their private
--                            data, votes and credits go with them (on delete cascade).
-- The other way in is still the invite link /join/<invite_code> (join_trip). The invite code is
-- made by the trips table itself when the trip is inserted.

create function public.search_users(p_query text, p_trip_id uuid default null)
returns table (user_id uuid, display_name text, email text)
language sql stable
security definer set search_path = ''
as $$
  select u.id, p.display_name, u.email::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where auth.uid() is not null
    and char_length(trim(p_query)) >= 1
    and starts_with(lower(u.email), lower(trim(p_query)))
    and u.id <> auth.uid()
    and (p_trip_id is null or not exists (
      select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = u.id))
  order by u.email
  limit 5;
$$;

-- Adds one account to a trip (does nothing if already in it). Internal: create_trip / add_trip_member.
create function public.add_member_to_trip(p_trip_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_member uuid;
begin
  select id into v_member from public.trip_members where trip_id = p_trip_id and user_id = p_user_id;
  if v_member is not null then
    return v_member;
  end if;

  insert into public.trip_members (trip_id, user_id, name)
  values (
    p_trip_id, p_user_id,
    coalesce((select display_name from public.profiles where id = p_user_id), 'Traveler')
  )
  returning id into v_member;

  insert into public.member_private (member_id) values (v_member);
  insert into public.member_state (member_id) values (v_member);
  return v_member;
end;
$$;

create function public.create_trip(
  p_name       text,
  p_city       text,
  p_start_date date,
  p_end_date   date,
  p_goal       text,
  p_friend_ids uuid[]
)
returns table (trip_id uuid, invite_code text)
language plpgsql
security definer set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_trip   public.trips;
  v_friend uuid;
begin
  if v_user is null then
    raise exception 'You must be signed in to create a trip';
  end if;
  if p_end_date - p_start_date > 30 then
    raise exception 'A trip can last 31 days at most';
  end if;
  if coalesce(cardinality(p_friend_ids), 0) > 11 then
    raise exception 'You can add up to 11 friends here; share the invite link for more';
  end if;

  -- name / city / dates / goal are checked by the trips table itself
  insert into public.trips (name, city, start_date, end_date, goal, created_by)
  values (trim(p_name), p_city, p_start_date, p_end_date, coalesce(p_goal, 'balanced'), v_user)
  returning * into v_trip;

  perform public.add_member_to_trip(v_trip.id, v_user);

  foreach v_friend in array coalesce(p_friend_ids, '{}') loop
    if v_friend <> v_user and exists (select 1 from auth.users where id = v_friend) then
      perform public.add_member_to_trip(v_trip.id, v_friend);
    end if;
  end loop;

  return query select v_trip.id, v_trip.invite_code;
end;
$$;

create function public.add_trip_member(p_trip_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Only members of this trip can add people';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'This account does not exist';
  end if;
  return public.add_member_to_trip(p_trip_id, p_user_id);
end;
$$;

create function public.remove_trip_member(p_member_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_member public.trip_members;
begin
  select * into v_member from public.trip_members where id = p_member_id;
  if v_member.id is null then
    raise exception 'This person is not in the trip';
  end if;
  if not exists (select 1 from public.trips where id = v_member.trip_id and created_by = auth.uid()) then
    raise exception 'Only the person who created the trip can remove people';
  end if;
  if v_member.user_id = auth.uid() then
    raise exception 'You can''t remove yourself';
  end if;

  delete from public.chat_messages where sender_member_id = v_member.id;
  update public.option_sets set voter_ids = array_remove(voter_ids, v_member.id)
  where trip_id = v_member.trip_id and v_member.id = any (voter_ids);
  delete from public.trip_members where id = v_member.id;
end;
$$;

revoke execute on function public.search_users(text, uuid), public.create_trip(text, text, date, date, text, uuid[]),
  public.add_trip_member(uuid, uuid), public.remove_trip_member(uuid)
  from public, anon;
grant execute on function public.search_users(text, uuid), public.create_trip(text, text, date, date, text, uuid[]),
  public.add_trip_member(uuid, uuid), public.remove_trip_member(uuid)
  to authenticated;
revoke execute on function public.add_member_to_trip(uuid, uuid) from public, anon, authenticated;

-- Live member list on the trip page: someone joins (invite link, added in settings) or is removed.
-- INSERT events are filtered by RLS (members of the same trip). DELETE events carry only the
-- removed row's id; the page compares it with its own member list.
alter publication supabase_realtime add table public.trip_members;
