# Smoke de producción — Allocator coordinado de bloque de fuerza (§29, Causa B)

Fecha del documento: 2026-08-25 (preparado antes del deploy; **no ejecutado
todavía**)

Cierra la **Causa B** del Hallazgo 5 de §28 (accesorios de fuerza compartidos
entre semanas de un mismo bloque bajo concurrencia). Diseño en
[`docs/superpowers/specs/2026-08-24-strength-rotation-block-allocator-design.md`](../specs/2026-08-24-strength-rotation-block-allocator-design.md),
plan en
[`docs/superpowers/plans/2026-08-25-strength-rotation-block-allocator.md`](../plans/2026-08-25-strength-rotation-block-allocator.md),
cierre técnico en §29 del roadmap.

**Este documento es un guion para ejecutar en producción, no un reporte de
ejecución.** Al momento de escribirlo, el cambio vive sólo en el árbol de
trabajo local, sin commitear. No confundir con un smoke ya corrido: cuando se
ejecute, hay que agregar una sección de resultado real con evidencia, no
tildar los checkboxes de la sección "Criterios de salida" a priori.

## Precondiciones — no arrancar sin esto

1. **El cambio debe estar commiteado y desplegado.** Producción corre hoy
   `839f665` ("Operations dashboard entrega A"), que **no** incluye el
   allocator. Verificar el commit publicado en el deploy activo desde
   la consola de Netlify (Deploys → el deploy en Published, que muestra su
   commit) — no con `git log` local, que describe el árbol de trabajo y no lo
   que está sirviendo producción. Si el deploy publicado sigue siendo
   `839f665`, este smoke no puede ejecutarse todavía.
2. **Sin migraciones nuevas.** El allocator no toca Supabase (confirmado:
   `git status` no muestra ningún `supabase/*.sql` nuevo). No hay paso de
   aplicar SQL antes de este smoke.
3. **Confirmar saldo de Anthropic con el owner antes de generar.** El
   registro más reciente en `CLAUDE.md` es ~US$0,60 al 2026-07-30; el Plan
   Builder corre en `claude-sonnet-4-6` a través de `plan_builder_week`/
   `plan_builder_pair`, y el costo medido es **~US$0,029 por semana
   generada** (`OPTIMIZATION_AND_COSTS.md` §4). Un bloque `peak` de 4-6
   semanas más el resto del plan puede rondar 6-8 semanas totales — no arrancar
   sin decir el número aproximado en voz alta y tener el visto bueno.
4. **Usar el mismo atleta gestionado de prueba de smokes anteriores** (o uno
   equivalente), nunca el self del owner con datos reales. El smoke de §28 usó
   "Juan perez" — reutilizarlo si sigue disponible evita ensuciar otro perfil.

## Fase 0 — verificación sin costo (US$0)

Antes de generar nada nuevo:

- [ ] Abrir la app, entrar al atleta de prueba y confirmar **cero
      `ConstraintError`** en la consola del navegador. El backfill de scope de
      atleta (`src/services/athlete/athleteScopeMigration.ts`, modificado en
      este mismo árbol) corre al abrir; un `ConstraintError` ahí sería un
      índice Dexie violado, no algo del allocator, pero comparte el mismo
      deploy y debe descartarse primero.
- [ ] Confirmar que check-ins y resúmenes semanales **previos** al deploy
      siguen visibles sin cambios — el allocator no debería tocar nada fuera
      de sesiones de fuerza recién generadas/reparadas.
- [ ] Abrir una sesión de fuerza **ya existente** (de antes de este deploy) y
      confirmar que conserva sus superseries (si las tenía) y que los nombres
      de ejercicio siguen resueltos (no aparece ningún id crudo tipo
      `dead_bug` sin traducir). El allocator no debe alterar contenido
      histórico no regenerado.

Ninguno de estos tres pasos llama al proveedor de IA.

## Fase 1 — una sola corrida real

Generar **un** plan competitivo con evento a **6-8 semanas** desde hoy, para
forzar un bloque `peak` de 4 semanas o más (`build → peak → taper` con al
menos 4 semanas de `peak` es lo que hace comparable el par de semanas contra
el Hallazgo 5 original). No generar más de un plan en este smoke: el costo
crece linealmente y una sola corrida ya alcanza para evaluar los 7 criterios.

Al aceptar el plan, anotar el `plan_id` que uses en la query de abajo (visible
en el export de backup JSON, o en la URL/estado de la página del plan si el
dev tooling lo expone).

## Instrumento crítico — dónde vive la telemetría, y dónde NO

