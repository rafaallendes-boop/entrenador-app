# SP1a — Fundación de dos lados (datos + RLS v2 + sync link-aware) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar SP1a del spec `docs/superpowers/specs/2026-07-05-coach-two-sided-foundation-sp1-design.md` (incl. enmiendas §2b D1–D6): `athlete_memberships` como fuente canónica de acceso, RLS v2 por membresía, self link-aware con gate de claim, pull por membresías, ruteo RPC de completación coach-authored, y extracción de `coachMemory` a `athlete_coach_notes`. **Sin** flujos de invitación ni UI (eso es SP1b).

**Architecture:** Tres migraciones SQL manuales (`013a` preflight report-only, `013b` expand con backfill + RLS v2 aditiva + RPC, `013c` contract diferido) + Dexie v17 con dos stores nuevos (`athleteMemberships` cache pull-only, `athleteCoachNotes` bidireccional). El cliente resuelve "self" desde la membresía `role='self'` con fallback legacy `ath_<uid>`; el pull remoto pasa a `athlete_id ∈ membresías` con fallback al comportamiento actual cuando el cache está vacío. La completación de sesiones coach-authored por un self se rutea por op discriminada `session_completion` → RPC `mark_session_done` (nunca upsert de fila). Todo es testeable con membresías **sembradas**.

**Tech Stack:** React + TypeScript + Vite, Dexie (fake-indexeddb en tests), Supabase (PostgREST + RLS + plpgsql), Zustand, vitest.

## Global Constraints

- **Los commits los hace el owner** — el ejecutor NUNCA corre `git add`/`git commit`; cada "checkpoint de commit" significa: detenerse, mostrar el diff resumido y pedir al owner que commitee con el mensaje sugerido.
- Nunca el literal `'default'` fuera de `activeAthlete.ts` (hay guard test); usar `ATHLETE_PROFILE_LOCAL_ID`, `getActiveAthleteId()` o `getSelfAthleteId()`.
- Lecturas de `sessions`/`dayLogs`/`weekSummaries`/`coachProposals`/`chatMessages` fuera de sync/export pasan por `filterRowsToActiveScope`/`isRowInActiveScope`; filas legacy/unscoped pertenecen SOLO al self.
- Creación local de esas filas se estampa con `withActiveAthleteStamp`; en sync, el fallback legacy se ancla a `getSelfAthleteId()`.
- Dexie está en **v16**; este plan agrega **v17**. Todo cambio de schema requiere test de upgrade real (patrón `db.close(); await db.delete(); await db.open()` por test).
- Migraciones remotas son manuales y numeradas (`supabase/013*.sql`); el ejecutor las escribe pero **no** las aplica — las aplica el owner.
- No modificar `src/services/ai/promptBuilder.ts` (la extracción de coachMemory toca solo a sus CALLERS, que le pasan `athleteMemory` como string).
- No duplicar lógica de sync existente; extender `syncService.ts` / `syncSupabase.ts` en sus seams actuales.
- Antes de cada checkpoint: `npm run lint && npm test && npm run build` en verde.
- Timestamps remotos de las tablas nuevas: **bigint epoch-ms** (igual que `athletes` en `007`), NO timestamptz.
- `ENTITY_TIER` en `src/types/syncDiagnostics.ts:51` es `Record<SupabaseTable, SyncTier>` exhaustivo: cada tabla agregada al union `SupabaseTable` exige su entrada de tier (typecheck lo fuerza).

---

### Task 1: Migración `013a` — preflight report-only

**Files:**
- Create: `supabase/013a_two_sided_preflight.sql`

**Interfaces:**
- Produces: script SQL de solo lectura que el owner corre en prod ANTES de `013b`. Todos los checks marcados "must be 0" deben dar 0.

- [ ] **Step 1: Escribir el preflight**

```sql
-- SP1a two-sided -- PREFLIGHT (report only, mutates nothing).
-- Correr ANTES de 013b. Todos los checks "must be 0" deben dar 0.

-- 1. Cuentas con más de un atleta self-shaped (owner = linked).
--    Violarían unique(account_id) where role='self'. MUST BE 0.
select 'accounts with >1 self-shaped athlete' as check, count(*) as offending from (
  select owner_account_id
  from public.athletes
  where linked_account_id = owner_account_id
  group by owner_account_id
  having count(*) > 1
) a
union all
-- 2. Atletas con linked_account_id que ya es self de otro atleta.
--    Violarían unique(account_id) where role='self'. MUST BE 0.
select 'linked accounts colliding as self', count(*) from (
  select l.linked_account_id
  from public.athletes l
  where l.linked_account_id is not null
  group by l.linked_account_id
  having count(distinct l.id) > 1
) b
union all
-- 3. Filas hijas con athlete_id que no existe en athletes. MUST BE 0.
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
  and not exists (select 1 from public.athletes a where a.id = w.athlete_id);

-- 4. Señal operativa (no bloquea): forma del roster y deuda legacy.
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

-- 5. Preview de la clasificación authored_by_role (D1): sesiones que quedarán 'coach'.
select 'sessions que backfillearán coach-authored' as info, count(*)
from public.sessions s
join public.athletes a on a.id = s.athlete_id
where a.linked_account_id is null;
```

- [ ] **Step 2: Sanity check local del SQL**

Run: `grep -cE "insert|update|delete|alter|create|drop" supabase/013a_two_sided_preflight.sql`
Expected: `0` (es report-only; las palabras solo pueden aparecer en comentarios `--`, verificar visualmente si el grep da >0).

- [ ] **Step 3: Checkpoint de commit (owner)**

Mensaje sugerido: `feat(sp1a): 013a preflight report-only para memberships`

---

### Task 2: Migración `013b` — expand (tablas + backfill + helpers + RLS v2 + trigger + RPC)

**Files:**
- Create: `supabase/013b_two_sided_expand.sql`

**Interfaces:**
- Consumes: checks de `013a` en 0.
- Produces: tablas `athlete_memberships` / `athlete_invites` / `athlete_coach_notes`; columnas `authored_by_role`, `created_by_account_id`, `updated_by_account_id`; helpers `public.auth_athlete_ids()` / `public.auth_coach_athlete_ids()`; RPC `public.mark_session_done(...)`; policies membership aditivas (las legacy `user_id`/`owner` quedan intactas — rollback §11 del spec).

- [ ] **Step 1: Escribir la migración completa**

```sql
-- SP1a two-sided -- EXPAND (spec 2026-07-05 §3, §4 + enmienda §2b).
-- Aditiva: crea tablas/columnas/policies nuevas SIN tocar las policies legacy
-- user_id/owner (rollback = drop de lo nuevo). Requiere 013a en 0.

-- ── 0. Guard: aborta si el preflight fallaría ────────────────────────────────
do $$
declare
  dup_self_account int;
  dup_self_linked int;
begin
  select count(*) into dup_self_account from (
    select owner_account_id from public.athletes
    where linked_account_id = owner_account_id
    group by owner_account_id having count(*) > 1
  ) a;
  select count(*) into dup_self_linked from (
    select linked_account_id from public.athletes
    where linked_account_id is not null
    group by linked_account_id having count(distinct id) > 1
  ) b;
  if dup_self_account > 0 or dup_self_linked > 0 then
    raise exception '013b aborted: self collisions (owner=%, linked=%). Resolver con 013a antes de expandir.',
      dup_self_account, dup_self_linked;
  end if;
end $$;

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
-- Escritura de athletes queda con las policies owner legacy en SP1a.

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
language plpgsql
as $$
declare parent_athlete text;
begin
  if new.plan_id is null or new.athlete_id is null then
    return new; -- filas legacy/parciales: las cubre el estampado + backfill
  end if;
  select athlete_id into parent_athlete
  from public.training_plans where id = new.plan_id;
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
    and s.athlete_id in (select m.athlete_id from public.athlete_memberships m
                         where m.account_id = auth.uid());
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
```

- [ ] **Step 2: Revisión estática del SQL**

Verificar a mano contra el spec:
- La matriz de D5 (§2b) mapea 1:1 con las secciones 8a–8f (11 tablas + server-only).
- `athletes` usa `id in (...)`, nunca `athlete_id` (enmienda §4.2).
- El RPC solo toca `status`, las 5 claves camelCase de `data`, `updated_at`, `updated_by_account_id`; su WHERE incluye el guard LWW `s.updated_at <= p_updated_at`.
- `athlete_coach_notes` usa `auth_coach_note_athlete_ids()` (coach ∪ self-sin-coach-externo) en select Y write — nunca `auth_athlete_ids()`.
- `athlete_profiles.coach_memory` queda en NULL después del guard de migración (antes de que la policy 8c abra SELECT por membresía).
- `training_plan_weeks` tiene el trigger de consistencia con el plan padre además del anti-reparent.
- Ninguna policy legacy se dropea (solo `readiness_daily_select` se REEMPLAZA por su equivalente por membresía, per §1b del spec).

- [ ] **Step 3: Checkpoint de commit (owner)**

Mensaje sugerido: `feat(sp1a): 013b expand — memberships, coach notes, RLS v2, mark_session_done`

---

### Task 3: Migración `013c` — contract diferido + smoke SQL documentado

**Files:**
- Create: `supabase/013c_two_sided_contract.sql`
- Create: `docs/superpowers/plans/2026-07-09-sp1a-smoke.md`

**Interfaces:**
- Produces: `013c` que el owner aplica SOLO después del deploy del bundle SP1a (los bundles viejos no envían `authored_by_role`); doc de smoke con membresías sembradas para validar RLS/RPC en prod o en un proyecto Supabase de prueba.

- [ ] **Step 1: Escribir `013c`**

```sql
-- SP1a two-sided -- CONTRACT (diferido; aplicar SOLO tras deploy del bundle SP1a).
-- Los bundles pre-SP1a no envían authored_by_role: endurecer antes rompería sus upserts.

-- Guard: no debe quedar deuda (el bundle nuevo estampa siempre).
do $$
declare pending int;
begin
  select count(*) into pending from public.sessions where authored_by_role is null;
  if pending > 0 then
    raise exception '013c aborted: % sessions sin authored_by_role. Backfill de seguridad primero.', pending;
  end if;
end $$;

alter table public.sessions alter column authored_by_role set not null;

-- Re-limpieza defensiva: 013b ya nulificó coach_memory, pero bundles viejos
-- pudieron re-escribirlo en la ventana 013b -> deploy (el bundle nuevo ya no
-- envía coach_memory en athlete_profiles). Verificar antes que la memoria
-- re-escrita esté en notes; si este count da >0, migrarla a mano primero:
--   select count(*) from public.athlete_profiles p
--   where p.coach_memory is not null and p.athlete_id is not null
--     and not exists (select 1 from public.athlete_coach_notes n
--                     where n.athlete_id = p.athlete_id and n.coach_memory is not null);
update public.athlete_profiles set coach_memory = null where coach_memory is not null;

-- NOTA: el contract de owner_account_id/linked_account_id en athletes queda
-- diferido más allá de SP1 (el código aún las lee; spec §3.5).
```

- [ ] **Step 2: Escribir el smoke doc con membresías sembradas**

Crear `docs/superpowers/plans/2026-07-09-sp1a-smoke.md`:

