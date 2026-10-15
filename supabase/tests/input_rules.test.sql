-- Regression test for 014_input_rules.sql. For a local/test database only, never production:
-- it creates two test users' rows. Run after all migrations (needs auth.uid() reading
-- request.jwt.claim.sub, as Supabase does). Fails loudly if any rule stops working.
create or replace function pg_temp.expect(label text, q text, should_pass boolean) returns void language plpgsql as $$
declare ok boolean := true;
begin
  begin execute q; exception when others then ok := false; end;
  if ok <> should_pass then raise exception 'FAILED: % (expected %)', label, case when should_pass then 'accepted' else 'rejected' end; end if;
  raise notice 'ok  %', label;
end $$;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','alice@test'), ('22222222-2222-2222-2222-222222222222','mallory@test') on conflict do nothing;
insert into public.deck_groups (id, user_id, title, share_id) values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Alice group','5aa5aa5a-0000-0000-0000-000000000001') on conflict do nothing;
insert into public.decks (id, user_id, title, front_label, back_label) values ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Alice deck','a','b') on conflict do nothing;

grant execute on function pg_temp.expect(text,text,boolean) to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', false);

-- Valid input keeps working
select pg_temp.expect('own group', $q$insert into deck_groups (id, title) values ('bbbbbbbb-0000-0000-0000-000000000002','Mine')$q$, true);
select pg_temp.expect('normal deck in own group', $q$insert into decks (title, front_label, back_label, cards, color, shape, answer_mode, lang, csv_url, group_id) values ('Mine','English','Dutch','[{"front":"x","back":"y"}]','blue','blue','type','nl-NL','https://docs.google.com/spreadsheets/d/x/pub?output=csv','bbbbbbbb-0000-0000-0000-000000000002')$q$, true);
select pg_temp.expect('deck with 2,000 cards', $q$insert into decks (title, front_label, back_label, cards) select 'Big','a','b', jsonb_agg(jsonb_build_object('front','w'||i,'back','v'||i)) from generate_series(1,2000) i$q$, true);
select pg_temp.expect('progress on own deck', $q$insert into progress (deck_id, card_hash, box, due_at) select id,'h',2,now() from decks where title='Mine'$q$, true);
select pg_temp.expect('normal event', $q$insert into events (name, props) values ('home_action','{"what":"create_ai"}')$q$, true);
-- Bad input is refused
select pg_temp.expect('deck for another user', $q$insert into decks (user_id, title, front_label, back_label) values ('11111111-1111-1111-1111-111111111111','x','a','b')$q$, false);
select pg_temp.expect('unknown field role', $q$insert into decks (title, front_label, back_label, role) values ('x','a','b','admin')$q$, false);
select pg_temp.expect('cards not a list', $q$insert into decks (title, front_label, back_label, cards) values ('x','a','b','"hello"')$q$, false);
select pg_temp.expect('title too long', $q$insert into decks (title, front_label, back_label) values (repeat('A',100000),'a','b')$q$, false);
select pg_temp.expect('too many cards', $q$insert into decks (title, front_label, back_label, cards) select 'x','a','b', jsonb_agg(jsonb_build_object('front','w'||i,'back','v')) from generate_series(1,6000) i$q$, false);
select pg_temp.expect('unknown colour', $q$insert into decks (title, front_label, back_label, color) values ('x','a','b','<script>')$q$, false);
select pg_temp.expect('javascript: sheet link', $q$insert into decks (title, front_label, back_label, csv_url) values ('x','a','b','javascript:alert(1)')$q$, false);
select pg_temp.expect('deck into another user''s group', $q$insert into decks (title, front_label, back_label, group_id) values ('x','a','b','aaaaaaaa-0000-0000-0000-000000000001')$q$, false);
select pg_temp.expect('progress on another user''s deck', $q$insert into progress (deck_id, card_hash, box, due_at) values ('dddddddd-0000-0000-0000-000000000001','h',1,now())$q$, false);
select pg_temp.expect('event props too big', $q$insert into events (name, props) values ('x', jsonb_build_object('j', repeat('z',100000)))$q$, false);
select pg_temp.expect('bad event name', $q$insert into events (name) values ('<b>')$q$, false);
select pg_temp.expect('group title too long', $q$insert into deck_groups (title) values (repeat('G',100000))$q$, false);
reset role;
-- Nothing improper was saved, and the other user's data is untouched
do $$ begin
  if exists (select 1 from public.decks where user_id = '22222222-2222-2222-2222-222222222222' and (char_length(title) > 300 or group_id = 'aaaaaaaa-0000-0000-0000-000000000001')) then raise exception 'FAILED: bad deck was saved'; end if;
  if (select title from public.decks where id = 'dddddddd-0000-0000-0000-000000000001') <> 'Alice deck' then raise exception 'FAILED: other user''s deck changed'; end if;
  raise notice 'ok  nothing improper saved';
end $$;
