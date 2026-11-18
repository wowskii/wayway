-- =====================================================================
-- WayWay · Migration 2 · Group chat, decisions and itinerary
-- Shapes follow src/contracts/contract.ts. Nested contract objects (TimeSlot, Option[],
-- Branch[]) are stored as jsonb, so the contract can evolve without a migration each time.
-- Members can READ their trip's group data; WRITES (except chat messages) are done by the
-- API routes with the admin key, after the code checks the rules (quorum, limits, ...).
-- =====================================================================

-- ---------------------------------------------------------------------
-- chat_messages  (contract: ChatMessage) — the group chat
-- sender_member_id NULL = WayWay (the mapper turns it into senderId "wayway")
-- ---------------------------------------------------------------------
create table public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.trips (id) on delete cascade,
  sender_member_id uuid,
  text             text not null check (char_length(text) between 1 and 4000),
  option_set_id    uuid,            -- set when the message carries option cards
  created_at       timestamptz not null default now(),
  -- the sender must belong to this same trip
  foreign key (sender_member_id, trip_id) references public.trip_members (id, trip_id)
    on delete set null (sender_member_id)
);
create index chat_messages_trip_idx on public.chat_messages (trip_id, created_at);

-- ---------------------------------------------------------------------
-- slot_proposals  (contract: SlotProposal)
-- ---------------------------------------------------------------------
create table public.slot_proposals (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips (id) on delete cascade,
  slot         jsonb not null,      -- TimeSlot
  kind         text not null check (kind in ('meal', 'activity')),
  status       text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  requested_by uuid references public.trip_members (id) on delete set null,
  confirmed_by uuid references public.trip_members (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index slot_proposals_trip_idx on public.slot_proposals (trip_id, created_at);

-- ---------------------------------------------------------------------
-- option_sets  (contract: OptionSet)
-- ---------------------------------------------------------------------
create table public.option_sets (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references public.trips (id) on delete cascade,
  slot                jsonb not null,                 -- TimeSlot
  round               integer not null default 1 check (round between 1 and 3),
  options             jsonb not null default '[]',    -- Option[]
  candidate_option_id text not null check (candidate_option_id in ('A', 'B', 'C')),
  status              text not null default 'collecting_feedback'
                      check (status in ('collecting_feedback', 'voting', 'decided')),
  round_deadline      timestamptz not null,
  vote_deadline       timestamptz,
  voter_ids           uuid[] not null default '{}',
  vote_attempt        integer check (vote_attempt in (1, 2)),
  chosen_option_id    text check (chosen_option_id in ('A', 'B', 'C')),
  created_at          timestamptz not null default now()
);
create index option_sets_trip_idx on public.option_sets (trip_id, created_at);

alter table public.chat_messages
  add constraint chat_messages_option_set_fk
  foreign key (option_set_id) references public.option_sets (id) on delete set null;

-- ---------------------------------------------------------------------
-- votes  (contract: Vote) — private: you see only your own votes and critiques
-- ---------------------------------------------------------------------
create table public.votes (
  option_set_id uuid not null references public.option_sets (id) on delete cascade,
  option_id     text not null check (option_id in ('A', 'B', 'C')),
  member_id     uuid not null references public.trip_members (id) on delete cascade,
  vote_attempt  integer not null default 1 check (vote_attempt in (1, 2)),
  level         text not null check (level in ('must_go', 'want_to_go', 'same', 'lean_not_go', 'definitely_no')),
  critique      text,
  accepts_split boolean,
  created_at    timestamptz not null default now(),
  primary key (option_set_id, option_id, member_id, vote_attempt)
);

-- ---------------------------------------------------------------------
-- decisions  (contract: Decision, without creditEvents which are server only)
-- ---------------------------------------------------------------------
create table public.decisions (
  option_set_id      uuid primary key references public.option_sets (id) on delete cascade,
  trip_id            uuid not null references public.trips (id) on delete cascade,
  chosen_option_id   text not null check (chosen_option_id in ('A', 'B', 'C')),
  voter_ids          uuid[] not null default '{}',
  split_accepted_by  uuid[],
  resolved_by        text not null check (resolved_by in ('vote', 'tie_candidate', 'split_refused')),
  decided_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- credit_events  (contract: CreditEvent) — audit trail, server only
-- ---------------------------------------------------------------------
create table public.credit_events (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.trip_members (id) on delete cascade,
  option_set_id uuid not null references public.option_sets (id) on delete cascade,
  change        integer not null,
  reason        text not null check (reason in ('compromise', 'favorite_chosen')),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- itinerary_items  (contract: ItineraryItem)
-- ---------------------------------------------------------------------
create table public.itinerary_items (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips (id) on delete cascade,
  option_set_id uuid references public.option_sets (id) on delete set null,  -- decision that created it
  day           integer not null check (day >= 1),
  start_time    time not null,
  end_time      time not null,
  spot_id       text,               -- shared stop
  branches      jsonb,              -- Branch[] when the group splits
  created_at    timestamptz not null default now(),
  check (end_time > start_time),
  check (spot_id is not null or branches is not null)
);
create index itinerary_items_trip_idx on public.itinerary_items (trip_id, day, start_time);

-- =====================================================================
-- Privacy rules (RLS)
-- =====================================================================
alter table public.chat_messages   enable row level security;
alter table public.slot_proposals  enable row level security;
alter table public.option_sets     enable row level security;
alter table public.votes           enable row level security;
alter table public.decisions       enable row level security;
alter table public.credit_events   enable row level security;
alter table public.itinerary_items enable row level security;

revoke all on public.chat_messages, public.slot_proposals, public.option_sets, public.votes,
  public.decisions, public.credit_events, public.itinerary_items from anon;

-- Members read their trip's group data
create policy "chat: read same trip" on public.chat_messages
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "slots: read same trip" on public.slot_proposals
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "options: read same trip" on public.option_sets
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "decisions: read same trip" on public.decisions
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "itinerary: read same trip" on public.itinerary_items
  for select to authenticated using (public.is_trip_member(trip_id));

-- Group chat: a member can post as themselves (WayWay's messages come from the API)
create policy "chat: send as yourself" on public.chat_messages
  for insert to authenticated
  with check (
    public.owns_member(sender_member_id)
    and public.is_trip_member(trip_id)
    and option_set_id is null
  );
revoke update, delete on public.chat_messages from authenticated;

-- Votes: you only see your own (votes are cast through the API, which checks the rules)
create policy "votes: read own" on public.votes
  for select to authenticated using (public.owns_member(member_id));
revoke insert, update, delete on public.votes from authenticated;

-- Everything else is written by the server only
revoke insert, update, delete on public.slot_proposals, public.option_sets,
  public.decisions, public.itinerary_items from authenticated;
revoke all on public.credit_events from authenticated;   -- no policy: server only

-- =====================================================================
-- Realtime: the app gets live updates for these tables (still filtered by RLS)
-- =====================================================================
alter publication supabase_realtime add table
  public.chat_messages, public.slot_proposals, public.option_sets,
  public.decisions, public.itinerary_items;
