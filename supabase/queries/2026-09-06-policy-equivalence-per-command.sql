-- Equivalencia de policies por (tabla, comando) y presencia nominal — 2026-09-06
--
-- Generado a partir del dump archivado
-- docs/superpowers/smokes/evidence/2026-09-05-pg-policies-produccion.csv,
-- que es la autoridad sobre los predicados efectivos de producción.
-- Reemplaza los bloques agrupados de 2026-09-02-membership-equivalence.sql, que
-- el propio archivo declaraba insuficientes para acreditar el corte de 031.
--
-- Sólo lectura. Ejecutar con el rol del SQL Editor (postgres), que ve todas las
-- filas: estas consultas EVALÚAN los predicados, no dependen de que RLS los
-- aplique. Cuantifican sobre auth.users en lugar de impersonar cuenta por
-- cuenta, así que los helpers auth_*_ids() quedan inlineados con su cuerpo de
-- 013b (§6 de esa migración).
--
-- Criterio para 031: §1 sin faltantes ni predicados distintos, §2 con CERO
-- filas en las 88 consultas, y §3 resuelto por diseño antes del corte.

-- ── §1. Presencia nominal de las 25 policies de 013b + las 4 de 030 ─────────
-- Una fila por policy esperada. `instalada` = false bloquea el corte.
with esperadas(tablename, policyname, cmd, origen) as (
  values
    ('athlete_coach_notes','athlete_coach_notes_select','SELECT','013b'),
    ('athlete_coach_notes','athlete_coach_notes_write','ALL','013b'),
    ('athlete_memberships','athlete_memberships_select_own','SELECT','013b'),
    ('athlete_profiles','athlete_profiles_select_membership','SELECT','013b'),
    ('athlete_profiles','athlete_profiles_write_membership','ALL','013b'),
    ('athletes','athletes_select_membership','SELECT','013b'),
    ('athletes','athletes_update_self','UPDATE','013b'),
    ('athletes','athletes_write_coach','UPDATE','013b'),
    ('chat_messages','chat_messages_select_membership','SELECT','013b'),
    ('chat_messages','chat_messages_write_membership','ALL','013b'),
    ('coach_proposals','coach_proposals_select_membership','SELECT','013b'),
    ('coach_proposals','coach_proposals_write_coach','ALL','013b'),
    ('coach_proposals','coach_proposals_write_member','ALL','030'),
    ('day_logs','day_logs_select_membership','SELECT','013b'),
    ('day_logs','day_logs_write_membership','ALL','013b'),
    ('readiness_daily','readiness_daily_select','SELECT','013b'),
    ('sessions','sessions_delete_membership','DELETE','013b'),
    ('sessions','sessions_insert_membership','INSERT','013b'),
    ('sessions','sessions_select_membership','SELECT','013b'),
    ('sessions','sessions_update_membership','UPDATE','013b'),
    ('training_plan_weeks','training_plan_weeks_select_membership','SELECT','013b'),
    ('training_plan_weeks','training_plan_weeks_write_coach','ALL','013b'),
    ('training_plan_weeks','training_plan_weeks_write_member','ALL','030'),
    ('training_plans','training_plans_select_membership','SELECT','013b'),
    ('training_plans','training_plans_write_coach','ALL','013b'),
    ('training_plans','training_plans_write_member','ALL','030'),
    ('week_summaries','week_summaries_select_membership','SELECT','013b'),
    ('week_summaries','week_summaries_write_membership','ALL','013b'),
    ('whoop_workouts','whoop_workouts_select_membership','SELECT','030')
)
select e.origen, e.tablename, e.policyname, e.cmd as cmd_esperado,
       p.cmd as cmd_instalado,
       (p.policyname is not null) as instalada,
       p.permissive, p.roles, p.qual, p.with_check
from esperadas e
left join pg_policies p
  on p.schemaname = 'public'
 and p.tablename = e.tablename
 and p.policyname = e.policyname
order by e.origen, e.tablename, e.policyname;