**La telemetría nueva `strengthAllocator` no llega a `plan_generation_attempts`
ni al panel `/ops`.** Vive únicamente dentro de la columna jsonb
`training_plan_weeks.generation_meta`, bajo la clave `strengthAllocator`
(`src/services/planBuilder/repairWeek.ts:2196`, propagada a
`generationMeta` en `asyncGenerationLoop.ts`/`generateWeek.ts`/
`generatePlan.ts` y persistida tal cual — camelCase incluido — por
`trainingPlanWeekToRow` en `src/services/planBuilder/planRows.ts:72`). El
dashboard operacional de §31 agrega sobre `plan_generation_jobs`/
`plan_generation_attempts`/`coach_requests`, ninguna de las cuales tiene esta
información. **No busques esto en `/ops`.**

Query verificada contra el esquema real de `supabase/003_training_plans_sync.sql`
(columnas `sessions jsonb`, `generation_meta jsonb`, ambas con las claves
camelCase del tipo TypeScript sin transformar):

```sql
select week_index,
       generation_meta->'strengthAllocator' as allocator,
       generation_meta->>'strengthAccessoryRotationActionCount' as rotaciones,
       generation_meta->'repairWarnings' as warnings,
       jsonb_path_query_array(sessions,
         '$[*] ? (@.sessionType == "strength").exercises[*].name') as fuerza
from training_plan_weeks
where plan_id = '<PLAN_ID>'
order by week_index;
```

Cómo leer el resultado:

- `allocator` es un objeto con `slotCount`, `assignedCount`,
  `infeasibleIntraWeekCount`, `insufficientPoolCount`,
  `unresolvedIdentityCount`, `searchExhaustedCount` y
  `unmaterializedCount` — los siete contadores de §10 del spec, **por columna
  local**, no la matriz completa del bloque.
- `rotaciones` es el contador preexistente de §16/§23 (`strengthAccessoryRotationActionCount`),
  útil como referencia de cuánto rotó la política determinista además del
  allocator.
- `warnings` es `repairWarnings` (`src/types/planBuilder.ts:85`), la lista de
  `{ code, message }` de la reparación de esa semana. Es donde hay que buscar
  `allocator.divergent_template` para el Criterio 6.
- `fuerza` es la lista plana de nombres de ejercicio de cada sesión de fuerza
  de esa semana, en el orden en que aparecen — compará manualmente los
  nombres compartidos entre pares de semanas del mismo bloque para el
  Criterio 3.

Si `generation_meta->'strengthAllocator'` es `null` para una semana de fuerza
dentro de un bloque de 2+ semanas, eso ya es un hallazgo: el allocator debería
haber corrido.

## Criterios de salida

Evaluar los siete contra la corrida real. Cada uno indica qué observar y qué
significaría que falló.

- [ ] **1. `unmaterializedCount = 0` en todas las semanas.**
      Observar: la columna `unmaterializedCount` del jsonb en cada fila.
      Fallar significa: la matriz asignó una celda a una sesión/ocurrencia que
      ya no existía al momento de materializar — un desface entre el snapshot
      del template y la sesión viva.

- [ ] **2. `assignedCount = 0` sólo en la semana `week_index` que corresponde
      a `indexInBlock = 0` del bloque (la columna de referencia).**
      Observar: `assignedCount` por fila. En las demás semanas del bloque debe
      ser `> 0`, salvo que los contadores de degradación
      (`infeasibleIntraWeekCount` + `insufficientPoolCount` +
      `unresolvedIdentityCount` + `searchExhaustedCount`) expliquen por qué no
      hubo margen para asignar nada.
      Fallar significa: una semana que sí debería rotar (no es la primera del
      bloque) quedó con la columna intacta sin ninguna causa de degradación
      que lo justifique.

- [ ] **3. Solape de accesorios contables < 3 entre cada par de semanas del
      bloque — el criterio deportivo real.**
      Observar: comparar manualmente la columna `fuerza` (nombres de
      ejercicio) entre cada par de semanas `peak` de la corrida; contar
      cuántos nombres se repiten entre cada par (excluyendo el main lift, que
      es posicional y está fuera de alcance por diseño). Es exactamente
      `quality.strength.repeated_template`, la métrica que falló en la QA del
      2026-08-13 (§28) con 3 contables compartidos entre semanas 1 y 2.
      Fallar significa: algún par del bloque comparte 3 o más accesorios
      contables — el defecto original sigue vivo.

- [ ] **4. Ninguna sesión de fuerza por debajo del mínimo de trabajo de
      fuerza para su duración: 5 ejercicios desde 70 min, 4 desde 55, 3 desde
      45** (`repairWeek.ts:3375-3377`).
      Observar: contar entradas en `fuerza` por sesión de fuerza (agrupando
      por sesión, no sumando todas las semanas) contra la duración de esa
      sesión.
      Fallar significa: el allocator o su degradación dejaron una sesión con
      menos ejercicios contables de los que el propio motor exige — sería una
      regresión de densidad, no sólo de rotación.

