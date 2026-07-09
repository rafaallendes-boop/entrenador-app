-- Whoop integration (athlete_id first).
-- whoop_connections / oauth states belong to the account (user_id).
-- biometric_readings / readiness_daily belong to the self athlete (athlete_id).
-- whoop_connections, whoop_oauth_states and biometric_readings are SERVER-ONLY:
-- RLS enabled with no authenticated/anon policies, so only service-role can access them.
-- readiness_daily is client-readable only for accounts with access to the athlete.

create table if not exists public.whoop_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  key_version smallint not null default 1,
  expires_at timestamptz not null,
  whoop_user_id text null,
  scopes text null,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz null,
  last_manual_sync_at timestamptz null,
  last_sync_status text null check (last_sync_status in ('ok', 'error'))
);

create table if not exists public.whoop_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.biometric_readings (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id text not null references public.athletes(id) on delete cascade,
  source text not null,
  metric text not null,
  value numeric null,
  recorded_at timestamptz not null,
  raw_id text null
);

create index if not exists biometric_readings_user_idx
  on public.biometric_readings (user_id, recorded_at);

create index if not exists biometric_readings_athlete_idx
  on public.biometric_readings (athlete_id, recorded_at);

create table if not exists public.readiness_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id text not null references public.athletes(id) on delete cascade,
  date text not null,
  recovery_score numeric null,
  hrv_ms numeric null,
  rhr_bpm numeric null,
  strain numeric null,
  sleep_hours numeric null,
  sleep_performance numeric null,
  source text not null default 'whoop',
  updated_at bigint not null,
  primary key (athlete_id, date, source)
);

create index if not exists readiness_daily_user_idx
  on public.readiness_daily (user_id, date);

-- RLS: server-only tables (enabled, no client policies).
alter table public.whoop_connections enable row level security;
alter table public.whoop_oauth_states enable row level security;
alter table public.biometric_readings enable row level security;

-- RLS: readiness_daily client-readable by athlete access.
-- SP1 migration note: replace this predicate with athlete_memberships once landed.
alter table public.readiness_daily enable row level security;

drop policy if exists readiness_daily_select on public.readiness_daily;
create policy readiness_daily_select on public.readiness_daily
  for select using (
    exists (
      select 1
      from public.athletes a
      where a.id = readiness_daily.athlete_id
        and (a.owner_account_id = auth.uid() or a.linked_account_id = auth.uid())
    )
  );
