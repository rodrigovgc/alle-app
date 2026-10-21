-- Alle 012: decks made with Alle's own AI.
-- One row per AI deck, so the app can give each person a few free AI decks a month.
-- Run once in Supabase → SQL Editor.

create table if not exists public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  cards int not null default 0,
  model text
);

create index if not exists ai_generations_user_month on public.ai_generations (user_id, created_at);

alter table public.ai_generations enable row level security;

-- Explicit API access (Supabase stops granting it automatically for new tables from 30 Oct 2026).
grant select, insert on public.ai_generations to authenticated;
grant all on public.ai_generations to service_role;

-- People see and add only their own rows (the server function acts as the signed-in person).
drop policy if exists "own ai rows: read" on public.ai_generations;
create policy "own ai rows: read" on public.ai_generations for select using (user_id = auth.uid());
drop policy if exists "own ai rows: add" on public.ai_generations;
create policy "own ai rows: add" on public.ai_generations for insert with check (user_id = auth.uid());
