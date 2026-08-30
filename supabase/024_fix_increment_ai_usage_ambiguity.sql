-- Corrige `increment_ai_usage_if_under_limit`, que fallaba con 400 en toda
-- invocación y, por el diseño fail-closed de `usageGate.ts`, tumbaba TODA la
-- IA de la app en cuanto `AI_USAGE_LIMITS_ENABLED` se encendía.
--
-- CAUSA. La función declara `returns table (usage_date date, request_count
-- integer)` con `language plpgsql`, así que `usage_date` y `request_count` son
-- variables OUT en alcance dentro del cuerpo. La lista de inferencia de un
-- `ON CONFLICT (...)` admite expresiones de índice, o sea que es contexto de
-- expresión y SÍ sufre sustitución de variables de PL/pgSQL — a diferencia de
-- la lista de columnas de un `INSERT` o del destino de un `SET`, que no la
-- sufren. Por eso `on conflict (user_id, usage_date, bucket_id)` resolvía
-- `usage_date` de forma ambigua entre la columna y la variable OUT, y con el
-- `plpgsql.variable_conflict` por defecto (`error`) eso es 42702
-- `column reference "usage_date" is ambiguous` → PostgREST devuelve 400.
--
-- No se puede arreglar calificando: la lista de inferencia de ON CONFLICT sólo
-- acepta nombres de columna desnudos, `ai_usage_daily.usage_date` es sintaxis
-- inválida ahí. Por eso la corrección es la directiva `#variable_conflict
-- use_column`, que resuelve hacia la columna. Todas las demás referencias del
-- cuerpo ya venían calificadas, así que la directiva no cambia nada más.
--
-- Las otras dos RPC de 021 NO están afectadas: `read_ai_usage_spend` es
-- `language sql` (sin sustitución de variables), y `increment_ai_usage_cost`
-- referencia su OUT param `estimated_cost_usd` sólo en posiciones calificadas
-- o en el destino de un SET.
--
-- CONTRATO PRESERVADO. Los nombres de las columnas devueltas siguen siendo
-- `usage_date` y `request_count` porque `usageGate.ts` los lee por nombre
-- (`row.usage_date` / `row.request_count`). Renombrar los OUT params habría
-- arreglado la ambigüedad rompiendo al cliente.
--
-- APLICACIÓN MANUAL. `create or replace function` conserva los privilegios
-- existentes; los revoke/grant se repiten por idempotencia y para que el
-- archivo se sostenga solo.

create or replace function public.increment_ai_usage_if_under_limit(
  p_user_id uuid,
  p_bucket_id text,
  p_limit integer
)
returns table (usage_date date, request_count integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if p_limit < 1 or p_user_id is null or p_bucket_id is null or length(p_bucket_id) = 0 then
    return;
  end if;

  return query
  insert into public.ai_usage_daily (user_id, usage_date, bucket_id, request_count)
  values (p_user_id, current_date, p_bucket_id, 1)
  on conflict (user_id, usage_date, bucket_id)
  do update
     set request_count = ai_usage_daily.request_count + 1,
         updated_at = now()
   where ai_usage_daily.request_count + 1 <= p_limit
  returning ai_usage_daily.usage_date, ai_usage_daily.request_count;
end;
$$;

revoke all on function public.increment_ai_usage_if_under_limit(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.increment_ai_usage_if_under_limit(uuid, text, integer)
  to service_role;

-- VERIFICACIÓN OBLIGATORIA, en ejecución aparte.
--
-- No va en un `do $$` porque PL/pgSQL no compila una sentencia hasta
-- ejecutarla: el camino de guarda temprana (`p_limit < 1`) devuelve antes de
-- llegar al ON CONFLICT y por lo tanto NO habría detectado esta ambigüedad.
-- La única verificación válida ejecuta el upsert de verdad, así que va dentro
-- de una transacción que se revierte.
--
-- El uuid tiene que ser real: `ai_usage_daily_user_id_fkey` es INMEDIATO, no
-- diferido, así que un uuid inexistente aborta en el propio INSERT (23503) sin
-- llegar a devolver fila. Los tres pasos ejercitan el contrato completo,
-- incluido el camino de conflicto, que es donde vivía el defecto.
--
--   begin;
--   select 'insert' as paso, * from public.increment_ai_usage_if_under_limit(
--     (select id from auth.users where email = '<TU_EMAIL>'), 'probe_024', 2);
--   select 'upsert' as paso, * from public.increment_ai_usage_if_under_limit(
--     (select id from auth.users where email = '<TU_EMAIL>'), 'probe_024', 2);
--   select 'limite' as paso, * from public.increment_ai_usage_if_under_limit(
--     (select id from auth.users where email = '<TU_EMAIL>'), 'probe_024', 2);
--   rollback;
--
-- Esperado: paso 1 → una fila con `usage_date` = hoy y `request_count` = 1;
-- paso 2 → `request_count` = 2 (camino ON CONFLICT DO UPDATE); paso 3 → CERO
-- filas, que es exactamente el contrato del que depende el 429. Un 42702 en
-- cualquiera de los tres significa que la corrección no se aplicó. Un 23503
-- significa que el uuid no existe, no que la función esté mal.
