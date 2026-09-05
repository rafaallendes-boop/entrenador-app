-- Backfill idempotente de athlete_memberships para la Entrega 1a.
--
-- IMPORTANTE: replica exactamente la clasificacion del trigger
-- seed_membership_for_new_athlete de 013b:
--   linked = owner  -> owner/self
--   linked is null -> owner/coach
--   linked != owner -> linked/self + owner/coach
--
-- No borra, no transfiere y no modifica athletes. Ejecutar en el SQL Editor
-- despues de aplicar 030 y guardar todos los resultados en el smoke de audit.

begin;

-- 1. Atleta self historico.
insert into public.athlete_memberships (
  athlete_id, account_id, role, created_at, updated_at
)
select
  a.id,
  a.owner_account_id,
  'self',
  a.created_at,
  a.updated_at
from public.athletes a
where a.linked_account_id = a.owner_account_id
on conflict (athlete_id, account_id) do nothing;

-- 2. Atleta gestionado sin cuenta propia.
insert into public.athlete_memberships (
  athlete_id, account_id, role, created_at, updated_at
)
select
  a.id,
  a.owner_account_id,
  'coach',
  a.created_at,
  a.updated_at
from public.athletes a
where a.linked_account_id is null
on conflict (athlete_id, account_id) do nothing;

-- 3a. Atleta reclamado por una cuenta distinta: la cuenta linked es self.
insert into public.athlete_memberships (
  athlete_id, account_id, role, created_at, updated_at
)
select
  a.id,
  a.linked_account_id,
  'self',
  a.created_at,
  a.updated_at
from public.athletes a
where a.linked_account_id is not null
  and a.linked_account_id <> a.owner_account_id
on conflict (athlete_id, account_id) do nothing;

-- 3b. El owner original conserva el vinculo coach.
insert into public.athlete_memberships (
  athlete_id, account_id, role, created_at, updated_at
)
select
  a.id,
  a.owner_account_id,
  'coach',
  a.created_at,
  a.updated_at
from public.athletes a
where a.linked_account_id is not null
  and a.linked_account_id <> a.owner_account_id
on conflict (athlete_id, account_id) do nothing;

-- Verificacion A: el rol del owner coincide con 013b. Debe devolver cero.
select
  m.athlete_id,
  m.account_id,
  m.role as membership_role,
  case
    when a.linked_account_id = a.owner_account_id then 'self'
    else 'coach'
  end as expected_role
from public.athlete_memberships m
join public.athletes a on a.id = m.athlete_id
where m.account_id = a.owner_account_id
  and m.role <> case
    when a.linked_account_id = a.owner_account_id then 'self'
    else 'coach'
  end;

-- Verificacion B: ningun par legacy owner/linked quedo sin membresia.
-- Debe devolver 0.
select count(*) as legacy_pairs_without_membership
from (
  select a.id as athlete_id, a.owner_account_id as account_id
  from public.athletes a
  union
  select a.id, a.linked_account_id
  from public.athletes a
  where a.linked_account_id is not null
) legacy_pair
where legacy_pair.account_id is not null
  and not exists (
    select 1
    from public.athlete_memberships m
    where m.athlete_id = legacy_pair.athlete_id
      and m.account_id = legacy_pair.account_id
  );

-- Verificacion C: para un atleta reclamado, el linked histórico es `self`.
-- `ON CONFLICT DO NOTHING` hace correcto re-ejecutar este archivo, pero también
-- puede conservar una fila preexistente mal clasificada; la verificación B sólo
-- detectaría su ausencia, no un rol equivocado.
-- Debe devolver cero filas.
select
  m.athlete_id,
  m.account_id,
  m.role as membership_role,
  'self'::text as expected_role
from public.athlete_memberships m
join public.athletes a on a.id = m.athlete_id
where a.linked_account_id is not null
  and a.linked_account_id <> a.owner_account_id
  and m.account_id = a.linked_account_id
  and m.role <> 'self';

commit;
