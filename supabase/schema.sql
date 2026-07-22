-- Astroman — Supabase schema. Run once in your Supabase project:
--   Dashboard → SQL Editor → paste this → Run.
-- The app connects with the service_role key (which bypasses RLS); RLS is
-- enabled with no policies so the public/anon key has no access even if leaked.

create extension if not exists citext;

create table if not exists public.users (
  id         text primary key,
  username   citext not null unique,           -- case-insensitive, wildcard-safe
  salt       text not null,
  hash       text not null,                     -- scrypt hash (never plaintext)
  created_at timestamptz not null default now()
);

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

alter table public.users  enable row level security;
alter table public.people enable row level security;
