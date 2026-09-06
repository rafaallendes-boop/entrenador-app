-- 033 · Backfill de training_plan_weeks.athlete_id desde el plan padre.
--
-- POR QUÉ. La auditoría de autorización del 2026-09-05 midió las nueve tablas
-- del criterio de corte y encontró 12 filas con `athlete_id` nulo, todas en
-- `training_plan_weeks`; las otras ocho dieron cero. El corte de 031 exige cero
-- en las nueve, así que esto lo bloquea.
--
-- No es una regresión de la Entrega 1a: es deuda anterior. El trigger
-- `training_plan_weeks_athlete_consistency` de 013b exime los nulos a propósito
-- —«filas legacy/parciales: las cubre el estampado + backfill»— y ésta es esa
-- segunda mitad, que nunca se escribió.
--
-- ALCANCE. Sólo copia identidad ya existente desde `training_plans`. No inventa
-- athlete_id, no toca otras tablas y NO agrega `not null`: endurecer la columna
-- es una decisión de 1b y exige auditar antes todos los productores.
--
-- Numeración: 031 (corte) y 032 (rollback) están reservadas para la Entrega 1b.
--
-- Aplicación MANUAL. Diagnóstico previo en producción: 12 filas nulas, las 12
-- con plan padre, los 2 planes padres con athlete_id, cero huérfanas.

begin;

-- 1. Derivar desde el padre. `p.athlete_id is not null` evita propagar un nulo,
--    y `w.athlete_id is null` hace la migración idempotente y re-ejecutable.
update public.training_plan_weeks w
set athlete_id = p.athlete_id,
    updated_at = w.updated_at
from public.training_plans p
where p.id = w.plan_id
  and w.athlete_id is null
  and p.athlete_id is not null;

-- 2. Fail-closed. Si sobrevive alguna fila nula, la causa NO es la cubierta por
--    este backfill (sería una huérfana o un padre sin identidad) y hay que
--    diagnosticarla a mano antes del corte: revertir en vez de dejar el
--    criterio de 031 en un verde falso.
do $$
declare restantes integer;
begin
  select count(*) into restantes
  from public.training_plan_weeks
  where athlete_id is null;

  if restantes > 0 then
    raise exception
      '033: quedan % filas de training_plan_weeks sin athlete_id derivable; revisar huérfanas o planes sin identidad antes de 031',
      restantes;
  end if;
end $$;

commit;

-- Verificación posterior (ejecutar por separado; debe devolver 0):
--   select count(*) from public.training_plan_weeks where athlete_id is null;
