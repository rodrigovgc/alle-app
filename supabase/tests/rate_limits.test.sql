-- Regression test for 015_rate_limits.sql. TEST DATABASE ONLY (adds test users).
-- Stops with FAILED: if the limit, the window or the separation between accounts breaks.
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','a@test'), ('22222222-2222-2222-2222-222222222222','b@test') on conflict do nothing;
delete from public.rate_hits;
create or replace function pg_temp.call(uid text, b text) returns jsonb language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, true); return public.hit_limit(b); end $$;
do $$
declare a text := '11111111-1111-1111-1111-111111111111'; b text := '22222222-2222-2222-2222-222222222222'; r jsonb;
begin
  for i in 1..3 loop r := pg_temp.call(a, 'ai'); if (r->>'ok')::boolean is not true then raise exception 'FAILED: hit % refused', i; end if; end loop;
  r := pg_temp.call(a, 'ai'); if (r->>'ok')::boolean then raise exception 'FAILED: 4th hit allowed'; end if;
  if (r->>'retry_after')::int not between 1 and 60 then raise exception 'FAILED: retry_after %', r->>'retry_after'; end if;
  r := pg_temp.call(b, 'ai'); if (r->>'ok')::boolean is not true then raise exception 'FAILED: account B blocked by A'; end if;
  r := pg_temp.call(a, 'sheet'); if (r->>'ok')::boolean is not true then raise exception 'FAILED: buckets not separate'; end if;
  r := pg_temp.call(a, 'made_up'); if (r->>'ok')::boolean then raise exception 'FAILED: unknown bucket allowed'; end if;
  update public.rate_hits set at = at - interval '61 seconds';
  r := pg_temp.call(a, 'ai'); if (r->>'ok')::boolean is not true then raise exception 'FAILED: no recovery after the window'; end if;
  raise notice 'ok  rate limits: limit, Retry-After, per account, per bucket, recovery';
end $$;