```markdown
# SP1a — Smoke con membresías sembradas (RLS v2 + RPC)

Correr en SQL editor de Supabase (o proyecto de prueba) DESPUÉS de 013b.
Necesita dos cuentas reales: COACH_UID y SELF_UID (crear el segundo login antes).

## 1. Sembrar un escenario two-sided sobre un atleta gestionado existente
-- Reemplazar :ATH (id de un atleta gestionado del coach), :COACH_UID, :SELF_UID.
insert into public.athlete_memberships (athlete_id, account_id, role, created_at, updated_at)
values (':ATH', ':SELF_UID', 'self',
        (extract(epoch from now())*1000)::bigint,
        (extract(epoch from now())*1000)::bigint);

## 2. Checks (correr logueado como cada cuenta vía la app o con JWT de prueba)
- [ ] Self-solo (cuenta sin memberships extra): dashboard/semana idénticos a antes de 013b.
- [ ] Coach ve las filas del atleta :ATH (sessions/day_logs/week_summaries/chat/proposals).
- [ ] SELF_UID ve las filas de :ATH (select por membresía).
- [ ] SELF_UID NO puede update de una sesión de :ATH con authored_by_role='coach'
      vía PostgREST directo (0 rows / denied).
- [ ] SELF_UID SÍ completa esa sesión vía rpc mark_session_done → status cambia,
      data conserva las claves no-whitelist, updated_by_account_id = SELF_UID.
- [ ] SELF_UID NO puede insert/update en coach_proposals / training_plans /
      training_plan_weeks de :ATH.
- [ ] SELF_UID NO puede leer NI escribir athlete_coach_notes de :ATH (tiene
      coach externo → auth_coach_note_athlete_ids() lo excluye).
- [ ] COACH_UID en su PROPIO atleta (solo membresía self, sin coach externo)
      SÍ lee y escribe su propia nota (regresión del owner actual).
- [ ] SELF_UID no ve coach_memory vía athlete_profiles (columna en NULL post-013b).
- [ ] Cross-tenant: una TERCERA cuenta sin membresía no ve ninguna fila de :ATH.
- [ ] Reparent: update sessions set athlete_id='otro' where id='...' → exception.
- [ ] readiness_daily de :ATH visible para ambos miembros (si hay data Whoop).

## 3. Limpieza del seed
delete from public.athlete_memberships
where athlete_id = ':ATH' and account_id = ':SELF_UID' and role = 'self';
```

- [ ] **Step 3: Checkpoint de commit (owner)**

Mensaje sugerido: `feat(sp1a): 013c contract diferido + smoke doc de membresías sembradas`

---

### Task 4: Tipos + Dexie v17 + test de upgrade real

**Files:**
- Modify: `src/types/index.ts` (junto a `Athlete`, ~línea 611; y `SessionBase`, línea 244)
- Modify: `src/db/db.ts` (después del bloque v15, línea ~218)
- Test: `src/db/__tests__/dbV17Upgrade.test.ts`

**Interfaces:**
- Produces (tipos exactos que consumen las Tasks 5–10):

```ts
export type MembershipRole = 'self' | 'coach'

export interface AthleteMembership {
  athleteId: string
  accountId: string
  role: MembershipRole
  createdAt: number
  updatedAt: number
}

export interface AthleteCoachNote {
  athleteId: string
  coachMemory?: string
  updatedByAccountId?: string
  updatedAt: number
}
```
- Produces: `SessionBase.authoredByRole?: MembershipRole`; stores Dexie `db.athleteMemberships` (PK compuesta `[athleteId+accountId]`) y `db.athleteCoachNotes` (PK `athleteId`).

- [ ] **Step 1: Escribir el failing test de upgrade**

```ts
// src/db/__tests__/dbV17Upgrade.test.ts
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { db } from '../db'
import type { AthleteMembership, AthleteCoachNote } from '../../types'

describe('Dexie v17 upgrade (SP1a memberships + coach notes)', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
  })

  it('preserves v16 data and adds the new stores', async () => {
    // Sembrar una DB previa (v16-shaped) con datos reales antes de abrir la v17.
    const legacy = new Dexie('EntrenadorDB')
    legacy.version(16).stores({
      sessions:       'id, date, weekStartDate, type, status, completedAt, athleteId',
      dayLogs:        'id, date, athleteId, &[athleteId+date]',
      athletes:       'id, ownerAccountId, updatedAt',
      readinessDaily: 'id, date, athleteId, source, updatedAt, &[athleteId+date+source]',
      whoopWorkouts:   'id, date, athleteId, updatedAt, &workoutId',
    })
    await legacy.open()
    await legacy.table('sessions').put({
      id: 's1', date: '2026-07-06', timeBlock: 'AM', type: 'squash', status: 'planned',
      title: 'Drills', durationMin: 60, athleteId: 'ath_u1', createdAt: 1, updatedAt: 1,
    })
    legacy.close()

    await db.open()
    expect((await db.sessions.get('s1'))?.title).toBe('Drills')

    const membership: AthleteMembership = {
      athleteId: 'ath_u1', accountId: 'u1', role: 'self', createdAt: 1, updatedAt: 1,
    }
    await db.athleteMemberships.put(membership)
    // PK compuesta: mismo par reemplaza, par distinto agrega.
    await db.athleteMemberships.put({ ...membership, updatedAt: 2 })
    await db.athleteMemberships.put({ ...membership, accountId: 'u2', role: 'coach' })
    expect(await db.athleteMemberships.count()).toBe(2)
    expect(await db.athleteMemberships.where('accountId').equals('u1').count()).toBe(1)

    const note: AthleteCoachNote = { athleteId: 'ath_u1', coachMemory: 'lefty', updatedAt: 1 }
    await db.athleteCoachNotes.put(note)
    expect((await db.athleteCoachNotes.get('ath_u1'))?.coachMemory).toBe('lefty')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/db/__tests__/dbV17Upgrade.test.ts`
Expected: FAIL — `db.athleteMemberships is undefined` (o error de tipo en compilación).

- [ ] **Step 3: Agregar tipos y schema v17**

En `src/types/index.ts`, junto a `Athlete` (~línea 611), agregar `MembershipRole`, `AthleteMembership`, `AthleteCoachNote` (bloque exacto de "Interfaces" arriba). En `SessionBase` (línea 244), después de `athleteId?`:

```ts
  authoredByRole?: MembershipRole  // D1: estampado en creación; legacy/null = 'self'
```

En `src/db/db.ts`: importar los tipos, declarar las tablas y el bloque v17:

```ts
  athleteMemberships!: Table<AthleteMembership, [string, string]>
  athleteCoachNotes!: Table<AthleteCoachNote, string>
```

```ts
    // v17 — SP1a two-sided foundation: cache pull-only de membresías (fuente
    // canónica remota: athlete_memberships) + notas de coach extraídas de
    // athleteProfiles.coachMemory (spec 2026-07-05 §3.1/§3.3).
    this.version(17).stores({
      athleteMemberships: '[athleteId+accountId], accountId, athleteId, role',
      athleteCoachNotes:  'athleteId, updatedAt',
    })
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/db/__tests__/dbV17Upgrade.test.ts`
Expected: PASS (2 stores nuevos + data v16 intacta).

- [ ] **Step 5: Suite completa + checkpoint de commit (owner)**

Run: `npm run lint && npm test && npm run build`
Mensaje sugerido: `feat(sp1a): Dexie v17 — athleteMemberships (pull-only) + athleteCoachNotes`

---

### Task 5: Cache de membresías + pull-only en sync

**Files:**
- Create: `src/services/athlete/membershipCache.ts`
- Modify: `src/services/syncUtils.ts:6` (union `SupabaseTable`)
- Modify: `src/types/syncDiagnostics.ts:51` (`ENTITY_TIER`)
- Modify: `src/services/syncService.ts` (nueva `pullMemberships`, wire en `pullRemoteAndMerge` línea ~2246)
- Test: `src/services/athlete/__tests__/membershipCache.test.ts`

**Interfaces:**
- Consumes: `AthleteMembership`, `db.athleteMemberships` (Task 4).
- Produces (firmas exactas que consumen Tasks 6–10):

```ts
export function membershipFromRemoteRow(row: Record<string, unknown>): AthleteMembership
export async function replaceMembershipCache(accountId: string, memberships: AthleteMembership[]): Promise<void>
export async function getMembershipsForAccount(accountId: string): Promise<AthleteMembership[]>
export async function getSelfMembership(accountId: string): Promise<AthleteMembership | undefined>
export async function getMembershipAthleteIds(accountId: string): Promise<string[]>
export async function getRoleForAthlete(accountId: string, athleteId: string): Promise<MembershipRole | null>
```

- [ ] **Step 1: Escribir los failing tests**

```ts
// src/services/athlete/__tests__/membershipCache.test.ts
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../../db/db'
import {
  membershipFromRemoteRow,
  replaceMembershipCache,
  getMembershipsForAccount,
  getSelfMembership,
  getMembershipAthleteIds,
  getRoleForAthlete,
} from '../membershipCache'
import type { AthleteMembership } from '../../../types'

const m = (athleteId: string, accountId: string, role: 'self' | 'coach'): AthleteMembership =>
  ({ athleteId, accountId, role, createdAt: 1, updatedAt: 1 })

describe('membershipCache', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  it('maps remote snake_case rows to AthleteMembership', () => {
    expect(membershipFromRemoteRow({
      athlete_id: 'ath_a', account_id: 'u1', role: 'coach', created_at: 5, updated_at: 9,
    })).toEqual({ athleteId: 'ath_a', accountId: 'u1', role: 'coach', createdAt: 5, updatedAt: 9 })
  })

  it('replaceMembershipCache reemplaza SOLO las filas de esa cuenta', async () => {
    await db.athleteMemberships.bulkPut([m('ath_a', 'u1', 'self'), m('ath_x', 'u2', 'self')])
    await replaceMembershipCache('u1', [m('ath_a', 'u1', 'self'), m('ath_b', 'u1', 'coach')])
    expect((await getMembershipsForAccount('u1')).map(r => r.athleteId).sort()).toEqual(['ath_a', 'ath_b'])
    expect(await getMembershipsForAccount('u2')).toHaveLength(1) // otra cuenta intacta
  })

  it('replaceMembershipCache con lista vacía limpia el cache de la cuenta', async () => {
    await db.athleteMemberships.put(m('ath_a', 'u1', 'self'))
    await replaceMembershipCache('u1', [])
    expect(await getMembershipsForAccount('u1')).toHaveLength(0)
  })

  it('getSelfMembership / getMembershipAthleteIds / getRoleForAthlete', async () => {
    await replaceMembershipCache('u1', [m('ath_a', 'u1', 'self'), m('ath_b', 'u1', 'coach')])
    expect((await getSelfMembership('u1'))?.athleteId).toBe('ath_a')
    expect((await getMembershipAthleteIds('u1')).sort()).toEqual(['ath_a', 'ath_b'])
    expect(await getRoleForAthlete('u1', 'ath_b')).toBe('coach')
    expect(await getRoleForAthlete('u1', 'ath_zzz')).toBeNull()
    expect(await getSelfMembership('u_sin_memberships')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/athlete/__tests__/membershipCache.test.ts`
Expected: FAIL — módulo `../membershipCache` no existe.

- [ ] **Step 3: Implementar `membershipCache.ts`**

```ts
// src/services/athlete/membershipCache.ts
/**
 * Cache local PULL-ONLY de athlete_memberships (fuente canónica remota, spec
 * SP1 §3.1/§4.4). El cliente nunca muta membresías: solo refleja el snapshot
 * remoto por cuenta. Un wipe local NO revoca accesos (D4).
 */
import { db } from '../../db/db'
import type { AthleteMembership, MembershipRole } from '../../types'

export function membershipFromRemoteRow(row: Record<string, unknown>): AthleteMembership {
  return {
    athleteId: row.athlete_id as string,
    accountId: row.account_id as string,
    role: row.role as MembershipRole,
    createdAt: (row.created_at as number) ?? 0,
    updatedAt: (row.updated_at as number) ?? 0,
  }
}

/** Reemplaza el snapshot local de UNA cuenta (transaccional: clear + bulkPut). */
export async function replaceMembershipCache(
  accountId: string,
  memberships: AthleteMembership[],
): Promise<void> {
  await db.transaction('rw', db.athleteMemberships, async () => {
    await db.athleteMemberships.where('accountId').equals(accountId).delete()
    const own = memberships.filter((m) => m.accountId === accountId)
    if (own.length) await db.athleteMemberships.bulkPut(own)
  })
}

export async function getMembershipsForAccount(accountId: string): Promise<AthleteMembership[]> {
  return db.athleteMemberships.where('accountId').equals(accountId).toArray()
}

export async function getSelfMembership(accountId: string): Promise<AthleteMembership | undefined> {
  const rows = await getMembershipsForAccount(accountId)
  return rows.find((m) => m.role === 'self')
}

export async function getMembershipAthleteIds(accountId: string): Promise<string[]> {
  const rows = await getMembershipsForAccount(accountId)
  return rows.map((m) => m.athleteId)
}

export async function getRoleForAthlete(
  accountId: string,
  athleteId: string,
): Promise<MembershipRole | null> {
  const row = await db.athleteMemberships.get([athleteId, accountId])
  return row?.role ?? null
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run src/services/athlete/__tests__/membershipCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Extender `SupabaseTable` + `ENTITY_TIER`**

En `src/services/syncUtils.ts:6` agregar al union:

```ts
  | 'athlete_memberships'
  | 'athlete_coach_notes'
