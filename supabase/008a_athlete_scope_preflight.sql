-- Athlete Scope F2 -- PREFLIGHT (report only, mutates nothing).
-- Read before any future 008b partial-unique migration.

-- 1. Duplicates that would block the partial unique index (must be 0).
select 'day_logs dup' as check, count(*) as offending from (
  select athlete_id, date
  from public.day_logs
  where athlete_id is not null
  group by athlete_id, date
  having count(*) > 1
) d
union all
select 'week_summaries dup', count(*) from (
  select athlete_id, week_start_date
  from public.week_summaries
  where athlete_id is not null
  group by athlete_id, week_start_date
  having count(*) > 1
) w;

-- 2. Null debt (operational signal, does not block a partial index).
select 'day_logs null' as check, count(*) from public.day_logs where athlete_id is null
union all
select 'week_summaries null', count(*) from public.week_summaries where athlete_id is null
union all
select 'day_logs legacy dup by date', count(*) from (
  select date
  from public.day_logs
  where athlete_id is null
  group by date
  having count(*) > 1
) x
union all
select 'week_summaries legacy dup by week', count(*) from (
  select week_start_date
  from public.week_summaries
  where athlete_id is null
  group by week_start_date
  having count(*) > 1
) y;
