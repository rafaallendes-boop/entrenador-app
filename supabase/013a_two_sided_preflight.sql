-- SP1a two-sided -- PREFLIGHT (report only, mutates nothing).
-- Correr ANTES de 013b. Todos los checks "must be 0" deben dar 0.

-- 1. Cuentas que generarían membresía self para más de un atleta, incluyendo
--    la colisión cruzada owner=linked en uno + linked<>owner en otro.
--    Violarían unique(account_id) where role='self'. MUST BE 0.
select 'accounts with >1 candidate self athlete' as check, count(*) as offending from (
  select account_id
  from (
    select a.id as athlete_id, a.owner_account_id as account_id
    from public.athletes a
    where a.linked_account_id = a.owner_account_id
    union all
    select a.id as athlete_id, a.linked_account_id as account_id
    from public.athletes a
    where a.linked_account_id is not null
      and a.linked_account_id <> a.owner_account_id
  ) candidate_self
  group by account_id
  having count(distinct athlete_id) > 1
) a
union all
-- 2. Filas hijas con athlete_id que no existe en athletes. MUST BE 0.
select 'sessions orphan athlete_id', count(*)
from public.sessions s
where s.athlete_id is not null
  and not exists (select 1 from public.athletes a where a.id = s.athlete_id)
union all
select 'day_logs orphan athlete_id', count(*)
from public.day_logs d
where d.athlete_id is not null
  and not exists (select 1 from public.athletes a where a.id = d.athlete_id)
union all
select 'week_summaries orphan athlete_id', count(*)
from public.week_summaries w
where w.athlete_id is not null
  and not exists (select 1 from public.athletes a where a.id = w.athlete_id)
union all
select 'athlete_profiles duplicate athlete_id', count(*) from (
  select athlete_id from public.athlete_profiles
  where athlete_id is not null
  group by athlete_id having count(*) > 1
) p;

-- 3. Señal operativa (no bloquea): forma del roster y deuda legacy.
select 'athletes self-shaped (owner=linked)' as info, count(*) from public.athletes
where linked_account_id = owner_account_id
union all
select 'athletes managed (linked null)', count(*) from public.athletes
where linked_account_id is null
union all
select 'athletes linked<>owner (two-sided ya existente)', count(*) from public.athletes
where linked_account_id is not null and linked_account_id <> owner_account_id
union all
select 'sessions athlete_id null (legacy)', count(*) from public.sessions where athlete_id is null
union all
select 'athlete_profiles con coach_memory', count(*) from public.athlete_profiles
where coach_memory is not null and athlete_id is not null
union all
select 'athlete_profiles con coach_memory SIN athlete_id (no migrable)', count(*) from public.athlete_profiles
where coach_memory is not null and athlete_id is null;

-- 4. Preview de la clasificación authored_by_role (D1): sesiones que quedarán 'coach'.
select 'sessions que backfillearán coach-authored' as info, count(*)
from public.sessions s
join public.athletes a on a.id = s.athlete_id
where a.linked_account_id is null;