```

En `src/types/syncDiagnostics.ts:51` agregar a `ENTITY_TIER`:

```ts
  athlete_memberships: 'B',
  athlete_coach_notes: 'B',
```

Run: `npx tsc --noEmit` (o `npm run build`) — si otro `Record<SupabaseTable, ...>` exhaustivo rompe, agregar ahí las dos claves con el valor análogo a `athlete_profiles`.

- [ ] **Step 6: `pullMemberships` en syncService, wired en `pullRemoteAndMerge`**

En `src/services/syncService.ts`, importar `membershipFromRemoteRow, replaceMembershipCache` desde `./athlete/membershipCache` y agregar (cerca de `pullAthletes`, línea ~2224):

```ts
/**
 * Pull-only del snapshot de membresías (SP1a). Tolerante a tabla ausente
 * (013b no aplicado aún): ante error deja el cache como está y el resto del
 * sync cae al modelo legacy owner/linked.
 */
export async function pullMemberships(userId: string): Promise<void> {
  if (!isEnabled()) return
  try {
    const { data, error } = await withRequestTimeout(
      getSupabase().from('athlete_memberships').select('*').eq('account_id', userId),
      'athlete_memberships.select',
    )
    if (error) throw error
    await replaceMembershipCache(userId, (data ?? []).map((row) =>
      membershipFromRemoteRow(row as Record<string, unknown>)))
  } catch (error) {
    syncLog('memberships:pull_failed', {
      error: error instanceof Error ? error.message : String(error),
    }, 'warn')
  }
}
```

(Se EXPORTA porque el bootstrap de `App.tsx` la necesita antes del backfill local — Task 6 Step 8: en un fresh device de un usuario reclamado, decidir el self con cache vacío fabricaría `ath_<uid>`.)

En `pullRemoteAndMerge` (línea ~2246), como PRIMERA operación del run (antes de `pullAthletes(userId)`):

```ts
    await pullMemberships(userId)
    await pullAthletes(userId)
```

**Importante:** las membresías NUNCA se encolan ni se pushean (pull-only, §4.4). No agregar `athlete_memberships` a ningún push/enqueue.

- [ ] **Step 7: Suite completa + checkpoint de commit (owner)**

Run: `npm run lint && npm test && npm run build`
Mensaje sugerido: `feat(sp1a): membership cache pull-only + pull en sync`

---

### Task 6: Self link-aware + claim gate + hidratación por membresías

**Files:**
- Create: `src/services/athlete/claimGate.ts`
- Modify: `src/services/athlete/hydrateActiveAthlete.ts`
- Modify: `src/services/athlete/athleteScopeMigration.ts` (gate en `backfillLocalAthleteScope`)
- Modify: `src/App.tsx:163-178` (capturar token al bootstrap; tolerar backfill `null`)
- Modify: `src/services/syncService.ts:1916` (tolerar backfill `null`)
- Test: `src/services/athlete/__tests__/claimGate.test.ts`
- Test: `src/services/athlete/__tests__/hydrateLinkAware.test.ts`

**Interfaces:**
- Consumes: `getSelfMembership` (Task 5).
- Produces:

```ts
// claimGate.ts
export function capturePendingClaimTokenFromUrl(href?: string): void
export function getPendingClaimToken(): string | null
export function clearPendingClaimToken(): void
export function isClaimPending(): boolean
```
- Cambio de contrato: `backfillLocalAthleteScope` pasa de `Promise<string>` a `Promise<string | null>` (`null` = gate de claim activo, NO se creó `ath_<uid>`). `hydrateActiveAthlete` resuelve self por membresía con fallback `ath_<uid>`.

- [ ] **Step 1: Failing tests del claim gate**

```ts
// src/services/athlete/__tests__/claimGate.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  capturePendingClaimTokenFromUrl,
  getPendingClaimToken,
  clearPendingClaimToken,
  isClaimPending,
} from '../claimGate'

