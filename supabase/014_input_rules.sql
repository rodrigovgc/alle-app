-- Alle update 014: input rules in the database itself.
-- Paste into Supabase → SQL Editor and click Run. Safe to run again.
--
-- The app talks to the database directly, so the database has to refuse bad
-- input on its own, whatever a browser sends:
--   1. A deck can only go into its owner's own group (and only owners' decks show
--      in a shared group). Progress can only point at your own decks.
--   2. Sizes and allowed values for every field people can write.
-- "not valid" = the rules apply to everything saved from now on; rows already in
-- the database are left as they are.

------------------------------------------------------------------------------
-- 1. Ownership across tables
------------------------------------------------------------------------------
create or replace function public.check_deck_group_owner() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.group_id is not null and not exists (
    select 1 from public.deck_groups g where g.id = new.group_id and g.user_id = new.user_id
  ) then
    raise exception 'That group does not belong to you' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists decks_group_owner on public.decks;
create trigger decks_group_owner before insert or update of group_id, user_id on public.decks
  for each row execute function public.check_deck_group_owner();

create or replace function public.check_progress_deck_owner() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.decks d where d.id = new.deck_id and d.user_id = new.user_id) then
    raise exception 'That deck does not belong to you' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists progress_deck_owner on public.progress;
create trigger progress_deck_owner before insert or update of deck_id, user_id on public.progress
  for each row execute function public.check_progress_deck_owner();

-- Shared groups only ever include the group owner's own decks
create or replace function public.get_shared_group(sid uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'title', g.title,
    'decks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', d.title, 'front_label', d.front_label, 'back_label', d.back_label, 'lang', d.lang,
        'color', d.color, 'shape', d.shape, 'answer_mode', d.answer_mode, 'csv_url', d.csv_url, 'cards', d.cards::jsonb
      ) order by d.position nulls last, d.created_at)
      from public.decks d where d.group_id = g.id and d.user_id = g.user_id), '[]'::jsonb))
  from public.deck_groups g
  where g.share_id = sid and (select auth.uid()) is not null
  limit 1;
$$;
revoke all on function public.get_shared_group(uuid) from public, anon;
grant execute on function public.get_shared_group(uuid) to authenticated;

create or replace function public.get_shared_group_meta(sid uuid)
returns table (title text, deck_count int, card_count int, color text, shape text)
language sql stable security definer set search_path = public as $$
  select g.title,
         (select count(*)::int from public.decks d where d.group_id = g.id and d.user_id = g.user_id),
         (select coalesce(sum(jsonb_array_length(d.cards::jsonb)), 0)::int from public.decks d where d.group_id = g.id and d.user_id = g.user_id),
         (select d.color from public.decks d where d.group_id = g.id and d.user_id = g.user_id order by d.position nulls last limit 1),
         (select d.shape from public.decks d where d.group_id = g.id and d.user_id = g.user_id order by d.position nulls last limit 1)
  from public.deck_groups g
  where g.share_id = sid
  limit 1;
$$;
revoke all on function public.get_shared_group_meta(uuid) from public;
grant execute on function public.get_shared_group_meta(uuid) to anon, authenticated;

------------------------------------------------------------------------------
-- 2. Sizes and allowed values
------------------------------------------------------------------------------
create or replace function pg_temp.rule(tbl text, name text, expr text) returns void language plpgsql as $$
begin
  execute format('alter table %s drop constraint if exists %I', tbl, name);
  execute format('alter table %s add constraint %I check (%s) not valid', tbl, name, expr);
end $$;

select pg_temp.rule('public.decks', 'decks_title_len',  'char_length(title) <= 300');
select pg_temp.rule('public.decks', 'decks_labels_len', 'char_length(front_label) <= 100 and char_length(back_label) <= 100');
select pg_temp.rule('public.decks', 'decks_lang_len',   'char_length(lang) <= 35');
select pg_temp.rule('public.decks', 'decks_color_ok',   $c$color in ('lime','purple','pink','blue','green','yellow','red','beige','none')$c$);
select pg_temp.rule('public.decks', 'decks_shape_ok',   $c$shape is null or shape in ('lime','purple','pink','blue','green','yellow','red','beige')$c$);
select pg_temp.rule('public.decks', 'decks_mode_ok',    $c$answer_mode is null or answer_mode in ('type','choice')$c$);
select pg_temp.rule('public.decks', 'decks_csv_url_ok', $c$csv_url is null or (csv_url ~* '^https://' and char_length(csv_url) <= 2000)$c$);
select pg_temp.rule('public.decks', 'decks_source_len', 'source is null or char_length(source) <= 40');
-- Cards: a list, at most 5,000 cards and about 1.5 MB of text
select pg_temp.rule('public.decks', 'decks_cards_ok',
  $c$jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) <= 5000 and octet_length(cards::text) <= 1500000$c$);

select pg_temp.rule('public.deck_groups', 'groups_title_len', 'char_length(title) <= 200');

select pg_temp.rule('public.progress', 'progress_hash_len', 'char_length(card_hash) <= 128');
select pg_temp.rule('public.progress', 'progress_counts_ok', 'reviews >= 0 and lapses >= 0');

select pg_temp.rule('public.events', 'events_name_ok',  $c$name ~ '^[a-z0-9_]{1,64}$'$c$);
select pg_temp.rule('public.events', 'events_props_ok', $c$jsonb_typeof(props) = 'object' and octet_length(props::text) <= 4000$c$);

select pg_temp.rule('public.ai_generations', 'ai_cards_ok', 'cards between 0 and 300');
select pg_temp.rule('public.ai_generations', 'ai_model_len', 'model is null or char_length(model) <= 80');

------------------------------------------------------------------------------
-- 3. Report: older rows that don't fit the new rules. They stay as they are, but
--    editing one of them would be refused until it's fixed. All zeros = nothing to do.
------------------------------------------------------------------------------
select
  (select count(*) from public.decks where not (char_length(title) <= 300 and char_length(front_label) <= 100 and char_length(back_label) <= 100)) as long_deck_names,
  (select count(*) from public.decks where not (color in ('lime','purple','pink','blue','green','yellow','red','beige','none'))) as odd_colours,
  (select count(*) from public.decks where not (shape is null or shape in ('lime','purple','pink','blue','green','yellow','red','beige'))) as odd_shapes,
  (select count(*) from public.decks where not (answer_mode is null or answer_mode in ('type','choice'))) as odd_answer_modes,
  (select count(*) from public.decks where not (csv_url is null or (csv_url ~* '^https://' and char_length(csv_url) <= 2000))) as odd_sheet_links,
  (select count(*) from public.decks where not (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) <= 5000 and octet_length(cards::text) <= 1500000)) as oversized_decks,
  (select count(*) from public.decks d where d.group_id is not null and not exists (select 1 from public.deck_groups g where g.id = d.group_id and g.user_id = d.user_id)) as decks_in_others_groups,
  (select count(*) from public.events where not (name ~ '^[a-z0-9_]{1,64}$')) as odd_event_names;
