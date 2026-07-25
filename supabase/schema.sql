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

alter table public.users         enable row level security;
alter table public.people        enable row level security;
alter table public.conversations enable row level security;

-- PostgREST (what supabase-js talks to) caches the table schema. After adding a
-- column it will keep answering "column does not exist" until that cache is
-- reloaded, so force it. Harmless to run when nothing changed.
notify pgrst, 'reload schema';