describe('claimGate (D6)', () => {
  beforeEach(() => clearPendingClaimToken())

  it('sin token no hay claim pendiente', () => {
    expect(isClaimPending()).toBe(false)
    expect(getPendingClaimToken()).toBeNull()
  })

  it('captura ?claim= de la URL y persiste (sobrevive el redirect OAuth)', () => {
    capturePendingClaimTokenFromUrl('https://app.example/claim?claim=tok_abc123')
    expect(isClaimPending()).toBe(true)
    expect(getPendingClaimToken()).toBe('tok_abc123')
    // re-captura sin token en URL NO borra el persistido (post-OAuth vuelve sin query)
    capturePendingClaimTokenFromUrl('https://app.example/')
    expect(getPendingClaimToken()).toBe('tok_abc123')
  })

  it('clear libera el gate', () => {
    capturePendingClaimTokenFromUrl('https://app.example/?claim=tok_x')
    clearPendingClaimToken()
    expect(isClaimPending()).toBe(false)
  })

  it('ignora URLs inválidas sin romper', () => {
    capturePendingClaimTokenFromUrl('::::not-a-url::::')
    expect(isClaimPending()).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/athlete/__tests__/claimGate.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `claimGate.ts`**

```ts
// src/services/athlete/claimGate.ts
/**
 * Gate de secuencia claim-antes-de-bootstrap (spec SP1 §5.1/§6.2 + D6).
 * SP1a construye SOLO el punto de corte: mientras haya un token de claim
 * pendiente, el bootstrap NO crea el self default `ath_<uid>`. El redeem del
 * token (RPC) y la ruta /claim llegan en SP1b; hasta entonces el gate solo se
 * activa si alguien llega con ?claim= en la URL.
 */
const CLAIM_TOKEN_STORAGE_KEY = 'entrenador_pending_claim_token_v1'

/** Captura ?claim=<token> y lo persiste ANTES del redirect OAuth (D6). */
export function capturePendingClaimTokenFromUrl(
  href: string = typeof window !== 'undefined' ? window.location.href : '',
): void {
  try {
    const token = new URL(href).searchParams.get('claim')
    if (token && token.trim()) {
      localStorage.setItem(CLAIM_TOKEN_STORAGE_KEY, token.trim())
    }
  } catch {
    // URL inválida o storage no disponible: el gate simplemente no se activa.
  }
}

export function getPendingClaimToken(): string | null {
  try {
    return localStorage.getItem(CLAIM_TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export function clearPendingClaimToken(): void {
  try {
    localStorage.removeItem(CLAIM_TOKEN_STORAGE_KEY)
  } catch {
    // storage no disponible
  }
}

export function isClaimPending(): boolean {
  return getPendingClaimToken() !== null
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run src/services/athlete/__tests__/claimGate.test.ts`
Expected: PASS.

- [ ] **Step 5: Failing tests de hidratación link-aware + gate de backfill**

```ts
// src/services/athlete/__tests__/hydrateLinkAware.test.ts
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../../db/db'
import { hydrateActiveAthlete } from '../hydrateActiveAthlete'
import { backfillLocalAthleteScope, athleteIdForOwner } from '../athleteScopeMigration'
import { getSelfAthleteId, setActiveAthleteId, setSelfAthleteId } from '../activeAthlete'
import { replaceMembershipCache } from '../membershipCache'
import { capturePendingClaimTokenFromUrl, clearPendingClaimToken } from '../claimGate'
import { persistAthleteSelection } from '../athleteSelection'

const OWNER = 'u1'

describe('self link-aware + claim gate (SP1a §6.1/§6.2)', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    clearPendingClaimToken()
    persistAthleteSelection(OWNER, null)
  })

  it('fallback legacy: sin membresías resuelve ath_<uid> (single-athlete intacto)', async () => {
    await backfillLocalAthleteScope(OWNER)
    const active = await hydrateActiveAthlete(OWNER)
    expect(active).toBe(athleteIdForOwner(OWNER))
    expect(getSelfAthleteId()).toBe(athleteIdForOwner(OWNER))
  })

  it('con membresía self hacia OTRO atleta (reclamado), el self es ese atleta', async () => {
    const now = Date.now()
    await db.athletes.put({
      id: 'ath_claimed', ownerAccountId: 'coach_1', linkedAccountId: OWNER,
      status: 'active', createdAt: now, updatedAt: now,
    })
    await replaceMembershipCache(OWNER, [
      { athleteId: 'ath_claimed', accountId: OWNER, role: 'self', createdAt: now, updatedAt: now },
    ])
    const active = await hydrateActiveAthlete(OWNER)
    expect(active).toBe('ath_claimed')
    expect(getSelfAthleteId()).toBe('ath_claimed')
  })

  it('backfill NO crea ath_<uid> si el self por membresía apunta a otro atleta', async () => {
    const now = Date.now()
    await replaceMembershipCache(OWNER, [
      { athleteId: 'ath_claimed', accountId: OWNER, role: 'self', createdAt: now, updatedAt: now },
    ])
    const result = await backfillLocalAthleteScope(OWNER)
    expect(result).toBe('ath_claimed')
    expect(await db.athletes.get(athleteIdForOwner(OWNER))).toBeUndefined()
  })

  it('claim gate: backfill retorna null y NO crea el self default (D6)', async () => {
    capturePendingClaimTokenFromUrl('https://app.example/?claim=tok_1')
    const result = await backfillLocalAthleteScope(OWNER)
    expect(result).toBeNull()
    expect(await db.athletes.get(athleteIdForOwner(OWNER))).toBeUndefined()
  })

  it('selección persistida sigue válida si está entre mis membresías', async () => {
    const now = Date.now()
    await backfillLocalAthleteScope(OWNER)
    await db.athletes.put({
      id: 'ath_m_1', ownerAccountId: OWNER, linkedAccountId: null,
      status: 'active', createdAt: now, updatedAt: now,
    })
    await replaceMembershipCache(OWNER, [
      { athleteId: athleteIdForOwner(OWNER), accountId: OWNER, role: 'self', createdAt: now, updatedAt: now },
      { athleteId: 'ath_m_1', accountId: OWNER, role: 'coach', createdAt: now, updatedAt: now },
    ])
    persistAthleteSelection(OWNER, 'ath_m_1')
    expect(await hydrateActiveAthlete(OWNER)).toBe('ath_m_1')
  })
})
```

- [ ] **Step 6: Correr y verificar que fallan**

Run: `npx vitest run src/services/athlete/__tests__/hydrateLinkAware.test.ts`
Expected: FAIL — backfill crea `ath_<uid>` incondicional y el self no mira membresías.

- [ ] **Step 7: Implementar hidratación link-aware + gate**

`src/services/athlete/hydrateActiveAthlete.ts` — reemplazar la resolución del self (mantener el resto de la lógica de selección persistida):

```ts
import { db } from '../../db/db'
import { setActiveAthleteId, setSelfAthleteId } from './activeAthlete'
import { athleteIdForOwner } from './athleteScopeMigration'
import { getSelfMembership, getMembershipAthleteIds } from './membershipCache'
import { getPersistedAthleteSelection, persistAthleteSelection } from './athleteSelection'

/**
 * Resolve the owner's athletes and publish them to the module holders.
 *
 * SP1a (§6.1): el self se resuelve por la membresía role='self' de la cuenta
 * (cache pull-only). Fallback legacy sin membresías → `ath_<owner>` local,
 * preservando single-athlete. NO crea `ath_<uid>` cuando el self por membresía
 * apunta a otro atleta (caso reclamado, §6.2).
 *
 * Selection-aware: una selección persistida VÁLIDA se respeta. Válida =
 * (a) está entre mis membresías, o (b) legacy: fila local con owner correcto
 * y status active.
 */
export async function hydrateActiveAthlete(ownerAccountId: string): Promise<string | null> {
  const selfMembership = await getSelfMembership(ownerAccountId)
  const legacySelfRow = selfMembership
    ? null
    : await db.athletes.get(athleteIdForOwner(ownerAccountId))
  const selfId = selfMembership?.athleteId ?? legacySelfRow?.id ?? null
  setSelfAthleteId(selfId)

  const persisted = getPersistedAthleteSelection(ownerAccountId)
  if (persisted && persisted !== selfId) {
    const memberIds = await getMembershipAthleteIds(ownerAccountId)
    const row = await db.athletes.get(persisted)
    const isValid = memberIds.includes(persisted)
      || (!!row && row.ownerAccountId === ownerAccountId && row.status === 'active')
    if (isValid) {
      setActiveAthleteId(persisted)
      return persisted
    }
    persistAthleteSelection(ownerAccountId, null)
  }

  setActiveAthleteId(selfId)
  return selfId
}
```

`src/services/athlete/athleteScopeMigration.ts` — al inicio de `backfillLocalAthleteScope`, antes del `db.athletes.put`:

```ts
import { isClaimPending } from './claimGate'
import { getSelfMembership } from './membershipCache'
```

```ts
export async function backfillLocalAthleteScope(ownerAccountId: string): Promise<string | null> {
  // D6: con un claim pendiente NO se crea el self default — el redeem (SP1b)
  // debe correr antes del bootstrap para no chocar con unique(role='self').
  if (isClaimPending()) return null

  // §6.2: si el self por membresía apunta a OTRO atleta (cuenta que reclamó),
  // no fabricar ath_<uid>; el self real ya existe.
  const selfMembership = await getSelfMembership(ownerAccountId)
  if (selfMembership && selfMembership.athleteId !== athleteIdForOwner(ownerAccountId)) {
    return selfMembership.athleteId
  }

  const athleteId = athleteIdForOwner(ownerAccountId)
  // ... resto sin cambios (put + patchScopableTables + marker)
```

- [ ] **Step 8: Ajustar los callers del backfill (orden: membresías ANTES del fallback)**

**Fresh device de un usuario reclamado:** si el bootstrap decide con el cache local vacío, fabrica `ath_<uid>` local y `ensureRemoteAthleteOnce` lo UPSERTEA remoto (hoy fabrica la fila con `linkedAccountId: userId` cuando no existe local — `syncService.ts:1913-1935`). Por eso el orden es: pull de membresías → backfill → hidratación.

`src/App.tsx` — al inicio de ambos `useEffect` de athlete-scope (líneas ~163 y ~204):

```ts
import { capturePendingClaimTokenFromUrl } from './services/athlete/claimGate'
import { pullMemberships } from './services/syncService'
```

```ts
// App.tsx (ambos efectos): membresías primero (tolerante a offline/tabla
// ausente: deja el cache como esté y el backfill cae al modelo legacy).
capturePendingClaimTokenFromUrl()
await pullMemberships(userId)
if (cancelled) return
const backfilled = await backfillLocalAthleteScope(userId)
if (cancelled) return
if (backfilled !== null) {
  await hydrateActiveAthlete(userId)
  if (cancelled) return
  useAuthStore.getState().setActiveAthleteId(getActiveAthleteId())
}
```

(Offline en fresh device: `pullMemberships` no puebla nada y el backfill crea `ath_<uid>` — correcto para todo usuario legacy. El caso "usuario reclamado + fresh device + offline" queda documentado como no soportado en SP1a: el claim de SP1b requiere sesión online, y el guard remoto de abajo evita contaminar el server.)

`src/services/syncService.ts` — `ensureRemoteAthleteOnce` (línea ~1913): tolerar `null` Y no fabricar/upsertear `ath_<uid>` cuando el self real es otro atleta:

```ts
async function ensureRemoteAthleteOnce(userId: string): Promise<void> {
  if (!isEnabled()) return

  const athleteId = await backfillLocalAthleteScope(userId)
  if (athleteId === null) return   // claim gate (D6): no crear ath_<uid> ni remoto
  await hydrateActiveAthlete(userId)

  // Self reclamado (membresía apunta a un atleta que NO es ath_<uid>): la fila
  // remota ya existe y su owner es el coach — fabricarla/upsertearla acá
  // crearía un duplicado con owner equivocado.
  if (athleteId !== athleteIdForOwner(userId)) return

  const now = Date.now()
  const localAthlete = await db.athletes.get(athleteId)
  // ... resto sin cambios (fabricación + upsert onConflict id)
```

Revisar con typecheck cualquier otro caller que asuma `string` (`npx tsc --noEmit` los lista).

- [ ] **Step 9: Server-side self link-aware (Whoop, spec §1b)**

El spec exige barrer también el punto server-side que Whoop dejó resolviendo `ath_<uid>` determinístico. En `netlify/functions/_shared/__tests__/whoopSupabase.test.ts` (junto al test existente de línea ~152, usando el mismo `makeFakeDb`), agregar primero los failing tests:

```ts
  it('resolveSelfAthleteId prefiere la membresía self (SP1 §1b)', async () => {
    const db = makeFakeDb({
      athlete_memberships: [{ athlete_id: 'ath_claimed', account_id: 'u1', role: 'self' }],
      athletes: [{ id: 'ath_u1', owner_account_id: 'u1', status: 'active' }],
    })
    await expect(resolveSelfAthleteId(db, 'u1')).resolves.toBe('ath_claimed')
  })

  it('resolveSelfAthleteId cae a ath_<uid> sin membresías (legacy/pre-013b)', async () => {
    const db = makeFakeDb({
      athlete_memberships: [],
      athletes: [{ id: 'ath_u1', owner_account_id: 'u1', status: 'active' }],
    })
    await expect(resolveSelfAthleteId(db, 'u1')).resolves.toBe('ath_u1')
  })
```

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopSupabase.test.ts` → FAIL.

Luego en `netlify/functions/_shared/whoopSupabase.ts:169` reemplazar la resolución:

```ts
export async function resolveSelfAthleteId(db: WhoopDb, userId: string): Promise<string | null> {
  // SP1 §1b: la membresía role='self' es la fuente canónica; fallback legacy
  // ath_<uid>. Tolerante a tabla ausente (013b no aplicado): cae al legacy.
  try {
    const { data, error } = await table<{ athlete_id?: string }>(db, 'athlete_memberships')
      .select('athlete_id')
      .eq('account_id', userId)
      .eq('role', 'self')
      .maybeSingle()
    if (!error && data?.athlete_id) return data.athlete_id
  } catch {
    // tabla ausente / error transitorio: modelo legacy
  }
  const { data, error } = await table<{ id?: string }>(db, 'athletes')
    .select('id')
    .eq('id', `ath_${userId}`)
    .maybeSingle()
  if (error) throw new Error(`resolveSelfAthleteId: ${message(error)}`)
  return data?.id ?? null
}
```

(Si `makeFakeDb` no conoce la tabla `athlete_memberships`, extender el fake con la tabla vacía por default — mismo patrón que sus tablas existentes.)

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopSupabase.test.ts netlify/functions/_shared/__tests__/whoopSync.test.ts` → PASS (whoopSync mockea `resolveSelfAthleteId`, no cambia).

- [ ] **Step 10: Correr los tests y la suite**

Run: `npx vitest run src/services/athlete/__tests__/hydrateLinkAware.test.ts`
Expected: PASS.
Run: `npm run lint && npm test && npm run build`
Expected: verde — atención a tests existentes de `hydrateActiveAthlete`/`athleteScopeMigration` que asuman el contrato viejo; actualizarlos SOLO donde el contrato cambió de forma intencional (retorno `string | null`).

- [ ] **Step 11: Checkpoint de commit (owner)**

Mensaje sugerido: `feat(sp1a): self link-aware por membresía + claim gate pre-bootstrap`

---

### Task 7: Pull por membresías en `fetchAll`

**Files:**
- Modify: `src/services/sync/syncSupabase.ts:63-103` (`fetchAll`)
- Test: `src/services/sync/__tests__/syncSupabaseMembership.test.ts`

**Interfaces:**
- Consumes: `getMembershipAthleteIds` (Task 5).
- Produces: `fetchAll` con predicado por membresías; helper puro exportado para test:

```ts
export function buildPullFilter(
  table: SupabaseTable,
  userId: string,
  memberAthleteIds: string[],
  scope: ReadScope,
): { kind: 'or'; value: string } | { kind: 'eq_user' } | { kind: 'eq_owner' } | { kind: 'in_athletes'; value: string[] } | { kind: 'skip' }
```

- [ ] **Step 1: Failing tests del predicado**

```ts
// src/services/sync/__tests__/syncSupabaseMembership.test.ts
import { describe, it, expect } from 'vitest'
import { buildPullFilter } from '../syncSupabase'

describe('buildPullFilter (SP1a §6.3)', () => {
  it('athletes: por membresías (id, no athlete_id) + owned; sin cache cae a owner', () => {
    // Un self reclamado o un coach grant_coach NO es owner de la fila athletes:
    // el pull debe traerla por membresía o el roster/display queda vacío.
    expect(buildPullFilter('athletes', 'u1', ['ath_a', 'ath_b'], { mode: 'legacy' })).toEqual({
      kind: 'or',
      value: 'id.in.(ath_a,ath_b),owner_account_id.eq.u1',
    })
    expect(buildPullFilter('athletes', 'u1', [], { mode: 'legacy' }))
      .toEqual({ kind: 'eq_owner' })
  })

  it('con membresías: athlete_id IN (mis atletas) + legacy null del user', () => {
    expect(buildPullFilter('sessions', 'u1', ['ath_a', 'ath_b'], { mode: 'legacy' })).toEqual({
      kind: 'or',
      value: 'athlete_id.in.(ath_a,ath_b),and(athlete_id.is.null,user_id.eq.u1)',
    })
  })

  it('sin membresías cae al comportamiento actual (scope athlete)', () => {
    expect(buildPullFilter('sessions', 'u1', [], { mode: 'athlete', athleteId: 'ath_a' })).toEqual({
      kind: 'or',
      value: 'athlete_id.eq.ath_a,and(athlete_id.is.null,user_id.eq.u1)',
    })
  })

  it('sin membresías ni scope cae a user_id (legacy puro)', () => {
    expect(buildPullFilter('sessions', 'u1', [], { mode: 'legacy' }))
      .toEqual({ kind: 'eq_user' })
  })

  it('athlete_coach_notes NO tiene user_id: in por membresías, eq por scope, skip sin ambos', () => {
    expect(buildPullFilter('athlete_coach_notes', 'u1', ['ath_a'], { mode: 'legacy' }))
      .toEqual({ kind: 'in_athletes', value: ['ath_a'] })
    expect(buildPullFilter('athlete_coach_notes', 'u1', [], { mode: 'athlete', athleteId: 'ath_a' }))
      .toEqual({ kind: 'in_athletes', value: ['ath_a'] })
    expect(buildPullFilter('athlete_coach_notes', 'u1', [], { mode: 'legacy' }))
      .toEqual({ kind: 'skip' })
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/sync/__tests__/syncSupabaseMembership.test.ts`
Expected: FAIL — `buildPullFilter` no existe.

- [ ] **Step 3: Implementar `buildPullFilter` + cablearlo en `fetchAll`**

En `src/services/sync/syncSupabase.ts`:

```ts
import { getMembershipAthleteIds } from '../athlete/membershipCache'
```

```ts
/**
 * SP1a (§6.3): el pull pasa de user_id a athlete_id ∈ mis membresías (un coach
 * pullea varios atletas) manteniendo las filas legacy (athlete_id null) del
 * user. Sin cache de membresías (013b no aplicado / offline) cae EXACTAMENTE
 * al comportamiento previo — single-athlete no cambia.
 */
export function buildPullFilter(
  table: SupabaseTable,
  userId: string,
  memberAthleteIds: string[],
  scope: ReadScope,
):
  | { kind: 'or'; value: string }
  | { kind: 'eq_user' }
  | { kind: 'eq_owner' }
  | { kind: 'in_athletes'; value: string[] }
  | { kind: 'skip' } {
  if (table === 'athletes') {
    // PK es `id`, no athlete_id. Con membresías: mis atletas + los que ownneo
    // (roster completo aunque aún no tenga membresía backfilleada local).
    return memberAthleteIds.length > 0
      ? { kind: 'or', value: `id.in.(${memberAthleteIds.join(',')}),owner_account_id.eq.${userId}` }
      : { kind: 'eq_owner' }
  }
  if (table === 'athlete_coach_notes') {
    // No tiene columna user_id: solo predicados por athlete_id.
    if (memberAthleteIds.length > 0) return { kind: 'in_athletes', value: memberAthleteIds }
    if (scope.mode === 'athlete') return { kind: 'in_athletes', value: [scope.athleteId] }
    return { kind: 'skip' }
  }
  if (memberAthleteIds.length > 0) {
    return {
      kind: 'or',
      value: `athlete_id.in.(${memberAthleteIds.join(',')}),and(athlete_id.is.null,user_id.eq.${userId})`,
    }
  }
  if (scope.mode === 'athlete') {
    return {
      kind: 'or',
      value: `athlete_id.eq.${scope.athleteId},and(athlete_id.is.null,user_id.eq.${userId})`,
    }
  }
  return { kind: 'eq_user' }
}
```

En `fetchAll`, reemplazar la construcción del `query`:

```ts
export async function fetchAll<T>(
  table: SupabaseTable,
  userId: string,
  scope: ReadScope = resolveReadScope(),
): Promise<T[]> {
  const rows: T[] = []
  const memberAthleteIds = await getMembershipAthleteIds(userId)
  const filter = buildPullFilter(table, userId, memberAthleteIds, scope)
  if (filter.kind === 'skip') return rows

  for (let from = 0; ; from += FETCH_PAGE_SIZE) {
    const to = from + FETCH_PAGE_SIZE - 1
    const base = getSupabase()
      .from(table)
      .select('*')
    const query =
      filter.kind === 'eq_owner' ? base.eq('owner_account_id', userId)
      : filter.kind === 'in_athletes' ? base.in('athlete_id', filter.value)
      : filter.kind === 'or' ? base.or(filter.value)
      : base.eq('user_id', userId)
    // ... resto del loop de paginación sin cambios
```

- [ ] **Step 4: `pullAthletes` directo también por membresías**

`pullAthletes` (`src/services/syncService.ts:2224`) NO usa `fetchAll`: hace su propia query `.eq('owner_account_id', userId)`. Aplicarle el mismo predicado:

```ts
import { getMembershipAthleteIds } from './athlete/membershipCache'
```

```ts
  const memberIds = await getMembershipAthleteIds(userId)
  const base = getSupabase().from('athletes').select('*')
  const query = memberIds.length > 0
    ? base.or(`id.in.(${memberIds.join(',')}),owner_account_id.eq.${userId}`)
    : base.eq('owner_account_id', userId)
```

(reemplaza solo la construcción de la query; el merge local de filas `athletes` no cambia. Ojo: las filas traídas por membresía tienen `ownerAccountId` de OTRO usuario — verificar que el merge local de `pullAthletes` no las descarte ni las re-pushee: `pushAthlete` ya guarda `ownerAccountId !== userId` → no push. Si el merge filtra por owner, quitar ese filtro para filas cuyo id ∈ memberIds.)

- [ ] **Step 5: Correr y verificar que pasan + suite**

Run: `npx vitest run src/services/sync/__tests__/syncSupabaseMembership.test.ts`
Expected: PASS.
Run: `npm test` — los tests de sync existentes deben seguir verdes (cache de membresías vacío en ellos ⇒ comportamiento idéntico).

- [ ] **Step 6: Checkpoint de commit (owner)**

Mensaje sugerido: `feat(sp1a): pull remoto por membresías con fallback legacy`

---

### Task 8: `authoredByRole` + ruteo `session_completion` vía RPC

**Files:**
- Create: `src/services/sync/sessionCompletion.ts`
- Modify: `src/types/index.ts` (ya tiene `authoredByRole` de Task 4 — sin cambios acá)
- Modify: `src/services/athlete/activeScopeFilter.ts` (nuevo `resolveAuthoredByRole`)
- Modify: `src/store/useTrainingStore.ts:140` (stamp en `addSession`)
- Modify: `src/services/planBuilder/commitPlan.ts:69` (stamp en sesiones del plan)
- Modify: `src/services/syncService.ts` (`sessionToRow:1312`, `rowToSession:1486`, `pushSession:1968`, drainQueue rama nueva ~línea 944)
- Modify: `src/services/syncUtils.ts:307` (`OfflineOp.action`)
- Test: `src/services/sync/__tests__/sessionCompletion.test.ts`

**Interfaces:**
- Consumes: `getRoleForAthlete` (Task 5), `getSelfAthleteId` (existente), `MembershipRole` (Task 4).
- Produces:

```ts
// activeScopeFilter.ts
export function resolveAuthoredByRole(athleteId: string | undefined): MembershipRole

// sessionCompletion.ts
export interface MarkSessionDoneParams {
  p_session_id: string
  p_status: Session['status']
  p_updated_at: number
  p_completed_at: number | null
  p_actual_rpe: number | null
  p_actual_duration_min: number | null
  p_completion_notes: string | null
  p_session_feedback: Record<string, unknown> | null
}
export function buildMarkSessionDoneParams(session: Session): MarkSessionDoneParams
export async function shouldRouteSessionCompletionViaRpc(session: Session, accountId: string): Promise<boolean>
```
- Produces: `OfflineOp.action` extendido a `'upsert' | 'delete' | 'session_completion'`; `sessionToRow` emite `authored_by_role` y `updated_by_account_id` como columnas (fuera de `data`); `rowToSession` las mapea de vuelta.

- [ ] **Step 1: Failing tests**

```ts
// src/services/sync/__tests__/sessionCompletion.test.ts
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../../db/db'
import { buildMarkSessionDoneParams, shouldRouteSessionCompletionViaRpc } from '../sessionCompletion'
import { resolveAuthoredByRole } from '../../athlete/activeScopeFilter'
import { setSelfAthleteId, setActiveAthleteId } from '../../athlete/activeAthlete'
import { replaceMembershipCache } from '../../athlete/membershipCache'
import type { Session } from '../../../types'

const baseSession = (over: Partial<Session>): Session => ({
  id: 's1', date: '2026-07-06', timeBlock: 'AM', type: 'squash', status: 'completed',
  title: 'Match play', durationMin: 60, createdAt: 1, updatedAt: 99,
  athleteId: 'ath_managed', authoredByRole: 'coach',
  completedAt: 50, actualRpe: 7, actualDurationMin: 55,
  completionNotes: 'buen ritmo', sessionFeedback: undefined,
  ...over,
} as Session)

describe('resolveAuthoredByRole (D1)', () => {
  it('self athlete -> self; otro atleta -> coach; sin holders -> self', () => {
    setSelfAthleteId('ath_self')
    expect(resolveAuthoredByRole('ath_self')).toBe('self')
    expect(resolveAuthoredByRole('ath_managed')).toBe('coach')
    setSelfAthleteId(null)
    expect(resolveAuthoredByRole('ath_managed')).toBe('self')
    expect(resolveAuthoredByRole(undefined)).toBe('self')
  })
})

describe('buildMarkSessionDoneParams (whitelist D2)', () => {
  it('extrae SOLO la whitelist con nulls explícitos para clears', () => {
    expect(buildMarkSessionDoneParams(baseSession({ sessionFeedback: undefined }))).toEqual({
      p_session_id: 's1',
      p_status: 'completed',
      p_updated_at: 99,
      p_completed_at: 50,
      p_actual_rpe: 7,
      p_actual_duration_min: 55,
      p_completion_notes: 'buen ritmo',
      p_session_feedback: null,
    })
  })

  it('des-completar manda nulls (el RPC borra las claves)', () => {
    const params = buildMarkSessionDoneParams(baseSession({
      status: 'planned', completedAt: undefined, actualRpe: undefined,
      actualDurationMin: undefined, completionNotes: undefined,
    }))
    expect(params.p_status).toBe('planned')
    expect(params.p_completed_at).toBeNull()
    expect(params.p_actual_rpe).toBeNull()
  })
})

describe('shouldRouteSessionCompletionViaRpc (D2)', () => {
  beforeEach(async () => {
    db.close(); await db.delete(); await db.open()
    setSelfAthleteId(null); setActiveAthleteId(null)
  })

  it('self member (no coach) + sesión coach-authored -> RPC', async () => {
    await replaceMembershipCache('u1', [
      { athleteId: 'ath_managed', accountId: 'u1', role: 'self', createdAt: 1, updatedAt: 1 },
    ])
    expect(await shouldRouteSessionCompletionViaRpc(baseSession({}), 'u1')).toBe(true)
  })

  it('coach member -> upsert normal aunque sea coach-authored', async () => {
    await replaceMembershipCache('u1', [
      { athleteId: 'ath_managed', accountId: 'u1', role: 'coach', createdAt: 1, updatedAt: 1 },
    ])
    expect(await shouldRouteSessionCompletionViaRpc(baseSession({}), 'u1')).toBe(false)
  })

  it('sesión self-authored o sin membresías (legacy) -> upsert normal', async () => {
    expect(await shouldRouteSessionCompletionViaRpc(
      baseSession({ authoredByRole: 'self' }), 'u1')).toBe(false)
    expect(await shouldRouteSessionCompletionViaRpc(baseSession({}), 'u1')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/sync/__tests__/sessionCompletion.test.ts`
Expected: FAIL — módulos/funciones no existen.

- [ ] **Step 3: Implementar `resolveAuthoredByRole` + `sessionCompletion.ts`**

En `src/services/athlete/activeScopeFilter.ts` (junto a `withActiveAthleteStamp`):

```ts
import type { MembershipRole } from '../../types'
import { getSelfAthleteId } from './activeAthlete'
```

```ts
/**
 * D1: autoría estampada en creación, derivada de los holders (sin lookup async).
 * Mismo criterio que el backfill 013b: sesión de un atleta que NO es mi self
 * (gestionado u operado como coach) nace 'coach'; todo lo demás 'self'.
 */
export function resolveAuthoredByRole(athleteId: string | undefined): MembershipRole {
  const self = getSelfAthleteId()
  if (!athleteId || !self) return 'self'
  return athleteId === self ? 'self' : 'coach'
}
```

`src/services/sync/sessionCompletion.ts`:

```ts
/**
 * Ruteo de completación coach-authored (spec SP1 §4.3 + D2): el self NUNCA
 * upsertea la fila entera de una sesión coach-authored — va por RPC
 * mark_session_done con whitelist exacta, incluso offline (op discriminada).
 */
import type { Session } from '../../types'
import { getRoleForAthlete } from '../athlete/membershipCache'

export interface MarkSessionDoneParams {
  p_session_id: string
  p_status: Session['status']
  p_updated_at: number
  p_completed_at: number | null
  p_actual_rpe: number | null
  p_actual_duration_min: number | null
  p_completion_notes: string | null
  p_session_feedback: Record<string, unknown> | null
}

/** Whitelist exacta (D2): claves camelCase de data + status. Null = clear en el RPC. */
export function buildMarkSessionDoneParams(session: Session): MarkSessionDoneParams {
  return {
    p_session_id: session.id,
    p_status: session.status,
    p_updated_at: session.updatedAt,
    p_completed_at: session.completedAt ?? null,
    p_actual_rpe: session.actualRpe ?? null,
    p_actual_duration_min: session.actualDurationMin ?? null,
    p_completion_notes: session.completionNotes ?? null,
    p_session_feedback: (session.sessionFeedback as Record<string, unknown> | undefined) ?? null,
  }
}

/**
 * RPC solo cuando: la sesión es coach-authored, tengo membresía sobre su
 * atleta y mi rol NO es coach. Sin cache (legacy/013b no aplicado) → upsert
 * normal, igual que hoy.
 */
export async function shouldRouteSessionCompletionViaRpc(
  session: Session,
  accountId: string,
): Promise<boolean> {
  if (session.authoredByRole !== 'coach') return false
  if (!session.athleteId) return false
  const role = await getRoleForAthlete(accountId, session.athleteId)
  return role === 'self'
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run src/services/sync/__tests__/sessionCompletion.test.ts`
Expected: PASS.

- [ ] **Step 5: Estampar en creación + mapear en sync**

`src/store/useTrainingStore.ts:140` (`addSession`):

```ts
import { withActiveAthleteStamp, resolveAuthoredByRole } from '../services/athlete/activeScopeFilter'
```

```ts
    const stamped = withActiveAthleteStamp<Session>({
      ...partial, weekStartDate, id: uuid(), createdAt: now, updatedAt: now,
    })
    const session: Session = { ...stamped, authoredByRole: resolveAuthoredByRole(stamped.athleteId) }
```

`src/services/planBuilder/commitPlan.ts:69` — donde se hace `db.sessions.put(session)`, estampar antes del put (mismo patrón: si la sesión ya trae `authoredByRole`, respetarlo):

```ts
      const authored = session.authoredByRole ?? resolveAuthoredByRole(session.athleteId)
      await db.sessions.put({ ...session, authoredByRole: authored })
```

`src/services/syncService.ts` — `sessionToRow` (línea 1312): sacar `authoredByRole` de `data` y emitir columnas (red de seguridad: derivar si falta):

```ts
function sessionToRow(session: Session, userId: string): Record<string, unknown> {
  const { id, date, timeBlock, type, status, createdAt, updatedAt, authoredByRole, ...rest } = session
  return {
    id,
    user_id: userId,
    date,
    time_block: timeBlock,
    type,
    status,
    created_at: createdAt,
    updated_at: updatedAt,
    authored_by_role: authoredByRole ?? resolveAuthoredByRole(session.athleteId),
    updated_by_account_id: userId,
    data: rest,
  }
}
```

(importar `resolveAuthoredByRole` desde `./athlete/activeScopeFilter`; NO enviar `created_by_account_id` — lo setea el default `auth.uid()` en insert y no se pisa en updates.)

**Provenance en el resto de los row builders (§3.4 completo):** mismo patrón en `dayLogToRow` (línea ~1501), `weekSummaryToRow` y `athleteProfileToRow` — agregar `updated_by_account_id: userId` al objeto retornado (los tres ya reciben `userId`). Ejemplo con `dayLogToRow`:

```ts
function dayLogToRow(log: DayLog, userId: string): Record<string, unknown> {
  const { id, date, updatedAt, ...rest } = log
  return {
    id,
    user_id: userId,
    date,
    updated_at: updatedAt,
    updated_by_account_id: userId,
    data: rest,
  }
}
```

(Los merges `rowToX` NO mapean provenance de vuelta en SP1a: la UI que distingue autoría es SP2 — spec §6.4.)

`rowToSession` (línea 1486) — mapear de vuelta, sin dejar que `data` la duplique:

```ts
    ...data,
    athleteId: getRowAthleteId(row, data),
    authoredByRole: (row.authored_by_role ?? data.authoredByRole ?? undefined) as Session['authoredByRole'],
```

**Contrato de deploy (SQL-first estricto):** este bundle ASUME `013b` aplicado en cualquier entorno contra el que sincronice (dev y prod) — mismo precedente que `010` (migración antes del deploy). Sin `013b`, el upsert de sessions con `authored_by_role`/`updated_by_account_id` cae en schema mismatch (`schemaMismatchBlockedTables`, `syncService.ts:468`) y el push de sessions queda bloqueado: NO es un modo soportado. Las tolerancias a tabla ausente (`pullMemberships`, `mergeCoachNotes`, `buildPullFilter` con cache vacío) son defensa en profundidad para ventanas de error operativo, no un modo de operación. El smoke "pre-013b" de Task 11 corre con sync deshabilitado o contra una DB dev YA migrada.

- [ ] **Step 6: Ruteo en `pushSession` + rama `session_completion` en drainQueue**

`src/services/syncUtils.ts:307`:

```ts
  action: 'upsert' | 'delete' | 'session_completion'
```

`src/services/syncService.ts` — `pushSession` (línea 1968):

```ts
import { buildMarkSessionDoneParams, shouldRouteSessionCompletionViaRpc } from './sync/sessionCompletion'
```

```ts
export async function pushSession(session: Session): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  if (await shouldRouteSessionCompletionViaRpc(session, userId)) {
    await pushSessionCompletion(session, userId)
    return
  }
  await upsertRow('sessions', withAthleteId(sessionToRow(session, userId), session.athleteId))
}

/** D2: completación coach-authored por el self — RPC, nunca upsert de fila. */
async function pushSessionCompletion(session: Session, userId: string): Promise<void> {
  if (!isEnabled()) return
  const payload = buildMarkSessionDoneParams(session) as unknown as Record<string, unknown>
  if (!navigator.onLine) {
    enqueue({ userId, table: 'sessions', action: 'session_completion', payload, enqueuedAt: Date.now() })
    scheduleRetry(15000)
    return
  }
  try {
    const { data, error } = await withRequestTimeout(
      getSupabase().rpc('mark_session_done', payload as never),
      'sessions.mark_session_done',
    )
    if (error) throw error
    if (data !== true) {
      // false = stale (LWW: remoto más nuevo), inexistente o sin membresía.
      // Op consumida: NO reintentar (el próximo pull trae la verdad remota).
      syncLog('sessions:mark_done_skipped', { sessionId: session.id }, 'warn')
    }
  } catch (error) {
    const errorInfo = classifySyncError(error, 'sessions')
    if (!errorInfo.retriable && !errorInfo.autoRepairable) {
      applySyncFailure(error, errorInfo.userMessage, 'sessions')
      return
    }
    enqueue({ userId, table: 'sessions', action: 'session_completion', payload, enqueuedAt: Date.now() })
    applySyncFailure(error, 'No se pudo sincronizar la completación de la sesión.', 'sessions')
  }
}
```

En drainQueue (rama de acciones, `syncService.ts` ~línea 944) — convertir el `if (op.action === 'upsert') { ... } else { ...delete }` en tres ramas, agregando ANTES del else de delete:

```ts
        } else if (op.action === 'session_completion') {
          const { data, error } = await withRequestTimeout(
            getSupabase().rpc('mark_session_done', op.payload as never),
            'sessions.mark_session_done',
          )
          if (error) throw error
          if (data !== true) {
            // Stale/inaccesible: op consumida sin retry (LWW — remoto gana).
            syncLog('sessions:mark_done_skipped', {
              sessionId: op.payload.p_session_id ?? null,
            }, 'warn')
          }
        } else {
```

Y ajustar los `trackSyncEvent` que hoy mapean `op.action === 'upsert' ? 'push' : 'delete'` a:

```ts
        kind: op.action === 'delete' ? 'delete' : 'push',
```

(aparece 2 veces en drainQueue: éxito y expiración — buscar `op.action === 'upsert' ? 'push' : 'delete'`).

**Identidad de cola para ops sin `payload.id`:** la compactación/limpieza de la cola identifica entidades vía `getOfflineOpEntityId` (`syncUtils.ts:842`) y la extracción local de `clearQueuedOpsForEntityOlderThan` (`syncQueue.ts:~119`), ambas basadas en `payload.id`. Los payloads nuevos no lo tienen (`p_session_id` en completions, `athlete_id` en notas) → sin fix, `shouldReplaceQueuedOp` nunca compacta y la limpieza post-push es no-op (cola con duplicados). Fix centralizado:

```ts
// syncUtils.ts — reemplazar getOfflineOpEntityId:
export function getOfflineOpEntityId(op: OfflineOp): string | null {
  return getEntityIdFromPayload(op.table, op.payload)
}

/** Identidad de entidad por payload: id normal, p_session_id (completions RPC),
 *  athlete_id (athlete_coach_notes, PK natural). */
export function getEntityIdFromPayload(
  table: SupabaseTable,
  payload: Record<string, unknown>,
): string | null {
  const id = payload.id
  if (typeof id === 'string' && id.length > 0) return id
  const sessionId = payload.p_session_id
  if (typeof sessionId === 'string' && sessionId.length > 0) return sessionId
  if (table === 'athlete_coach_notes') {
    const athleteId = payload.athlete_id
    if (typeof athleteId === 'string' && athleteId.length > 0) return athleteId
  }
  return null
}
```

En `clearQueuedOpsForEntityOlderThan` (`syncQueue.ts`), reemplazar la extracción local de `entityId` por `getEntityIdFromPayload(table, payload)`. En `shouldReplaceQueuedOp` (`syncUtils.ts:~828`), permitir que una completion nueva reemplace a una vieja de la misma sesión:

```ts
  if (incoming.action === 'delete') {
    return true
  }
  if (incoming.action === 'session_completion') {
    return existing.action === 'session_completion' || existing.action === 'upsert'
  }
  return existing.action === 'upsert'
```

Tests: en `src/services/sync/__tests__/sessionCompletion.test.ts` agregar casos de `getEntityIdFromPayload`:

```ts
import { getEntityIdFromPayload } from '../../syncUtils'

describe('getEntityIdFromPayload (identidad de cola)', () => {
  it('id normal, p_session_id para completions, athlete_id para notas', () => {
    expect(getEntityIdFromPayload('sessions', { id: 's1' })).toBe('s1')
    expect(getEntityIdFromPayload('sessions', { p_session_id: 's1', p_status: 'completed' })).toBe('s1')
    expect(getEntityIdFromPayload('athlete_coach_notes', { athlete_id: 'ath_a', coach_memory: 'x' })).toBe('ath_a')
    expect(getEntityIdFromPayload('day_logs', { date: '2026-07-06' })).toBeNull()
  })
})
```

- [ ] **Step 7: Suite completa**

Run: `npm run lint && npm test && npm run build`
Expected: verde. Los tests existentes de `syncService` no cambian de resultado (sin membresías cacheadas, el ruteo RPC nunca se activa).

- [ ] **Step 8: Checkpoint de commit (owner)**

Mensaje sugerido: `feat(sp1a): authoredByRole estampado + completación coach-authored vía RPC`

---

### Task 9: Extracción de `coachMemory` → `athleteCoachNotes` (local + store + sync + callers)

**Files:**
- Create: `src/services/athlete/coachNotes.ts`
- Modify: `src/store/useCoachMemoryStore.ts`
- Modify: `src/services/syncService.ts` (nueva `pushCoachNote` + `mergeCoachNotes` en `pullRemoteAndMerge` línea ~2270)
- Modify: `src/store/useTrainingStore.ts:286` (`generateCoachNote`)
- Modify: `src/services/weekCreator/WeekCreatorPromptBuilder.ts:78`
- Test: `src/services/athlete/__tests__/coachNotes.test.ts`

**Interfaces:**
- Consumes: `db.athleteCoachNotes`, `AthleteCoachNote` (Task 4), `getActiveAthleteId` (existente), `fetchAll` con soporte `athlete_coach_notes` (Task 7).
- Produces:

```ts
// coachNotes.ts
export async function getActiveCoachNote(): Promise<AthleteCoachNote | undefined>
export async function upsertActiveCoachNote(coachMemory: string | undefined): Promise<AthleteCoachNote | null>
export async function getCoachMemoryText(): Promise<string | undefined>
```
- Contrato de transición: **lectura dual** (nota nueva primero, fallback `athleteProfile.coachMemory` legacy); **escritura solo** a la tabla nueva. `athlete_profiles.coach_memory` remoto queda como legado congelado hasta `013c`.

- [ ] **Step 1: Failing tests**

```ts
// src/services/athlete/__tests__/coachNotes.test.ts
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../../db/db'
import { getActiveCoachNote, upsertActiveCoachNote, getCoachMemoryText } from '../coachNotes'
import { setActiveAthleteId, setSelfAthleteId, ATHLETE_PROFILE_LOCAL_ID } from '../activeAthlete'

describe('coachNotes (extracción §3.3 + D3)', () => {
  beforeEach(async () => {
    db.close(); await db.delete(); await db.open()
    setSelfAthleteId('ath_u1')
    setActiveAthleteId('ath_u1')
  })

  it('upsert + get por atleta activo', async () => {
    const saved = await upsertActiveCoachNote('  zurdo, cuidar hombro  ')
    expect(saved?.athleteId).toBe('ath_u1')
    expect(saved?.coachMemory).toBe('zurdo, cuidar hombro')
    expect((await getActiveCoachNote())?.coachMemory).toBe('zurdo, cuidar hombro')
  })

  it('nota del atleta activo, no del self: las notas son POR ATLETA (D3)', async () => {
    await upsertActiveCoachNote('nota self')
    setActiveAthleteId('ath_managed')
    expect(await getActiveCoachNote()).toBeUndefined()
    await upsertActiveCoachNote('nota gestionado')
    expect((await getActiveCoachNote())?.coachMemory).toBe('nota gestionado')
    setActiveAthleteId('ath_u1')
    expect((await getActiveCoachNote())?.coachMemory).toBe('nota self')
  })

  it('sin atleta activo (pre-hidratación) el upsert devuelve null y no escribe', async () => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    expect(await upsertActiveCoachNote('x')).toBeNull()
    expect(await db.athleteCoachNotes.count()).toBe(0)
  })

  it('getCoachMemoryText: dual-read — nota nueva primero, fallback profile legacy', async () => {
    await db.athleteProfiles.put({
      id: ATHLETE_PROFILE_LOCAL_ID, athleteId: 'ath_u1',
      coachMemory: 'legacy memory', updatedAt: 1,
    } as never)
    expect(await getCoachMemoryText()).toBe('legacy memory')
    await upsertActiveCoachNote('nueva memory')
    expect(await getCoachMemoryText()).toBe('nueva memory')
  })

  it('vaciar la nota (undefined) prevalece sobre el legacy (no resucita)', async () => {
    await db.athleteProfiles.put({
      id: ATHLETE_PROFILE_LOCAL_ID, athleteId: 'ath_u1',
      coachMemory: 'legacy memory', updatedAt: 1,
    } as never)
    await upsertActiveCoachNote('algo')
    await upsertActiveCoachNote(undefined)
    expect(await getCoachMemoryText()).toBeUndefined()
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/athlete/__tests__/coachNotes.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `coachNotes.ts`**

```ts
// src/services/athlete/coachNotes.ts
/**
 * athlete_coach_notes local (spec SP1 §3.3, extracción de coachMemory).
 * D3: la nota es POR ATLETA (compartida entre coaches), no por coach.
 * Transición: lectura dual (nota nueva → fallback athleteProfile.coachMemory
 * legacy); escritura SOLO acá. El coach_memory remoto de athlete_profiles
 * queda congelado hasta 013c.
 */
import { db } from '../../db/db'
import type { AthleteCoachNote } from '../../types'
import { getActiveAthleteId } from './activeAthlete'
import { getAthleteProfile } from '../../db/queries'

export async function getActiveCoachNote(): Promise<AthleteCoachNote | undefined> {
  const athleteId = getActiveAthleteId()
  if (!athleteId) return undefined
  return db.athleteCoachNotes.get(athleteId)
}

/** Escribe la nota del atleta ACTIVO. Sin atleta hidratado no escribe (null). */
export async function upsertActiveCoachNote(
  coachMemory: string | undefined,
): Promise<AthleteCoachNote | null> {
  const athleteId = getActiveAthleteId()
  if (!athleteId) return null
  const trimmed = coachMemory?.trim() || undefined
  const note: AthleteCoachNote = { athleteId, coachMemory: trimmed, updatedAt: Date.now() }
  await db.athleteCoachNotes.put(note)
  return note
}

/**
 * Dual-read de transición: si existe fila de nota (aunque esté vacía), manda;
 * si no hay fila, cae al coachMemory legacy del perfil.
 */
export async function getCoachMemoryText(): Promise<string | undefined> {
  const note = await getActiveCoachNote()
  if (note) return note.coachMemory || undefined
  const profile = await getAthleteProfile()
  return profile?.coachMemory || undefined
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run src/services/athlete/__tests__/coachNotes.test.ts`
Expected: PASS.

- [ ] **Step 5: Sync — `pushCoachNote` + `mergeCoachNotes`**

En `src/services/syncService.ts`:

```ts
import { getActiveCoachNote } from './athlete/coachNotes'
import type { AthleteCoachNote } from '../types'
```

```ts
function coachNoteToRow(note: AthleteCoachNote, userId: string): Record<string, unknown> {
  return {
    athlete_id: note.athleteId,
    coach_memory: note.coachMemory ?? null,
    updated_by_account_id: userId,
    updated_at: note.updatedAt,
  }
}

export async function pushCoachNote(note: AthleteCoachNote): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  await upsertRow('athlete_coach_notes', coachNoteToRow(note, userId))
}

/**
 * Merge LWW de athlete_coach_notes (bidireccional, §6.3). Tolerante a tabla
 * ausente pre-013b: fetchAll devuelve [] (skip) o el catch loguea y sigue.
 */
async function mergeCoachNotes(userId: string, context: MergeContext): Promise<void> {
  let remoteRows: Record<string, unknown>[]
  try {
    remoteRows = await fetchAll<Record<string, unknown>>('athlete_coach_notes', userId, context.readScope)
  } catch (error) {
    syncLog('coach_notes:pull_failed', {
      error: error instanceof Error ? error.message : String(error),
    }, 'warn')
    return
  }
  for (const row of remoteRows) {
    const remote: AthleteCoachNote = {
      athleteId: row.athlete_id as string,
      coachMemory: (row.coach_memory as string | null) ?? undefined,
      updatedByAccountId: (row.updated_by_account_id as string | null) ?? undefined,
      updatedAt: (row.updated_at as number) ?? 0,
    }
    const local = await db.athleteCoachNotes.get(remote.athleteId)
    if (!local || remote.updatedAt > local.updatedAt) {
      await db.athleteCoachNotes.put(remote)
    } else if (local.updatedAt > remote.updatedAt) {
      context.pendingWrites.push(() => pushCoachNote(local))
    }
  }
}
```

En `pullRemoteAndMerge` (línea ~2270), dentro del `Promise.all` de merges, agregar:

```ts
      mergeCoachNotes(userId, mergeContext),
```

**Nota de RLS:** la policy `athlete_coach_notes_write` usa `auth_coach_note_athlete_ids()` (coach ∪ self-sin-coach-externo): el owner actual escribe/lee su propia memoria sin fricción; un self reclamado CON coach externo no puede leer ni escribir la nota — su push sería rechazado y su pull no trae filas (la nota simplemente no existe para él, coherente con D4). El `upsertRow` existente ya encola/clasifica el error de rechazo.

- [ ] **Step 6: Store — `useCoachMemoryStore` lee/escribe la nota**

`src/store/useCoachMemoryStore.ts` — cambiar `loadMemory` y `saveMemory` (dejar `saveAthleteProfile` como está, salvo que YA NO toque coachMemory):

```ts
import { getCoachMemoryText, upsertActiveCoachNote } from '../services/athlete/coachNotes'
```

```ts
  loadMemory: async () => {
    const requestId = ++latestMemoryLoadRequestId
    const [profile, memoryText] = await Promise.all([getAthleteProfile(), getCoachMemoryText()])
    if (requestId !== latestMemoryLoadRequestId) return
    set({ coachMemory: memoryText ?? '', athleteProfile: profile ?? null, hasLoaded: true, lastLoadedAt: Date.now() })
  },

  saveMemory: async (coachMemory) => {
    const requestId = ++latestMemoryLoadRequestId
    set({ isSaving: true })
    try {
      if (!syncService.canWriteAthleteProfileLocally('automatic')) {
        set({ isSaving: false })
        return
      }
      // Extracción §3.3: la memoria del coach vive en athlete_coach_notes.
      // athleteProfile.coachMemory queda como legado congelado (dual-read).
      const note = await upsertActiveCoachNote(coachMemory)
      if (note) void syncService.pushCoachNote(note)
      if (requestId !== latestMemoryLoadRequestId) return
      set({ coachMemory: note?.coachMemory ?? '', isSaving: false, hasLoaded: true, lastLoadedAt: Date.now() })
    } catch (error) {
      if (requestId === latestMemoryLoadRequestId) set({ isSaving: false })
      throw error
    }
  },
```

En `saveAthleteProfile`, la línea final que setea `coachMemory: profile.coachMemory ?? ''` debe dejar de pisar la memoria con el perfil:

```ts
      set({ athleteProfile: profile, isSaving: false, hasLoaded: true, lastLoadedAt: Date.now() })
```

- [ ] **Step 7: Callers que leían `athleteProfile?.coachMemory` directo**

`src/store/useTrainingStore.ts:286` (`generateCoachNote`): agregar `getCoachMemoryText` al `Promise.all` existente y usarlo:

```ts
import { getCoachMemoryText } from '../services/athlete/coachNotes'
```

```ts
      const [sessions, weekDayLogs, currentWeekSummary, athleteProfile, coachMemoryText] = await Promise.all([
        getSessionsForWeek(weekStart),
        getDayLogsForWeek(weekStart),
        getWeekSummary(weekStart),
        getAthleteProfile(),
        getCoachMemoryText(),
      ])
```

y en el contexto:

```ts
          athleteMemory: coachMemoryText,
```

`src/services/weekCreator/WeekCreatorPromptBuilder.ts:78` — este builder recibe `profile`; NO hacerlo async por dentro: cambiar su firma para recibir la memoria ya resuelta. Localizar el caller del builder (grep `WeekCreatorPromptBuilder`), resolver `await getCoachMemoryText()` ahí y pasarla como parámetro `coachMemoryText?: string`, reemplazando en la línea 78:

```ts
    coachMemoryText?.trim() ? `## MEMORIA DEL COACH\n${coachMemoryText.trim()}` : '',
```

`src/pages/ChatCoach.tsx` ya lee `coachMemory` del store (línea 99/205) — con el store migrado queda correcto sin cambios. `src/pages/SettingsPage.tsx` ídem (draft sobre `coachMemory` del store; su `loadMemory()` post-clear en línea ~324 no cambia).

El clear selectivo del grupo coachMemory vive en `src/services/appMaintenance.ts:128` — hoy hace `db.athleteProfiles.clear()` (todos los perfiles). Extenderlo con la misma semántica de grupo (todas las notas) y agregar `db.athleteCoachNotes` a la lista de tablas de la transacción `rw` de `clearSelectedLocalAppData`:

```ts
      if (selection.coachMemory) {
        await db.athleteProfiles.clear()
        await db.athleteCoachNotes.clear()
      }
```

- [ ] **Step 8: Suite completa**

Run: `npm run lint && npm test && npm run build`
Expected: verde. Revisar tests existentes de `useCoachMemoryStore`/Settings que asuman escritura de coachMemory en el perfil; actualizarlos al contrato nuevo (escritura en nota) manteniendo las aserciones de gating (`canWriteAthleteProfileLocally`) intactas.

- [ ] **Step 9: Checkpoint de commit (owner)**

Mensaje sugerido: `feat(sp1a): coachMemory extraído a athlete_coach_notes con dual-read`

---

### Task 10: Lifecycle D4 — export/import/wipe

**Files:**
- Create: `src/services/athlete/coachNoteExportPolicy.ts`
- Modify: `src/services/dataExport.ts` (tablas del backup, líneas ~104/134/179; import ~295-390)
- Modify: `src/services/appMaintenance.ts` (wipe, líneas ~73-130)
- Test: `src/services/athlete/__tests__/coachNoteExportPolicy.test.ts`

**Interfaces:**
- Consumes: `AthleteMembership`, `AthleteCoachNote` (Task 4).
- Produces:

```ts
export function canExportCoachNotesFor(
  athleteId: string,
  accountId: string,
  memberships: AthleteMembership[],
): boolean
```
- Reglas D4 exactas: `athleteMemberships` y `athlete_invites` **nunca** entran al export/import; `athleteCoachNotes` entra solo según la política; el wipe local limpia ambos stores pero **no** muta nada remoto (un wipe no revoca accesos).

- [ ] **Step 1: Failing tests de la política**

```ts
// src/services/athlete/__tests__/coachNoteExportPolicy.test.ts
import { describe, it, expect } from 'vitest'
import { canExportCoachNotesFor } from '../coachNoteExportPolicy'
import type { AthleteMembership } from '../../../types'

const m = (athleteId: string, accountId: string, role: 'self' | 'coach'): AthleteMembership =>
  ({ athleteId, accountId, role, createdAt: 1, updatedAt: 1 })

describe('canExportCoachNotesFor (D4)', () => {
  it('sin membresías (legacy single-user): exporta — backup completo actual', () => {
    expect(canExportCoachNotesFor('ath_a', 'u1', [])).toBe(true)
  })

  it('coach del atleta: exporta', () => {
    expect(canExportCoachNotesFor('ath_a', 'coach1',
      [m('ath_a', 'coach1', 'coach'), m('ath_a', 'u2', 'self')])).toBe(true)
  })

  it('self SIN coach externo (dueño único): exporta — no perder su propio backup', () => {
    expect(canExportCoachNotesFor('ath_a', 'u1', [m('ath_a', 'u1', 'self')])).toBe(true)
  })

  it('self CON coach externo (atleta reclamado): NO exporta la nota del coach', () => {
    expect(canExportCoachNotesFor('ath_a', 'u1',
      [m('ath_a', 'u1', 'self'), m('ath_a', 'coach1', 'coach')])).toBe(false)
  })

  it('sin membresía sobre ese atleta: NO exporta', () => {
    expect(canExportCoachNotesFor('ath_b', 'u1', [m('ath_a', 'u1', 'self')])).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/athlete/__tests__/coachNoteExportPolicy.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar la política**

```ts
// src/services/athlete/coachNoteExportPolicy.ts
/**
 * D4: la nota de coach es contenido coach-only. El export self-triggered de un
 * atleta con coach EXTERNO la excluye (no filtrar la memoria del coach al self).
 * El dueño único (self sin coach externo, o modo legacy sin membresías) conserva
 * su backup completo — es su propia memoria de coach del modo single-user.
 */
import type { AthleteMembership } from '../../types'

export function canExportCoachNotesFor(
  athleteId: string,
  accountId: string,
  memberships: AthleteMembership[],
): boolean {
  if (memberships.length === 0) return true // legacy: sin modelo de membresías
  const forAthlete = memberships.filter((m) => m.athleteId === athleteId)
  if (forAthlete.length === 0) return false // sin acceso, sin export
  const mine = forAthlete.filter((m) => m.accountId === accountId)
  if (mine.some((m) => m.role === 'coach')) return true
  const iAmSelf = mine.some((m) => m.role === 'self')
  const externalCoach = forAthlete.some((m) => m.accountId !== accountId && m.role === 'coach')
  return iAmSelf && !externalCoach
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run src/services/athlete/__tests__/coachNoteExportPolicy.test.ts`
Expected: PASS.

- [ ] **Step 5: Cablear export/import/wipe**

`src/services/dataExport.ts` — seguir EXACTAMENTE el patrón con que `readinessDaily` fue agregado (aparece en: interfaz de tablas ~línea 104, counts ~134, lectura ~179-207, import counts ~295, e import de filas ~346):

1. Agregar `athleteCoachNotes: AthleteCoachNote[]` a la interfaz de tablas del backup y `athleteCoachNotes: number` a los counts. **No** agregar `athleteMemberships` a nada (D4: nunca se exporta).
2. En la lectura del export, filtrar por la política:

```ts
import { canExportCoachNotesFor } from './athlete/coachNoteExportPolicy'
import { getMembershipsForAccount } from './athlete/membershipCache'
```

```ts
  const allNotes = await db.athleteCoachNotes.toArray()
  const memberships = accountId ? await getMembershipsForAccount(accountId) : []
  const athleteCoachNotes = allNotes.filter((note) =>
    !accountId || canExportCoachNotesFor(note.athleteId, accountId, memberships))
```

(El `accountId` es el mismo user id que el export ya usa para scoping; si la función de export no lo recibe hoy, pasarlo desde el caller de Settings igual que se resuelve para otros scopes — buscar cómo obtiene el userId el flujo de export actual y reutilizarlo. Sin cuenta (export anónimo/local) exporta todo, comportamiento legacy.)

3. En el import, validar e importar `athleteCoachNotes` si vienen (mismo patrón de validación fila-a-fila que `readinessDaily` en ~línea 346), e IGNORAR silenciosamente cualquier clave `athleteMemberships`/`athleteInvites` de payloads viejos o manipulados:

```ts
  // D4: membresías/invites son acceso server-authoritative — importar en otra
  // cuenta jamás debe fabricar accesos. Se descartan si aparecen en el payload.
```

4. Marcar el import como dirty para el backfill (ya existe `markBackfillDirtyAfterImport()` en el flujo de import — verificar que se siga llamando).

`src/services/appMaintenance.ts` — en el conteo (~línea 73) y el wipe (~líneas 111-130), agregar ambos stores:

```ts
    db.athleteMemberships,   // en la lista de la transacción
    db.athleteCoachNotes,
```

```ts
        // D4: limpia el CACHE local de membresías; no muta nada remoto.
        // Un wipe local NO revoca accesos (revocar = acción explícita por RPC).
        await db.athleteMemberships.clear()
        await db.athleteCoachNotes.clear()
```

- [ ] **Step 6: Suite completa**

Run: `npm run lint && npm test && npm run build`
Expected: verde. Los tests de `dataExport` existentes pueden requerir el campo nuevo en fixtures del backup — agregarlo como array vacío donde aplique.

- [ ] **Step 7: Checkpoint de commit (owner)**

Mensaje sugerido: `feat(sp1a): lifecycle D4 — export con política de notas, wipe de caches, import sin membresías`

---

### Task 11: Verificación final + guía de rollout

**Files:**
- Modify: `docs/superpowers/plans/2026-07-09-sp1a-smoke.md` (sección de rollout)
- Modify: `PROJECT_REVIEW_AND_ROADMAP.md` (solo si el owner lo pide en el checkpoint)

- [ ] **Step 1: Verificación completa local**

Run: `npm run lint && npm test && npm run build`
Expected: todo verde; anotar el conteo de tests (base previa: 139 archivos / 990+ tests — la suite creció con Whoop a 1160; debe crecer de nuevo con SP1a).

- [ ] **Step 2: Verificación funcional single-athlete (regresión crítica)**

SQL-first estricto (contrato de Task 8): el bundle no se smokea contra una DB sin `013b`. Dos modos válidos:

**(a) DB dev con `013b` aplicado** — `npm run dev` contra el Supabase de dev migrado (013a → 013b):
- dashboard y semana cargan igual;
- crear/editar sesión y day log funciona (sessions push con `authored_by_role` OK);
- coach memory en Settings carga (nota migrada por 013b o dual-read local) y guarda (push a `athlete_coach_notes` OK — el owner es self-sin-coach-externo, la policy `auth_coach_note_athlete_ids()` lo permite);
- cache de membresías poblado tras el primer sync (verificar en DevTools → IndexedDB → athleteMemberships).

**(b) Sin backend (sync deshabilitado / sin sesión)** — verificar que el modo local puro no rompe:
- dashboard/semana/sesión/day log operan offline;
- coach memory carga por dual-read local y guarda localmente;
- ningún crash relacionado a `athleteMemberships`/`athleteCoachNotes`.

- [ ] **Step 3: Agregar la secuencia de rollout al smoke doc**

Agregar al final de `docs/superpowers/plans/2026-07-09-sp1a-smoke.md`:

```markdown
## Secuencia de rollout (orden estricto)
1. `013a` en prod → todos los "must be 0" en 0.
2. `013b` en prod → post-check report OK (memberships > 0, authored null = 0).
3. Deploy del bundle SP1a + hard refresh.
4. Smoke single-athlete (self): dashboard/semana/sesión/day log/chat/coach memory.
5. Smoke coach: switcher a gestionado, check-in misma fecha sin 23505,
   coach memory por atleta NO se cruza entre atletas.
6. Smoke two-sided sembrado (sección 1 y 2 de este doc) con segunda cuenta.
7. `013c` en prod (endurece authored_by_role) — SOLO tras confirmar 3-6.
8. Re-correr `008a` y el post-check de `013b`: todo en 0.

## Rollback de emergencia
-- Las policies legacy user_id/owner siguen vigentes: basta remover lo aditivo.
drop policy if exists sessions_select_membership on public.sessions;      -- (repetir per tabla _select_membership / _write_membership / _write_coach)
drop policy if exists athletes_select_membership on public.athletes;
-- restaurar readiness_daily_select de 011 (owner/linked) si se revierte todo.
-- Los triggers _no_reparent y las tablas nuevas pueden quedar (inertes para el bundle viejo).
```

- [ ] **Step 4: Checkpoint final de commit (owner)**

Presentar al owner: diff completo, resultado de lint/test/build, y la secuencia de rollout. Mensaje sugerido para el commit final (o squash): `feat(sp1a): fundación two-sided — memberships, RLS v2, self link-aware, coach notes`

---

## Revisión externa 2026-07-10 (aplicada)

Ocho hallazgos incorporados: (1) fuga de `coach_memory` → limpieza en `013b` con guard + notas gated por `auth_coach_note_athlete_ids()` (coach ∪ self-sin-coach-externo — coach-only puro rompía lectura/escritura del owner sobre su propia memoria, que solo tiene membresía `self`); (2) `athletes` pull por `id in (membresías)` ∪ owner, en `buildPullFilter` y en `pullAthletes` directo; (3) fresh device: `pullMemberships` ANTES del backfill en `App.tsx` + guard en `ensureRemoteAthleteOnce` que no fabrica/upsertea `ath_<uid>` cuando el self real es otro atleta; (4) RPC con guard LWW `s.updated_at <= p_updated_at` y cliente tratando `data !== true` como op consumida sin retry; (5) identidad de cola `getEntityIdFromPayload` (id → p_session_id → athlete_id) usada por compactación y limpieza; (6) trigger de consistencia `training_plan_weeks.athlete_id = training_plans.athlete_id`; (7) provenance completo: backfill de `updated_by_account_id` + envío en day/week/profile row builders; (8) contrato SQL-first estricto (013b antes del bundle en todo entorno; tolerancias = defensa, no modo soportado).

## Revisión independiente post-implementación 2026-07-10 (aplicada)

La revisión final endureció once puntos adicionales: `athlete_profiles` canónico por `athlete_id` (preflight + unique + pull/write membership-aware), omisión total de `coach_memory` en writes del bundle, reconciliación LWW en `013c`, trigger de membresía para atletas nuevos, write de `athletes` por rol con owner/linked inmutables, autoría de sesión server-stamped e inmutable, wipe remoto de `athlete_coach_notes`, trigger plan/week `SECURITY DEFINER` fail-closed, RPC limitado a self sobre sesión coach-authored, pull por rango athlete-aware y export de notas fail-closed para un self reclamado.

## Self-Review (ya aplicado)

- **Cobertura del spec:** §1b (RLS readiness_daily → Task 2 §8f; `resolveSelfAthleteId` server → Task 6 Step 9); §3.1/§3.2/§3.3/§3.4/§3.5 → Task 2; §4.1–4.4 → Task 2; D1 → Tasks 2+8; D2 → Tasks 2+8; D3 → Tasks 2+9 (PK athlete_id, comentario en SQL y en coachNotes.ts); D4 → Task 10; D5 → Task 2 (secciones 8a–8f mapean la tabla de D5); D6 → Task 6; §6.1/§6.2 → Task 6 (cliente + server); §6.3 → Tasks 5+7+9; §8 testing → tests por task + smoke doc (Task 3); §9 SP1a completo; §5/§7 (invites/UI) correctamente FUERA (SP1b).
- **Sin placeholders:** cada step con código/SQL completo; los dos puntos que dependen de inspección en ejecución (caller de `WeekCreatorPromptBuilder`, obtención del userId en export) indican el mecanismo exacto de resolución (grep dirigido + patrón existente), no un TBD de diseño.
- **Consistencia de tipos:** `AthleteMembership`/`AthleteCoachNote`/`MembershipRole` definidos en Task 4 y consumidos con esos nombres exactos en Tasks 5–10; `buildPullFilter`/`getMembershipAthleteIds`/`getSelfMembership`/`getRoleForAthlete` con firmas idénticas entre "Produces" y usos.
