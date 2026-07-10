-- WHOOP workouts used for athlete-scoped adherence auto-completion.
-- Writes use the service role; clients only receive rows for accessible athletes.

create table if not exists public.whoop_workouts (
  workout_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id text not null references public.athletes(id) on delete cascade,
  date text not null,
  sport_name text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  duration_min numeric not null,
  strain numeric null,
  avg_hr numeric null,
  max_hr numeric null,
  distance_m numeric null,
  score_state text not null check (score_state in ('SCORED', 'PENDING_SCORE', 'UNSCORABLE')),
  updated_at bigint not null
);

create index if not exists whoop_workouts_athlete_idx
  on public.whoop_workouts (athlete_id, date);

create index if not exists whoop_workouts_athlete_start_idx
  on public.whoop_workouts (athlete_id, start_at);

create index if not exists whoop_workouts_user_idx
  on public.whoop_workouts (user_id, date);

alter table public.whoop_workouts enable row level security;

drop policy if exists whoop_workouts_select on public.whoop_workouts;
create policy whoop_workouts_select on public.whoop_workouts
  for select using (
    exists (
      select 1
      from public.athletes a
      where a.id = whoop_workouts.athlete_id
        and (a.owner_account_id = auth.uid() or a.linked_account_id = auth.uid())
    )
  );
