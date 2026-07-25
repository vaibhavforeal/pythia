-- Pythia — Supabase schema. Run once in your Supabase project:
--   Dashboard → SQL Editor → paste this → Run.
-- The app connects with the service_role key (which bypasses RLS); RLS is
-- enabled with no policies so the public/anon key has no access even if leaked.

create extension if not exists citext;

-- Users can sign in three ways: legacy username+password, email+password, or
-- Google (OAuth). username/salt/hash are null for Google-only accounts; email is
-- null for legacy username accounts. citext makes username/email matching
-- case-insensitive.
create table if not exists public.users (
  id         text primary key,
  username   citext unique,                     -- legacy login; null for email/Google accounts
  email      citext,                             -- email/Google accounts
  google_id  text,                               -- set for Google (OAuth) accounts
  salt       text,                               -- null for Google-only accounts
  hash       text,                               -- scrypt hash (never plaintext); null for Google
  created_at timestamptz not null default now(),
  streak_current integer not null default 0,     -- consecutive days checked in
  streak_longest integer not null default 0,     -- best run ever
  streak_last    text,                           -- last check-in, the USER's local YYYY-MM-DD
  streak_days    integer not null default 0      -- distinct days checked in, all time
);

-- Bring an already-created users table up to the schema above (idempotent).
alter table public.users add column if not exists email     citext;
alter table public.users add column if not exists google_id text;
alter table public.users alter column username drop not null;
alter table public.users alter column salt     drop not null;
alter table public.users alter column hash     drop not null;

-- Phone becomes the identity anchor; email is an optional add-on. Stored E.164
-- so one human can't become several accounts by typing their number three ways.
-- soul_id is the shareable handle (ember-comet-472) — assigned once and frozen,
-- so correcting a birth time never changes an identifier already shared.
alter table public.users add column if not exists phone          text;
alter table public.users add column if not exists phone_verified boolean not null default false;
alter table public.users add column if not exists soul_id        text;
alter table public.users add column if not exists soul_id_at     timestamptz;
create unique index if not exists idx_users_phone   on public.users(phone)   where phone   is not null;
create unique index if not exists idx_users_soul_id on public.users(soul_id) where soul_id is not null;

-- Your own birth details. Needed server-side so friend compatibility and the
-- daily flow can be computed without either party handing over the other's
-- chart; friends only ever see signs (see server/friends.js). Also means your
-- profile follows you to a new device instead of living in one browser.
alter table public.users add column if not exists birth      jsonb;
alter table public.users add column if not exists birth_role text;   -- 'groom' | 'bride'

-- Pending OTPs, one row per number. The code itself is never stored — only an
-- HMAC of it, bound to the number — so a database read yields no working codes.
create table if not exists public.otps (
  phone       text primary key,
  hash        text not null,
  attempts    integer not null default 0,
  sends       integer not null default 1,
  created_at  timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  expires_at  timestamptz not null
);

-- Daily check-in streak. streak_last is the user's OWN local date (text, not a
-- date column) because "today" has to mean today where they are, not in UTC.
alter table public.users add column if not exists streak_current integer not null default 0;
alter table public.users add column if not exists streak_longest integer not null default 0;
alter table public.users add column if not exists streak_last    text;
alter table public.users add column if not exists streak_days    integer not null default 0;

-- Unique on email/google_id only where present (multiple NULLs stay allowed).
create unique index if not exists idx_users_email     on public.users(email)     where email     is not null;
create unique index if not exists idx_users_google_id on public.users(google_id) where google_id is not null;

create table if not exists public.people (
  id         text primary key,
  user_id    text not null,
  name       text not null,
  year   int, month int, day int, hour int, minute int,
  lat    double precision,
  lon    double precision,
  tz     double precision,
  created_at timestamptz not null default now()
);
create index if not exists idx_people_user on public.people(user_id);

-- Saved chat conversations. chart/match/messages are stored as JSONB so a chat
-- can be resumed with its full context without recomputing the chart.
create table if not exists public.conversations (
  id         text primary key,
  user_id    text not null,
  title      text not null,
  chart      jsonb not null,
  input      jsonb,                               -- raw birth input, to restore the form/toggles
  match      jsonb,
  messages   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_conversations_user on public.conversations(user_id, updated_at desc);

-- Invite links ("cast your chart, we'll compare"). Read by anonymous visitors
-- through the server only — the token is the capability, and the inviter's
-- birth stays server-side rather than being encoded in a shareable URL.
create table if not exists public.invites (
  token      text primary key,
  user_id    text not null,
  name       text,                              -- shown on the public invite page
  birth      jsonb not null,                    -- inviter's birth input, never sent to the invitee
  role       text,                              -- 'groom' | 'bride', for directional Guna Milan
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists idx_invites_user on public.invites(user_id, created_at desc);

-- Who opened someone's link and checked. Summary only: the responder has no
-- account and never agreed to us keeping their birth details.
create table if not exists public.invite_responses (
  id         text primary key,
  token      text not null,
  name       text,
  total      integer,
  max        integer,
  band       text,
  label      text,
  created_at timestamptz not null default now()
);
create index if not exists idx_invite_responses_token on public.invite_responses(token, created_at desc);

-- Friendships. Stored once with the pair ordered (user_a < user_b) so "a
-- befriends b" and "b befriends a" can't become two rows that disagree.
create table if not exists public.friendships (
  pair_key   text primary key,
  user_a     text not null,
  user_b     text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_friendships_a on public.friendships(user_a);
create index if not exists idx_friendships_b on public.friendships(user_b);

create table if not exists public.friend_requests (
  id          text primary key,
  pair_key    text not null unique,   -- one live request per pair, either direction
  from_user   text not null,
  to_user     text not null,
  source      text,                   -- 'soul-id' | 'invite'
  created_at  timestamptz not null default now()
);
create index if not exists idx_friend_requests_to on public.friend_requests(to_user, created_at desc);

create table if not exists public.blocks (
  id         text primary key,
  blocker    text not null,
  blocked    text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_blocks_pair on public.blocks(blocker, blocked);

alter table public.otps             enable row level security;
alter table public.friendships      enable row level security;
alter table public.friend_requests  enable row level security;
alter table public.blocks           enable row level security;
alter table public.users            enable row level security;
alter table public.people           enable row level security;
alter table public.conversations    enable row level security;
alter table public.invites          enable row level security;
alter table public.invite_responses enable row level security;

-- PostgREST (what supabase-js talks to) caches the table schema. After adding a
-- column it will keep answering "column does not exist" until that cache is
-- reloaded, so force it. Harmless to run when nothing changed.
notify pgrst, 'reload schema';
