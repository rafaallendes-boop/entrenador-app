# Spec — Fase 0: fundación de medición del Plan Builder

**Fecha:** 2026-07-23
**Revisión:** v2, tras review del owner (dos bloqueantes en la definición de `quality_version = 2`)
**Estado:** propuesto, pendiente de aprobación
**Origen:** `docs/superpowers/2026-07-23-plan-builder-latency-handoff.md`, Parte 3
**Alcance:** instrumentación y semántica de calidad. **No cambia el comportamiento de generación**: ni modelo, ni `effort`, ni `temperature`, ni prompt, ni schema, ni concurrencia.

---

## 1. Por qué esta fase existe

No se puede decidir nada sobre modelo, effort, concurrencia o arquitectura, por tres razones independientes:

1. **La unidad de medida es la equivocada.** `014` mide intentos por semana. El usuario no espera una semana: espera *su primera semana* y *su plan completo*. La v1 del handoff dedujo "~88s para 4 semanas" multiplicando p50 × semanas, cuando el generador corre un worker pool de 3 — un error de ~2×.
2. **La muestra no es lo que parece.** Las 10 filas de `014` son 10 semanas dentro de **3 planes**.
3. **La métrica de calidad está contaminada.** El score penaliza hidratación determinística esperada por diseño, mezclada con reparación correctiva real, mediante un contador que además confunde acciones con sesiones.

Este spec es el **contrato de medición** para las fases 2, 3 y 4. Ninguna puede empezar antes de que esté desplegado.

---

## 2. Evidencia verificada

Confirmado contra el código en `bb795ca`.

### 2.1 Arquitectura de generación

| Hecho | Fuente |
|---|---|
| Worker pool de 3 sobre cola compartida (no oleadas) | `asyncGenerationLoop.ts:861`, `DEFAULT_CONCURRENCY = 3` |
| Presupuesto del worker: 13 min | `DEFAULT_WORKER_BUDGET_MS = 13 * 60_000` |
| Máx. 2 intentos por semana | `MAX_WEEK_ATTEMPTS = 2` |
| Cap 5.000, retry por truncamiento a 12.000 | `DEFAULT_MAX_TOKENS`, `TRUNCATED_RETRY_MAX_TOKENS` |
| Polling del cliente cada 4s, stall a 5 min | `pollPlanGeneration.ts:25,28` |
| `previousWeek` cae al **shell** si la previa no está lista | `asyncGenerationLoop.ts:709-710` |

El shell conserva **fase y carga objetivo** (comentado en el código). Lo que falta bajo concurrencia no es la directiva de progresión: es el **contenido real de sesiones** de la semana anterior.

### 2.2 Cómo se contamina el score (mecanismo real)

> **Corrección de la v1 de este spec.** La v1 afirmaba que el problema era el warning `quality.generation.high_repair_count`. Es falso.

`isGenerationReliabilitySignal` (`qualityReview.ts:639`) excluye **todo** issue con código `quality.generation.*` del penalty por issues, tanto en `scoreWeek` como en `scorePlan`. **El warning aporta exactamente cero al score.**

El mecanismo real es `repairPenalty`:

```
countRepairs(week) = repairedSessionCount + movedSessionCount
                   + addedFallbackCount + filteredSportCount     (qualityReview.ts:643)

scoreWeek: repairPenalty = min(10, floor(repairCount / 2))        (qualityReview.ts:624)
scorePlan: repairPenalty = min(8,  floor(repairCount / 8))        (qualityReview.ts:635)
```

Consecuencias, todas distintas de lo que decía la v1:

- Cambiar solo `getGenerationReliabilityIssues()` **no produce una calidad v2 limpia**. No toca el score.
- Como `repairCount` **varía por semana**, sí puede explicar parte del spread 95 vs 87. La v1 afirmaba lo contrario ("es constante"); era incorrecto.
- `quality_version = 2` debe versionar **`countRepairs()`, `scoreWeek()` y `scorePlan()`**, no solo el warning.
- El evento de `repairWeek.ts:827` alimenta `repairedSessionCount` **y** `addedFallbackCount`, y `countRepairs` los suma: se penaliza dos veces el mismo hecho. Registrar ambas dimensiones es correcto; **penalizarlas dos veces no**. El problema está en la composición del score, no en el registro.

