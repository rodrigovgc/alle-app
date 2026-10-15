-- TEST DATABASE ONLY. NEVER RUN IN SUPABASE.
-- The classic SQL injection mistake (a query glued together from text), used as a control
-- for injection.e2e.mjs --control: the test must catch this function leaking other users' decks.
create or replace function public.unsafe_find_decks(name text) returns setof public.decks
language plpgsql security definer set search_path = public as $f$
begin
  return query execute 'select * from decks where user_id = ''' || auth.uid() || ''' and title = ''' || name || '''';
end $f$;
grant execute on function public.unsafe_find_decks(text) to authenticated;
notify pgrst, 'reload schema';
