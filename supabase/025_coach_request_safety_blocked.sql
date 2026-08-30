-- ORDEN DE ROLLOUT — OBLIGATORIO, mismo patrón que `019`.
--
-- APLICAR ESTA MIGRACIÓN **ANTES** DEL DEPLOY DEL BUNDLE.
--
-- `isOperationsWindow` (src/services/operations/operationsMetricsContract.ts)
-- exige `coach.safetyBlocked` de forma estricta y a propósito: el contrato es
-- un guard de drift, no un tolerador de formas viejas. Si el cliente se publica
-- antes de aplicar esto, `read_operations_metrics` devuelve la forma anterior,
-- la validación del sobre falla y **el panel `/ops` completo deja de
-- renderizar**, no sólo esta métrica. No es un fallo silencioso, pero sí total.
--
-- Verificación posterior, antes de desplegar el cliente:
--   select count(*) from pg_proc where proname = 'read_operations_metrics';
--   select (public.read_operations_metrics(now() - interval '1 day'))
--            -> 'last24h' -> 'coach' ? 'safetyBlocked';   -- debe dar true

-- El desenlace de seguridad se conoce después de que el proxy haya respondido.
-- Conserva las filas históricas ok/error y permite reclasificar únicamente una
-- respuesta exitosa como una declinación segura desde el endpoint autenticado.
alter table public.coach_requests
  drop constraint if exists coach_requests_outcome_check;

alter table public.coach_requests
  add constraint coach_requests_outcome_check
  check (outcome in ('ok', 'error', 'safety_blocked'));

-- 022 ya está aplicada. Se reemplaza el RPC aquí para exponer el contador sin
-- alterar la semántica existente de `errors` ni sus filtros de costo.
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
  select jsonb_build_object(
    'accountsUsingAi', (select count(distinct user_id) from public.coach_requests where created_at >= p_since),
    'accountsPlanning', (select count(distinct user_id) from public.plan_generation_jobs where created_at >= p_since)
  ) into v_activity;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'count', c) order by c desc), '[]'::jsonb)
  into v_error_codes
  from (
    select left(coalesce(error_code, 'sin_codigo'), 40) as code, count(*) as c
    from public.coach_requests where created_at >= p_since and outcome = 'error'
    group by 1 order by 2 desc limit 5
  ) top_codes;

  select jsonb_build_object(
    'requests', count(*),
    'errors', count(*) filter (where outcome = 'error'),
    -- Separate observability only: this value is deliberately not an error.
    'safetyBlocked', count(*) filter (where outcome = 'safety_blocked'),
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
  from public.coach_requests where created_at >= p_since;

  select coalesce(jsonb_object_agg(outcome, c), '{}'::jsonb) into v_run_outcomes
  from (select outcome, count(*) as c from public.plan_generation_jobs where created_at >= p_since group by 1) o;
  select jsonb_build_object(
    'runs', count(*), 'byOutcome', v_run_outcomes,
    'firstWeekP50', percentile_cont(0.5) within group (order by first_week_ready_e2e_ms),
    'firstWeekP90', percentile_cont(0.9) within group (order by first_week_ready_e2e_ms),
    'firstWeekP95', percentile_cont(0.95) within group (order by first_week_ready_e2e_ms),
    'completeP50', percentile_cont(0.5) within group (order by (plan_complete_ms + extract(epoch from (worker_started_at - enqueued_at)) * 1000)),
    'completeP90', percentile_cont(0.9) within group (order by (plan_complete_ms + extract(epoch from (worker_started_at - enqueued_at)) * 1000)),
    'completeP95', percentile_cont(0.95) within group (order by (plan_complete_ms + extract(epoch from (worker_started_at - enqueued_at)) * 1000)),
    'costUsd', coalesce(sum(estimated_cost_usd), 0),
    'coverage', jsonb_build_object(
      'rowsTotal', count(*), 'rowsWithCost', count(*) filter (where estimated_cost_usd is not null),
      'tokensTotal', coalesce(sum(coalesce(total_input_tokens, 0) + coalesce(total_output_tokens, 0)), 0),
      'tokensWithCost', coalesce(sum(coalesce(total_input_tokens, 0) + coalesce(total_output_tokens, 0))
        filter (where estimated_cost_usd is not null), 0)
    )
  ) into v_plan
  from public.plan_generation_jobs where created_at >= p_since;

  select coalesce(jsonb_object_agg(outcome, c), '{}'::jsonb) into v_attempt_outcomes
  from (select outcome, count(*) as c from public.plan_generation_attempts where created_at >= p_since group by 1) a;
  select jsonb_build_object('total', count(*), 'byOutcome', v_attempt_outcomes)
  into v_attempts from public.plan_generation_attempts where created_at >= p_since;

  if to_regclass('public.ai_usage_daily') is not null then
    execute $q$
      select jsonb_build_object(
        'startDate', to_char($1::date, 'YYYY-MM-DD'),
        'requests', coalesce(sum(request_count), 0), 'costUsd', coalesce(sum(estimated_cost_usd), 0),
        'byBucket', coalesce((
          select jsonb_object_agg(bucket_id, total) from (
            select bucket_id, sum(request_count) as total from public.ai_usage_daily
            where usage_date >= $1::date group by 1
          ) b
        ), '{}'::jsonb)
      ) from public.ai_usage_daily where usage_date >= $1::date
    $q$ into v_quota using p_since;
  end if;

  return jsonb_build_object(
    'activity', v_activity, 'coach', v_coach, 'planBuilder', v_plan,
    'attempts', v_attempts, 'quota', v_quota,
    'totalCostUsd', coalesce((v_coach->>'costUsd')::numeric, 0) + coalesce((v_plan->>'costUsd')::numeric, 0),
    'totalCostCoverage', jsonb_build_object(
      'rowsTotal', coalesce((v_coach->'coverage'->>'rowsTotal')::bigint, 0) + coalesce((v_plan->'coverage'->>'rowsTotal')::bigint, 0),
      'rowsWithCost', coalesce((v_coach->'coverage'->>'rowsWithCost')::bigint, 0) + coalesce((v_plan->'coverage'->>'rowsWithCost')::bigint, 0),
      'tokensTotal', coalesce((v_coach->'coverage'->>'tokensTotal')::bigint, 0) + coalesce((v_plan->'coverage'->>'tokensTotal')::bigint, 0),
      'tokensWithCost', coalesce((v_coach->'coverage'->>'tokensWithCost')::bigint, 0) + coalesce((v_plan->'coverage'->>'tokensWithCost')::bigint, 0)
    )
  );
end;
$$;

revoke all on function public.read_operations_metrics(timestamptz) from public, anon, authenticated;
grant execute on function public.read_operations_metrics(timestamptz) to service_role;
