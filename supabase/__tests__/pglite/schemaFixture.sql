-- Fixture mínimo para ejecutar migraciones en PGlite. Replica SOLO lo que 037
-- presupone: auth.users, user_entitlements (020+028), athletes (007),
-- athlete_memberships + índices + trigger de siembra (013b) y el trigger de
-- invariantes de rol vigentes (031). No es un dump de producción.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

create table public.user_entitlements (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  tier         text not null check (tier in ('free','weekly','advanced')),
  expires_at   timestamptz,
  source       text not null default 'manual',
  note         text,
  granted_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  account_role text not null default 'athlete' check (account_role in ('athlete','coach'))
);

create table public.athletes (
  id                text primary key,
  owner_account_id  uuid not null references auth.users(id) on delete cascade,
  linked_account_id uuid null references auth.users(id) on delete set null,
  display_name      text,
  status            text not null default 'active',
  created_at        bigint not null,
  updated_at        bigint not null
);

create table public.athlete_memberships (
  athlete_id text not null references public.athletes(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('self','coach')),
  created_at bigint not null,
  updated_at bigint not null,
  primary key (athlete_id, account_id)
);
create unique index athlete_memberships_one_self_per_account
  on public.athlete_memberships (account_id) where role = 'self';
create unique index athlete_memberships_one_self_per_athlete
  on public.athlete_memberships (athlete_id) where role = 'self';
