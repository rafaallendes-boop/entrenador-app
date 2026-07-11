-- SP1a two-sided -- EXPAND (spec 2026-07-05 §3, §4 + enmienda §2b).
-- Aditiva: crea tablas/columnas/policies nuevas SIN tocar las policies legacy
-- user_id/owner (rollback = drop de lo nuevo). Requiere 013a en 0.

-- ── 0. Guard: aborta si el preflight fallaría ────────────────────────────────
do $$
declare
  dup_self_account int;
  dup_profiles int;
begin
  select count(*) into dup_self_account from (
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
    group by account_id having count(distinct athlete_id) > 1
  ) a;
  select count(*) into dup_profiles from (
    select athlete_id from public.athlete_profiles
    where athlete_id is not null
    group by athlete_id having count(*) > 1
  ) p;
  if dup_self_account > 0 or dup_profiles > 0 then
    raise exception '013b aborted: collisions (self memberships=%, profiles=%). Resolver con 013a antes de expandir.',
      dup_self_account, dup_profiles;
  end if;
end $$;

-- athlete_profiles pasa a ser contenido canónico por atleta, no por editor.
-- PostgreSQL permite múltiples NULL en un unique index, preservando deuda legacy
-- no scoped mientras evita perfiles paralelos coach/self para un athlete_id real.
create unique index if not exists athlete_profiles_one_per_athlete
  on public.athlete_profiles (athlete_id);

-- ── 1. Tablas nuevas ─────────────────────────────────────────────────────────
create table if not exists public.athlete_memberships (
  athlete_id text not null references public.athletes(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('self','coach')),
  created_at bigint not null,
  updated_at bigint not null,
  primary key (athlete_id, account_id)
);

create unique index if not exists athlete_memberships_one_self_per_account
  on public.athlete_memberships (account_id) where role = 'self';
create unique index if not exists athlete_memberships_one_self_per_athlete
  on public.athlete_memberships (athlete_id) where role = 'self';
create index if not exists athlete_memberships_account_role
  on public.athlete_memberships (account_id, role);

create table if not exists public.athlete_invites (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('claim_self','grant_coach')),
  athlete_id    text null references public.athletes(id) on delete cascade,
  invited_role  text not null check (invited_role in ('self','coach')),
  created_by    uuid not null references auth.users(id) on delete cascade,
  target_email  text null,
  token_hash    text not null,
  status        text not null default 'pending'
                check (status in ('pending','accepted','revoked','expired')),
  expires_at    bigint not null,
  created_at    bigint not null,
  accepted_at   bigint null,
  accepted_by   uuid null references auth.users(id)
);

create table if not exists public.athlete_coach_notes (
  athlete_id            text primary key references public.athletes(id) on delete cascade,
  coach_memory          text null,
  updated_by_account_id uuid null,
  updated_at            bigint not null
);

-- ── 2. Columnas provenance (§3.4) ────────────────────────────────────────────
-- authored_by_role queda NULLABLE en expand; 013c la endurece tras el deploy
-- del bundle (patrón 009c/010c). created_by usa default auth.uid() para inserts
-- PostgREST; el cliente NO envía created_by en upserts (no pisar autoría).
alter table public.sessions
  add column if not exists authored_by_role text
  check (authored_by_role in ('self','coach'));

do $$
declare tbl text;
begin
  foreach tbl in array array['sessions','day_logs','week_summaries','athlete_profiles']
  loop
    execute format(
      'alter table public.%I add column if not exists created_by_account_id uuid default auth.uid()', tbl);
    execute format(
      'alter table public.%I add column if not exists updated_by_account_id uuid', tbl);
  end loop;
end $$;

-- ── 3. Backfill de membresías desde athletes (§3.5) ─────────────────────────
-- owner = linked (self actual) -> membership(owner,'self')
insert into public.athlete_memberships (athlete_id, account_id, role, created_at, updated_at)
select a.id, a.owner_account_id, 'self', a.created_at, a.updated_at
from public.athletes a
where a.linked_account_id = a.owner_account_id
on conflict (athlete_id, account_id) do nothing;

-- managed (linked null) -> membership(owner,'coach')
insert into public.athlete_memberships (athlete_id, account_id, role, created_at, updated_at)
select a.id, a.owner_account_id, 'coach', a.created_at, a.updated_at
from public.athletes a
where a.linked_account_id is null
on conflict (athlete_id, account_id) do nothing;

