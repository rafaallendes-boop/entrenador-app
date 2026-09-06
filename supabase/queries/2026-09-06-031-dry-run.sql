-- DRY RUN de 031 — NO aplica nada. 2026-09-06.
--
-- ================================================================
--  ESTE SCRIPT TERMINA EN `rollback;` Y NO COMMITEA NADA.
--  Es una copia de 031 con el `commit;` reemplazado por `rollback;`
--  más un reporte del estado que habría quedado.
--  Sirve para comprobar que 031 aplica limpio contra el esquema
--  real: nombres de policy, guards, helper, rename y trigger.
--  Supabase va a advertir «Potential issue detected» porque el
--  texto contiene DROP POLICY. Es esperado: se revierte.
--  NO borrar la última línea.
-- ================================================================
--
-- Resultado esperado, con el estado del 2026-09-06:
--   policies_totales  = 31   (78 actuales − 48 retiradas + 1 nueva)
--   athletes_policies = 5
--   athletes_detalle  = athletes_delete_membership/DELETE,
--                       athletes_insert_bootstrap_owner/INSERT,
--                       athletes_select_membership/SELECT,
--                       athletes_update_self/UPDATE,
--                       athletes_write_coach/UPDATE
--
-- Cualquier excepción quiere decir que 031 NO está listo para aplicar.

-- 031_retire_legacy_policies.sql
-- Entrega 1b — corte de las policies legacy: la membresía pasa a ser la única
-- autoridad de RLS. Aplicación manual, transaccional y fail-closed.
--
-- REQUIERE `034` YA APLICADA (athlete_id not null). El número mayor no es un
-- error: `031`/`032` estaban reservadas por nombre desde la Entrega 1a.
--
-- Alcance, derivado del dump de producción del 2026-09-05
-- (docs/superpowers/smokes/evidence/2026-09-05-pg-policies-produccion.csv) y de
-- la equivalencia ejecutada el 2026-09-06 —88 consultas, todas en cero—:
--
--   * retira 48 de las 49 policies legacy;
--   * CONSERVA `athletes_insert`, renombrada a `athletes_insert_bootstrap_owner`;
--   * reemplaza `athletes_delete` por una policy de membresía;
--   * endurece `enforce_athlete_role_invariants` para altas con forma de reclamo.
--
-- Por qué se conserva el INSERT de `athletes`: la membresía se siembra *desde*
-- el propio insert (`athletes_seed_membership`, 013b), así que en ese instante
-- no existe membresía sobre la que predicar. Cualquier policy de INSERT en esa
-- tabla tiene que hablar de `owner_account_id`. Y sin ninguna policy de INSERT,
-- un `INSERT … ON CONFLICT DO UPDATE` se rechaza **aunque la fila ya exista**
-- (medido el 2026-09-06 con una tabla temporal en transacción revertida:
-- `new row violates row-level security policy`), de modo que retirarla rompería
-- todo push de `athletes` —incluido `ensureRemoteAthlete`, que corre dentro del
-- drenaje de cola—, no sólo el alta. Retirarla algún día exige mover el cliente
-- a `create_self_athlete` y a `admin_create_managed_athlete`, y esta última
-- exige `account_role = 'coach'`: es Entrega 2, no 1b.
--
-- Detalle y alternativas descartadas:
-- docs/superpowers/specs/2026-09-06-migration-031-cut-design.md

begin;

-- ── 1. Guards fail-closed ──────────────────────────────────────────────────
-- No se retira nada si la RLS v2 no está completa o si quedan filas sin scope.

do $$
declare
  esperadas constant int := 29;
  n int;
