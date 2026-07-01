-- Athlete Scope Foundation: expand + backfill (sin contract).
--
-- athlete_id es TEXT (alineado con los PK text del proyecto y con
-- training_plans.athlete_id existente). Mantiene user_id y las politicas
-- legacy por usuario. No crea coach_athlete_links (diferido a F2/F3).

-- 1. Tabla athletes (PK text, generada client-side como el resto de entidades).
create table if not exists public.athletes (
  id text primary key,
  owner_account_id uuid not null references auth.users(id) on delete cascade,
  linked_account_id uuid null references auth.users(id) on delete set null,
  display_name text null,
  status text not null default 'active',
  created_at bigint not null,
  updated_at bigint not null
);

alter table public.athletes enable row level security;

drop policy if exists athletes_select on public.athletes;
create policy athletes_select on public.athletes
  for select using (auth.uid() = owner_account_id or auth.uid() = linked_account_id);

drop policy if exists athletes_insert on public.athletes;
create policy athletes_insert on public.athletes
  for insert with check (auth.uid() = owner_account_id);

drop policy if exists athletes_update on public.athletes;
create policy athletes_update on public.athletes
  for update using (auth.uid() = owner_account_id) with check (auth.uid() = owner_account_id);

drop policy if exists athletes_delete on public.athletes;
create policy athletes_delete on public.athletes
  for delete using (auth.uid() = owner_account_id);

-- 2. Backfill idempotente: un athlete por usuario con datos existentes.
--    id deterministico: 'ath_' || user_id.
create temporary table if not exists athlete_scope_owner_ids (
  user_id uuid primary key
);

truncate athlete_scope_owner_ids;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'athlete_profiles',
    'sessions',
    'day_logs',
    'week_summaries',
    'chat_messages',
    'coach_proposals',
    'training_plans',
    'training_plan_weeks'
  ]
  loop
    if to_regclass('public.' || tbl) is not null
       and exists (
         select 1
         from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = tbl
           and c.column_name = 'user_id'
       ) then
      execute format(
        'insert into athlete_scope_owner_ids (user_id)
         select distinct user_id from public.%I where user_id is not null
         on conflict (user_id) do nothing',
        tbl
      );
    end if;
  end loop;
end $$;

insert into public.athletes (
  id,
  owner_account_id,
  linked_account_id,
  status,
  created_at,
  updated_at
)
select
  'ath_' || user_id::text,
  user_id,
  user_id,
  'active',
  (extract(epoch from now()) * 1000)::bigint,
  (extract(epoch from now()) * 1000)::bigint
from athlete_scope_owner_ids
on conflict (id) do nothing;

drop table if exists athlete_scope_owner_ids;

-- Preserve any non-default training_plans.athlete_id already present, then
-- backfill default/null values. Guarded for partially migrated/staging schemas.
do $$
begin
  if to_regclass('public.training_plans') is not null
     and exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = 'training_plans'
         and c.column_name = 'user_id'
     )
     and exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = 'training_plans'
         and c.column_name = 'athlete_id'
     ) then
    insert into public.athletes (
      id,
      owner_account_id,
      linked_account_id,
      status,
      created_at,
      updated_at
    )
    select distinct
      tp.athlete_id,
      tp.user_id,
      tp.user_id,
      'active',
      (extract(epoch from now()) * 1000)::bigint,
      (extract(epoch from now()) * 1000)::bigint
    from public.training_plans tp
    where tp.athlete_id is not null
      and tp.athlete_id <> 'default'
    on conflict (id) do nothing;

    -- 3a. training_plans: athlete_id text not null ya existe; backfill de valor.
    update public.training_plans
    set athlete_id = 'ath_' || user_id::text
    where athlete_id is null or athlete_id = 'default';
  end if;
end $$;

-- 3b. Resto de tablas: agregar athlete_id text nullable si la tabla existe.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'sessions',
    'day_logs',
    'week_summaries',
    'chat_messages',
    'coach_proposals',
    'athlete_profiles',
    'training_plan_weeks'
  ]
  loop
    if to_regclass('public.' || tbl) is not null then
      execute format('alter table public.%I add column if not exists athlete_id text', tbl);
    end if;
  end loop;
