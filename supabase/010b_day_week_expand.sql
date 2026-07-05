-- Coach F2 Parte 2b - EXPAND: athlete_id not null + full unique (athlete_id, date/week).
-- Partial indexes from 008b are not valid PostgREST onConflict targets, so this
-- adds full unique indexes that can coexist with the legacy user_id uniques.

do $$
declare
  day_null int;
  week_null int;
  day_dup int;
  week_dup int;
begin
  select count(*) into day_null
  from public.day_logs
  where athlete_id is null;

  select count(*) into week_null
  from public.week_summaries
  where athlete_id is null;

  select count(*) into day_dup
  from (
    select athlete_id, date
    from public.day_logs
    where athlete_id is not null
    group by athlete_id, date
    having count(*) > 1
  ) d;

  select count(*) into week_dup
  from (
    select athlete_id, week_start_date
    from public.week_summaries
    where athlete_id is not null
    group by athlete_id, week_start_date
    having count(*) > 1
  ) w;

  if day_null > 0 or week_null > 0 or day_dup > 0 or week_dup > 0 then
    raise exception '010b aborted: day_logs(null=%, dup=%), week_summaries(null=%, dup=%). Resolve with 010a before expanding.',
      day_null, day_dup, week_null, week_dup;
  end if;
end $$;

alter table public.day_logs alter column athlete_id set not null;
alter table public.week_summaries alter column athlete_id set not null;

create unique index if not exists day_logs_athlete_date_unique_full
  on public.day_logs (athlete_id, date);

create unique index if not exists week_summaries_athlete_week_unique_full
  on public.week_summaries (athlete_id, week_start_date);
