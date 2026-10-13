-- Alle update 013: more numbers for the owner dashboard (/dashboard).
-- Run after 012_ai_decks.sql. Paste into Supabase → SQL Editor and click Run. Safe to run again.
-- Like dash_insights(), it returns nothing unless the signed-in account is the owner.

create or replace function public.dash_more(days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  span interval := make_interval(days => greatest(1, least(coalesce(days, 30), 365)));
  since timestamptz := now() - span;
  month_start timestamptz := date_trunc('month', now());
  result jsonb;
begin
  if not public.is_owner() then
    return null;
  end if;

  with
  act as (
    select user_id, created_at as at from public.events
    union all select user_id, last_reviewed_at from public.progress
    union all select user_id, created_at from public.decks
  ),
  ai as (
    select * from public.ai_generations where model is distinct from 'preview'
  )
  select jsonb_build_object(
    'generated_at', now(),

    -- Alle's own AI (pretend cards from test builds left out)
    'ai', jsonb_build_object(
      'decks', (select count(*) from ai where created_at >= since),
      'decks_prev', (select count(*) from ai where created_at >= since - span and created_at < since),
      'people', (select count(distinct user_id) from ai where created_at >= since),
      'cards', (select coalesce(sum(cards), 0) from ai where created_at >= since),
      'all_time', (select count(*) from ai),
      -- Rough cost with Claude Haiku: ~1,000 tokens in ($0.10 per million) + ~30 tokens out per card ($0.50 per million)
      'cost_usd', (select round(coalesce(sum(0.0001 + cards * 0.000015), 0)::numeric, 4) from ai where created_at >= since),
      'cost_month_usd', (select round(coalesce(sum(0.0001 + cards * 0.000015), 0)::numeric, 4) from ai where created_at >= month_start),
      -- People who used all their free AI decks this month (the app's default is 3)
      'at_limit', (select count(*) from (select user_id from public.ai_generations where created_at >= month_start
                                         group by user_id having count(*) >= 3) x),
      'added', (select count(*) from public.events where name = 'ai_deck_created' and props->>'inApp' = 'true' and created_at >= since),
      'own_ai', (select count(*) from public.events where name = 'ai_deck_created' and coalesce(props->>'inApp', '') <> 'true' and created_at >= since)
    ),
    'ai_daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::date,
        'n', (select count(*) from ai where created_at::date = d::date)) order by d), '[]'::jsonb)
      from generate_series(date_trunc('day', since), date_trunc('day', now()), interval '1 day') d
    ),

    -- Do people come back? Of everyone who signed up at least N days ago, the share active on day N or later
    'retention', (
      select jsonb_agg(jsonb_build_object('day', n, 'eligible', eligible, 'back', back) order by n) from (
        select n,
          (select count(*) from auth.users u where u.created_at <= now() - make_interval(days => n)) as eligible,
          (select count(*) from auth.users u where u.created_at <= now() - make_interval(days => n)
             and exists (select 1 from act a where a.user_id = u.id and a.at >= u.created_at + make_interval(days => n))) as back
        from unnest(array[1, 7, 30]) n
      ) r
    ),
    -- How many of the period's active people show up on an average day
    'stickiness', (
      select jsonb_build_object(
        'daily_avg', round(coalesce(avg(n), 0)::numeric, 1),
        'active', (select count(distinct user_id) from act where at >= since))
      from (select count(distinct user_id) n from act where at >= since group by at::date) x
    ),

    'groups', jsonb_build_object(
      'groups', (select count(*) from public.deck_groups),
      'people_with_groups', (select count(*) from (select user_id from public.deck_groups group by user_id having count(*) >= 2) x),
      'ungrouped_decks', (select count(*) from public.decks where group_id is null)
    ),
    'sharing', jsonb_build_object(
      'shared_decks', (select count(*) from public.decks where share_id is not null),
      'shared_groups', (select count(*) from public.deck_groups where share_id is not null),
      'copies', (select count(*) from public.decks where source = 'shared')
    ),

    -- What people tap on the Home tab
    'home', (
      select coalesce(jsonb_agg(jsonb_build_object('what', what, 'n', n, 'people', p) order by n desc), '[]'::jsonb)
      from (select props->>'what' as what, count(*) n, count(distinct user_id) p from public.events
            where name = 'home_action' and created_at >= since group by 1) x
    ),

    -- When people study (Brussels time), from finished sessions
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'n',
        (select count(*) from public.events where name = 'session_finished' and created_at >= since
           and extract(hour from created_at at time zone 'Europe/Brussels') = h)) order by h), '[]'::jsonb)
      from generate_series(0, 23) h
    ),

    'due', jsonb_build_object(
      'cards', (select count(*) from public.progress where due_at <= now()),
      'people', (select count(distinct user_id) from public.progress where due_at <= now())
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.dash_more(int) from public, anon;
grant execute on function public.dash_more(int) to authenticated;
