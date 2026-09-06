-- Chequeos alrededor de la aplicación de 034 y 031. Sólo lectura. 2026-09-06.
-- Ejecutar cada bloque por separado, en el momento que indica su título.

-- ── A. ANTES de todo ───────────────────────────────────────────────────────
-- Los tres deben dar el valor esperado o no se aplica nada.
select 'filas_sin_athlete_id (debe ser: sin filas)' as chequeo,
       coalesce(string_agg(t || '=' || n, ', ' order by t), 'sin filas') as valor
from (
  select 'sessions' t, count(*) n from public.sessions where athlete_id is null
  union all select 'day_logs', count(*) from public.day_logs where athlete_id is null
  union all select 'week_summaries', count(*) from public.week_summaries where athlete_id is null
  union all select 'chat_messages', count(*) from public.chat_messages where athlete_id is null
  union all select 'coach_proposals', count(*) from public.coach_proposals where athlete_id is null
  union all select 'athlete_profiles', count(*) from public.athlete_profiles where athlete_id is null
  union all select 'training_plans', count(*) from public.training_plans where athlete_id is null
  union all select 'training_plan_weeks', count(*) from public.training_plan_weeks where athlete_id is null
  union all select 'whoop_workouts', count(*) from public.whoop_workouts where athlete_id is null
) x where n > 0
union all
select 'policies_totales (debe ser: 78)',
       count(*)::text from pg_policies
 where schemaname='public' and tablename in (
   'athletes','sessions','day_logs','week_summaries','chat_messages','coach_proposals',
   'athlete_profiles','training_plans','training_plan_weeks','athlete_memberships',
   'athlete_coach_notes','readiness_daily','whoop_workouts')
union all
select 'cola de sync del cliente',
       'revisar en la app: cabecera de Ajustes en "Al día"';

-- ── B. DESPUÉS de aplicar 034 ──────────────────────────────────────────────
-- Debe devolver 0 filas. Cada fila es una tabla que todavía acepta null.
select c.table_name, c.is_nullable
from information_schema.columns c
where c.table_schema = 'public'
  and c.column_name = 'athlete_id'
  and c.is_nullable = 'YES'
  and c.table_name in (
    'sessions','day_logs','week_summaries','chat_messages','coach_proposals',
    'athlete_profiles','training_plans','training_plan_weeks','whoop_workouts');

-- ── C. DESPUÉS de aplicar 031 ──────────────────────────────────────────────
-- policies_totales = 31, athletes_policies = 5, legacy_restantes = 1.
select
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('athletes','sessions','day_logs','week_summaries','chat_messages',
       'coach_proposals','athlete_profiles','training_plans','training_plan_weeks',
       'athlete_memberships','athlete_coach_notes','readiness_daily','whoop_workouts')
  ) as policies_totales,
  (select count(*) from pg_policies where schemaname='public' and tablename='athletes')
    as athletes_policies,
  (select count(*) from pg_policies where schemaname='public'
     and (qual like '%owner_account_id%' or qual like '%linked_account_id%'
          or qual like '%auth.uid() = user_id%'
          or with_check like '%owner_account_id%' or with_check like '%linked_account_id%'
          or with_check like '%auth.uid() = user_id%')
     and tablename in ('athletes','sessions','day_logs','week_summaries','chat_messages',
       'coach_proposals','athlete_profiles','training_plans','training_plan_weeks',
       'athlete_memberships','athlete_coach_notes','readiness_daily','whoop_workouts')
  ) as legacy_restantes,
  (select string_agg(policyname || '/' || cmd, ', ' order by policyname) from pg_policies
     where schemaname='public' and tablename='athletes') as athletes_detalle;

-- ── D. DESPUÉS de refrescar la app y sincronizar ───────────────────────────
-- El sync real es la aceptación: si el corte rompiera una lectura o escritura,
-- aparece acá. Debe seguir en cero.
select 'filas_sin_athlete_id' as chequeo,
       coalesce(string_agg(t || '=' || n, ', ' order by t), 'sin filas') as valor
from (
  select 'sessions' t, count(*) n from public.sessions where athlete_id is null
  union all select 'day_logs', count(*) from public.day_logs where athlete_id is null
  union all select 'training_plan_weeks', count(*) from public.training_plan_weeks where athlete_id is null
) x where n > 0;
