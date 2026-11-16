-- =====================================================================
-- WayWay · Migration 4 · Vote extension flag (Role 4, vote rules)
-- Rule: no quorum at the deadline -> voting is extended ONCE by 30 min; still no quorum -> no decision.
-- The database must remember whether the extension was already used, otherwise every check
-- would extend again. Written by the API route only (option_sets is server-write already).
-- =====================================================================
alter table public.option_sets
  add column vote_extended boolean not null default false;
