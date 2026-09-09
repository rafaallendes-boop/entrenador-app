-- Verificación de que `035_client_error_events` y `036_client_error_metrics`
-- están aplicadas **y completas** en el proyecto donde se corre.
--
-- Complementa `2026-09-06-035-rls-checks.sql`, que ejercita la RLS con dos
-- cuentas reales de fixture. Esto es lo anterior a eso: la forma del esquema.
-- `036` no tenía ninguna query de verificación hasta acá.
--
-- Sólo lectura. No inserta, no borra y no necesita fixtures.
-- Ejecutado contra producción el 2026-09-08; resultados en
-- docs/superpowers/smokes/2026-09-08-035-036-applied-evidence.md

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Presencia. Esperado: t035_tabla=true, p035_policies=1, i035_indices=4,
--    y 1 en cada una de las tres funciones.
select
  to_regclass('public.client_error_events') is not null as t035_tabla,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'client_error_events') as p035_policies,
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename = 'client_error_events') as i035_indices,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'insert_client_error_event') as f035_insert,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'read_client_error_metrics') as f036_metrics,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'read_client_error_retention_health') as f036_retention;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS, policy única y EXECUTE de las tres funciones.
--
-- Esperado:
--   rls_activa        true
--   policy            client_error_events_select_own / SELECT
--   exec_*            anon:false, authenticated:false, service_role:true
--   security_definer  las tres en true
--
-- Las tres funciones son `security definer` a propósito: la escritura y los
-- agregados no pasan por la RLS de la cuenta. Por eso el EXECUTE restringido a
-- `service_role` es la única barrera, y verificarlo no es opcional.
with f as (
  select p.proname, p.oid, p.prosecdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'insert_client_error_event',
      'read_client_error_metrics',
      'read_client_error_retention_health'
    )
)
select 'rls_activa' as k,
  (select relrowsecurity::text from pg_class
    where oid = 'public.client_error_events'::regclass) as v
union all
select 'policy',
  (select policyname || ' / ' || cmd from pg_policies
    where schemaname = 'public' and tablename = 'client_error_events')
union all
select 'exec_' || f.proname,
  string_agg(r || ':' || has_function_privilege(r, f.oid, 'execute')::text, ', ' order by r)
from f, unnest(array['anon', 'authenticated', 'service_role']) r
group by f.proname
union all
select 'security_definer',
  (select string_agg(proname || ':' || prosecdef::text, ', ' order by proname) from f)
union all
select 'filas_total', (select count(*)::text from public.client_error_events);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Grants de tabla. Esperado: sólo `service_role`; `anon` y `authenticated`
--    SIN GRANTS de tabla y `puede_select` false.
--
-- OJO: que `authenticated` dé false acá **no** es un hallazgo. `035` otorga
-- SELECT **por columna**, y ni `role_table_grants` ni `has_table_privilege`
-- ven los grants de columna. La verificación real es el bloque 4.
select r as rol,
  coalesce(string_agg(g.privilege_type, ', ' order by g.privilege_type), 'SIN GRANTS') as grants_en_tabla,
  has_table_privilege(r, 'public.client_error_events', 'select') as puede_select
from unnest(array['anon', 'authenticated', 'service_role']) r
left join information_schema.role_table_grants g
  on g.table_schema = 'public' and g.table_name = 'client_error_events' and g.grantee = r
group by r
order by r;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Grants de columna — la superficie de lectura real de una cuenta.
--
-- Esperado: exactamente una fila, `authenticated / SELECT / 14 columnas`, y
-- `anon` ausente. Si aparecieran más de 14, alguien amplió la superficie sin
-- migración; si aparecieran menos, la policy quedó parcialmente inerte.
--
-- Las 14 columnas son las que enumera `035`: id, user_id, scope_kind, source,
-- diagnostic_code, fingerprint, error_name, stack_frames, component, route,
-- request_class, release, platform, created_at.
select g.grantee as rol,
  g.privilege_type as priv,
  count(*) as columnas,
  string_agg(g.column_name, ', ' order by g.column_name) as cuales
from information_schema.role_column_grants g
where g.table_schema = 'public'
  and g.table_name = 'client_error_events'
  and g.grantee in ('anon', 'authenticated')
group by g.grantee, g.privilege_type
order by g.grantee;
