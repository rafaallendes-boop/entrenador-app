-- Athlete Scope F2 — remote integrity net for day_logs / week_summaries.
-- Additive partial unique on (athlete_id, <date>) WHERE athlete_id is not null.
-- Coexists with the legacy (user_id, date) uniques (NOT dropped in scope X).
-- Self-guarding: aborts before creating anything if any duplicate remains.
-- PREREQUISITE: deploy the client 23505 handler BEFORE running this (see plan rollout).

do $$
declare
  dup_day int;
  dup_week int;
begin
  select count(*) into dup_day from (
    select athlete_id, date from public.day_logs
    where athlete_id is not null group by athlete_id, date having count(*) > 1
  ) d;
  select count(*) into dup_week from (
    select athlete_id, week_start_date from public.week_summaries
    where athlete_id is not null group by athlete_id, week_start_date having count(*) > 1
  ) w;
  if dup_day > 0 or dup_week > 0 then
    raise exception 'Athlete scope 008b aborted: % day_logs and % week_summaries duplicate (athlete_id, date) rows. Resolve via 008a preflight before migrating.', dup_day, dup_week;
  end if;
end $$;

create unique index if not exists day_logs_athlete_date_unique
  on public.day_logs (athlete_id, date) where athlete_id is not null;
create unique index if not exists week_summaries_athlete_week_unique
  on public.week_summaries (athlete_id, week_start_date) where athlete_id is not null;
