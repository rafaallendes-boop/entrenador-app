alter table public.training_plans
  drop constraint if exists training_plans_status_check;

alter table public.training_plans
  add constraint training_plans_status_check
  check (status in ('draft', 'active', 'archived', 'superseded'));

alter table public.training_plans
  add column if not exists generation_state text not null default 'complete';

alter table public.training_plans
  drop constraint if exists training_plans_generation_state_check;

alter table public.training_plans
  add constraint training_plans_generation_state_check
  check (generation_state in ('shell', 'generating', 'partial', 'failed', 'complete', 'cancelled'));

update public.training_plans
set generation_state = 'complete'
where generation_state is null;
