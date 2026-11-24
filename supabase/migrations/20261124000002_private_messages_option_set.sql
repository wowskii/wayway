-- =====================================================================
-- WayWay · Private messages linked to the decision they are about
-- In rounds 1-3 a member reacts privately to the options of ONE option set. The round number
-- alone cannot tell which decision ("round 1" exists for every slot), so the message can now
-- point to its option set.
--   - NULL (default) = not about a decision: the onboarding interview, or no options open.
--     NULL is never checked by the foreign key, so existing code keeps working unchanged.
--   - The option set must belong to the SAME trip as the message (composite foreign key).
--   - Deleting an option set keeps the messages and only clears the link.
-- Policies are unchanged: members still insert only their own messages; the foreign key keeps
-- the link inside their trip.
-- =====================================================================

-- Needed by the composite foreign key below ("this option set, in this trip").
alter table public.option_sets
  add constraint option_sets_id_trip_id_key unique (id, trip_id);

alter table public.private_messages
  add column option_set_id uuid;

alter table public.private_messages
  add constraint private_messages_option_set_fk
  foreign key (option_set_id, trip_id) references public.option_sets (id, trip_id)
  on delete set null (option_set_id);

-- "Every private message about this option set" (reactions of a round), by member and time.
create index private_messages_option_set_idx
  on public.private_messages (option_set_id, member_id, created_at)
  where option_set_id is not null;
