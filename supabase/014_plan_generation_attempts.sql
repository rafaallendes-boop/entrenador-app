-- Append-only observability for the expensive server-side Plan Builder path.
-- Deliberately excludes prompts, provider responses and session payloads.

create table if not exists public.plan_generation_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id text not null references public.athletes(id) on delete cascade,
  plan_id text not null references public.training_plans(id) on delete cascade,
  job_id text not null,
  week_index integer not null check (week_index >= 0),
  attempt smallint not null check (attempt > 0),
  trace_id text not null,
  provider text not null,
  model text null,
  input_tokens integer null check (input_tokens >= 0),
  output_tokens integer null check (output_tokens >= 0),
  cache_creation_input_tokens integer null check (cache_creation_input_tokens >= 0),
  cache_read_input_tokens integer null check (cache_read_input_tokens >= 0),
  duration_ms integer null check (duration_ms >= 0),
  stop_reason text null,
  outcome text not null check (outcome in ('succeeded', 'validation_failed', 'truncated', 'provider_failed')),
  error_class text null,
  retry_used boolean not null default false,
  max_tokens integer null check (max_tokens > 0),
  worker_concurrency smallint null check (worker_concurrency > 0),
  raw_session_count smallint null check (raw_session_count >= 0),
  valid_session_count smallint null check (valid_session_count >= 0),
  dropped_session_count smallint null check (dropped_session_count >= 0),
  repaired_session_count smallint null check (repaired_session_count >= 0),
  added_fallback_count smallint null check (added_fallback_count >= 0),
  quality_score smallint null check (quality_score between 0 and 100),
  quality_grade text null check (quality_grade in ('excellent', 'good', 'needs_review', 'poor')),
  quality_critical_issue_count smallint null check (quality_critical_issue_count >= 0),
  quality_warning_count smallint null check (quality_warning_count >= 0),
  created_at timestamptz not null default now(),
  constraint plan_generation_attempts_job_week_attempt_key
    unique (job_id, week_index, attempt)
);

-- trace_id identifies a provider call for correlation, but callers may reuse it.
-- Replay idempotency is scoped to the durable job/week/attempt identity above.
alter table public.plan_generation_attempts
  drop constraint if exists plan_generation_attempts_trace_key;

create index if not exists plan_generation_attempts_user_created_idx
  on public.plan_generation_attempts (user_id, created_at desc);

create index if not exists plan_generation_attempts_plan_week_idx
  on public.plan_generation_attempts (plan_id, week_index, attempt);

create index if not exists plan_generation_attempts_outcome_created_idx
  on public.plan_generation_attempts (outcome, created_at desc);

alter table public.plan_generation_attempts enable row level security;

drop policy if exists plan_generation_attempts_select_own on public.plan_generation_attempts;
create policy plan_generation_attempts_select_own
  on public.plan_generation_attempts
  for select
  using (auth.uid() = user_id);

-- Intentionally no INSERT, UPDATE or DELETE policies for authenticated clients.
-- Netlify writes and retention use the server-only service role. An attempt is
-- immutable and cannot be fabricated or changed from the browser.

-- Cancellation is sticky for the same job. This closes the race where a
-- background checkpoint could overwrite cancelRequested=true written by the
-- client between the worker's last poll and its upsert. A later retrigger has a
-- different (or not-yet-assigned) jobId, so it can clear a stale request. When
-- cancellation happens before enqueue assigns a jobId, the first assigned job
-- adopts that request; a no-jobId -> no-jobId retrigger still clears it.
create or replace function public.preserve_active_plan_cancel_requested()
returns trigger
language plpgsql
as $$
begin
  if coalesce((old.generation_summary ->> 'cancelRequested')::boolean, false)
     and (
       (
         old.generation_summary ->> 'jobId' is null
         and new.generation_summary ->> 'jobId' is not null
       )
       or old.generation_summary ->> 'jobId' = new.generation_summary ->> 'jobId'
     )
     and not coalesce((new.generation_summary ->> 'cancelRequested')::boolean, false) then
    new.generation_summary = jsonb_set(
      coalesce(new.generation_summary, '{}'::jsonb),
      '{cancelRequested}',
      'true'::jsonb,
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists training_plans_preserve_active_cancel on public.training_plans;
create trigger training_plans_preserve_active_cancel
before update on public.training_plans
for each row execute function public.preserve_active_plan_cancel_requested();