-- Mantener la fuente canónica después del snapshot de backfill. Los bundles
-- legacy crean dos formas seguras: self (owner=linked) y managed
-- (linked null). Un linked distinto del owner NO recibe self automáticamente:
-- ese consentimiento pertenece a los RPC de invitación de SP1b.
create or replace function public.seed_membership_for_new_athlete()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.linked_account_id = new.owner_account_id then
    insert into public.athlete_memberships
      (athlete_id, account_id, role, created_at, updated_at)
    values (new.id, new.owner_account_id, 'self', new.created_at, new.updated_at)
    on conflict (athlete_id, account_id) do nothing;
  else
    insert into public.athlete_memberships
      (athlete_id, account_id, role, created_at, updated_at)
    values (new.id, new.owner_account_id, 'coach', new.created_at, new.updated_at)
    on conflict (athlete_id, account_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists athletes_seed_membership on public.athletes;
create trigger athletes_seed_membership
  after insert on public.athletes
  for each row execute function public.seed_membership_for_new_athlete();

-- linked no nulo y <> owner -> DOS membresías (no perder acceso del coach)
insert into public.athlete_memberships (athlete_id, account_id, role, created_at, updated_at)
select a.id, a.linked_account_id, 'self', a.created_at, a.updated_at
from public.athletes a
where a.linked_account_id is not null and a.linked_account_id <> a.owner_account_id
on conflict (athlete_id, account_id) do nothing;

insert into public.athlete_memberships (athlete_id, account_id, role, created_at, updated_at)
select a.id, a.owner_account_id, 'coach', a.created_at, a.updated_at
from public.athletes a
where a.linked_account_id is not null and a.linked_account_id <> a.owner_account_id
on conflict (athlete_id, account_id) do nothing;

-- ── 4. Backfill de coach_memory -> athlete_coach_notes (§3.5) ────────────────
insert into public.athlete_coach_notes (athlete_id, coach_memory, updated_by_account_id, updated_at)
select distinct on (p.athlete_id)
  p.athlete_id, p.coach_memory, a.owner_account_id,
  coalesce(p.updated_at, (extract(epoch from now()) * 1000)::bigint)
from public.athlete_profiles p
join public.athletes a on a.id = p.athlete_id
where p.coach_memory is not null and p.athlete_id is not null
order by p.athlete_id, p.updated_at desc nulls last
on conflict (athlete_id) do nothing;

-- Limpieza del legado ANTES de abrir SELECT por membresía en athlete_profiles:
-- si coach_memory quedara en la fila, un self reclamado la leería vía la policy
-- nueva de la sección 8c (fuga de memoria del coach). Guard: toda memoria no
-- migrable debe estar ya en notes.
do $$
declare unmigrated int;
begin
  select count(*) into unmigrated
  from public.athlete_profiles p
  where p.coach_memory is not null and p.athlete_id is not null
    and not exists (select 1 from public.athlete_coach_notes n
                    where n.athlete_id = p.athlete_id and n.coach_memory is not null);
  if unmigrated > 0 then
    raise exception '013b aborted: % coach_memory sin migrar a notes.', unmigrated;
  end if;
end $$;

update public.athlete_profiles set coach_memory = null where coach_memory is not null;
-- (coach_memory con athlete_id null no es legible por las policies nuevas y el
-- guard de arriba no lo exige; el update lo limpia igual por higiene.)

-- ── 5. Backfill authored_by_role + created_by (D1) ──────────────────────────
-- Managed (hay coach y NO hay self) -> 'coach'; todo lo demás (incl. legacy
-- athlete_id null) -> 'self'. Reclamar un atleta NUNCA reescribe esto.
update public.sessions s
set authored_by_role = case
  when s.athlete_id is not null
    and exists (select 1 from public.athlete_memberships m
                where m.athlete_id = s.athlete_id and m.role = 'coach')
    and not exists (select 1 from public.athlete_memberships m
                    where m.athlete_id = s.athlete_id and m.role = 'self')
  then 'coach' else 'self' end
where s.authored_by_role is null;

do $$
declare tbl text;
begin
  foreach tbl in array array['sessions','day_logs','week_summaries','athlete_profiles']
  loop
    execute format(
      'update public.%I set created_by_account_id = user_id where created_by_account_id is null', tbl);
    execute format(
      'update public.%I set updated_by_account_id = user_id where updated_by_account_id is null', tbl);
  end loop;
end $$;

-- ── 6. Helpers anti-recursión (§4.1) ─────────────────────────────────────────
create or replace function public.auth_athlete_ids()
returns setof text
language sql stable security definer
set search_path = public
as $$ select athlete_id from public.athlete_memberships where account_id = auth.uid() $$;

create or replace function public.auth_coach_athlete_ids()
returns setof text
language sql stable security definer
set search_path = public
as $$ select athlete_id from public.athlete_memberships
      where account_id = auth.uid() and role = 'coach' $$;

-- Acceso a notas de coach (D4-coherente): coaches del atleta, MÁS el self sin
-- coach externo (dueño único / legacy single-user: el owner escribe y lee su
-- propia memoria de coach — solo tiene membresía 'self' sobre su atleta).
-- Un self reclamado CON coach externo no lee ni escribe la nota.
create or replace function public.auth_coach_note_athlete_ids()
returns setof text
language sql stable security definer
set search_path = public
as $$
  select athlete_id from public.athlete_memberships
  where account_id = auth.uid() and role = 'coach'
  union
  select m.athlete_id from public.athlete_memberships m
  where m.account_id = auth.uid() and m.role = 'self'
    and not exists (
      select 1 from public.athlete_memberships c
      where c.athlete_id = m.athlete_id
        and c.role = 'coach'
        and c.account_id <> auth.uid()
    )
$$;

revoke all on function public.auth_athlete_ids() from public, anon;
revoke all on function public.auth_coach_athlete_ids() from public, anon;
revoke all on function public.auth_coach_note_athlete_ids() from public, anon;
grant execute on function public.auth_athlete_ids() to authenticated;
grant execute on function public.auth_coach_athlete_ids() to authenticated;
grant execute on function public.auth_coach_note_athlete_ids() to authenticated;

-- ── 7. RLS de las tablas nuevas (§4.4 + D5) ──────────────────────────────────
alter table public.athlete_memberships enable row level security;
drop policy if exists athlete_memberships_select_own on public.athlete_memberships;
create policy athlete_memberships_select_own on public.athlete_memberships
  for select using (account_id = auth.uid());
-- SIN insert/update/delete: mutación solo por RPC SECURITY DEFINER (SP1b).

alter table public.athlete_invites enable row level security;
-- server-only: sin policies authenticated/anon.

-- Notas de coach: lectura Y escritura por auth_coach_note_athlete_ids()
-- (coach ∪ self-sin-coach-externo). NO usar auth_athlete_ids() acá: un self
-- reclamado con coach externo no debe leer la memoria del coach (D4).
alter table public.athlete_coach_notes enable row level security;
drop policy if exists athlete_coach_notes_select on public.athlete_coach_notes;
create policy athlete_coach_notes_select on public.athlete_coach_notes
  for select using (athlete_id in (select public.auth_coach_note_athlete_ids()));
drop policy if exists athlete_coach_notes_write on public.athlete_coach_notes;
create policy athlete_coach_notes_write on public.athlete_coach_notes
  for all using (athlete_id in (select public.auth_coach_note_athlete_ids()))
  with check (athlete_id in (select public.auth_coach_note_athlete_ids()));

-- ── 8. RLS v2 aditiva en tablas hijas (D5, lista explícita) ──────────────────
-- Las policies legacy user_id/owner NO se tocan (permissive OR; rollback simple).

-- 8a. SELECT por membresía en todas las hijas del set canónico 007.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'sessions','day_logs','week_summaries','chat_messages','coach_proposals',
    'athlete_profiles','training_plans','training_plan_weeks'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_select_membership', tbl);
    execute format(
      'create policy %I on public.%I for select using (
         athlete_id in (select public.auth_athlete_ids())
       )', tbl || '_select_membership', tbl);
  end loop;
end $$;

-- 8b. athletes: PK es id, NO athlete_id (enmienda §4.2 — no copiar el predicado a ciegas).
drop policy if exists athletes_select_membership on public.athletes;
create policy athletes_select_membership on public.athletes
  for select using (id in (select public.auth_athlete_ids()));
drop policy if exists athletes_write_coach on public.athletes;
create policy athletes_write_coach on public.athletes
  for update using (id in (select public.auth_coach_athlete_ids()))
  with check (id in (select public.auth_coach_athlete_ids()));
drop policy if exists athletes_update_self on public.athletes;
create policy athletes_update_self on public.athletes
  for update using (id in (select public.auth_athlete_ids()))
  with check (id in (select public.auth_athlete_ids()));

-- Las columnas legacy de acceso no son editables por policies membership. SP1b
-- muta membresías por RPC y no necesita reparentar owner/linked.
create or replace function public.reject_athlete_access_reparent()
returns trigger language plpgsql as $$
begin
  if new.owner_account_id is distinct from old.owner_account_id
     or new.linked_account_id is distinct from old.linked_account_id then
    raise exception 'athlete owner/linked reparent blocked';
  end if;
  return new;
end $$;
drop trigger if exists athletes_no_access_reparent on public.athletes;
create trigger athletes_no_access_reparent before update on public.athletes
  for each row execute function public.reject_athlete_access_reparent();

-- 8c. Escritura member (self + coach): day_logs, week_summaries, chat_messages,
--     athlete_profiles (campos personales; coach_memory ya vive en notes).
do $$
declare tbl text;
begin
  foreach tbl in array array['day_logs','week_summaries','chat_messages','athlete_profiles']
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_write_membership', tbl);
    execute format(
      'create policy %I on public.%I for all using (
         athlete_id in (select public.auth_athlete_ids())
       ) with check (
         athlete_id in (select public.auth_athlete_ids())
       )', tbl || '_write_membership', tbl);
  end loop;
end $$;

-- 8d. Escritura coach-only: coach_proposals, training_plans, training_plan_weeks.
do $$
declare tbl text;
begin
  foreach tbl in array array['coach_proposals','training_plans','training_plan_weeks']
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_write_coach', tbl);
    execute format(
      'create policy %I on public.%I for all using (
         athlete_id in (select public.auth_coach_athlete_ids())
       ) with check (
         athlete_id in (select public.auth_coach_athlete_ids())
       )', tbl || '_write_coach', tbl);
  end loop;
end $$;

-- 8e. sessions: insert member; update/delete coach total o self solo self-authored.
--     La completación de coach-authored por el self va por RPC (D2), no por policy.
drop policy if exists sessions_insert_membership on public.sessions;
create policy sessions_insert_membership on public.sessions
  for insert with check (athlete_id in (select public.auth_athlete_ids()));
drop policy if exists sessions_update_membership on public.sessions;
create policy sessions_update_membership on public.sessions
  for update using (
    athlete_id in (select public.auth_coach_athlete_ids())
    or (athlete_id in (select public.auth_athlete_ids())
        and coalesce(authored_by_role, 'self') = 'self')
  ) with check (
    athlete_id in (select public.auth_athlete_ids())
  );
drop policy if exists sessions_delete_membership on public.sessions;
create policy sessions_delete_membership on public.sessions
  for delete using (
    athlete_id in (select public.auth_coach_athlete_ids())
    or (athlete_id in (select public.auth_athlete_ids())
        and coalesce(authored_by_role, 'self') = 'self')
  );

-- Autoría server-stamped e inmutable (D1). Bundles viejos que omiten la columna
-- siguen funcionando durante expand; el trigger deriva el rol canónico.
create or replace function public.enforce_session_authorship()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.authored_by_role := case when exists (
      select 1 from public.athlete_memberships m
      where m.athlete_id = new.athlete_id
        and m.account_id = auth.uid() and m.role = 'coach'
    ) then 'coach' else 'self' end;
  elsif new.authored_by_role is distinct from old.authored_by_role then
    raise exception 'authored_by_role is immutable';
  end if;
  return new;
end $$;
drop trigger if exists sessions_authorship_guard on public.sessions;
create trigger sessions_authorship_guard
  before insert or update on public.sessions
  for each row execute function public.enforce_session_authorship();

-- 8f. readiness_daily (Whoop, §1b): migrar el predicado owner/linked -> membresía.
--     Equivalente al de 011 porque el backfill de membresías replica owner/linked.
drop policy if exists readiness_daily_select on public.readiness_daily;
create policy readiness_daily_select on public.readiness_daily
  for select using (athlete_id in (select public.auth_athlete_ids()));
-- Escritura sigue server-only (service-role); sin policies de write.

-- ── 9. Trigger anti-reparenting (§3.5) ───────────────────────────────────────
-- Permite null -> valor (estampado legacy del cliente); rechaza cambiar un
-- athlete_id ya seteado (cierra exfiltración/corrupción por re-parent).
create or replace function public.reject_athlete_reparent()
returns trigger
language plpgsql
as $$
begin
  if old.athlete_id is not null and new.athlete_id is distinct from old.athlete_id then
    raise exception 'athlete_id reparent blocked on %.% (% -> %)',
      tg_table_schema, tg_table_name, old.athlete_id, new.athlete_id;
  end if;
  return new;
end $$;

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'sessions','day_logs','week_summaries','chat_messages','coach_proposals',
    'training_plans','training_plan_weeks','athlete_profiles','athlete_coach_notes'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', tbl || '_no_reparent', tbl);
    execute format(
      'create trigger %I before update on public.%I
       for each row execute function public.reject_athlete_reparent()',
      tbl || '_no_reparent', tbl);
  end loop;
end $$;

-- Consistencia hija-padre: training_plan_weeks.athlete_id debe coincidir con el
-- del plan padre (la policy coach-only solo mira el athlete_id de la week; sin
-- esto un INSERT podría cruzar athlete_ids dentro del propio roster).
create or replace function public.enforce_plan_week_athlete()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare parent_athlete text;
begin
  if new.plan_id is null or new.athlete_id is null then
    return new; -- filas legacy/parciales: las cubre el estampado + backfill
  end if;
  select athlete_id into parent_athlete
  from public.training_plans where id = new.plan_id;
  if not found then
    raise exception 'training plan % not found', new.plan_id;
  end if;
  if parent_athlete is not null and parent_athlete <> new.athlete_id then
    raise exception 'training_plan_weeks.athlete_id (%) != training_plans.athlete_id (%) for plan %',
      new.athlete_id, parent_athlete, new.plan_id;
  end if;
  return new;
end $$;

drop trigger if exists training_plan_weeks_athlete_consistency on public.training_plan_weeks;
create trigger training_plan_weeks_athlete_consistency
  before insert or update on public.training_plan_weeks
  for each row execute function public.enforce_plan_week_athlete();

-- ── 10. RPC mark_session_done (§4.3 + D2) ────────────────────────────────────
-- Whitelist EXACTA: status (columna) + claves camelCase de completación dentro
-- de data JSONB. Las claves whitelisted se reemplazan enteras por los params
-- (null = clear); ninguna otra clave de data se toca.
create or replace function public.mark_session_done(
  p_session_id text,
  p_status text,
  p_updated_at bigint,
  p_completed_at bigint default null,
  p_actual_rpe numeric default null,
  p_actual_duration_min numeric default null,
  p_completion_notes text default null,
  p_session_feedback jsonb default null
) returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if p_status is null or p_status not in ('planned','completed','adjusted','skipped') then
    raise exception 'mark_session_done: invalid status %', p_status;
  end if;
  if p_updated_at is null then
    raise exception 'mark_session_done: p_updated_at required';
  end if;

  update public.sessions s
  set status = p_status,
      data = (coalesce(s.data, '{}'::jsonb)
              - 'completedAt' - 'actualRpe' - 'actualDurationMin'
              - 'completionNotes' - 'sessionFeedback')
             || jsonb_strip_nulls(jsonb_build_object(
                  'completedAt', p_completed_at,
                  'actualRpe', p_actual_rpe,
                  'actualDurationMin', p_actual_duration_min,
                  'completionNotes', p_completion_notes,
                  'sessionFeedback', p_session_feedback)),
      updated_at = greatest(s.updated_at, p_updated_at),
      updated_by_account_id = auth.uid()
  where s.id = p_session_id
    -- LWW: una op offline vieja NO pisa una fila más nueva (empate aplica,
    -- consistente con el write path 008b donde el empate gana remoto... acá
    -- el "remoto" es la fila; <= permite el caso normal same-ms).
    and s.updated_at <= p_updated_at
    and s.authored_by_role = 'coach'
    and s.athlete_id in (select m.athlete_id from public.athlete_memberships m
                         where m.account_id = auth.uid() and m.role = 'self');
  get diagnostics v_updated = row_count;
  -- false = stale (LWW: la fila remota es más nueva), inexistente o sin
  -- membresía. El cliente lo trata como op CONSUMIDA (drop + log), nunca retry.
  return v_updated > 0;
end $$;

revoke all on function public.mark_session_done(text, text, bigint, bigint, numeric, numeric, text, jsonb)
  from public, anon;
grant execute on function public.mark_session_done(text, text, bigint, bigint, numeric, numeric, text, jsonb)
  to authenticated;

-- ── 11. Post-check report ────────────────────────────────────────────────────
select 'memberships total' as check, count(*) from public.athlete_memberships
union all
select 'memberships self', count(*) from public.athlete_memberships where role = 'self'
union all
select 'memberships coach', count(*) from public.athlete_memberships where role = 'coach'
union all
select 'athletes sin membresía (must be 0)', count(*)
from public.athletes a
where not exists (select 1 from public.athlete_memberships m where m.athlete_id = a.id)
union all
select 'sessions authored_by_role null (must be 0)', count(*)
from public.sessions where authored_by_role is null
union all
select 'coach notes migradas', count(*) from public.athlete_coach_notes;
