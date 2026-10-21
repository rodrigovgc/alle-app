-- Alle analytics: a privacy-light events table + aggregate views for the owner.
-- Run once in Supabase → SQL Editor. Safe to run again.

-- 1. Lightweight events. No message text, no card content; just what happened.
create table if not exists public.events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,              -- e.g. 'deck_added', 'session_finished'
  props      jsonb not null default '{}'::jsonb,  -- e.g. {"source":"ai","subject":"language"}
  created_at timestamptz not null default now()
);
create index if not exists events_name_idx on public.events (name, created_at);
create index if not exists events_user_idx on public.events (user_id, created_at);

alter table public.events enable row level security;

-- Explicit API access (Supabase stops granting it automatically for new tables from 30 Oct 2026).
grant insert on public.events to authenticated;
grant all on public.events to service_role;

-- Anyone signed in may add their own events; nobody can read raw rows.
drop policy if exists "insert own events" on public.events;
create policy "insert own events" on public.events
  for insert with check (auth.uid() = user_id);

-- 2. Set the owner's user id so only you can read the aggregate views.
--    Replace the email with the account you want to be the owner.
create or replace function public.is_owner() returns boolean
language sql stable as $$
  select auth.jwt() ->> 'email' = 'rodrigovgc@example.com'   -- ← change to your email
$$;

-- 3. Aggregate views. These expose only counts, never who did what.
create or replace view public.stats_overview as
  select
    (select count(*) from auth.users) as users,
    (select count(*) from public.decks) as decks,
    (select count(*) from public.decks where is_sample) as ready_made_decks,
    (select count(*) from public.decks where not is_sample and csv_url is not null) as sheet_decks,
    (select count(*) from public.decks where not is_sample and csv_url is null) as ai_or_pasted_decks,
    (select count(distinct user_id) from public.progress where last_reviewed_at > now() - interval '14 days') as active_14d;

create or replace view public.stats_funnel as
  select
    (select count(*) from auth.users) as signed_up,
    (select count(distinct user_id) from public.decks where not is_sample) as made_own_deck,
    (select count(distinct user_id) from public.decks where not is_sample and csv_url is not null) as imported_sheet,
    (select count(distinct user_id) from public.decks where not is_sample and csv_url is null) as created_ai;

create or replace view public.stats_ready_made as
  select title, count(*) as adds
  from public.decks where is_sample group by title order by adds desc;

create or replace view public.stats_events as
  select name, props, count(*) as n
  from public.events group by name, props order by n desc;

create or replace view public.stats_activity as
  select date_trunc('day', last_reviewed_at)::date as day, count(*) as reviews,
         count(distinct user_id) as people
  from public.progress
  where last_reviewed_at > now() - interval '14 days'
  group by 1 order by 1;

-- Views run with the owner's rights; gate every read behind is_owner().
alter view public.stats_overview set (security_invoker = off);
alter view public.stats_funnel set (security_invoker = off);
alter view public.stats_ready_made set (security_invoker = off);
alter view public.stats_events set (security_invoker = off);
alter view public.stats_activity set (security_invoker = off);

grant select on public.stats_overview, public.stats_funnel, public.stats_ready_made,
  public.stats_events, public.stats_activity to authenticated;

-- Wrap each view so only the owner gets rows.
create or replace function public.dash_overview() returns setof public.stats_overview
language sql stable security definer set search_path = public as $$
  select * from public.stats_overview where public.is_owner() $$;
create or replace function public.dash_funnel() returns setof public.stats_funnel
language sql stable security definer set search_path = public as $$
  select * from public.stats_funnel where public.is_owner() $$;
create or replace function public.dash_ready_made() returns setof public.stats_ready_made
language sql stable security definer set search_path = public as $$
  select * from public.stats_ready_made where public.is_owner() $$;
create or replace function public.dash_events() returns setof public.stats_events
language sql stable security definer set search_path = public as $$
  select * from public.stats_events where public.is_owner() $$;
create or replace function public.dash_activity() returns setof public.stats_activity
language sql stable security definer set search_path = public as $$
  select * from public.stats_activity where public.is_owner() $$;