-- ── §2. Equivalencia legacy vs membresía, 44 pares ──────────────────────────
-- `filas` cuenta pares (fila, cuenta), no filas: una fila visible sólo por
-- legacy para tres cuentas suma 3. El criterio es cero, así que la distinción
-- no cambia el veredicto, pero sí cómo se lee un resultado distinto de cero.
-- UPDATE se parte en `using` (filas alcanzables) y `check` (filas admisibles
-- como resultado), porque Postgres los evalúa por separado y sessions divergen:
-- su USING v2 filtra por authored_by_role y su WITH CHECK no.
select 'athlete_profiles' as tabla, 'DELETE' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.athlete_profiles t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'athlete_profiles' as tabla, 'DELETE' as cmd, 'membership_only' as direccion, count(*) as filas
from public.athlete_profiles t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'athlete_profiles' as tabla, 'INSERT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.athlete_profiles t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'athlete_profiles' as tabla, 'INSERT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.athlete_profiles t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'athlete_profiles' as tabla, 'SELECT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.athlete_profiles t cross join auth.users u
where coalesce(((t.user_id = u.id) or (t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id))), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'athlete_profiles' as tabla, 'SELECT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.athlete_profiles t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id) or (t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id))), false)

union all
select 'athlete_profiles' as tabla, 'UPDATE/check' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.athlete_profiles t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'athlete_profiles' as tabla, 'UPDATE/check' as cmd, 'membership_only' as direccion, count(*) as filas
from public.athlete_profiles t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'athlete_profiles' as tabla, 'UPDATE/using' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.athlete_profiles t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'athlete_profiles' as tabla, 'UPDATE/using' as cmd, 'membership_only' as direccion, count(*) as filas
from public.athlete_profiles t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'athletes' as tabla, 'SELECT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.athletes t cross join auth.users u
where coalesce((((t.owner_account_id = u.id or t.linked_account_id = u.id))), false) and not coalesce(((t.id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'athletes' as tabla, 'SELECT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.athletes t cross join auth.users u
where coalesce(((t.id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce((((t.owner_account_id = u.id or t.linked_account_id = u.id))), false)

union all
select 'athletes' as tabla, 'UPDATE/check' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.athletes t cross join auth.users u
where coalesce(((t.owner_account_id = u.id)), false) and not coalesce(((t.id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach'))), false)

union all
select 'athletes' as tabla, 'UPDATE/check' as cmd, 'membership_only' as direccion, count(*) as filas
from public.athletes t cross join auth.users u
where coalesce(((t.id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach'))), false) and not coalesce(((t.owner_account_id = u.id)), false)

union all
select 'athletes' as tabla, 'UPDATE/using' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.athletes t cross join auth.users u
where coalesce(((t.owner_account_id = u.id)), false) and not coalesce(((t.id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach'))), false)

union all
select 'athletes' as tabla, 'UPDATE/using' as cmd, 'membership_only' as direccion, count(*) as filas
from public.athletes t cross join auth.users u
where coalesce(((t.id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach'))), false) and not coalesce(((t.owner_account_id = u.id)), false)

union all
select 'chat_messages' as tabla, 'DELETE' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.chat_messages t cross join auth.users u
where coalesce(((t.user_id = u.id) or (t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'chat_messages' as tabla, 'DELETE' as cmd, 'membership_only' as direccion, count(*) as filas
from public.chat_messages t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id) or (t.user_id = u.id)), false)

union all
select 'chat_messages' as tabla, 'INSERT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.chat_messages t cross join auth.users u
where coalesce(((t.user_id = u.id) or (t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'chat_messages' as tabla, 'INSERT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.chat_messages t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id) or (t.user_id = u.id)), false)

union all
select 'chat_messages' as tabla, 'SELECT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.chat_messages t cross join auth.users u
where coalesce(((t.user_id = u.id) or (t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id)) or (t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'chat_messages' as tabla, 'SELECT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.chat_messages t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id) or (t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id)) or (t.user_id = u.id)), false)

union all
select 'chat_messages' as tabla, 'UPDATE/check' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.chat_messages t cross join auth.users u
where coalesce(((t.user_id = u.id) or (t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'chat_messages' as tabla, 'UPDATE/check' as cmd, 'membership_only' as direccion, count(*) as filas
from public.chat_messages t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id) or (t.user_id = u.id)), false)

union all
select 'chat_messages' as tabla, 'UPDATE/using' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.chat_messages t cross join auth.users u
where coalesce(((t.user_id = u.id) or (t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'chat_messages' as tabla, 'UPDATE/using' as cmd, 'membership_only' as direccion, count(*) as filas
from public.chat_messages t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id) or (t.user_id = u.id)), false)

union all
select 'coach_proposals' as tabla, 'DELETE' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.coach_proposals t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'coach_proposals' as tabla, 'DELETE' as cmd, 'membership_only' as direccion, count(*) as filas
from public.coach_proposals t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'coach_proposals' as tabla, 'INSERT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.coach_proposals t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'coach_proposals' as tabla, 'INSERT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.coach_proposals t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'coach_proposals' as tabla, 'SELECT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.coach_proposals t cross join auth.users u
where coalesce(((t.user_id = u.id) or (t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id))), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'coach_proposals' as tabla, 'SELECT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.coach_proposals t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id) or (t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id))), false)

union all
select 'coach_proposals' as tabla, 'UPDATE/check' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.coach_proposals t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'coach_proposals' as tabla, 'UPDATE/check' as cmd, 'membership_only' as direccion, count(*) as filas
from public.coach_proposals t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'coach_proposals' as tabla, 'UPDATE/using' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.coach_proposals t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'coach_proposals' as tabla, 'UPDATE/using' as cmd, 'membership_only' as direccion, count(*) as filas
from public.coach_proposals t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'day_logs' as tabla, 'DELETE' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.day_logs t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'day_logs' as tabla, 'DELETE' as cmd, 'membership_only' as direccion, count(*) as filas
from public.day_logs t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'day_logs' as tabla, 'INSERT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.day_logs t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'day_logs' as tabla, 'INSERT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.day_logs t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'day_logs' as tabla, 'SELECT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.day_logs t cross join auth.users u
where coalesce(((t.user_id = u.id) or (t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id))), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'day_logs' as tabla, 'SELECT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.day_logs t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id) or (t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id))), false)

union all
select 'day_logs' as tabla, 'UPDATE/check' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.day_logs t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'day_logs' as tabla, 'UPDATE/check' as cmd, 'membership_only' as direccion, count(*) as filas
from public.day_logs t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'day_logs' as tabla, 'UPDATE/using' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.day_logs t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'day_logs' as tabla, 'UPDATE/using' as cmd, 'membership_only' as direccion, count(*) as filas
from public.day_logs t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'sessions' as tabla, 'DELETE' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.sessions t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or ((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) and coalesce(t.authored_by_role,'self') = 'self')))), false)

union all
select 'sessions' as tabla, 'DELETE' as cmd, 'membership_only' as direccion, count(*) as filas
from public.sessions t cross join auth.users u
where coalesce(((((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or ((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) and coalesce(t.authored_by_role,'self') = 'self')))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'sessions' as tabla, 'INSERT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.sessions t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'sessions' as tabla, 'INSERT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.sessions t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'sessions' as tabla, 'SELECT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.sessions t cross join auth.users u
where coalesce(((t.user_id = u.id) or (t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id))), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'sessions' as tabla, 'SELECT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.sessions t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id) or (t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id))), false)

union all
select 'sessions' as tabla, 'UPDATE/check' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.sessions t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'sessions' as tabla, 'UPDATE/check' as cmd, 'membership_only' as direccion, count(*) as filas
from public.sessions t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'sessions' as tabla, 'UPDATE/using' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.sessions t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or ((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) and coalesce(t.authored_by_role,'self') = 'self')))), false)

union all
select 'sessions' as tabla, 'UPDATE/using' as cmd, 'membership_only' as direccion, count(*) as filas
from public.sessions t cross join auth.users u
where coalesce(((((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or ((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) and coalesce(t.authored_by_role,'self') = 'self')))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'training_plan_weeks' as tabla, 'DELETE' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.training_plan_weeks t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'training_plan_weeks' as tabla, 'DELETE' as cmd, 'membership_only' as direccion, count(*) as filas
from public.training_plan_weeks t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'training_plan_weeks' as tabla, 'INSERT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.training_plan_weeks t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'training_plan_weeks' as tabla, 'INSERT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.training_plan_weeks t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'training_plan_weeks' as tabla, 'SELECT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.training_plan_weeks t cross join auth.users u
where coalesce(((t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id)) or (t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'training_plan_weeks' as tabla, 'SELECT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.training_plan_weeks t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id)) or (t.user_id = u.id)), false)

union all
select 'training_plan_weeks' as tabla, 'UPDATE/check' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.training_plan_weeks t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'training_plan_weeks' as tabla, 'UPDATE/check' as cmd, 'membership_only' as direccion, count(*) as filas
from public.training_plan_weeks t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'training_plan_weeks' as tabla, 'UPDATE/using' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.training_plan_weeks t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'training_plan_weeks' as tabla, 'UPDATE/using' as cmd, 'membership_only' as direccion, count(*) as filas
from public.training_plan_weeks t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'training_plans' as tabla, 'DELETE' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.training_plans t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'training_plans' as tabla, 'DELETE' as cmd, 'membership_only' as direccion, count(*) as filas
from public.training_plans t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'training_plans' as tabla, 'INSERT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.training_plans t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'training_plans' as tabla, 'INSERT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.training_plans t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'training_plans' as tabla, 'SELECT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.training_plans t cross join auth.users u
where coalesce(((t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id)) or (t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'training_plans' as tabla, 'SELECT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.training_plans t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id)) or (t.user_id = u.id)), false)

union all
select 'training_plans' as tabla, 'UPDATE/check' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.training_plans t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'training_plans' as tabla, 'UPDATE/check' as cmd, 'membership_only' as direccion, count(*) as filas
from public.training_plans t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'training_plans' as tabla, 'UPDATE/using' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.training_plans t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'training_plans' as tabla, 'UPDATE/using' as cmd, 'membership_only' as direccion, count(*) as filas
from public.training_plans t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id and m.role = 'coach')) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'week_summaries' as tabla, 'DELETE' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.week_summaries t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'week_summaries' as tabla, 'DELETE' as cmd, 'membership_only' as direccion, count(*) as filas
from public.week_summaries t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'week_summaries' as tabla, 'INSERT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.week_summaries t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'week_summaries' as tabla, 'INSERT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.week_summaries t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'week_summaries' as tabla, 'SELECT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.week_summaries t cross join auth.users u
where coalesce(((t.user_id = u.id) or (t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id))), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'week_summaries' as tabla, 'SELECT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.week_summaries t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id)) or (t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id) or (t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id))), false)

union all
select 'week_summaries' as tabla, 'UPDATE/check' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.week_summaries t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'week_summaries' as tabla, 'UPDATE/check' as cmd, 'membership_only' as direccion, count(*) as filas
from public.week_summaries t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'week_summaries' as tabla, 'UPDATE/using' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.week_summaries t cross join auth.users u
where coalesce(((t.user_id = u.id)), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'week_summaries' as tabla, 'UPDATE/using' as cmd, 'membership_only' as direccion, count(*) as filas
from public.week_summaries t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.user_id = u.id)), false)

union all
select 'whoop_workouts' as tabla, 'SELECT' as cmd, 'legacy_only' as direccion, count(*) as filas
from public.whoop_workouts t cross join auth.users u
where coalesce(((t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id))), false) and not coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false)

union all
select 'whoop_workouts' as tabla, 'SELECT' as cmd, 'membership_only' as direccion, count(*) as filas
from public.whoop_workouts t cross join auth.users u
where coalesce(((t.athlete_id in (select m.athlete_id from public.athlete_memberships m where m.account_id = u.id))), false) and not coalesce(((t.athlete_id in (select a.id from public.athletes a where a.owner_account_id = u.id or a.linked_account_id = u.id))), false)
order by tabla, cmd, direccion;

-- ── §3. Comandos sin reemplazo v2: el corte quitaría el acceso ──────────────
-- athletes DELETE, athletes INSERT.
-- Ninguna migración crea una policy de membresía para estos comandos, así que
-- 031 no puede retirar athletes_insert / athletes_delete sin romper el alta y
-- el borrado duro de atletas desde el cliente. Confirmar antes del corte:
select cmd, count(*) as policies
from pg_policies
where schemaname = 'public' and tablename = 'athletes'
  and cmd in ('INSERT','DELETE')
group by cmd
order by cmd;
