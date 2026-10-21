-- Alle update 010: deck groups (collapsible sections on the home screen).
-- Paste into Supabase → SQL Editor and click Run. Safe to run again.

create table if not exists public.deck_groups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  position    double precision,
  collapsed   boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.deck_groups enable row level security;

-- Explicit API access (Supabase stops granting it automatically for new tables from 30 Oct 2026).
grant select, insert, update, delete on public.deck_groups to authenticated;
grant all on public.deck_groups to service_role;

drop policy if exists "own groups" on public.deck_groups;
create policy "own groups" on public.deck_groups
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- A deck belongs to at most one group. Deleting a group keeps its decks.
alter table public.decks add column if not exists group_id uuid references public.deck_groups(id) on delete set null;
create index if not exists decks_group_id_idx on public.decks(group_id);
