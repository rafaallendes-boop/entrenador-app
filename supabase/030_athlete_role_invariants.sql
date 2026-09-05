-- 030_athlete_role_invariants.sql
-- Cierra los huecos de comando de la RLS v2 e impone por trigger la invariante
-- de rol que debe valer también para la policy legacy `athletes_insert`.
-- No retira ninguna policy legacy: eso es 031 (Entrega 1b). Aplicación manual.
-- Requiere 028 aplicada: lee `account_role`.

begin;

-- ── 1. Escritura self donde 013b dejó sólo coach ───────────────────────────
do $$
declare tbl text;
begin
  foreach tbl in array array['coach_proposals', 'training_plans', 'training_plan_weeks']
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_write_member', tbl);
    execute format(
      'create policy %I on public.%I for all using (
         athlete_id in (select public.auth_athlete_ids())
       ) with check (
         athlete_id in (select public.auth_athlete_ids())
       )', tbl || '_write_member', tbl);
  end loop;
end $$;

-- `013b` migró readiness_daily pero omitió whoop_workouts, que conserva desde
-- 012 el predicado legacy owner/linked. Esta policy es aditiva en 1a: la
-- legacy sigue vigente hasta el corte, después de auditar equivalencia.
drop policy if exists whoop_workouts_select_membership on public.whoop_workouts;
create policy whoop_workouts_select_membership on public.whoop_workouts
  for select using (athlete_id in (select public.auth_athlete_ids()));

-- ── 2. Invariantes de rol, por trigger ─────────────────────────────────────
-- Vale para cualquier camino de inserción, incluida la policy legacy
-- `athletes_insert`, que sigue viva durante la auditoría 1a.
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
    -- `athlete_id is distinct from new.id` NO es cosmético. `ensureRemoteAthlete`
    -- reinserta el mismo atleta self con `on conflict (id) do update` antes de
    -- cada push, y PostgreSQL dispara los triggers BEFORE INSERT en ese camino
    -- ANTES de resolver el conflicto. Sin esta exención, el segundo upsert y
    -- todos los siguientes fallan y el sync queda roto para las cuentas que ya
    -- tienen su membresía self —es decir, todas, apenas corra el backfill.
    -- La invariante que importa es que no haya un SEGUNDO self, no que la fila
    -- existente no se pueda volver a escribir.
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
    -- Decisión transitoria de 1a: no exigir todavía que todo atleta managed
    -- tenga owner coach. La cuenta existente del owner es athlete+self y a la
    -- vez tiene managed legacy; cerrar el recíproco la rompería antes de 1b.
    null;
  end if;

  return new;
end;
$$;

drop trigger if exists athletes_enforce_role_invariants on public.athletes;
create trigger athletes_enforce_role_invariants
  before insert on public.athletes
  for each row execute function public.enforce_athlete_role_invariants();

-- ── 3. Alta self: usuario autenticado con su JWT ───────────────────────────
-- `athletes_seed_membership` (013b) es la única fuente de memberships: al
-- estampar linked_account_id = owner_account_id el trigger crea `self`.
create or replace function public.create_self_athlete(p_athlete_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if v_uid is null then
    raise exception 'create_self_athlete: no authenticated user';
  end if;
  if p_athlete_id is null or length(p_athlete_id) = 0 then
    raise exception 'create_self_athlete: invalid athlete id';
  end if;

  -- Sin ON CONFLICT: apropiarse de un id managed existente debe fallar.
  insert into public.athletes (id, owner_account_id, linked_account_id, created_at, updated_at)
  values (p_athlete_id, v_uid, v_uid, v_now, v_now);

  return p_athlete_id;
end;
$$;

revoke all on function public.create_self_athlete(text) from public, anon;
grant execute on function public.create_self_athlete(text) to authenticated;

-- ── 4. Alta managed y borrado: service role ────────────────────────────────
-- La autorización del invocador vive en el endpoint/herramienta administrativa
-- que use la service role. Esta RPC valida además que el owner de una alta
-- administrativa NUEVA sea coach.
create or replace function public.admin_create_managed_athlete(
  p_owner uuid,
  p_athlete_id text,
  p_display_name text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_role text;
begin
  if p_owner is null or p_athlete_id is null or length(p_athlete_id) = 0 then
    raise exception 'admin_create_managed_athlete: invalid owner or athlete id';
  end if;

  select account_role into v_role
  from public.user_entitlements
  where user_id = p_owner;
  if coalesce(v_role, 'athlete') <> 'coach' then
    raise exception 'admin_create_managed_athlete: owner is not a coach account';
  end if;

  -- Sin ON CONFLICT: esta RPC CREA; no puede adjuntar una membresía a un atleta
  -- existente y ajeno. linked_account_id NULL hace que 013b cree `coach`.
  insert into public.athletes (id, owner_account_id, linked_account_id, display_name, created_at, updated_at)
  values (p_athlete_id, p_owner, null, p_display_name, v_now, v_now);

  return p_athlete_id;
end;
$$;

create or replace function public.admin_delete_athlete(p_actor uuid, p_athlete_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.athlete_memberships
    where account_id = p_actor and athlete_id = p_athlete_id and role = 'coach'
  ) then
    raise exception 'admin_delete_athlete: actor has no coach membership over athlete';
  end if;

  -- Borrar la propia identidad de atleta es un flujo de cuenta separado.
  if exists (
    select 1
    from public.athlete_memberships
    where athlete_id = p_athlete_id and role = 'self'
  ) then
    raise exception 'admin_delete_athlete: athlete has a self membership';
  end if;

  delete from public.athletes where id = p_athlete_id;
  return p_athlete_id;
end;
$$;

revoke all on function public.admin_create_managed_athlete(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_delete_athlete(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_create_managed_athlete(uuid, text, text) to service_role;
grant execute on function public.admin_delete_athlete(uuid, text) to service_role;

commit;

notify pgrst, 'reload schema';
