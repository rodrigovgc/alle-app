-- Alle update 015: short-term limits for the server routes that cost something.
-- Paste into Supabase → SQL Editor and click Run. Safe to run again.
--
-- Vercel runs many copies of each server function at once, so a counter kept in a
-- function's memory would not work. The counter lives here, in the database every copy
-- shares, and is keyed by the signed-in account (from the verified sign-in token), not
-- by an IP address someone could fake in a header.

create table if not exists public.rate_hits (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket  text not null,
  at      timestamptz not null default now()
);
create index if not exists rate_hits_lookup on public.rate_hits (user_id, bucket, at);
alter table public.rate_hits enable row level security;  -- no policies: only the function below touches it
revoke all on public.rate_hits from anon, authenticated;
grant all on public.rate_hits to service_role;   -- only hit_limit() (security definer) touches it

-- Counts one use of `bucket` for the signed-in person. Returns {"ok":true,"left":n} or
-- {"ok":false,"retry_after":seconds}. Limits are fixed here per bucket, so a caller can't
-- pick their own.
create or replace function public.hit_limit(bucket text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  max_hits int; win interval; used int; oldest timestamptz;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  case bucket
    when 'ai'    then max_hits := 3;  win := interval '1 minute';   -- making AI decks (costs money)
    when 'sheet' then max_hits := 30; win := interval '1 minute';   -- looking up Google Sheet names
    when 'ai_card' then max_hits := 10; win := interval '1 minute';  -- "Try this card again" (one card each)
    else return jsonb_build_object('ok', false, 'reason', 'unknown_bucket');
  end case;
  -- One person's requests wait for each other here, so parallel requests can't slip past the count
  perform pg_advisory_xact_lock(hashtext(uid::text || ':' || bucket));
  delete from public.rate_hits r where r.user_id = uid and r.bucket = hit_limit.bucket and r.at < now() - win;
  select count(*), min(r.at) into used, oldest from public.rate_hits r where r.user_id = uid and r.bucket = hit_limit.bucket;
  if used >= max_hits then
    return jsonb_build_object('ok', false, 'retry_after', greatest(1, ceil(extract(epoch from (oldest + win - now())))::int));
  end if;
  insert into public.rate_hits (user_id, bucket) values (uid, hit_limit.bucket);
  return jsonb_build_object('ok', true, 'left', max_hits - used - 1);
end $$;
revoke all on function public.hit_limit(text) from public, anon;
grant execute on function public.hit_limit(text) to authenticated;
