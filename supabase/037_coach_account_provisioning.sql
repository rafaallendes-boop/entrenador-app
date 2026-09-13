-- 037_coach_account_provisioning.sql
-- Entrega 2 de la separación del rol coach (spec 2026-09-01 §7.4 y §10):
--   * admin_set_account_role: fija `account_role` (y opcionalmente `tier`) de
--     una cuenta existente en auth.users. Rechaza `coach` si la cuenta tiene una
--     membresía self — es la invariante de 030 vista desde el rol.
--   * admin_transfer_coach_membership: mueve la membresía `coach` de un
--     gestionado SIN self de una cuenta a otra cuenta coach. Inserta antes de
--     borrar; nunca reparenta owner/linked (trigger reject_athlete_access_reparent).
-- Ambas son service-role only: la autorización del invocador vive en la
-- herramienta operacional (SQL Editor), no en la RPC. Aplicación manual.
-- Requiere 028 (account_role), 030 (invariantes de rol) y 031 (membresía como
-- única autoridad de RLS).

begin;

-- ── 1. Rol de cuenta ───────────────────────────────────────────────────────
create or replace function public.admin_set_account_role(
  p_user uuid,
  p_role text,
  p_tier text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then
    raise exception 'admin_set_account_role: invalid user';
  end if;
  if p_role is null or p_role not in ('athlete','coach') then
    raise exception 'admin_set_account_role: invalid role %', p_role;
  end if;
  if p_tier is not null and p_tier not in ('free','weekly','advanced') then
    raise exception 'admin_set_account_role: invalid tier %', p_tier;
  end if;
  -- La provisión es infrecuente: serializarla con INSERT evita crear un self
  -- mientras otra transacción cambia su cuenta a coach (trigger de 031).
  lock table public.athletes in share row exclusive mode;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'admin_set_account_role: user does not exist';
  end if;

  -- Una cuenta coach no puede tener self (030). Provisionar el rol sobre una
  -- cuenta que ya lo tiene rompería la invariante por la puerta de atrás.
  if p_role = 'coach' and (exists (
    select 1 from public.athlete_memberships m
    where m.account_id = p_user and m.role = 'self'
  ) or exists (
    select 1 from public.athletes a
    where a.owner_account_id = p_user and a.linked_account_id = p_user
  )) then
    raise exception 'admin_set_account_role: account has a self athlete; cannot become coach';
  end if;

  -- En una fila nueva expires_at queda null; una fila existente lo conserva.
  insert into public.user_entitlements (user_id, tier, account_role, source, note)
  values (p_user, coalesce(p_tier, 'free'), p_role, 'manual', 'admin_set_account_role')
  on conflict (user_id) do update
    set account_role = excluded.account_role,
        tier = coalesce(p_tier, public.user_entitlements.tier);

  return p_role;
end;
$$;

-- ── 2. Transferencia de la membresía coach ─────────────────────────────────
create or replace function public.admin_transfer_coach_membership(
  p_athlete_id text,
  p_from uuid,
  p_to uuid
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
  if p_athlete_id is null or length(p_athlete_id) = 0 or p_from is null or p_to is null or p_from = p_to then
    raise exception 'admin_transfer_coach_membership: invalid arguments';
  end if;

  -- Bloquear la identidad serializa dos transferencias simultáneas del mismo
  -- origen; la segunda revalida la membresía tras esperar.
  perform 1 from public.athletes a where a.id = p_athlete_id for update;
  if not found then
    raise exception 'admin_transfer_coach_membership: athlete does not exist';
  end if;

  select e.account_role into v_role
  from public.user_entitlements e
  where e.user_id = p_to for share;
  if coalesce(v_role, 'athlete') <> 'coach' then
    raise exception 'admin_transfer_coach_membership: destination is not a coach account';
  end if;

  if not exists (
    select 1 from public.athlete_memberships m
    where m.athlete_id = p_athlete_id and m.account_id = p_from and m.role = 'coach'
  ) then
    raise exception 'admin_transfer_coach_membership: source has no coach membership';
  end if;

  -- Un atleta con cuenta propia consiente a su coach dentro de la app (SP1b).
  -- Esta RPC sólo mueve gestionados sin self.
  if exists (
    select 1 from public.athlete_memberships m
    where m.athlete_id = p_athlete_id and m.role = 'self'
  ) then
    raise exception 'admin_transfer_coach_membership: athlete has a self membership';
  end if;

  -- Insertar ANTES de borrar: en ningún instante el atleta queda sin coach.
  insert into public.athlete_memberships (athlete_id, account_id, role, created_at, updated_at)
  values (p_athlete_id, p_to, 'coach', v_now, v_now)
  on conflict (athlete_id, account_id) do update
    set role = 'coach', updated_at = excluded.updated_at;

  delete from public.athlete_memberships m
  where m.athlete_id = p_athlete_id and m.account_id = p_from and m.role = 'coach';

  return p_athlete_id;
end;
$$;

-- ── 3. Grants: service role únicamente ─────────────────────────────────────
revoke all on function public.admin_set_account_role(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_transfer_coach_membership(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_account_role(uuid, text, text) to service_role;
grant execute on function public.admin_transfer_coach_membership(text, uuid, uuid) to service_role;

commit;

notify pgrst, 'reload schema';
