-- 029_ai_usage_daily_subject.sql
-- Cuota delegada: tope por par (coach, atleta) además del global de la cuenta.
-- Aplicación manual. UNA sola transacción: cambiar la PK invalida el
-- `on conflict` de los consumidores antiguos, así que todos se redefinen acá.
--
-- La fila GLOBAL es `subject_athlete_id = ''` y es la ÚNICA contable: costo,
-- spend cap y métricas leen sólo esa. Las filas por sujeto son limitadores de
-- tasa, con costo siempre 0.

begin;

alter table public.ai_usage_daily
  add column if not exists subject_athlete_id text not null default '';

alter table public.ai_usage_daily drop constraint if exists ai_usage_daily_pkey;
alter table public.ai_usage_daily
  add primary key (user_id, usage_date, bucket_id, subject_athlete_id);

grant select (user_id, usage_date, bucket_id, subject_athlete_id, request_count, estimated_cost_usd, updated_at)
  on public.ai_usage_daily to authenticated;

-- ── 1. Reserva: global sola, o global + sujeto en la misma transacción ──────
create or replace function public.reserve_ai_usage(
  p_user_id uuid,
  p_bucket_id text,
  p_limit integer,
  p_subject_athlete_id text default null,
  p_subject_limit integer default null
)
returns table (usage_date date, request_count integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_rows integer;
begin
  -- `null < 1` es null, no true: sin `is null` el insert de una fila nueva
  -- reservaría una unidad pese a no tener límite válido.
  if p_limit is null or p_limit < 1
     or p_user_id is null or p_bucket_id is null or length(p_bucket_id) = 0 then
    return;
  end if;

  if (p_subject_athlete_id is null) <> (p_subject_limit is null) then
    raise exception 'reserve_ai_usage: subject and subject_limit must be provided together';
  end if;
  if p_subject_athlete_id is not null
     and (length(p_subject_athlete_id) = 0
          or p_subject_limit is null or p_subject_limit < 1) then
    raise exception 'reserve_ai_usage: invalid subject arguments';
  end if;

  -- Fila global: la única que acumula costo y participa en spend caps.
  insert into public.ai_usage_daily (user_id, usage_date, bucket_id, subject_athlete_id, request_count)
  values (p_user_id, current_date, p_bucket_id, '', 1)
  on conflict (user_id, usage_date, bucket_id, subject_athlete_id)
  do update set request_count = ai_usage_daily.request_count + 1, updated_at = now()
   where ai_usage_daily.request_count + 1 <= p_limit;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception using errcode = '45001', message = 'quota_exceeded', detail = 'account';
  end if;

  -- Fila de sujeto: sólo limitador. Un RAISE revierte también la reserva global
  -- anterior porque ambas sentencias viven en la misma invocación transaccional.
  if p_subject_athlete_id is not null then
    insert into public.ai_usage_daily (user_id, usage_date, bucket_id, subject_athlete_id, request_count)
    values (p_user_id, current_date, p_bucket_id, p_subject_athlete_id, 1)
    on conflict (user_id, usage_date, bucket_id, subject_athlete_id)
    do update set request_count = ai_usage_daily.request_count + 1, updated_at = now()
     where ai_usage_daily.request_count + 1 <= p_subject_limit;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception using errcode = '45001', message = 'quota_exceeded', detail = 'subject';
    end if;
  end if;

  return query
  select d.usage_date, d.request_count
  from public.ai_usage_daily d
  where d.user_id = p_user_id
    and d.usage_date = current_date
    and d.bucket_id = p_bucket_id
    and d.subject_athlete_id = '';
end;
$$;

revoke all on function public.reserve_ai_usage(uuid, text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid, text, integer, text, integer) to service_role;

-- ── 2. Incrementador legacy: el ON CONFLICT de tres columnas ya no existe ───
-- Mantenerlo operativo sobre la fila global hace posible volver temporalmente
-- al bundle anterior sin que la cuota falle por 42P10.
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
  if p_limit is null or p_limit < 1
     or p_user_id is null or p_bucket_id is null or length(p_bucket_id) = 0 then
    return;
  end if;

  return query
  insert into public.ai_usage_daily (user_id, usage_date, bucket_id, subject_athlete_id, request_count)
  values (p_user_id, current_date, p_bucket_id, '', 1)
  on conflict (user_id, usage_date, bucket_id, subject_athlete_id)
  do update set request_count = ai_usage_daily.request_count + 1, updated_at = now()
   where ai_usage_daily.request_count + 1 <= p_limit
  returning ai_usage_daily.usage_date, ai_usage_daily.request_count;
end;
$$;

revoke all on function public.increment_ai_usage_if_under_limit(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.increment_ai_usage_if_under_limit(uuid, text, integer) to service_role;

-- ── 3. Costo: SÓLO la fila global ──────────────────────────────────────────
create or replace function public.increment_ai_usage_cost(
  p_user_id uuid,
  p_bucket_id text,
  p_usage_date date,
  p_delta numeric
)
returns table (estimated_cost_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if p_delta is null or p_delta <= 0
     or p_user_id is null or p_bucket_id is null or p_usage_date is null then
    return;
  end if;

  return query
  update public.ai_usage_daily
     set estimated_cost_usd = ai_usage_daily.estimated_cost_usd + p_delta,
         updated_at = now()
   where ai_usage_daily.user_id = p_user_id
     and ai_usage_daily.usage_date = p_usage_date
     and ai_usage_daily.bucket_id = p_bucket_id
     and ai_usage_daily.subject_athlete_id = ''
  returning ai_usage_daily.estimated_cost_usd;
end;
$$;

revoke all on function public.increment_ai_usage_cost(uuid, text, date, numeric)
  from public, anon, authenticated;
grant execute on function public.increment_ai_usage_cost(uuid, text, date, numeric) to service_role;

-- ── 4. Spend cap: SÓLO la fila global ──────────────────────────────────────
create or replace function public.read_ai_usage_spend(p_user_id uuid)
returns table (account_cost_usd numeric, global_cost_usd numeric)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(estimated_cost_usd) filter (where user_id = p_user_id), 0),
    coalesce(sum(estimated_cost_usd), 0)
  from public.ai_usage_daily
  where usage_date = current_date
    and subject_athlete_id = '';
$$;

revoke all on function public.read_ai_usage_spend(uuid) from public, anon, authenticated;
grant execute on function public.read_ai_usage_spend(uuid) to service_role;

-- ── 5. Métricas: versión vigente de 025, sólo fila global en cuota ──────────
create or replace function public.read_operations_metrics(p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
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
            where usage_date >= $1::date
              and subject_athlete_id = ''
            group by 1
          ) b
        ), '{}'::jsonb)
      ) from public.ai_usage_daily
      where usage_date >= $1::date
        and subject_athlete_id = ''
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

commit;

notify pgrst, 'reload schema';
