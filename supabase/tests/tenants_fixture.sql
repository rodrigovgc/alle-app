-- Two accounts, each with their own data
insert into public.deck_groups (id, user_id, title, share_id) values
 ('a0000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','A group', null),
 ('b0000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','B private group','5b5b5b5b-0000-0000-0000-00000000000b');
insert into public.decks (id, user_id, title, front_label, back_label, cards, group_id, share_id) values
 ('a1111111-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','A deck','a','b','[{"front":"a1","back":"a2"}]','a0000000-0000-0000-0000-00000000000a', null),
 ('b2222222-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','B secret deck','a','b','[{"front":"b-secret","back":"b2"}]','b0000000-0000-0000-0000-00000000000b','5d5d5d5d-0000-0000-0000-00000000000b'),
 ('b3333333-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','B unshared deck','a','b','[{"front":"b-private","back":"x"}]', null, null);
insert into public.progress (user_id, deck_id, card_hash, box, due_at) values
 ('22222222-2222-2222-2222-222222222222','b2222222-0000-0000-0000-00000000000b','h-b',3,now()),
 ('11111111-1111-1111-1111-111111111111','a1111111-0000-0000-0000-00000000000a','h-a',2,now());
insert into public.ai_generations (user_id, cards, model) values ('22222222-2222-2222-2222-222222222222', 20, 'claude');
insert into public.events (user_id, name, props) values ('22222222-2222-2222-2222-222222222222','deck_added','{"title":"B secret deck"}');
