-- 026_fix_athlete_profiles_sync_contract.sql
--
-- INCIDENTE: los perfiles gestionados fallan con HTTP 409 en
--   /rest/v1/athlete_profiles?on_conflict=athlete_id
-- cuando producción todavía conserva el índice UNIQUE legado por user_id.
-- Ese contrato permitía un solo perfil por cuenta; RallyIQ necesita un perfil
-- canónico por athlete_id, aunque una misma cuenta gestione varios atletas.
--
-- ROLLOUT:
--   1. Ejecutar en una ventana de bajo tráfico.
--   2. La migración aborta sin borrar filas si encuentra perfiles ambiguos,
--      huérfanos o sin athlete_id que no pueda asociar al self.
--   3. Refrescar la app y ejecutar "Sincronizar ahora". El merge conserva los
--      perfiles locales gestionados ausentes en remoto y vuelve a empujarlos,
--      incluso si la operación original ya expiró.
--
-- Es idempotente y converge tanto desde 009b/009c como desde 013b. No aplica
-- 013a/b/c ni habilita SP1: sólo repara el contrato de athlete_profiles.

begin;

lock table public.athlete_profiles in share row exclusive mode;

-- Recupera únicamente deuda legacy del perfil self. Preferimos el athlete cuyo
-- owner y linked son la misma cuenta; el id determinista de 007 queda como
-- fallback. Nunca se elige un atleta gestionado (linked_account_id null).
update public.athlete_profiles p
set athlete_id = coalesce(
  (
    select a.id
    from public.athletes a
    where a.owner_account_id = p.user_id
      and a.linked_account_id = p.user_id
    order by a.updated_at desc, a.id asc
    limit 1
  ),
  (
    select a.id
    from public.athletes a
    where a.id = 'ath_' || p.user_id::text
      and a.owner_account_id = p.user_id
    limit 1
  )
)
where p.athlete_id is null;

-- Fail closed: no se inventan parents ni se fusiona JSON deportivo en SQL.
-- Cualquier deuda restante necesita inspección humana antes de cambiar índices.
do $$
declare
  null_profiles integer;
  orphan_profiles integer;
  duplicate_athletes integer;
begin
  select count(*) into null_profiles
  from public.athlete_profiles
  where athlete_id is null;

  select count(*) into orphan_profiles
  from public.athlete_profiles p
  where not exists (
    select 1 from public.athletes a where a.id = p.athlete_id
  );

  select count(*) into duplicate_athletes
  from (
    select athlete_id
    from public.athlete_profiles
    group by athlete_id
    having count(*) > 1
  ) duplicate_groups;

  if null_profiles > 0 or orphan_profiles > 0 or duplicate_athletes > 0 then
    raise exception
      '026 aborted: athlete_profiles has % null athlete_id, % orphan rows and % duplicate athlete groups. No rows were deleted.',
      null_profiles,
      orphan_profiles,
      duplicate_athletes;
  end if;
end $$;

-- PostgREST on_conflict=athlete_id depende de un unique cuyo target sea
-- exactamente athlete_id. El nombre coincide con 013b para que ambos caminos
-- de migración converjan en el mismo contrato.
create unique index if not exists athlete_profiles_one_per_athlete
  on public.athlete_profiles (athlete_id);

alter table public.athlete_profiles
  alter column athlete_id set not null;

-- Elimina cualquier UNIQUE de una sola columna sobre user_id, no sólo el nombre
-- histórico de 002. Un constraint con otro nombre produciría el mismo 409.
do $$
declare
  legacy record;
begin
  for legacy in
    select
      index_class.relname as index_name,
      unique_constraint.conname as constraint_name
    from pg_index index_meta
    join pg_class index_class
      on index_class.oid = index_meta.indexrelid
    join pg_attribute user_column
      on user_column.attrelid = index_meta.indrelid
     and user_column.attname = 'user_id'
     and not user_column.attisdropped
    left join pg_constraint unique_constraint
      on unique_constraint.conindid = index_meta.indexrelid
    where index_meta.indrelid = 'public.athlete_profiles'::regclass
      and index_meta.indisunique
      and not index_meta.indisprimary
      and index_meta.indnkeyatts = 1
      and exists (
        select 1
        from unnest(index_meta.indkey) with ordinality as key_column(attnum, position)
        where key_column.position = 1
          and key_column.attnum = user_column.attnum
      )
  loop
    if legacy.constraint_name is not null then
      execute format(
        'alter table public.athlete_profiles drop constraint %I',
        legacy.constraint_name
      );
    else
      execute format('drop index public.%I', legacy.index_name);
    end if;
  end loop;
end $$;

-- Verificación ejecutable dentro de la misma transacción.
do $$
declare
  athlete_unique_count integer;
  legacy_user_unique_count integer;
begin
  select count(*) into athlete_unique_count
  from pg_index index_meta
  join pg_attribute athlete_column
    on athlete_column.attrelid = index_meta.indrelid
   and athlete_column.attname = 'athlete_id'
   and not athlete_column.attisdropped
  where index_meta.indrelid = 'public.athlete_profiles'::regclass
    and index_meta.indisunique
    and index_meta.indnkeyatts = 1
    and exists (
      select 1
      from unnest(index_meta.indkey) with ordinality as key_column(attnum, position)
      where key_column.position = 1
        and key_column.attnum = athlete_column.attnum
    );

  select count(*) into legacy_user_unique_count
  from pg_index index_meta
  join pg_attribute user_column
    on user_column.attrelid = index_meta.indrelid
   and user_column.attname = 'user_id'
   and not user_column.attisdropped
  where index_meta.indrelid = 'public.athlete_profiles'::regclass
    and index_meta.indisunique
    and not index_meta.indisprimary
    and index_meta.indnkeyatts = 1
    and exists (
      select 1
      from unnest(index_meta.indkey) with ordinality as key_column(attnum, position)
      where key_column.position = 1
        and key_column.attnum = user_column.attnum
    );

  if athlete_unique_count = 0 or legacy_user_unique_count > 0 then
    raise exception
      '026 verification failed: athlete_id unique indexes=%, legacy user_id unique indexes=%',
      athlete_unique_count,
      legacy_user_unique_count;
  end if;
end $$;

-- Fuerza a PostgREST a refrescar el contrato usado por on_conflict.
notify pgrst, 'reload schema';

commit;

-- Smoke de sólo lectura posterior:
--   select
--     count(*) filter (where athlete_id is null) as null_profiles,
--     count(*) as total_profiles,
--     count(distinct athlete_id) as distinct_athletes
--   from public.athlete_profiles;
-- Los tres valores deben cumplir: null_profiles = 0 y
-- total_profiles = distinct_athletes.