### 2.3 Los sitios de incremento: 30, no 17

> **Corrección de la v1.** La v1 enumeró 17 sitios y los clasificó como si fueran exhaustivos. Cubría hasta la línea 850 de un archivo de ~2.460 líneas.

`grep -n "repairedSessionCount\s*++\|repairedSessionCount\s*+="` sobre `repairWeek.ts` devuelve **30 sitios**, incluidos varios `+= repairedCount` / `+= converted` (líneas 1258, 1371, 1499, 2457) que la v1 omitió por completo. Faltaban, entre otros: sanitización de drills, normalización de match tardío, alineación de duración, diversidad squash intra-week, rotación de fuerza cross-week, unicidad de firmas, caps de taper por sesión y semana, normalización de soporte aeróbico, materialización de running, y mínimo/dominancia del deporte principal. Todos alcanzables desde el flujo principal de `repairGeneratedWeek` (`repairWeek.ts:72`).

**La enumeración completa y su clasificación son trabajo de implementación, no un anexo de este spec.** Congelar una lista derivada de un grep sería repetir el error. Lo que el spec fija es la *taxonomía* y la *unidad* (§3.2); asignar cada sitio a una categoría es la primera tarea del plan, con test que falle si aparece un sitio sin clasificar.

**El inventario inicial no puede limitarse al contador legacy.** Debe cubrir:

- los **30 sitios** de `repairedSessionCount`;
- **todos** los sitios de `addedFallbackCount` (`:826`, `:2123`, `:2277`) — el de `balanceSessionCount` no está pareado con el contador legacy y se perdería;
- los demás eventos observacionales que puedan solaparse (`droppedSessionCount`, `movedSessionCount`, `filteredSportCount`).

Un inventario que arranque desde `repairedSessionCount` deja agujeros por construcción.

**También se retira la afirmación de "doble conteo confirmado 404/658".** La línea 658 está en `sanitizeSquashDrillSets` (declarada en 625), no dentro de `completeSquashDetails`. Puede contar la misma sesión después de hidratarla, pero son **dos transformaciones distintas**. El problema real no es un bug de doble conteo: es que `repairedSessionCount` **mezcla "acciones realizadas" con "sesiones afectadas"**.

### 2.4 `repairGeneratedWeek` es compartido con Week Creator

Cinco call sites en producción (`generateWeekCore.ts:201`, `generateWeek.ts:166`, `fallbackWeek.ts:372`, `WeekCreatorLocalHydrator.ts:146`, `WeekCreatorEngine.ts:802`).

Y el acoplamiento no es solo de telemetría:

- `WeekCreatorEngine.ts:826` **ramifica conductualmente** sobre `repairedSessionCount === 0` (early return que omite trabajo posterior).
- `WeekCreatorLocalHydrator.ts:155`, `WeekCreatorEngine.ts:804` y `:819` **suman al mismo contador** desde fuera de `repairWeek.ts`.
- `WeekCreatorEngine.ts:716` documenta que en el contrato esqueleto `repairGeneratedWeek` corre **dos veces sobre las mismas sesiones**.

**Cambiar la semántica de `repairedSessionCount` cambiaría el comportamiento de Week Creator**, el producto que se acaba de cerrar y medir con 60 smokes. Esto impone la restricción dura de §3.5.

---

## 3. Qué se construye

### 3.1 Migración `016` — nivel plan/job

Tabla nueva `public.plan_generation_jobs`, una fila por corrida, `job_id` único. Convive con `plan_generation_attempts` (que sigue append-only por intento) y le da el agrupador que hoy falta.

**Identidad:** `job_id` (unique), `user_id`, `athlete_id`, `plan_id`, `created_at`.

**Forma de la corrida:** `week_count_requested`, `week_count_succeeded`, `week_count_failed`, `worker_concurrency`.

**Latencia** — nombres finales según §5.1:

| Columna | Significado |
|---|---|
| `enqueued_at` | cuando el cliente encoló |
| `worker_started_at` | cuando el worker tomó el job |
| `first_week_ready_ms` | desde `worker_started_at` hasta el primer `putWeek` con semana lista |
| `first_week_ready_e2e_ms` | desde `enqueued_at`, incluye cola de arranque del worker |
| `plan_complete_ms` | hasta que la última semana quedó en estado terminal |
| `terminal_ms` | hasta error, cancelación o agotamiento de budget |
| `first_week_discoverable_estimated_ms` | **derivado**, nullable — ver §5.1 |

**Variante experimental** (el gap que mordió con `serviceTier` en week_creator): `provider`, `model`, `effort`, `thinking_mode`, `temperature`, `max_tokens`, `prompt_version`, `schema_version`, `quality_version`, `variant_id`.

`variant_id` es un slug corto y estable (ej. `s46-effort-medium-conc3`). Es lo que hace identificable una ventana **sin depender de `created_at`**.

**Contexto cross-week** (§5.2): `previous_week_context_source` ∈ `none` | `shell` | `ready`, más los agregados de disponibilidad.

**Tokens y costo:** `total_input_tokens`, `total_output_tokens`, `total_cache_read_tokens`, `total_cache_creation_tokens`, `estimated_cost_usd` (§5.4).

**Outcome:** `succeeded` | `partial` | `failed` | `cancelled` | `budget_exhausted`.

**RLS:** mismo contrato que `014` — `select` propio, **sin** `insert`/`update`/`delete` para clientes. Escribe solo el service role.

**En `plan_generation_attempts`:** agregar `variant_id`, `effort`, `thinking_mode`, `prompt_version`, `schema_version`, `quality_version` y los contadores de §3.2.

**Migración manual.** Escribir el `.sql` numerado no es aplicarlo.

### 3.2 Taxonomía y unidad

**Decisión de unidad: acciones atómicas para telemetría.** `repairedSessionCount` mezcla acciones con sesiones; el reemplazo no repite la ambigüedad, empezando por el nombre.

| Contador | Unidad | Contenido |
|---|---|---|
| `hydrationActionCount` | acción | completar contrato esqueleto (detalles de deporte ausentes) |
| `correctiveActionCount` | acción | el modelo produjo algo inválido/incoherente y se corrigió |
| `structuralActionCount` | acción | se fabricó o forzó contenido (fallback, match forzado) |
| `movedSessionCount` | sesión | ya existe, sin cambios |
| `droppedSessionCount` | sesión | ya existe, sin cambios |
| `addedFallbackCount` | sesión | ya existe, sin cambios |
| `filteredSportCount` | sesión | ya existe, sin cambios |

**No se usa `correctedSessionCount`:** un contador que puede subir varias veces sobre la misma sesión no es un conteo de sesiones.

**Contadores de sesiones únicas afectadas** (`hydratedSessionsAffected`, `correctedSessionsAffected`, `structurallyRepairedSessionsAffected`) se emiten **por separado**, vía un `Set` de identidad de sesión. Son para UX y lectura humana; **no entran al score**.

El evento de `repairWeek.ts:827` **sigue** apareciendo en `structuralActionCount` y en `addedFallbackCount`: son dos dimensiones válidas del mismo hecho. Lo que cambia es que `countRepairs` v2 no lo penaliza dos veces (§3.3).

### 3.3 `quality_version = 2`

Se versionan **cuatro** funciones de `qualityReview.ts`, no una:

**`countRepairs()` v2** — deja de contar hidratación, y deja de sumar dos veces el mismo hecho:

```
countRepairs_v2 = correctiveActionCount
                + structuralActionCount
                + movedSessionCount
                + droppedSessionCount
```

Quedan fuera de la suma, como **dimensiones diagnósticas** (se registran, no penalizan):

- **`filteredSportCount`** — es un **subconjunto estricto** de `droppedSessionCount`. En `filterDisallowedSports` (`repairWeek.ts:363-364`) el mismo `return false` incrementa ambos. Sumarlos penalizaría dos veces el mismo descarte.
- **`addedFallbackCount`** — el mismo evento entra por `structuralActionCount`.
- **`hydrationActionCount`** — nunca entra, por definición de la versión.