end $$;

-- 3c. Backfill directo por usuario para tablas 1:1 actuales.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'sessions',
    'day_logs',
    'week_summaries',
    'chat_messages',
    'coach_proposals',
    'athlete_profiles'
  ]
  loop
    if to_regclass('public.' || tbl) is not null
       and exists (
         select 1
         from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = tbl
           and c.column_name = 'user_id'
       )
       and exists (
         select 1
         from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = tbl
           and c.column_name = 'athlete_id'
       ) then
      execute format(
        'update public.%I set athlete_id = %L || user_id::text where athlete_id is null',
        tbl,
        'ath_'
      );
    end if;
  end loop;
end $$;

-- 3d. training_plan_weeks deriva su athlete_id desde el plan padre, no desde user_id.
do $$
begin
  if to_regclass('public.training_plan_weeks') is not null
     and to_regclass('public.training_plans') is not null
     and exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = 'training_plan_weeks'
         and c.column_name = 'athlete_id'
     )
     and exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = 'training_plan_weeks'
         and c.column_name = 'plan_id'
     )
     and exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = 'training_plans'
         and c.column_name = 'athlete_id'
     ) then
    update public.training_plan_weeks tpw
    set athlete_id = tp.athlete_id
    from public.training_plans tp
    where tpw.plan_id = tp.id
      and tpw.athlete_id is null;
  end if;
end $$;

-- 4. Indices + FK not valid (sin contract; se valida cuando no haya huerfanas).
do $$
declare
  tbl text;
  constraint_name text;
begin
  foreach tbl in array array[
    'sessions',
    'day_logs',
    'week_summaries',
    'chat_messages',
    'coach_proposals',
    'athlete_profiles',
    'training_plans',
    'training_plan_weeks'
  ]
  loop
    if to_regclass('public.' || tbl) is not null
       and exists (
         select 1
         from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = tbl
           and c.column_name = 'athlete_id'
       ) then
      execute format('create index if not exists %I on public.%I (athlete_id)', tbl || '_athlete_idx', tbl);

      -- FK for all scoped tables, including training_plans. Section 3a backfills
      -- training_plans.athlete_id ('default' -> 'ath_<user_id>') before this runs,
      -- and the constraint is NOT VALID, so adding it never blocks on existing rows.
      constraint_name := tbl || '_athlete_fk';
      if not exists (
        select 1
        from pg_constraint
        where conname = constraint_name
          and conrelid = format('public.%I', tbl)::regclass
      ) then
        execute format(
          'alter table public.%I add constraint %I foreign key (athlete_id) references public.athletes(id) on delete cascade not valid',
          tbl,
          constraint_name
        );
      end if;
    end if;
  end loop;
end $$;

-- 5. RLS transicional por athlete propio. Las politicas legacy por user_id se mantienen.
--    En Fase B solo se agrega SELECT por athlete_id. Las politicas de escritura
--    por athlete_id se difieren a Fase D para evitar bypasses cross-tenant con
--    filas legacy/null; las escrituras legacy siguen cubiertas por user_id.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'sessions',
    'day_logs',
    'week_summaries',
    'chat_messages',
    'coach_proposals',
    'athlete_profiles',
    'training_plans',
    'training_plan_weeks'
  ]
  loop
    if to_regclass('public.' || tbl) is not null
       and exists (
         select 1
         from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = tbl
           and c.column_name = 'athlete_id'
       ) then
      execute format('drop policy if exists %I on public.%I', tbl || '_select_by_athlete', tbl);
      execute format(
        'create policy %I on public.%I for select using (
          athlete_id in (select id from public.athletes where owner_account_id = auth.uid() or linked_account_id = auth.uid())
        )',
        tbl || '_select_by_athlete',
        tbl
      );

      -- Defensive cleanup in case an earlier draft of this migration was applied.
      execute format('drop policy if exists %I on public.%I', tbl || '_insert_by_athlete', tbl);
      execute format('drop policy if exists %I on public.%I', tbl || '_update_by_athlete', tbl);
      execute format('drop policy if exists %I on public.%I', tbl || '_delete_by_athlete', tbl);
    end if;
  end loop;
end $$;
