-- =====================================================================
-- WayWay · Migration 3 · Interview progress
-- Remembers which onboarding topics WayWay already covered with a member,
-- so "no allergies" (answered) is different from "not asked yet".
-- Private (owner only), like the rest of member_private.
-- =====================================================================
alter table public.member_private
  add column interview_topics text[] not null default '{}'
  check (interview_topics <@ array['interests', 'pace', 'sleep', 'diet', 'allergies', 'budget']::text[]);

grant update (interview_topics) on public.member_private to authenticated;
