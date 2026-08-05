-- Telemetría por request del coach síncrono. El Plan Builder async no pasa
-- por esta tabla: está cubierto por 016.
--
-- Escritura con el token del usuario. Sin update ni delete para clientes; la
-- retención usa service role desde otra función.
-- Sin contenido de mensajes: solo conteos y metadata.

create table if not exists public.coach_requests (
  id bigint generated always as identity primary key,
  trace_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_id text null,
  logical_attempt smallint null check (logical_attempt >= 1),
  request_class text not null check (request_class in (
    'chat_general', 'chat_action', 'weekly_summary', 'week_creator',
    'plan_builder_week', 'plan_builder_pair', 'import_extract'
  )),
  streamed boolean not null,
  outcome text not null check (outcome in ('ok', 'error')),
  error_code text null,
  finish_reason text null,
  retry_used boolean null,
  fallback_used boolean null,
  auth_duration_ms integer not null check (auth_duration_ms >= 0),
  provider_duration_ms integer null check (provider_duration_ms >= 0),
  server_duration_ms integer not null check (server_duration_ms >= 0),
  provider text null,
  model text null,
  service_tier text null,
  reasoning_effort text null,
  prompt_tokens integer null check (prompt_tokens >= 0),
  completion_tokens integer null check (completion_tokens >= 0),
  reasoning_tokens integer null check (reasoning_tokens >= 0),
  cache_creation_input_tokens integer null check (cache_creation_input_tokens >= 0),
  cache_read_input_tokens integer null check (cache_read_input_tokens >= 0),
  response_char_count integer null check (response_char_count >= 0),
  estimated_cost_usd numeric(12, 6) null check (estimated_cost_usd >= 0),
  created_at timestamptz not null default now()
);

comment on column public.coach_requests.streamed is
  'Transporte efectivo, no el solicitado. El bypass determinista respeta req.stream.';
comment on column public.coach_requests.estimated_cost_usd is
  '0 = bypass determinista; null = precio ausente o usage insuficiente; n = estimado.';

create index if not exists coach_requests_user_created_idx
  on public.coach_requests (user_id, created_at desc);
create index if not exists coach_requests_class_created_idx
  on public.coach_requests (request_class, created_at desc);
create index if not exists coach_requests_trace_created_idx
  on public.coach_requests (trace_id, created_at desc);

alter table public.coach_requests enable row level security;

drop policy if exists coach_requests_select_own on public.coach_requests;
create policy coach_requests_select_own
  on public.coach_requests
  for select
  using (auth.uid() = user_id);

drop policy if exists coach_requests_insert_own on public.coach_requests;
create policy coach_requests_insert_own
  on public.coach_requests
  for insert
  with check (auth.uid() = user_id);

-- Sin UPDATE ni DELETE para clientes. La retención usa service role.