- [ ] **5. El core rota `dead_bug → plank → side_plank →
      stability_ball_front_plank` entre semanas del bloque; si el modelo
      prescribió `copenhagen_side_plank` o press de disco, ese ejercicio DEBE
      sobrevivir sin sustituirse.**
      Observar: identificar el ejercicio de zona media/core en `fuerza` de
      cada semana. Si es uno de los cuatro de `INJECTED_CORE_ROTATION`
      (`dead_bug`, `plank`, `side_plank`, `stability_ball_front_plank`), debe
      avanzar en ese orden según `weekIndexInBlock` (con salvedad de
      equipamiento: sin `stability_ball` disponible, el ciclo usa sólo los
      tres primeros). Si en una semana el modelo prescribió un core real
      fuera de esa allowlist (Copenhagen, press de disco), **esa semana debe
      conservarlo**: es una prescripción real, no relleno, y §7 del spec la
      declara fija por proyección.
      **Ojo con el alcance:** cada semana se genera por separado, así que el
      modelo puede prescribir Copenhagen en una semana y no en otra. Lo que
      hay que comprobar es que un core fuera de la allowlist **sobreviva
      dentro de la semana donde apareció**, NO que se repita entre semanas.
      Exigir repetición entre semanas produciría un falso fallo.
      Fallar significa: el core rotable no avanza en el orden esperado, o un
      core real prescrito por el modelo fue reemplazado por el ciclo
      inyectado dentro de su propia semana.

- [ ] **6. `allocator.divergent_template` puede aparecer legítimamente si una
      semana hermana ya estaba lista con otro template — anotarlo, no
      contarlo como falla.**
      Observar: si aparece este código en `repairWarnings` de alguna semana
      (fuera del jsonb de `strengthAllocator`, en la metadata de reparación
      general), registrar en qué semana y con qué contexto de timing
      (concurrencia real puede o no disparar esta rama).
      No fallar el smoke sólo por su presencia: es el camino best-effort
      documentado en §9 del spec.

- [ ] **7. En la UI: la semana abre, las superseries se ven, ningún ejercicio
      con nombre crudo sin resolver.**
      Observar: abrir cada semana del bloque en la app (no sólo leer el JSON),
      confirmar que la sesión de fuerza renderiza normalmente, que cualquier
      superserie generada por la política determinista (§23) se ve con su
      riel/corchete, y que ningún nombre aparece como id crudo (`dead_bug`,
      `bent_over_row`, etc.) en vez de su copy en español.
      Fallar significa: hay una regresión de UI o de resolución de identidad
      que el JSON de Supabase no habría mostrado.

## Lo que este smoke NO prueba

- **El camino de crash por conversión de dominancia o recorte.** No hay forma
  confiable de provocarlo a mano desde la UI — depende de una combinación
  específica de template y recorte de densidad. Queda cubierto únicamente por
  `src/services/planBuilder/__tests__/strengthAllocatorSessionAnchoring.test.ts`,
  no por este smoke.
- **La convergencia multidispositivo del backfill de scope de atleta**
  (`athleteScopeMigration.ts`, modificado en el mismo árbol de trabajo). Un
  solo dispositivo no puede demostrar convergencia; sigue siendo prioridad 6
  del roadmap y su propio smoke dedicado (`2026-08-12-multi-device-sync-smoke.md`).
- **El caso de infactibilidad genuina del pool.** Si la corrida real produce
  `infeasibleIntraWeekCount` alto con `assignedCount` bajo, **eso no es un
  defecto**: es degradación honesta y correctamente reportada, tal como
  predice el diseño. Orden de magnitud observado durante la
  revisión de código, con un fixture **sintético** (tres sesiones de fuerza
  idénticas por semana sobre un bloque de 12): 2 de 12 celdas asignadas y 10
  `infeasibleIntraWeekCount`. No proviene de ningún test del repo ni de una
  corrida real, así que sirve para reconocer la forma del patrón y **no** como
  valor esperado contra el cual comparar. Si el patrón real se parece a eso,
  anotarlo como comportamiento esperado, no como hallazgo — a menos que además
  falle alguno de los 7 criterios de arriba.
- **Optimalidad global del allocator.** El spec (§8) es explícito: bajo el
  tope de exploración, la búsqueda devuelve la mejor solución *visitada*, no
  el óptimo global. Este smoke no puede distinguir "mejor visitada" de "óptimo
  real" — sólo puede confirmar que el resultado cumple los invariantes I1-I4
  observables (criterios 1-5 de arriba).

## Resultado

**Pendiente de ejecución.** No completar esta sección hasta correr el smoke
real contra un deploy que incluya el commit del allocator. Cuando se ejecute,
reemplazar esta sección con: plan_id usado, output real de la query SQL por
semana, veredicto por cada uno de los 7 criterios (con evidencia, no
inferencia), y costo real gastado en la corrida.
