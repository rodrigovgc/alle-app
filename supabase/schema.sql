-- Alle — Supabase schema. Run once in the SQL editor.

create extension if not exists pgcrypto;

-- Decks keep a snapshot of the sheet so study works even if the sheet is offline.
create table if not exists public.decks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  csv_url     text,
  front_label text not null,
  back_label  text not null,
  lang        text not null default 'en-US',
  color       text not null default 'lime',   -- a deck colour, or 'none'
  shape       text,                           -- null = the shape that goes with the colour
  answer_mode text,                           -- 'type' | 'choice' | null = automatic
  position    double precision,               -- the user's order on the home screen
  cards       jsonb not null default '[]'::jsonb,   -- [{ "front": "...", "back": "..." }]
  is_sample   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists decks_user_idx on public.decks (user_id, created_at);

-- Leitner progress, one row per user + deck + card hash (hash of the front text).
create table if not exists public.progress (
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deck_id          uuid not null references public.decks(id) on delete cascade,
  card_hash        text not null,
  box              smallint not null check (box between 1 and 5),
  due_at           timestamptz not null,
  last_reviewed_at timestamptz not null default now(),
  reviews          integer not null default 0,
  lapses           integer not null default 0,
  primary key (user_id, deck_id, card_hash)
);
create index if not exists progress_due_idx on public.progress (user_id, due_at);

alter table public.decks    enable row level security;
alter table public.progress enable row level security;

-- Explicit API access (Supabase stops granting it automatically for new tables from 30 Oct 2026).
grant select, insert, update, delete on public.decks, public.progress to authenticated;
grant all on public.decks, public.progress to service_role;

drop policy if exists "own decks" on public.decks;
create policy "own decks" on public.decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own progress" on public.progress;
create policy "own progress" on public.progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
