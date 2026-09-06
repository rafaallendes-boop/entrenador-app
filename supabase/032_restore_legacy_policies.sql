-- 032_restore_legacy_policies.sql
-- Rollback de `031`. Aplicación manual, transaccional.
--
-- Recrea las 48 policies legacy con el texto exacto que producción tenía el
-- 2026-09-05, tomado del dump archivado en
-- docs/superpowers/smokes/evidence/2026-09-05-pg-policies-produccion.csv.
-- Ese CSV es la razón por la que este archivo puede ser fiel: los predicados no
-- están reconstruidos de memoria ni reinterpretados desde 007/009/010.
--
-- Devuelve además el nombre original de la policy de INSERT de `athletes` y el
-- cuerpo previo de `enforce_athlete_role_invariants` (el de `030`).
--
-- NO revierte `034` (athlete_id not null). Es deliberado: ese constraint es
-- independiente del modelo de acceso y revertirlo sólo reabre la puerta a filas
-- sin scope. Si hiciera falta:
--   alter table public.<tabla> alter column athlete_id drop not null;

begin;

-- ── 1. Volver a la policy legacy de DELETE ─────────────────────────────────
drop policy if exists athletes_delete_membership on public.athletes;
drop function if exists public.auth_deletable_athlete_ids();

-- ── 2. Restaurar el nombre original de la policy de INSERT ─────────────────
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'athletes'
      and policyname = 'athletes_insert_bootstrap_owner'
  ) then
    execute 'alter policy athletes_insert_bootstrap_owner on public.athletes rename to athletes_insert';
  end if;
end $$;

-- ── 3. Recrear las 48 policies legacy ──────────────────────────────────────
create policy "athlete_profiles: delete own" on public.athlete_profiles
  for delete to public
  using ((auth.uid() = user_id));
create policy "athlete_profiles: insert own" on public.athlete_profiles
  for insert to public
  with check ((auth.uid() = user_id));
create policy "athlete_profiles: read own" on public.athlete_profiles
  for select to public
  using ((auth.uid() = user_id));
create policy "athlete_profiles: update own" on public.athlete_profiles
  for update to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "athlete_profiles_select_by_athlete" on public.athlete_profiles
  for select to public
  using ((athlete_id IN ( SELECT athletes.id
   FROM athletes
  WHERE ((athletes.owner_account_id = auth.uid()) OR (athletes.linked_account_id = auth.uid())))));
create policy "athletes_delete" on public.athletes
  for delete to public
  using ((auth.uid() = owner_account_id));
create policy "athletes_select" on public.athletes
  for select to public
  using (((auth.uid() = owner_account_id) OR (auth.uid() = linked_account_id)));
create policy "athletes_update" on public.athletes
  for update to public
  using ((auth.uid() = owner_account_id))
  with check ((auth.uid() = owner_account_id));
create policy "chat_messages: delete own" on public.chat_messages
  for delete to public
  using ((auth.uid() = user_id));
create policy "chat_messages: insert own" on public.chat_messages
  for insert to public
  with check ((auth.uid() = user_id));
create policy "chat_messages: read own" on public.chat_messages
  for select to public
  using ((auth.uid() = user_id));
create policy "chat_messages: update own" on public.chat_messages
  for update to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "chat_messages_delete_own" on public.chat_messages
  for delete to public
  using ((auth.uid() = user_id));
create policy "chat_messages_insert_own" on public.chat_messages
  for insert to public
  with check ((auth.uid() = user_id));
create policy "chat_messages_select_by_athlete" on public.chat_messages
  for select to public
  using ((athlete_id IN ( SELECT athletes.id
   FROM athletes
  WHERE ((athletes.owner_account_id = auth.uid()) OR (athletes.linked_account_id = auth.uid())))));
create policy "chat_messages_select_own" on public.chat_messages
  for select to public
  using ((auth.uid() = user_id));
create policy "chat_messages_update_own" on public.chat_messages
  for update to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "coach_proposals: delete own" on public.coach_proposals
  for delete to public
  using ((auth.uid() = user_id));
create policy "coach_proposals: insert own" on public.coach_proposals
  for insert to public
  with check ((auth.uid() = user_id));
create policy "coach_proposals: read own" on public.coach_proposals
  for select to public
  using ((auth.uid() = user_id));
create policy "coach_proposals: update own" on public.coach_proposals
  for update to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "coach_proposals_select_by_athlete" on public.coach_proposals
  for select to public
  using ((athlete_id IN ( SELECT athletes.id
   FROM athletes
  WHERE ((athletes.owner_account_id = auth.uid()) OR (athletes.linked_account_id = auth.uid())))));