begin
  select count(*) into n
  from pg_policies p
  join (values
    ('athlete_coach_notes','athlete_coach_notes_select'),
    ('athlete_coach_notes','athlete_coach_notes_write'),
    ('athlete_memberships','athlete_memberships_select_own'),
    ('athlete_profiles','athlete_profiles_select_membership'),
    ('athlete_profiles','athlete_profiles_write_membership'),
    ('athletes','athletes_select_membership'),
    ('athletes','athletes_update_self'),
    ('athletes','athletes_write_coach'),
    ('chat_messages','chat_messages_select_membership'),
    ('chat_messages','chat_messages_write_membership'),
    ('coach_proposals','coach_proposals_select_membership'),
    ('coach_proposals','coach_proposals_write_coach'),
    ('coach_proposals','coach_proposals_write_member'),
    ('day_logs','day_logs_select_membership'),
    ('day_logs','day_logs_write_membership'),
    ('readiness_daily','readiness_daily_select'),
    ('sessions','sessions_delete_membership'),
    ('sessions','sessions_insert_membership'),
    ('sessions','sessions_select_membership'),
    ('sessions','sessions_update_membership'),
    ('training_plan_weeks','training_plan_weeks_select_membership'),
    ('training_plan_weeks','training_plan_weeks_write_coach'),
    ('training_plan_weeks','training_plan_weeks_write_member'),
    ('training_plans','training_plans_select_membership'),
    ('training_plans','training_plans_write_coach'),
    ('training_plans','training_plans_write_member'),
    ('week_summaries','week_summaries_select_membership'),
    ('week_summaries','week_summaries_write_membership'),
    ('whoop_workouts','whoop_workouts_select_membership')
  ) as e(tablename, policyname)
    on p.tablename = e.tablename and p.policyname = e.policyname
  where p.schemaname = 'public';

  if n <> esperadas then
    raise exception
      '031: se esperaban % policies v2 instaladas y hay %. Revisar 013b/030 antes de cortar.',
      esperadas, n;
  end if;
end $$;

do $$
declare tbl text; n bigint;
begin
  foreach tbl in array array[
    'sessions', 'day_logs', 'week_summaries', 'chat_messages', 'coach_proposals',
    'athlete_profiles', 'training_plans', 'training_plan_weeks', 'whoop_workouts'
  ]
  loop
    execute format('select count(*) from public.%I where athlete_id is null', tbl) into n;
    if n > 0 then
      raise exception
        '031: % tiene % filas sin athlete_id; serían inalcanzables tras el corte. Aplicar 034 primero.',
        tbl, n;
    end if;
  end loop;
end $$;

-- Las tres funciones helper de 013b son la autoridad del modelo nuevo.
do $$
declare faltan text;
begin
  select string_agg(f, ', ')
    into faltan
  from unnest(array['auth_athlete_ids','auth_coach_athlete_ids','auth_coach_note_athlete_ids']) f
  where to_regprocedure('public.' || f || '()') is null;

  if faltan is not null then
    raise exception '031: faltan helpers de 013b: %', faltan;
  end if;
end $$;

-- ── 2. Reemplazo del DELETE de `athletes` ──────────────────────────────────
-- La legacy permitía a cualquier owner borrar la fila. En un atleta reclamado
-- el owner sigue siendo el coach, así que eso permitiría hard-delete de un
-- atleta con cuenta propia y cascada de sus datos por el FK
-- `athlete_profiles_athlete_fk … on delete cascade` de 007, salteando el guard
-- que `admin_delete_athlete` (030) ya impone.
--
-- El helper es SECURITY DEFINER por necesidad, no por estilo: `athlete_memberships`
-- tiene RLS (`account_id = auth.uid()`), así que una subconsulta escrita en línea
-- dentro de la policy sólo vería las membresías del propio actor y la membresía
-- `self` de otra cuenta sería invisible. Mismo patrón anti-recursión que 013b §6.
create or replace function public.auth_deletable_athlete_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select m.athlete_id
  from public.athlete_memberships m
  join public.athletes a on a.id = m.athlete_id
  where m.account_id = auth.uid()
    and m.role = 'coach'
    and not exists (
      select 1 from public.athlete_memberships s
      where s.athlete_id = m.athlete_id and s.role = 'self'
    )
    and (a.linked_account_id is null or a.linked_account_id = a.owner_account_id)
$$;

revoke all on function public.auth_deletable_athlete_ids() from public, anon;
grant execute on function public.auth_deletable_athlete_ids() to authenticated;

drop policy if exists athletes_delete_membership on public.athletes;
create policy athletes_delete_membership on public.athletes
  for delete using (id in (select public.auth_deletable_athlete_ids()));

