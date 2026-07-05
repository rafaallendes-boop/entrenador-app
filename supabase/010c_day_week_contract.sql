-- Coach F2 Parte 2b - CONTRACT: drop legacy (user_id, date/week) uniques and
-- redundant partial indexes from 008b. Apply only after 010b and the 2b bundle
-- are confirmed in production.

do $$
declare
  r record;
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'day_logs_athlete_date_unique_full'
  ) or not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'week_summaries_athlete_week_unique_full'
  ) then
    raise exception '010c aborted: full unique indexes from 010b were not found. Apply 010b first.';
  end if;

  -- Drop UNIQUE CONSTRAINTS with exact legacy columns.
  for r in
    select c.conname, t.relname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and c.contype = 'u'
      and (
        (t.relname = 'day_logs' and (
          select array_agg(a.attname::text order by k.ord)
          from unnest(c.conkey) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        ) = array['user_id', 'date'])
        or
        (t.relname = 'week_summaries' and (
          select array_agg(a.attname::text order by k.ord)
          from unnest(c.conkey) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        ) = array['user_id', 'week_start_date'])
      )
  loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
    raise notice '010c: dropped unique constraint %.%', r.relname, r.conname;
  end loop;

  -- Drop standalone UNIQUE INDEXES with exact legacy columns.
  for r in
    select i.relname as indexname, t.relname as tablename
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and x.indisunique
      and t.relname in ('day_logs', 'week_summaries')
      and not exists (select 1 from pg_constraint c where c.conindid = x.indexrelid)
      and x.indpred is null
      and i.relname not in ('day_logs_athlete_date_unique_full', 'week_summaries_athlete_week_unique_full')
      and (
        (t.relname = 'day_logs' and (
          select array_agg(a.attname::text order by k.ord)
          from unnest(x.indkey::int2[]) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum
        ) = array['user_id', 'date'])
        or
        (t.relname = 'week_summaries' and (
          select array_agg(a.attname::text order by k.ord)
          from unnest(x.indkey::int2[]) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum
        ) = array['user_id', 'week_start_date'])
      )
  loop
    execute format('drop index public.%I', r.indexname);
    raise notice '010c: dropped unique index %', r.indexname;
  end loop;
end $$;

-- Partial indexes from 008b, now redundant with the full unique indexes.
drop index if exists public.day_logs_athlete_date_unique;
drop index if exists public.week_summaries_athlete_week_unique;
