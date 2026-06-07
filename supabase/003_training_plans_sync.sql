create table if not exists public.training_plans (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id text not null,
  goal_event_id text not null,
  status text not null check (status in ('draft', 'active', 'archived', 'superseded')),
  generation_state text not null default 'complete' check (generation_state in ('shell', 'generating', 'partial', 'failed', 'complete', 'cancelled')),
  title text not null,
  start_date text not null,
  end_date text not null,
  total_weeks integer not null,
  phases jsonb not null default '[]'::jsonb,
  wizard_config jsonb not null default '{}'::jsonb,
  macro_snapshot jsonb not null default '{}'::jsonb,
  created_at bigint not null,
  updated_at bigint not null,
  accepted_at bigint null,
  notes text null,
  generation_summary jsonb null,
  deleted_at bigint null
);

create table if not exists public.training_plan_weeks (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.training_plans(id) on delete cascade,
  week_index integer not null,
  week_start_date text not null,
  phase text not null,
  status text not null,
  sessions jsonb not null default '[]'::jsonb,
  week_objectives jsonb not null default '[]'::jsonb,
  target_load_by_sport jsonb not null default '{}'::jsonb,
  validation_issues jsonb not null default '[]'::jsonb,
  generation_meta jsonb not null default '{}'::jsonb,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint null
);

create index if not exists training_plans_user_status_updated_idx
  on public.training_plans (user_id, status, updated_at desc);

create index if not exists training_plan_weeks_user_plan_week_idx
  on public.training_plan_weeks (user_id, plan_id, week_index);

create index if not exists training_plan_weeks_user_week_start_idx
  on public.training_plan_weeks (user_id, week_start_date);

alter table public.training_plans enable row level security;
alter table public.training_plan_weeks enable row level security;

drop policy if exists "training_plans_select_own" on public.training_plans;
create policy "training_plans_select_own"
  on public.training_plans
  for select
  using (auth.uid() = user_id);

drop policy if exists "training_plans_insert_own" on public.training_plans;
create policy "training_plans_insert_own"
  on public.training_plans
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "training_plans_update_own" on public.training_plans;
create policy "training_plans_update_own"
  on public.training_plans
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "training_plans_delete_own" on public.training_plans;
create policy "training_plans_delete_own"
  on public.training_plans
  for delete
  using (auth.uid() = user_id);

drop policy if exists "training_plan_weeks_select_own" on public.training_plan_weeks;
create policy "training_plan_weeks_select_own"
  on public.training_plan_weeks
  for select
  using (auth.uid() = user_id);

drop policy if exists "training_plan_weeks_insert_own" on public.training_plan_weeks;
create policy "training_plan_weeks_insert_own"
  on public.training_plan_weeks
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "training_plan_weeks_update_own" on public.training_plan_weeks;
create policy "training_plan_weeks_update_own"
  on public.training_plan_weeks
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "training_plan_weeks_delete_own" on public.training_plan_weeks;
create policy "training_plan_weeks_delete_own"
  on public.training_plan_weeks
  for delete
  using (auth.uid() = user_id);
