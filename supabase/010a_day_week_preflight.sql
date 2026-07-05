-- Coach F2 Parte 2b - preflight day_logs/week_summaries (report-only, no writes).
-- Hard gate for 010b/010c: null debt = 0 and duplicate (athlete_id, date/week) = 0.

-- 1. Duplicates that would block the full unique indexes.
select 'day_logs dup (athlete_id, date)' as check, count(*) as value from (
  select athlete_id, date
  from public.day_logs
  where athlete_id is not null
  group by athlete_id, date
  having count(*) > 1
) d
union all
select 'week_summaries dup (athlete_id, week_start_date)', count(*) from (
  select athlete_id, week_start_date
  from public.week_summaries
  where athlete_id is not null
  group by athlete_id, week_start_date
  having count(*) > 1
) w
union all
-- 2. Null debt blocks 010b SET NOT NULL.
select 'day_logs null athlete_id', count(*)
from public.day_logs
where athlete_id is null
union all
select 'week_summaries null athlete_id', count(*)
from public.week_summaries
where athlete_id is null;

-- 3. Existing unique indexes/constraints for visual verification before 010c.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('day_logs', 'week_summaries')
  and indexdef ilike '%unique%'
order by tablename, indexname;
