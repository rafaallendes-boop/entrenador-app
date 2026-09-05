-- Evidencia de equivalencia legacy <-> memberships para preparar 031.
-- Solo lectura. Ejecutar DESPUES del backfill de membresias.
--
-- pg_policies de produccion es la autoridad. Este archivo cubre los
-- predicados conocidos por el repo; si el inventario inicial muestra una
-- policy adicional, agregar su par legacy_only/membership_only antes de
-- aprobar el corte.
--
-- IMPORTANTE: los bloques agrupados de este archivo son diagnóstico inicial,
-- no acreditan por sí solos la equivalencia por (tabla, comando). Tras pegar
-- el dump real, completar un par para cada qual/with_check efectivo. En
-- particular sessions UPDATE/DELETE debe modelar authored_by_role; no se puede
-- reemplazar por el conjunto genérico de todas las memberships.

-- 0. Inventario autoritativo de policies. Guardar la salida completa.
select tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'athletes', 'sessions', 'day_logs', 'week_summaries', 'chat_messages',
    'coach_proposals', 'athlete_profiles', 'training_plans',
    'training_plan_weeks', 'athlete_memberships', 'athlete_coach_notes',
    'readiness_daily', 'whoop_workouts'
  )
order by tablename, cmd, policyname;

-- A. athletes / SELECT, ambas direcciones.
select
  'athletes/select/legacy_only' as case_name,
  a.id as athlete_id,
  candidate.account_id
from public.athletes a
cross join lateral (
  values (a.owner_account_id), (a.linked_account_id)
) candidate(account_id)
where candidate.account_id is not null
  and not exists (
    select 1
    from public.athlete_memberships m
    where m.athlete_id = a.id
      and m.account_id = candidate.account_id
  );

select
  'athletes/select/membership_only' as case_name,
  m.athlete_id,
  m.account_id
from public.athlete_memberships m
join public.athletes a on a.id = m.athlete_id
where a.owner_account_id is distinct from m.account_id
  and a.linked_account_id is distinct from m.account_id;

-- B. athletes / UPDATE. Legacy owner debe estar representado por membership.
-- Membership-only puede ser intencional (self reclamado o coach adicional) y
-- debe enumerarse/firmarse en el smoke antes de 031.
select
  'athletes/update/legacy_only' as case_name,
  a.id as athlete_id,
  a.owner_account_id as account_id
from public.athletes a
where not exists (
  select 1
  from public.athlete_memberships m
  where m.athlete_id = a.id
    and m.account_id = a.owner_account_id
);

select
  'athletes/update/membership_only' as case_name,
  m.athlete_id,
  m.account_id,
  m.role
from public.athlete_memberships m
join public.athletes a on a.id = m.athlete_id
where m.account_id <> a.owner_account_id;

-- C. Pares de acceso SELECT de tablas hijas, ambas direcciones. Esta prueba
-- cubre el predicado legacy owner/linked de 007; los predicados antiguos por
-- user_id se auditan por fila en la seccion E.
with legacy_access as (
  select a.id as athlete_id, a.owner_account_id as account_id
  from public.athletes a
  union
  select a.id, a.linked_account_id
  from public.athletes a
  where a.linked_account_id is not null
), membership_access as (
  select athlete_id, account_id from public.athlete_memberships
)
select 'children/select/legacy_only' as case_name, l.athlete_id, l.account_id
from legacy_access l
where not exists (
  select 1 from membership_access m
  where m.athlete_id = l.athlete_id and m.account_id = l.account_id
)
union all
select 'children/select/membership_only', m.athlete_id, m.account_id
from membership_access m
where not exists (
  select 1 from legacy_access l
  where l.athlete_id = m.athlete_id and l.account_id = m.account_id
);

-- C2. `readiness_daily` sí recibió policy por membresía en 013b; se conserva
-- con su nombre propio en la evidencia aunque su conjunto sea el mismo de C.
with legacy_access as (
  select a.id as athlete_id, a.owner_account_id as account_id from public.athletes a
  union
  select a.id, a.linked_account_id from public.athletes a
  where a.linked_account_id is not null
), membership_access as (
  select athlete_id, account_id from public.athlete_memberships
)
select 'readiness_daily/select/legacy_only' as case_name, l.athlete_id, l.account_id
from legacy_access l
where not exists (
  select 1 from membership_access m
  where m.athlete_id = l.athlete_id and m.account_id = l.account_id
)
union all
select 'readiness_daily/select/membership_only', m.athlete_id, m.account_id
from membership_access m
where not exists (
  select 1 from legacy_access l
  where l.athlete_id = m.athlete_id and l.account_id = m.account_id
);

-- C3. 012 dejó `whoop_workouts_select` por owner/linked y 030 agrega de forma
-- aditiva el reemplazo por membership. Este bloque debe decir `ok` antes de
-- medir la equivalencia y antes de aprobar 1b.
select
  'whoop_workouts/select/membership_policy' as check_name,
  case when exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'whoop_workouts'
      and qual ilike '%auth_athlete_ids%'
  ) then 'ok' else 'BLOQUEANTE: falta policy membership' end as status;

