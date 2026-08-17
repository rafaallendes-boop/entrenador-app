-- 021_ai_usage_daily.sql
-- Cuota diaria durable + circuit breaker de gasto (Pre-Lanzamiento puntos 3 y 4).
-- Ver docs/superpowers/specs/2026-08-16-ai-usage-rate-limits-design.md
-- Aplicación manual, como todas las anteriores.

create table public.ai_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  bucket_id text not null,
  request_count integer not null default 0 check (request_count >= 0),
  estimated_cost_usd numeric(12, 6) not null default 0 check (estimated_cost_usd >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, bucket_id)
);

alter table public.ai_usage_daily enable row level security;

create policy ai_usage_daily_select_own
  on public.ai_usage_daily
  for select
  using (auth.uid() = user_id);

-- Sin INSERT/UPDATE/DELETE para clientes. service_role es el único escritor.
revoke all on public.ai_usage_daily from anon, authenticated;
grant select (user_id, usage_date, bucket_id, request_count, estimated_cost_usd, updated_at)
  on public.ai_usage_daily to authenticated;

-- Check-and-increment atómico. Una fila si el incremento quedó bajo p_limit,
-- cero filas si lo hubiera excedido — no hay ventana de "leer y después
-- escribir". Solo invocable con service_role.
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

-- Gasto acumulado hoy: por cuenta y global. Solo lectura, no gatea nada por
-- sí sola. Solo invocable con service_role.
create or replace function public.read_ai_usage_spend(p_user_id uuid)
returns table (account_cost_usd numeric, global_cost_usd numeric)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(estimated_cost_usd) filter (where user_id = p_user_id), 0) as account_cost_usd,
    coalesce(sum(estimated_cost_usd), 0) as global_cost_usd
  from public.ai_usage_daily
  where usage_date = current_date;
$$;

revoke all on function public.read_ai_usage_spend(uuid) from public, anon, authenticated;
grant execute on function public.read_ai_usage_spend(uuid) to service_role;

-- Acumula costo real sobre la fila que un incremento previo ya reservó. Es
-- un UPDATE, no un upsert: la fila tiene que existir (la creó
-- increment_ai_usage_if_under_limit). Atómico por la misma razón que el
-- contador — SET x = x + delta en una sola sentencia, sin leer antes.
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
begin
  if p_delta <= 0 or p_user_id is null or p_bucket_id is null or p_usage_date is null then
    return;
  end if;

  return query
  update public.ai_usage_daily
     set estimated_cost_usd = ai_usage_daily.estimated_cost_usd + p_delta,
         updated_at = now()
   where ai_usage_daily.user_id = p_user_id
     and ai_usage_daily.usage_date = p_usage_date
     and ai_usage_daily.bucket_id = p_bucket_id
  returning ai_usage_daily.estimated_cost_usd;
end;
$$;

revoke all on function public.increment_ai_usage_cost(uuid, text, date, numeric)
  from public, anon, authenticated;
grant execute on function public.increment_ai_usage_cost(uuid, text, date, numeric)
  to service_role;

-- quota_exhausted es distinto de budget_exhausted (wallclock) Y de failed:
-- solo cubre agotar la CUOTA DIARIA de plan_builder_week. Un rechazo por
-- techo de gasto o kill switch durante el loop termina como 'failed' (ver
-- asyncGenerationLoop.ts) — no comparte este outcome.
alter table public.plan_generation_jobs drop constraint plan_generation_jobs_outcome_check;
alter table public.plan_generation_jobs add constraint plan_generation_jobs_outcome_check
  check (outcome in ('succeeded', 'partial', 'failed', 'cancelled', 'budget_exhausted', 'quota_exhausted'));