create policy "day_logs: delete own" on public.day_logs
  for delete to public
  using ((auth.uid() = user_id));
create policy "day_logs: insert own" on public.day_logs
  for insert to public
  with check ((auth.uid() = user_id));
create policy "day_logs: read own" on public.day_logs
  for select to public
  using ((auth.uid() = user_id));
create policy "day_logs: update own" on public.day_logs
  for update to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "day_logs_select_by_athlete" on public.day_logs
  for select to public
  using ((athlete_id IN ( SELECT athletes.id
   FROM athletes
  WHERE ((athletes.owner_account_id = auth.uid()) OR (athletes.linked_account_id = auth.uid())))));
create policy "sessions: delete own" on public.sessions
  for delete to public
  using ((auth.uid() = user_id));
create policy "sessions: insert own" on public.sessions
  for insert to public
  with check ((auth.uid() = user_id));
create policy "sessions: read own" on public.sessions
  for select to public
  using ((auth.uid() = user_id));
create policy "sessions: update own" on public.sessions
  for update to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "sessions_select_by_athlete" on public.sessions
  for select to public
  using ((athlete_id IN ( SELECT athletes.id
   FROM athletes
  WHERE ((athletes.owner_account_id = auth.uid()) OR (athletes.linked_account_id = auth.uid())))));
create policy "training_plan_weeks_delete_own" on public.training_plan_weeks
  for delete to public
  using ((auth.uid() = user_id));
create policy "training_plan_weeks_insert_own" on public.training_plan_weeks
  for insert to public
  with check ((auth.uid() = user_id));
create policy "training_plan_weeks_select_by_athlete" on public.training_plan_weeks
  for select to public
  using ((athlete_id IN ( SELECT athletes.id
   FROM athletes
  WHERE ((athletes.owner_account_id = auth.uid()) OR (athletes.linked_account_id = auth.uid())))));
create policy "training_plan_weeks_select_own" on public.training_plan_weeks
  for select to public
  using ((auth.uid() = user_id));
create policy "training_plan_weeks_update_own" on public.training_plan_weeks
  for update to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "training_plans_delete_own" on public.training_plans
  for delete to public
  using ((auth.uid() = user_id));
create policy "training_plans_insert_own" on public.training_plans
  for insert to public
  with check ((auth.uid() = user_id));
create policy "training_plans_select_by_athlete" on public.training_plans
  for select to public
  using ((athlete_id IN ( SELECT athletes.id
   FROM athletes
  WHERE ((athletes.owner_account_id = auth.uid()) OR (athletes.linked_account_id = auth.uid())))));
create policy "training_plans_select_own" on public.training_plans
  for select to public
  using ((auth.uid() = user_id));
create policy "training_plans_update_own" on public.training_plans
  for update to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "week_summaries: delete own" on public.week_summaries
  for delete to public
  using ((auth.uid() = user_id));
create policy "week_summaries: insert own" on public.week_summaries
  for insert to public
  with check ((auth.uid() = user_id));
create policy "week_summaries: read own" on public.week_summaries
  for select to public
  using ((auth.uid() = user_id));
create policy "week_summaries: update own" on public.week_summaries
  for update to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "week_summaries_select_by_athlete" on public.week_summaries
  for select to public
  using ((athlete_id IN ( SELECT athletes.id
   FROM athletes
  WHERE ((athletes.owner_account_id = auth.uid()) OR (athletes.linked_account_id = auth.uid())))));
create policy "whoop_workouts_select" on public.whoop_workouts
  for select to public
  using ((EXISTS ( SELECT 1
   FROM athletes a
  WHERE ((a.id = whoop_workouts.athlete_id) AND ((a.owner_account_id = auth.uid()) OR (a.linked_account_id = auth.uid()))))));

-- ── 4. Restaurar el cuerpo de `enforce_athlete_role_invariants` de 030 ─────
-- Sin la rama que 031 agregó para altas con forma de reclamo.
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
  v_role := coalesce(v_role, 'athlete');

  if v_is_self then
    if v_role = 'coach' then
      raise exception 'athletes: a coach account cannot own a self athlete';
    end if;
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
    null;
  end if;

  return new;
end;
$$;

-- ── 5. Verificación ────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n
  from pg_policies
  where schemaname = 'public' and tablename = 'athletes' and policyname = 'athletes_insert';
  if n <> 1 then
    raise exception '032: athletes_insert no quedó restaurada (n=%).', n;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
