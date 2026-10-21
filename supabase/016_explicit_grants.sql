-- 016 · Explicit Data API grants
-- From 30 Oct 2026 Supabase no longer grants API access automatically to new
-- tables in "public". Alle's existing tables keep their access, so running this
-- on the live project changes nothing; it records the intended access in one
-- place and makes a fresh rebuild (new project, preview branch, db reset) work.
-- Rows stay protected by the row-level security policies in each file.
-- Safe to run more than once.

grant select, insert, update, delete on public.decks       to authenticated;
grant select, insert, update, delete on public.progress    to authenticated;
grant select, insert, update, delete on public.deck_groups to authenticated;
grant insert                         on public.events      to authenticated;
grant select, insert                 on public.ai_generations to authenticated;

-- Never reachable from the browser: only hit_limit() (security definer) uses it.
revoke all on public.rate_hits from anon, authenticated;

grant all on public.decks, public.progress, public.deck_groups, public.events,
             public.ai_generations, public.rate_hits to service_role;
