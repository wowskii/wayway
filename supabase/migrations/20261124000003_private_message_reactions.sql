-- =====================================================================
-- WayWay · Private reactions to the options of a round
-- extractPreferences (AI module) reads a member's private message about the current option set
-- and returns their reaction to each option they talked about: [{ optionId, level, reason }]
-- (contract: OptionReaction[]). reviseOptions needs them at the end of the round, and the
-- evaluation compares them with the AI's estimates.
-- They are stored on WayWay's reply to that message (written by the API only), next to the
-- option_set_id and round of the same reply. NULL = no reaction in that message.
-- Like every private message, only the member themself can read them (policy "pm: read own").
-- =====================================================================
alter table public.private_messages
  add column reactions jsonb;
