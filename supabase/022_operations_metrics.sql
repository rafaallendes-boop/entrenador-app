-- supabase/022_operations_metrics.sql
-- Dashboard de operación (Pre-Lanzamiento punto 10, Entrega A).
-- Ver docs/superpowers/specs/2026-08-23-operations-dashboard-and-client-errors-design.md
-- Aplicación manual, como todas las anteriores.
--
-- Devuelve SOLO agregados. Ninguna consulta de acá selecciona user_id, texto de
-- usuario ni filas individuales: la función Netlify que lo consume nunca debe
-- tener acceso a datos por cuenta, ni aunque alguien la modifique después.

create or replace function public.read_operations_metrics(p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity jsonb;
  v_coach jsonb;
  v_error_codes jsonb;
  v_plan jsonb;
  v_run_outcomes jsonb;
  v_attempts jsonb;
  v_attempt_outcomes jsonb;
  v_quota jsonb := null;
begin
  -- Actividad. Ninguna de las dos es "usuarios activos": ambas salen de
  -- telemetría de IA, así que una cuenta que usa la app sin tocar la IA no
  -- aparece. La UI las nombra por lo que miden.
  select jsonb_build_object(
    'accountsUsingAi', (
      select count(distinct user_id) from public.coach_requests
      where created_at >= p_since
    ),
    'accountsPlanning', (
      select count(distinct user_id) from public.plan_generation_jobs
      where created_at >= p_since
    )
  ) into v_activity;

  select coalesce(
    jsonb_agg(jsonb_build_object('code', code, 'count', c) order by c desc),
    '[]'::jsonb
  ) into v_error_codes
  from (
    select left(coalesce(error_code, 'sin_codigo'), 40) as code, count(*) as c
    from public.coach_requests
    where created_at >= p_since and outcome = 'error'
    group by 1
    order by 2 desc
    limit 5
  ) top_codes;

  -- Costo: excluye nulls y publica cobertura en filas Y tokens. Un null no es
  -- cero, y la cobertura en filas sola engaña porque las requests caras son
  -- pocas.
  select jsonb_build_object(
    'requests', count(*),
    'errors', count(*) filter (where outcome = 'error'),
    'topErrorCodes', v_error_codes,
    'latencyP50', percentile_cont(0.5) within group (order by server_duration_ms),
    'latencyP90', percentile_cont(0.9) within group (order by server_duration_ms),
    'latencyP95', percentile_cont(0.95) within group (order by server_duration_ms),
    'costUsd', coalesce(sum(estimated_cost_usd), 0),
    'coverage', jsonb_build_object(
      'rowsTotal', count(*),
      'rowsWithCost', count(*) filter (where estimated_cost_usd is not null),
      'tokensTotal', coalesce(sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0)), 0),
      'tokensWithCost', coalesce(sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0))
        filter (where estimated_cost_usd is not null), 0)
    )
  ) into v_coach
  from public.coach_requests
  where created_at >= p_since;

  select coalesce(jsonb_object_agg(outcome, c), '{}'::jsonb) into v_run_outcomes
  from (
    select outcome, count(*) as c from public.plan_generation_jobs
    where created_at >= p_since group by 1
  ) o;

  select jsonb_build_object(
    'runs', count(*),
    'byOutcome', v_run_outcomes,
    -- E2E desde enqueue: es la medida comparable con la primera semana que la
    -- persona usuaria espera ver, no sólo el tramo interno del worker.
    'firstWeekP50', percentile_cont(0.5) within group (order by first_week_ready_e2e_ms),
    'firstWeekP90', percentile_cont(0.9) within group (order by first_week_ready_e2e_ms),
    'firstWeekP95', percentile_cont(0.95) within group (order by first_week_ready_e2e_ms),
    -- Misma base temporal end-to-end que primera semana: ambos tiles parten
    -- desde enqueued_at, por lo que nunca comparan dos relojes distintos.
    'completeP50', percentile_cont(0.5) within group (order by (
      plan_complete_ms + extract(epoch from (worker_started_at - enqueued_at)) * 1000
    )),
    'completeP90', percentile_cont(0.9) within group (order by (
      plan_complete_ms + extract(epoch from (worker_started_at - enqueued_at)) * 1000
    )),
    'completeP95', percentile_cont(0.95) within group (order by (
      plan_complete_ms + extract(epoch from (worker_started_at - enqueued_at)) * 1000
    )),
    'costUsd', coalesce(sum(estimated_cost_usd), 0),
    'coverage', jsonb_build_object(
      'rowsTotal', count(*),
      'rowsWithCost', count(*) filter (where estimated_cost_usd is not null),
      -- `plan_generation_jobs` usa total_input_tokens/total_output_tokens;
      -- prompt_tokens/completion_tokens existen sólo en coach_requests.
      'tokensTotal', coalesce(sum(coalesce(total_input_tokens, 0) + coalesce(total_output_tokens, 0)), 0),
      'tokensWithCost', coalesce(sum(coalesce(total_input_tokens, 0) + coalesce(total_output_tokens, 0))
        filter (where estimated_cost_usd is not null), 0)
    )
  ) into v_plan
  from public.plan_generation_jobs
  where created_at >= p_since;

  select coalesce(jsonb_object_agg(outcome, c), '{}'::jsonb) into v_attempt_outcomes
  from (
    select outcome, count(*) as c from public.plan_generation_attempts
    where created_at >= p_since group by 1
  ) a;

  select jsonb_build_object('total', count(*), 'byOutcome', v_attempt_outcomes)
  into v_attempts
  from public.plan_generation_attempts
  where created_at >= p_since;

  -- Granularidad declarada: `ai_usage_daily` guarda por día. Por eso este
  -- bloque publica `startDate`: se agrega desde ese día calendario inclusivo y
  -- la UI nunca debe presentarlo como una ventana móvil exacta de 24 h.
  --
  -- `021` YA está aplicada en producción (verificado 2026-08-23), así que en
  -- producción este bloque devuelve datos o ceros. El `to_regclass` se conserva
  -- para entornos donde no lo esté: una referencia estática a una tabla
  -- inexistente haría fallar el `create function` completo, dejando sin
  -- instalar todo el RPC y no sólo este bloque. El texto del `execute` es una
  -- constante literal y el único valor variable entra por `using`: sin
  -- superficie de inyección.
  if to_regclass('public.ai_usage_daily') is not null then
    execute $q$
      select jsonb_build_object(
        'startDate', to_char($1::date, 'YYYY-MM-DD'),
        'requests', coalesce(sum(request_count), 0),
        'costUsd', coalesce(sum(estimated_cost_usd), 0),
        'byBucket', coalesce((
          select jsonb_object_agg(bucket_id, total)
          from (
            select bucket_id, sum(request_count) as total
            from public.ai_usage_daily
            where usage_date >= $1::date
            group by 1
          ) b
        ), '{}'::jsonb)
      )
      from public.ai_usage_daily
      where usage_date >= $1::date
    $q$
    into v_quota
    using p_since;
  end if;

  return jsonb_build_object(
    'activity', v_activity,
    'coach', v_coach,
    'planBuilder', v_plan,
    'attempts', v_attempts,
    'quota', v_quota,
    'totalCostUsd', coalesce((v_coach->>'costUsd')::numeric, 0)
      + coalesce((v_plan->>'costUsd')::numeric, 0),
    'totalCostCoverage', jsonb_build_object(
      'rowsTotal', coalesce((v_coach->'coverage'->>'rowsTotal')::bigint, 0)
        + coalesce((v_plan->'coverage'->>'rowsTotal')::bigint, 0),
      'rowsWithCost', coalesce((v_coach->'coverage'->>'rowsWithCost')::bigint, 0)
        + coalesce((v_plan->'coverage'->>'rowsWithCost')::bigint, 0),
      'tokensTotal', coalesce((v_coach->'coverage'->>'tokensTotal')::bigint, 0)
        + coalesce((v_plan->'coverage'->>'tokensTotal')::bigint, 0),
      'tokensWithCost', coalesce((v_coach->'coverage'->>'tokensWithCost')::bigint, 0)
        + coalesce((v_plan->'coverage'->>'tokensWithCost')::bigint, 0)
    )
  );
end;
$$;

revoke all on function public.read_operations_metrics(timestamptz)
  from public, anon, authenticated;
grant execute on function public.read_operations_metrics(timestamptz)
  to service_role;

-- Las consultas del RPC filtran por tiempo sin `user_id`; los índices actuales
-- comienzan por user_id y no cubren este patrón de agregación operacional.
-- No se usa CONCURRENTLY para mantener esta migración ejecutable como un único
-- script manual; correrla en una ventana de bajo tráfico porque CREATE INDEX
-- bloquea escrituras brevemente mientras se construye.
create index if not exists coach_requests_created_idx
  on public.coach_requests (created_at desc);
create index if not exists plan_generation_jobs_created_idx
  on public.plan_generation_jobs (created_at desc);
create index if not exists plan_generation_attempts_created_idx
  on public.plan_generation_attempts (created_at desc);