-- C4. Equivalencia del predicado SELECT legacy de 012 frente al agregado en
-- 030. Ambas consultas deben devolver cero filas inexplicadas.
with legacy_access as (
  select a.id as athlete_id, a.owner_account_id as account_id from public.athletes a
  union
  select a.id, a.linked_account_id from public.athletes a
  where a.linked_account_id is not null
), membership_access as (
  select athlete_id, account_id from public.athlete_memberships
)
select 'whoop_workouts/select/legacy_only' as case_name, l.athlete_id, l.account_id
from legacy_access l
where not exists (
  select 1 from membership_access m
  where m.athlete_id = l.athlete_id and m.account_id = l.account_id
)
union all
select 'whoop_workouts/select/membership_only', m.athlete_id, m.account_id
from membership_access m
where not exists (
  select 1 from legacy_access l
  where l.athlete_id = m.athlete_id and l.account_id = m.account_id
);

-- D. Filas sin athlete_id. Todas deben ser cero antes de retirar una policy
-- legacy por user_id, porque `athlete_id in (...)` es false para NULL.
select 'sessions' as table_name, count(*) as rows_without_athlete_id
from public.sessions where athlete_id is null
union all select 'day_logs', count(*) from public.day_logs where athlete_id is null
union all select 'week_summaries', count(*) from public.week_summaries where athlete_id is null
union all select 'chat_messages', count(*) from public.chat_messages where athlete_id is null
union all select 'coach_proposals', count(*) from public.coach_proposals where athlete_id is null
union all select 'athlete_profiles', count(*) from public.athlete_profiles where athlete_id is null
union all select 'training_plans', count(*) from public.training_plans where athlete_id is null
union all select 'training_plan_weeks', count(*) from public.training_plan_weeks where athlete_id is null
union all select 'whoop_workouts', count(*) from public.whoop_workouts where athlete_id is null;

-- E. Acceso legacy por user_id que NO esta respaldado por una membership de
-- la fila. Cada consulta debe devolver cero. Se mantienen separadas para que
-- la evidencia quede identificada por tabla.
select 'sessions/select/user_id_legacy_only' as case_name, count(*) as row_count
from public.sessions r
where r.user_id is not null
  and not exists (
    select 1 from public.athlete_memberships m
    where m.athlete_id = r.athlete_id and m.account_id = r.user_id
  )
union all
select 'day_logs/select/user_id_legacy_only', count(*)
from public.day_logs r
where r.user_id is not null
  and not exists (select 1 from public.athlete_memberships m where m.athlete_id = r.athlete_id and m.account_id = r.user_id)
union all
select 'week_summaries/select/user_id_legacy_only', count(*)
from public.week_summaries r
where r.user_id is not null
  and not exists (select 1 from public.athlete_memberships m where m.athlete_id = r.athlete_id and m.account_id = r.user_id)
union all
select 'chat_messages/select/user_id_legacy_only', count(*)
from public.chat_messages r
where r.user_id is not null
  and not exists (select 1 from public.athlete_memberships m where m.athlete_id = r.athlete_id and m.account_id = r.user_id)
union all
select 'coach_proposals/select/user_id_legacy_only', count(*)
from public.coach_proposals r
where r.user_id is not null
  and not exists (select 1 from public.athlete_memberships m where m.athlete_id = r.athlete_id and m.account_id = r.user_id)
union all
select 'athlete_profiles/select/user_id_legacy_only', count(*)
from public.athlete_profiles r
where r.user_id is not null
  and not exists (select 1 from public.athlete_memberships m where m.athlete_id = r.athlete_id and m.account_id = r.user_id)
union all
select 'training_plans/select/user_id_legacy_only', count(*)
from public.training_plans r
where r.user_id is not null
  and not exists (select 1 from public.athlete_memberships m where m.athlete_id = r.athlete_id and m.account_id = r.user_id)
union all
select 'training_plan_weeks/select/user_id_legacy_only', count(*)
from public.training_plan_weeks r
where r.user_id is not null
  and not exists (select 1 from public.athlete_memberships m where m.athlete_id = r.athlete_id and m.account_id = r.user_id);

-- F. Escritura member frente al owner legacy, ambas direcciones. El segundo
-- conjunto contiene concesiones nuevas deliberadas (por ejemplo self
-- reclamado); cada una debe coincidir con una restriccion firmada.
with legacy_write as (
  select id as athlete_id, owner_account_id as account_id
  from public.athletes
), membership_write as (
  select athlete_id, account_id, role
  from public.athlete_memberships
)
select
  'children/write/legacy_only' as case_name,
  l.athlete_id,
  l.account_id,
  null::text as membership_role
from legacy_write l
where not exists (
  select 1 from membership_write m
  where m.athlete_id = l.athlete_id and m.account_id = l.account_id
)
union all
select
  'children/write/membership_only',
  m.athlete_id,
  m.account_id,
  m.role
from membership_write m
where not exists (
  select 1 from legacy_write l
  where l.athlete_id = m.athlete_id and l.account_id = m.account_id
);

-- G. INSERT/DELETE de athletes se reemplazan por RPC y no son equivalencia
-- literal. Antes de 031, documentar y firmar al menos estos casos:
--   * coach -> self: rechazado;
--   * segundo self de una cuenta: rechazado;
--   * borrar atleta con membership self: rechazado;
--   * managed bajo cuenta athlete: permitido transitoriamente en 1a y
--     pendiente de resolucion explicita en el plan de 1b.
