-- 2026-09-06-035-rls-checks.sql
-- Verificación de RLS y grants de `client_error_events` (Entrega B, bloque B2).
-- Ver docs/superpowers/specs/2026-09-06-client-error-reporting-design.md §11.
--
-- POR QUÉ ESTE ARCHIVO Y NO UN TEST: el repositorio no tiene harness de
-- PostgreSQL —ni pg-mem, ni testcontainers, ni dependencia `pg`— y el precedente
-- del proyecto para verificar policies es este directorio, como en el corte de
-- `031`. Un mock no puede demostrar RLS.
--
-- CÓMO SE CORRE: con `psql` contra el proyecto, después de aplicar `035`.
-- Ejecutar el bloque completo: crea sus fixtures y los borra al final.
--
-- ADVERTENCIA DE MÉTODO: `set local role authenticated` + `request.jwt.claims`
-- es lo que hace que estas consultas prueben algo. Una consulta corrida como
-- superusuario o con service_role **no demuestra RLS**: esos roles la saltan.

begin;

-- ─── Precondiciones ──────────────────────────────────────────────────────────
-- Esperado: 1 fila, todo `true`.
select
  to_regclass('public.client_error_events') is not null as tabla_existe,
  (select relrowsecurity from pg_class where oid = 'public.client_error_events'::regclass)
    as rls_activada,
  to_regprocedure(
    'public.insert_client_error_event(uuid,text,text,text,text,text,text,text,text,text,text,text,integer,integer)'
  ) is not null as rpc_existe;

-- Esperado: exactamente 1 policy, `client_error_events_select_own`, cmd = SELECT.
select policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename = 'client_error_events'
 order by policyname;

-- Esperado: `authenticated` sólo con SELECT. Cero filas para INSERT/UPDATE/DELETE,
-- y cero filas para `anon` en cualquier privilegio.
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name = 'client_error_events'
   and grantee in ('anon', 'authenticated')
 order by grantee, privilege_type;

-- Esperado: cero filas. Ni anon ni authenticated pueden ejecutar la RPC de ingesta.
select r.rolname
  from pg_roles r
 where r.rolname in ('anon', 'authenticated')
   and has_function_privilege(
         r.rolname,
         'public.insert_client_error_event(uuid,text,text,text,text,text,text,text,text,text,text,text,integer,integer)',
         'execute'
       );

-- ─── Fixtures ────────────────────────────────────────────────────────────────
-- Dos cuentas reales de auth.users. Reemplazar por UUID existentes en el
-- proyecto: crear usuarios desde SQL no reproduce el flujo de registro.
\set usuario_a '00000000-0000-0000-0000-00000000000a'
\set usuario_b '00000000-0000-0000-0000-00000000000b'

insert into public.client_error_events (
  user_id, scope_kind, source, diagnostic_code, fingerprint, error_name,
  stack_frames, component, route, request_class, release, platform, created_at
) values
  (:'usuario_a', 'self', 'react_boundary', 'render_failure', '0123456789abcdef',
   'TypeError', null, 'PlanBuilderV2', '/plans/builder', null, 'r-test', 'web', now()),
  (:'usuario_a', 'self', 'window_error', 'unknown', 'fedcba9876543210',
   'RangeError', null, null, '/week', null, 'r-test', 'web', now() - interval '31 days'),
  (:'usuario_b', 'self', 'sync_failure', 'sync_contract_failure', 'aaaabbbbccccdddd',
   'Error', null, 'SyncService', '/week', null, 'r-test', 'web', now());

-- ─── Caso 1: A lee lo suyo vigente ───────────────────────────────────────────
-- Esperado: 1 fila (`0123456789abcdef`).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select 'caso_1_a_lee_lo_propio' as caso, fingerprint
  from public.client_error_events order by fingerprint;
reset role;

-- ─── Caso 2: A no lee lo vencido ─────────────────────────────────────────────
-- El caso 1 ya lo demuestra: `fedcba9876543210` tiene 31 días y NO debe aparecer.
-- Esperado: 0 filas.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select 'caso_2_a_no_lee_vencido' as caso, count(*) as filas
  from public.client_error_events where fingerprint = 'fedcba9876543210';
reset role;

-- ─── Caso 3: A no lee lo de B ────────────────────────────────────────────────
-- Esperado: 0 filas. Es el caso central del aislamiento entre cuentas.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select 'caso_3_a_no_lee_a_b' as caso, count(*) as filas
  from public.client_error_events where fingerprint = 'aaaabbbbccccdddd';
reset role;

-- ─── Caso 4: anon no lee nada ────────────────────────────────────────────────
-- Esperado: error de permisos, o 0 filas. Cualquiera de los dos es aceptable;
-- una fila devuelta NO lo es.
set local role anon;
select 'caso_4_anon' as caso, count(*) as filas from public.client_error_events;
reset role;

-- ─── Caso 5: el cliente no escribe ───────────────────────────────────────────
-- Esperado: los tres fallan con permiso denegado. Correr uno por uno: el primer
-- error aborta la transacción, así que hay que envolverlos en savepoints.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

savepoint intento_insert;
-- Esperado: ERROR permission denied.
insert into public.client_error_events (
  user_id, scope_kind, source, diagnostic_code, fingerprint, error_name,
  route, release, platform
) values (
  '00000000-0000-0000-0000-00000000000a', 'self', 'window_error', 'unknown',
  '1111222233334444', 'TypeError', '/week', 'r-test', 'web'
);
rollback to savepoint intento_insert;

savepoint intento_update;
-- Esperado: ERROR permission denied.
update public.client_error_events set route = '/coach' where fingerprint = '0123456789abcdef';
rollback to savepoint intento_update;

savepoint intento_delete;
-- Esperado: ERROR permission denied.
delete from public.client_error_events where fingerprint = '0123456789abcdef';
rollback to savepoint intento_delete;

savepoint intento_rpc;
-- Esperado: ERROR permission denied for function insert_client_error_event.
select public.insert_client_error_event(
  '00000000-0000-0000-0000-00000000000a', 'self', 'window_error', 'unknown',
  '1111222233334444', 'TypeError', null, null, '/week', null, 'r-test', 'web', 30, 3600
);
rollback to savepoint intento_rpc;

reset role;

-- ─── Caso 6: la RPC respeta el techo ─────────────────────────────────────────
-- Como service_role. Esperado: las primeras 30 con inserted = true; la 31 con
-- inserted = false. Este caso NO demuestra la ausencia de carrera —para eso está
-- el runner concurrente del runbook—, sólo el conteo secuencial.
do $$
declare
  v_inserted boolean;
  v_true integer := 0;
  v_false integer := 0;
begin
  for i in 1..31 loop
    select inserted into v_inserted from public.insert_client_error_event(
      '00000000-0000-0000-0000-00000000000b', 'self', 'window_error', 'unknown',
      lpad(to_hex(i), 16, '0'), 'TypeError', null, null, '/week', null,
      'r-test', 'web', 30, 3600
    );
    if v_inserted then v_true := v_true + 1; else v_false := v_false + 1; end if;
  end loop;
  raise notice 'caso_6 insertadas=% rechazadas=% (esperado 29 y 2: B ya tenía 1 fila)', v_true, v_false;
end;
$$;

-- ─── Limpieza ────────────────────────────────────────────────────────────────
-- Todo el bloque corre en una transacción: el rollback deja el proyecto intacto.
rollback;
