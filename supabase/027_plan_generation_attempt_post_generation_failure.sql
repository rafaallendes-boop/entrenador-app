-- 027_plan_generation_attempt_post_generation_failure.sql
--
-- Un intento puede obtener una respuesta válida del proveedor y fallar después,
-- al materializar su semana o guardar el checkpoint del plan. Sin este outcome,
-- la telemetría lo registraba como `succeeded` aunque la corrida terminara
-- `partial`, ocultando exactamente la causa que debe investigarse.
--
-- La fila sigue siendo append-only: el worker la escribe sólo después de que
-- la semana alcanza un estado terminal, nunca se actualiza una fila previa.

alter table public.plan_generation_attempts
  drop constraint if exists plan_generation_attempts_outcome_check;

alter table public.plan_generation_attempts
  add constraint plan_generation_attempts_outcome_check
  check (outcome in (
    'succeeded',
    'validation_failed',
    'truncated',
    'provider_failed',
    'post_generation_failed'
  ));
