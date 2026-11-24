-- =====================================================================
-- WayWay · Close a final vote in ONE transaction
-- When a vote ends, the server (src/lib/chatbox-rounds/service.ts, with Henry's advancePoll /
-- decisionRows) must write several tables together: the option set's new status, the decision,
-- the credit audit trail, the itinerary items and the members' new credit balances.
-- Written one by one, a failure in the middle would leave e.g. a decision without its itinerary,
-- and a retry would add the credits twice. A function runs as one transaction: all or nothing.
--
-- Safe to call twice: it only acts while the option set is still "voting". If another request
-- already closed it, nothing is written and it returns false.
-- Server only (service role): members cannot call it.
-- =====================================================================
create function public.save_decision(
  p_option_set_id uuid,
  p_option_set    jsonb,   -- option_sets fields to set: status, chosen_option_id, voter_ids, vote_attempt, vote_deadline, vote_extended
  p_decision      jsonb,   -- decisions row, or null when the vote ends without a decision
  p_credit_events jsonb,   -- credit_events rows (array, may be empty)
  p_itinerary     jsonb,   -- itinerary_items rows (array, may be empty)
  p_member_states jsonb    -- [{ member_id, fairness_credits }] new balances (array, may be empty)
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.option_sets;
begin
  s := jsonb_populate_record(null::public.option_sets, p_option_set);

  update public.option_sets
     set status           = s.status,
         chosen_option_id = s.chosen_option_id,
         voter_ids        = coalesce(s.voter_ids, '{}'),
         vote_attempt     = s.vote_attempt,
         vote_deadline    = s.vote_deadline,
         vote_extended    = coalesce(s.vote_extended, false)
   where id = p_option_set_id
     and status = 'voting';
  if not found then
    return false;   -- already closed by another request: write nothing else
  end if;

  if p_decision is not null then
    insert into public.decisions (option_set_id, trip_id, chosen_option_id, voter_ids, split_accepted_by, resolved_by, decided_at)
    select option_set_id, trip_id, chosen_option_id, voter_ids, split_accepted_by, resolved_by, decided_at
      from jsonb_populate_record(null::public.decisions, p_decision);
  end if;

  insert into public.credit_events (member_id, option_set_id, change, reason)
  select member_id, option_set_id, change, reason
    from jsonb_populate_recordset(null::public.credit_events, coalesce(p_credit_events, '[]'));

  insert into public.itinerary_items (trip_id, option_set_id, day, start_time, end_time, spot_id, branches)
  select trip_id, option_set_id, day, start_time, end_time, spot_id, branches
    from jsonb_populate_recordset(null::public.itinerary_items, coalesce(p_itinerary, '[]'));

  insert into public.member_state (member_id, fairness_credits)
  select member_id, fairness_credits
    from jsonb_populate_recordset(null::public.member_state, coalesce(p_member_states, '[]'))
   where fairness_credits is not null
  on conflict (member_id) do update set fairness_credits = excluded.fairness_credits;

  return true;
end;
$$;

revoke execute on function public.save_decision(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_decision(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