> **Precondición de seguridad para excluir `addedFallbackCount`.** Solo es válido si **todos** sus sitios incrementan también `structuralActionCount`. Hoy no es el caso: `addedFallbackCount` tiene tres sitios (`repairWeek.ts:826`, `:2123`, `:2277`) y el de `balanceSessionCount` (`:2277`) **no** está pareado con `repairedSessionCount`. Si se excluye `addedFallbackCount` sin mapear `:2277` a `structuralActionCount`, ese fallback queda **completamente sin penalizar** — un agujero peor que la doble penalización que se está corrigiendo. El mapeo de `:2277` es obligatorio y va con test propio.

**`scoreWeek()` / `scorePlan()` v2** — misma forma, pero sobre `countRepairs_v2`, con divisores y topes recalibrados contra la distribución real del control (§5.3). Heredar `/2` y `/8` sobre una métrica de otro orden de magnitud no significaría nada.

**`getGenerationReliabilityIssues()` v2** — `quality.generation.high_repair_count` lee `correctiveActionCount + structuralActionCount`. Sigue sin afectar el score (está excluido por `isGenerationReliabilitySignal`); es señal de revisión humana.

**Contrato de la semana solo-hidratada.** Una semana con hidratación y nada más debe producir:

- cero warning de reparación alta;
- **cero penalización por reparación**;
- `countRepairs_v2 == 0`;
- contadores observacionales de hidratación **conservados y no nulos**.

Éste es el criterio que define la versión y el test que la ancla.

**Tests contractuales de no-doble-penalización.** Tres casos, cada uno verificando que dos dimensiones se registran pero el score sube una sola vez:

| Caso | Registro esperado | `countRepairs_v2` |
|---|---|---|
| Deporte filtrado (`filterDisallowedSports`) | `dropped = 1`, `filtered = 1` | **+1** |
| Fallback de `balanceSessionCount` (`:2277`) | `addedFallback = 1`, `structuralAction = 1` | **+1** |
| Fallback competitivo (`:826`/`:827`) | `addedFallback = 1`, `structuralAction = 1` | **+1** |

**Compatibilidad histórica:** las filas existentes quedan como `quality_version = 1`. No se recalculan, no se migran y **no se comparan** con v2.

### 3.4 Instrumentación cross-week (§5.2)

Se descarta el `crossWeekInfluencedCount` único de la v1: mezclaba drills, ejercicios, tipos de running y carga, y exigía una evaluación contrafactual de "cambió efectivamente".

En su lugar, hechos observables directamente:

- `previous_week_context_source`: `none` | `shell` | `ready`.
- Cantidad de sesiones / drills / ejercicios disponibles en ese contexto.
- `crossWeekStrengthRotationCount` — rotación de fuerza contra la semana anterior.
- `crossWeekTaperLoadAdjustmentCount` — cap de carga taper contra la carga previa.
- Overlap de squash y de fuerza entre semanas consecutivas.
- Ratio de carga respecto a la semana previa.

Con eso Fase 4 es medible comparando estrategias de concurrencia. Un contador causal de selección se añade allí si hace falta.

### 3.5 Restricción dura: no romper Week Creator

Derivada de §2.4:

- **`repairedSessionCount` conserva su semántica exacta actual** y sigue siendo la suma de los 30 sitios. Los contadores de §3.2 son **puramente aditivos**.
- La rama de `WeekCreatorEngine.ts:826` no cambia de comportamiento.
- `buildRepairStats` (`WeekCreatorEngine.ts:882`) mantiene su forma de salida; los campos nuevos se agregan sin quitar los existentes.
- El doble paso de `repairGeneratedWeek` en el contrato esqueleto (`WeekCreatorEngine.ts:716`) se documenta y se respeta: los contadores nuevos heredan ese comportamiento en v2 en vez de "arreglarlo" en esta fase.
- **Test de regresión** que fije los `repairStats` de Week Creator antes/después, para que Fase 0 no altere silenciosamente la comparabilidad de las 60 muestras Priority ya medidas.

### 3.6 Loadtest del Plan Builder

`scripts/loadtest-plan-builder.mjs`, siguiendo `loadtest-week-creator.mjs`:

- `runAsyncPlanGeneration` con **writer en memoria** y **proveedor real**. No toca Dexie ni Supabase de producción.
- **Unidad experimental = plan.** p50/p95 por plan; por semana como desglose secundario.
- Escenarios: squash build, squash taper/médico, running, ciclismo, dobles, semana parcial.
- Muestra objetivo: **30–50 semanas y ≥10 planes completos por variante**.
- Artefacto JSON en `loadtest-results/` con `variant_id` embebido.
- Sin prompts ni respuestas: solo tamaños, duraciones, tokens, booleanos y códigos.
- Mide `first_week_detected_ms` (§5.1).

---

## 4. Criterios de salida

- [ ] `016` aplicada en producción y confirmada por el owner.
- [ ] Una generación real escribe fila en `plan_generation_jobs` con timings y `variant_id` poblados.
- [ ] Los intentos de esa generación son agrupables por `job_id`.
- [ ] **Inventario completo clasificado** — los 30 sitios de `repairedSessionCount` **más** los 3 de `addedFallbackCount` **más** los eventos observacionales solapables — con test que falla si aparece uno sin categoría.
- [ ] **Contrato de la semana solo-hidratada verificado**: `countRepairs_v2 == 0`, cero penalización, cero warning, contadores de hidratación no nulos.
- [ ] **Los tres tests contractuales de no-doble-penalización en verde** (deporte filtrado, fallback de `balanceSessionCount`, fallback competitivo).
- [ ] **Regresión de Week Creator en verde**: `repairStats` y la rama de `:826` sin cambios de comportamiento.
- [ ] `loadtest-plan-builder.mjs` produce artefacto con ≥10 planes y p50/p95 **por plan**.
- [ ] **Distribución del control documentada y umbral v2 congelado antes de Fase 2.**
- [ ] Baseline v2 de Sonnet 4.6 `high` reconstruido y documentado.
- [ ] `npm run lint && npm test && npm run build` en verde.

---

## 5. Decisiones

### 5.1 Métricas de latencia y sus nombres

> **Corrección de la v1.** Proponía guardar como `first_week_visible_ms` un `first_week_ready_ms` redondeado al siguiente múltiplo de 4s, tratándolo como límite superior. **No lo es.** El poller arranca desde el cliente sin alineación con `worker_started_at` (`pollPlanGeneration.ts:185-199`), y al intervalo hay que sumarle cola, fetch, lectura de Supabase, escritura en Dexie, actualización del store y render.

- **Producción:** `first_week_ready_ms` (desde worker start) y `first_week_ready_e2e_ms` (desde `enqueued_at`). Opcionalmente `first_week_discoverable_estimated_ms`, **explícitamente marcado como derivado** en el nombre y en el comentario de la columna.
- **Loadtest headless:** `first_week_detected_ms` — cuando el poller recibe el primer snapshot listo. Un poller en memoria mide **descubrimiento**, no visibilidad.
- **`first_week_visible_ms`:** el nombre queda **reservado** y solo se usa si algún día un test con UI mide el render efectivo. No se aplica a un valor modelado.
- **Reporte desde cliente:** fuera de Fase 0. Si se agrega, va a telemetría UX separada, **no** a la tabla server-only de jobs.

### 5.2 Cross-week

Resuelto en §3.4: hechos observables en lugar de un contador causal agregado.

### 5.3 Umbral de reparación

- **Desactivado explícitamente** en la primera corrida, no "puesto muy alto".
- Calibrado **únicamente con el control Sonnet 4.6 `high`**.
- **Congelado antes de ejecutar `4.6-medium`.**
- **Nunca recalibrado por variante** — hacerlo normalizaría una degradación real.
- Los contadores crudos se conservan siempre, con el warning activo o no.

### 5.4 Costo estimado

`estimated_cost_usd` requiere tabla de precios **versionada y fechada**, no constantes únicas: Sonnet 5 tiene precio introductorio hasta el 31-08-2026, y sin fecha los números de Fase 3 quedarían mal desde septiembre.

---

## 6. Fuera de alcance

- Cualquier cambio de `effort`, `thinking`, modelo, `temperature` o concurrencia (Fases 2 y 3).
- Prompt caching (Fase 4, y solo tras medir el prefijo real con Token Counting).
- Correcciones de producto (Fase 1 — paralelizable, archivos disjuntos).
- "Arreglar" el doble paso de `repairGeneratedWeek` en el contrato esqueleto de Week Creator.
- Bajar el cap de 5.000.