-- ── 3. Retiro de las 48 policies legacy ────────────────────────────────────
-- Lista generada desde el dump archivado; `032` las recrea con el mismo texto.
drop policy if exists "athlete_profiles: delete own" on public.athlete_profiles;
drop policy if exists "athlete_profiles: insert own" on public.athlete_profiles;
drop policy if exists "athlete_profiles: read own" on public.athlete_profiles;
drop policy if exists "athlete_profiles: update own" on public.athlete_profiles;
drop policy if exists "athlete_profiles_select_by_athlete" on public.athlete_profiles;
drop policy if exists "athletes_delete" on public.athletes;
drop policy if exists "athletes_select" on public.athletes;
drop policy if exists "athletes_update" on public.athletes;
drop policy if exists "chat_messages: delete own" on public.chat_messages;
drop policy if exists "chat_messages: insert own" on public.chat_messages;
drop policy if exists "chat_messages: read own" on public.chat_messages;
drop policy if exists "chat_messages: update own" on public.chat_messages;
drop policy if exists "chat_messages_delete_own" on public.chat_messages;
drop policy if exists "chat_messages_insert_own" on public.chat_messages;
drop policy if exists "chat_messages_select_by_athlete" on public.chat_messages;
drop policy if exists "chat_messages_select_own" on public.chat_messages;
drop policy if exists "chat_messages_update_own" on public.chat_messages;
drop policy if exists "coach_proposals: delete own" on public.coach_proposals;
drop policy if exists "coach_proposals: insert own" on public.coach_proposals;
drop policy if exists "coach_proposals: read own" on public.coach_proposals;
drop policy if exists "coach_proposals: update own" on public.coach_proposals;
drop policy if exists "coach_proposals_select_by_athlete" on public.coach_proposals;
drop policy if exists "day_logs: delete own" on public.day_logs;
drop policy if exists "day_logs: insert own" on public.day_logs;
drop policy if exists "day_logs: read own" on public.day_logs;
drop policy if exists "day_logs: update own" on public.day_logs;
drop policy if exists "day_logs_select_by_athlete" on public.day_logs;
drop policy if exists "sessions: delete own" on public.sessions;
drop policy if exists "sessions: insert own" on public.sessions;
drop policy if exists "sessions: read own" on public.sessions;
drop policy if exists "sessions: update own" on public.sessions;
drop policy if exists "sessions_select_by_athlete" on public.sessions;
drop policy if exists "training_plan_weeks_delete_own" on public.training_plan_weeks;
drop policy if exists "training_plan_weeks_insert_own" on public.training_plan_weeks;
drop policy if exists "training_plan_weeks_select_by_athlete" on public.training_plan_weeks;
drop policy if exists "training_plan_weeks_select_own" on public.training_plan_weeks;
drop policy if exists "training_plan_weeks_update_own" on public.training_plan_weeks;
drop policy if exists "training_plans_delete_own" on public.training_plans;
drop policy if exists "training_plans_insert_own" on public.training_plans;
drop policy if exists "training_plans_select_by_athlete" on public.training_plans;
drop policy if exists "training_plans_select_own" on public.training_plans;
drop policy if exists "training_plans_update_own" on public.training_plans;
drop policy if exists "week_summaries: delete own" on public.week_summaries;
drop policy if exists "week_summaries: insert own" on public.week_summaries;
drop policy if exists "week_summaries: read own" on public.week_summaries;
drop policy if exists "week_summaries: update own" on public.week_summaries;
drop policy if exists "week_summaries_select_by_athlete" on public.week_summaries;
drop policy if exists "whoop_workouts_select" on public.whoop_workouts;

-- ── 4. El INSERT de `athletes` se conserva y se re-declara ─────────────────
-- Deja de leerse como deuda pendiente y pasa a ser lo que es: el bootstrap del
-- modelo de membresías. El predicado no cambia.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'athletes' and policyname = 'athletes_insert'
  ) then
    execute 'alter policy athletes_insert on public.athletes rename to athletes_insert_bootstrap_owner';
  end if;
end $$;

