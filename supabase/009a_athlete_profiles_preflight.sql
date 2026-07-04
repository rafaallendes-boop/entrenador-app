-- Coach F2 Parte 2a — preflight de athlete_profiles (report-only, NO escribe).
-- Gate duro para 009b/009c: null debt = 0 y duplicados (user_id, athlete_id) = 0.
select 'athlete_profiles null athlete_id' as check, count(*) as value
from public.athlete_profiles where athlete_id is null
union all
select 'athlete_profiles dup (user_id, athlete_id)', count(*) from (
  select user_id, athlete_id from public.athlete_profiles
  where athlete_id is not null
  group by user_id, athlete_id having count(*) > 1
) d
union all
select 'athlete_profiles rows total', count(*) from public.athlete_profiles;
