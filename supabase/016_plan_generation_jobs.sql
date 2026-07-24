-- Plan/job-level observability for the async Plan Builder. One row per run,
-- grouping the append-only rows of plan_generation_attempts by job_id.
-- Server-only writes (service role); clients may read their own rows.

create table if not exists public.plan_generation_jobs (
  job_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id text not null references public.athletes(id) on delete cascade,
  plan_id text not null references public.training_plans(id) on delete cascade,
  week_count_requested smallint not null check (week_count_requested >= 0),
  week_count_succeeded smallint not null check (week_count_succeeded >= 0),
  week_count_failed smallint not null check (week_count_failed >= 0),
  worker_concurrency smallint null check (worker_concurrency > 0),
  enqueued_at timestamptz not null,
  worker_started_at timestamptz not null,
  first_week_ready_ms integer null check (first_week_ready_ms >= 0),
  first_week_ready_e2e_ms integer null check (first_week_ready_e2e_ms >= 0),
  plan_complete_ms integer null check (plan_complete_ms >= 0),
  terminal_ms integer not null check (terminal_ms >= 0),
  first_week_discoverable_estimated_ms integer null check (first_week_discoverable_estimated_ms >= 0),
  previous_week_context_source text not null check (previous_week_context_source in ('none', 'shell', 'ready')),
  provider text not null,
  model text null,
  effort text null,
  thinking_mode text null,
  temperature real null,
  max_tokens integer null check (max_tokens > 0),
  prompt_version text not null,
  schema_version text not null,
  quality_version smallint not null check (quality_version in (1, 2)),
  variant_id text not null,
  total_input_tokens integer null check (total_input_tokens >= 0),
  total_output_tokens integer null check (total_output_tokens >= 0),
  total_cache_read_tokens integer null check (total_cache_read_tokens >= 0),
  total_cache_creation_tokens integer null check (total_cache_creation_tokens >= 0),
  estimated_cost_usd numeric(12, 6) null check (estimated_cost_usd >= 0),
  outcome text not null check (outcome in ('succeeded', 'partial', 'failed', 'cancelled', 'budget_exhausted')),
  created_at timestamptz not null default now()
);

comment on column public.plan_generation_jobs.first_week_discoverable_estimated_ms is
  'Derived and nullable (spec 5.1): only populated if a future UI test measures effective render; never modelled from the poll interval.';

create index if not exists plan_generation_jobs_user_created_idx
  on public.plan_generation_jobs (user_id, created_at desc);
create index if not exists plan_generation_jobs_variant_created_idx
  on public.plan_generation_jobs (variant_id, created_at desc);
create index if not exists plan_generation_jobs_plan_idx
  on public.plan_generation_jobs (plan_id);

alter table public.plan_generation_jobs enable row level security;

drop policy if exists plan_generation_jobs_select_own on public.plan_generation_jobs;
create policy plan_generation_jobs_select_own
  on public.plan_generation_jobs
  for select
  using (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE for authenticated clients. Service role only.

-- Variant identity + repair taxonomy on the per-attempt rows. Additive.
alter table public.plan_generation_attempts
  add column if not exists variant_id text null,
  add column if not exists effort text null,
  add column if not exists thinking_mode text null,
  add column if not exists prompt_version text null,
  add column if not exists schema_version text null,
  add column if not exists quality_version smallint null check (quality_version in (1, 2)),
  add column if not exists repair_taxonomy_version smallint null check (repair_taxonomy_version = 2),
  add column if not exists corrective_action_count smallint null check (corrective_action_count >= 0),
  add column if not exists structural_action_count smallint null check (structural_action_count >= 0),
  add column if not exists hydration_action_count smallint null check (hydration_action_count >= 0),
  add column if not exists moved_session_count smallint null check (moved_session_count >= 0),
  add column if not exists filtered_sport_count smallint null check (filtered_sport_count >= 0),
  add column if not exists hydrated_sessions_affected smallint null check (hydrated_sessions_affected >= 0),
  add column if not exists corrected_sessions_affected smallint null check (corrected_sessions_affected >= 0),
  add column if not exists structurally_repaired_sessions_affected smallint null check (structurally_repaired_sessions_affected >= 0);

create index if not exists plan_generation_attempts_variant_created_idx
  on public.plan_generation_attempts (variant_id, created_at desc);