-- ── 5. Cerrar por construcción la segunda clase de divergencia ─────────────
-- Un insert directo podía fijar `linked_account_id` a otra cuenta: la fila
-- queda con forma de reclamada y `athletes_seed_membership` sólo siembra
-- `coach`, sin `self`. Eso desacopla membresías de owner/linked, que es una de
-- las dos condiciones bajo las que legacy y membresía podrían divergir. El
-- reclamo pertenece a los RPC de invitación de SP1b, no a un insert del cliente.
--
-- Sólo se rechaza el alta de filas NUEVAS: un re-upsert de un atleta ya
-- existente debe seguir pasando, por la misma razón que 030 exceptuó el caso
-- self (los triggers BEFORE INSERT corren antes de resolver el conflicto y
-- `ensureRemoteAthlete` reinserta el mismo atleta antes de cada push).
create or replace function public.enforce_athlete_role_invariants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_is_self boolean := new.linked_account_id is not distinct from new.owner_account_id;
begin
  select account_role into v_role
  from public.user_entitlements
  where user_id = new.owner_account_id;
  -- Ausencia de fila = athlete por compatibilidad.
  v_role := coalesce(v_role, 'athlete');

  if v_is_self then
    if v_role = 'coach' then
      raise exception 'athletes: a coach account cannot own a self athlete';
    end if;
    -- Ver 030: la exención por id existe porque `ensureRemoteAthlete` reinserta
    -- el mismo atleta self con `on conflict (id) do update` antes de cada push.
    if exists (
      select 1
      from public.athlete_memberships
      where account_id = new.owner_account_id
        and role = 'self'
        and athlete_id is distinct from new.id
    ) then
      raise exception 'athletes: account already has a self athlete';
    end if;
  else
    -- 031: managed (linked null) sigue permitido. Una fila NUEVA con linked de
    -- otra cuenta es un reclamo, y el reclamo va por RPC de invitación.
    if new.linked_account_id is not null
       and not exists (select 1 from public.athletes a where a.id = new.id) then
      raise exception
        'athletes: claiming an athlete requires the SP1b invite RPCs, not a direct insert';
    end if;
  end if;

  return new;
end;
$$;

-- ── 6. Verificación del estado final ───────────────────────────────────────
do $$
declare
  n_legacy int;
  n_ins int;
  n_del int;
begin
  select count(*) into n_legacy
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'athletes', 'sessions', 'day_logs', 'week_summaries', 'chat_messages',
      'coach_proposals', 'athlete_profiles', 'training_plans',
      'training_plan_weeks', 'athlete_memberships', 'athlete_coach_notes',
      'readiness_daily', 'whoop_workouts'
    )
    and (qual like '%owner_account_id%' or qual like '%linked_account_id%'
         or qual like '%auth.uid() = user_id%'
         or with_check like '%owner_account_id%' or with_check like '%linked_account_id%'
         or with_check like '%auth.uid() = user_id%');

  -- La única superviviente esperada es el bootstrap de INSERT de `athletes`.
  if n_legacy <> 1 then
    raise exception '031: quedan % policies legacy y se esperaba exactamente 1 (el bootstrap).', n_legacy;
  end if;

  select count(*) into n_ins from pg_policies
   where schemaname='public' and tablename='athletes' and cmd='INSERT';
  select count(*) into n_del from pg_policies
   where schemaname='public' and tablename='athletes' and cmd='DELETE';

  if n_ins <> 1 then
    raise exception '031: athletes quedó con % policies de INSERT (debe ser 1).', n_ins;
  end if;
  if n_del <> 1 then
    raise exception '031: athletes quedó con % policies de DELETE (debe ser 1).', n_del;
  end if;
end $$;

-- ── Reporte del estado que habría quedado ──────────────────────────────────
select
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('athletes','sessions','day_logs','week_summaries','chat_messages',
       'coach_proposals','athlete_profiles','training_plans','training_plan_weeks',
       'athlete_memberships','athlete_coach_notes','readiness_daily','whoop_workouts')
  ) as policies_totales,
  (select count(*) from pg_policies where schemaname='public' and tablename='athletes')
    as athletes_policies,
  (select string_agg(policyname || '/' || cmd, ', ' order by policyname) from pg_policies
     where schemaname='public' and tablename='athletes') as athletes_detalle;

rollback;
