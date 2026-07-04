-- Coach F2 Parte 2a — EXPAND: unique compuesto (user_id, athlete_id).
-- Coexiste con athlete_profiles_user_id_unique (002) hasta 009c.
-- Aborta si hay null debt o duplicados (un unique nullable NO deduplica NULLs).
do $$
declare
  null_debt int;
  dup_count int;
begin
  select count(*) into null_debt from public.athlete_profiles where athlete_id is null;
  select count(*) into dup_count from (
    select user_id, athlete_id from public.athlete_profiles
    where athlete_id is not null
    group by user_id, athlete_id having count(*) > 1
  ) d;
  if null_debt > 0 or dup_count > 0 then
    raise exception 'athlete_profiles 009b aborted: % null athlete_id, % duplicate (user_id, athlete_id). Resolve via 009a before expanding.', null_debt, dup_count;
  end if;
end $$;

create unique index if not exists athlete_profiles_user_athlete_unique
  on public.athlete_profiles (user_id, athlete_id);
