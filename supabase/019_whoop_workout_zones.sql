-- Distribución de tiempo por zona de frecuencia cardíaca y cobertura de
-- medición, por entrenamiento. Extiende `whoop_workouts` (012); no crea tablas
-- ni cambia RLS.
--
-- APLICAR ANTES del primer deploy del código: `pullWorkouts` hace un SELECT con
-- lista explícita de columnas y pedir columnas inexistentes devuelve 400.
--
-- Las cinco restricciones se agregan SIN la cláusula de validación diferida:
-- todas las filas existentes tienen las siete columnas en null, así que
-- satisfacen la rama nula y la validación inmediata no puede fallar.

alter table public.whoop_workouts
  add column if not exists zone_zero_milli  bigint null,
  add column if not exists zone_one_milli   bigint null,
  add column if not exists zone_two_milli   bigint null,
  add column if not exists zone_three_milli bigint null,
  add column if not exists zone_four_milli  bigint null,
  add column if not exists zone_five_milli  bigint null,
  add column if not exists percent_recorded numeric null;

-- 1. Todo o nada: las seis columnas de zona son todas nulas o todas presentes.
alter table public.whoop_workouts
  add constraint whoop_workouts_zones_all_or_none check (
    (zone_zero_milli is null and zone_one_milli is null and zone_two_milli is null
      and zone_three_milli is null and zone_four_milli is null and zone_five_milli is null)
    or
    (zone_zero_milli is not null and zone_one_milli is not null and zone_two_milli is not null
      and zone_three_milli is not null and zone_four_milli is not null and zone_five_milli is not null)
  );

-- 2. No negatividad.
alter table public.whoop_workouts
  add constraint whoop_workouts_zones_non_negative check (
    coalesce(zone_zero_milli, 0) >= 0 and coalesce(zone_one_milli, 0) >= 0
    and coalesce(zone_two_milli, 0) >= 0 and coalesce(zone_three_milli, 0) >= 0
    and coalesce(zone_four_milli, 0) >= 0 and coalesce(zone_five_milli, 0) >= 0
  );

-- 3. Suma positiva: una distribución de seis ceros no describe nada.
alter table public.whoop_workouts
  add constraint whoop_workouts_zones_positive_total check (
    zone_zero_milli is null
    or (zone_zero_milli + zone_one_milli + zone_two_milli
        + zone_three_milli + zone_four_milli + zone_five_milli) > 0
  );

-- 4. Rango de cobertura.
alter table public.whoop_workouts
  add constraint whoop_workouts_percent_recorded_range check (
    percent_recorded is null or (percent_recorded >= 0 and percent_recorded <= 100)
  );

-- 5. Solo con score: el contrato oficial dice que `WorkoutScore` solo existe
--    cuando el entrenamiento está SCORED.
alter table public.whoop_workouts
  add constraint whoop_workouts_score_data_requires_scored check (
    score_state = 'SCORED'
    or (zone_zero_milli is null and percent_recorded is null)
  );
