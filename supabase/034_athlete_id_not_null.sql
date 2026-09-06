-- 034_athlete_id_not_null.sql
-- Precondición de `031`: `athlete_id` deja de poder ser null en las tablas
-- scoped por atleta. Aplicación manual.
--
-- ORDEN DE APLICACIÓN: esta migración va **antes** que `031`, pese a llevar un
-- número mayor. `031`/`032` estaban reservadas por nombre para el corte de
-- policies desde la Entrega 1a y se conservan así; este archivo tomó el
-- siguiente número libre.
--
-- Por qué es precondición y no higiene: toda policy v2 predica
-- `athlete_id in (…)`, que es FALSE cuando la columna es null. Mientras viven
-- las policies legacy, una fila sin `athlete_id` entra igual por
-- `auth.uid() = user_id`. Después de `031` esa fila deja de ser alcanzable.
-- Con el constraint, el fallo ocurre en el writer (23502 → HTTP 400 →
-- `validation_error`, no reintentable en `classifySyncError`) en vez de
-- convertirse en un 403 sobre una operación ya encolada.
--
-- Se aplica ahora porque el estado está limpio: la medición del 2026-09-06
-- devolvió cero filas sin `athlete_id` en las nueve tablas, así que esto es DDL
-- puro sin backfill. `athlete_profiles` ya quedó `not null` en `026` y por eso
-- no aparece acá.
--
-- Toma ACCESS EXCLUSIVE brevemente por tabla para validar el constraint.
-- Aplicar en una ventana de bajo tráfico, igual que los índices de `022`.

begin;

-- ── 1. Guard fail-closed: abortar si quedara una sola fila sin scope ────────
do $$
declare
  tbl text;
  n bigint;
  total bigint := 0;
begin
  foreach tbl in array array[
    'sessions', 'day_logs', 'week_summaries', 'chat_messages',
    'coach_proposals', 'training_plans', 'training_plan_weeks', 'whoop_workouts'
  ]
  loop
    execute format('select count(*) from public.%I where athlete_id is null', tbl) into n;
    if n > 0 then
      raise notice '034: % tiene % filas sin athlete_id', tbl, n;
      total := total + n;
    end if;
  end loop;

  if total > 0 then
    raise exception
      '034: % filas sin athlete_id. Repararlas antes de imponer not null (ver 033).', total;
  end if;
end $$;

-- ── 2. Imponer el contrato ─────────────────────────────────────────────────
-- Idempotente: `set not null` sobre una columna que ya lo es no falla.
alter table public.sessions             alter column athlete_id set not null;
alter table public.day_logs             alter column athlete_id set not null;
alter table public.week_summaries       alter column athlete_id set not null;
alter table public.chat_messages        alter column athlete_id set not null;
alter table public.coach_proposals      alter column athlete_id set not null;
alter table public.training_plans       alter column athlete_id set not null;
alter table public.training_plan_weeks  alter column athlete_id set not null;
alter table public.whoop_workouts       alter column athlete_id set not null;

-- ── 3. Verificación del estado final ───────────────────────────────────────
do $$
declare faltan text;
begin
  select string_agg(c.table_name, ', ' order by c.table_name)
    into faltan
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.column_name = 'athlete_id'
    and c.is_nullable = 'YES'
    and c.table_name in (
      'sessions', 'day_logs', 'week_summaries', 'chat_messages',
      'coach_proposals', 'athlete_profiles', 'training_plans',
      'training_plan_weeks', 'whoop_workouts'
    );

  if faltan is not null then
    raise exception '034: estas tablas siguen aceptando athlete_id null: %', faltan;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- Rollback (sólo si hiciera falta):
--   alter table public.<tabla> alter column athlete_id drop not null;
