-- Verificaciones de la Entrega 2. Reemplazar :coach_uuid, :hybrid_uuid y
-- :athlete_id antes de ejecutar. Guardar cada resultado en el runbook.

-- A. 037 aplicada: ambas funciones existen y sólo service_role las ejecuta.
select p.proname, p.prosecdef as security_definer,
       has_function_privilege('service_role', p.oid, 'execute') as service_role_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_set_account_role', 'admin_transfer_coach_membership');
-- Esperado: 2 filas, security_definer = true, service_role_exec = true, los otros dos = false.

-- B. Estado de la cuenta coach: rol coach, sin self, sin atletas propios de tipo self.
select e.user_id, e.account_role, e.tier,
       (select count(*) from public.athlete_memberships m where m.account_id = e.user_id and m.role = 'self') as self_memberships,
       (select count(*) from public.athletes a where a.owner_account_id = e.user_id and a.linked_account_id = a.owner_account_id) as self_rows
from public.user_entitlements e
where e.user_id = ':coach_uuid';
-- Esperado: account_role = coach, self_memberships = 0, self_rows = 0.

-- C. Membresías del atleta antes/después de la transferencia.
select m.athlete_id, m.account_id, m.role, m.updated_at
from public.athlete_memberships m
where m.athlete_id = ':athlete_id'
order by m.role, m.account_id;
-- Antes: una fila coach para :hybrid_uuid. Después: una fila coach para :coach_uuid, ninguna para :hybrid_uuid.

-- D. owner/linked del atleta NO cambiaron.
select a.id, a.owner_account_id, a.linked_account_id, a.status, a.updated_at
from public.athletes a
where a.id = ':athlete_id';
-- Esperado: owner_account_id = :hybrid_uuid antes y después; linked_account_id null.

-- E. Invariante global: ninguna cuenta coach tiene self.
select e.user_id
from public.user_entitlements e
join public.athlete_memberships m on m.account_id = e.user_id and m.role = 'self'
where e.account_role = 'coach';
-- Esperado: 0 filas.

-- F. Después del smoke: filas del atleta escritas por la cuenta coach.
select 'sessions' as t, count(*) from public.sessions where athlete_id = ':athlete_id' and updated_by_account_id = ':coach_uuid'
union all
select 'athlete_profiles', count(*) from public.athlete_profiles where athlete_id = ':athlete_id';
