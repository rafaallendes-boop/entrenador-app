# Handoff — Latencia de week_creator (cerrado) y plan builder (abierto)

**Fecha:** 2026-07-23
**Actualizado:** 2026-07-23 tras review del owner (correcciones verificadas contra el código en `bb795ca`).
**Propósito:** contexto completo para redactar un spec y un plan de implementación del trabajo de latencia/calidad del **plan builder**. Incluye el trabajo previo de `week_creator` porque de ahí sale la metodología que se quiere replicar.

> **Estado:** las Partes 1–2 son diagnóstico. La Parte 3 fue reemplazada por el plan de 5 fases acordado en review; el diseño anterior de "dos ventanas" quedó obsoleto porque se apoyaba en una métrica de calidad contaminada. El spec de Fase 0 vive en `docs/superpowers/specs/2026-07-23-plan-builder-measurement-foundation.md` y es el contrato de medición para todo lo posterior.

---

## Parte 1 — Week Creator (trabajo hecho en esta sesión)

### 1.1 Punto de partida

El plan de latencia de `week_creator` (retirado tras el cierre; historial en git) tenía las Fases 0–4 implementadas y verificadas localmente. **No quedaba desarrollo pendiente**: todos los criterios de salida eran empíricos (faltaba muestra), no de código.

### 1.2 Loadtest parametrizado por escenarios (implementado, TDD)

`scripts/loadtest-week-creator.mjs` corría un único escenario hardcodeado (5 sesiones, sin dobles, sin restricciones). Se parametrizó:

| `LOADTEST_SCENARIO` | Qué estresa |
|---|---|
| `standard` | 5 sesiones, sin dobles |
| `eight-doubles` | 8 sesiones + dobles → riesgo de truncamiento contra el cap |
| `partial-week` | semana en curso, no puede programar días pasados |
| `medical` | restricción activa → contrato `detailed` |
| `all` | reparte N por peso 10/10/5/5 (método de mayor resto) |

Funciones puras agregadas y testeadas: `buildScenarioSequence`, `summarizeByScenario`, `defaultReportPath`, `collectVariant`.

**Artefacto de resultados:** antes solo `console.log`. Ahora escribe `loadtest-results/week-creator-<timestamp>.json` (dir gitignoreado) con `variant`, `acceptance`, `overall`, `byScenario` y métricas crudas por generación. Sin prompts ni respuestas — solo tamaños, duraciones, tokens, booleanos y códigos.

**Nota importante:** el loadtest corre el `WeekCreatorEngine` real en su propio proceso node vía `vite.ssrLoadModule`. **No toca Dexie ni Supabase de producción**, así que no contamina la telemetría del owner ni sus datos.

### 1.3 Fix de atribución (implementado, TDD)

El loadtest capturaba `model` pero **no** `serviceTier` ni `reasoningEffort`, aunque el proxy ya los devuelve. Se agregó `collectVariant()` + captura en `makeProviderAttempt`, de modo que cada JSON pagado se auto-documenta:

```json
"variant": {"models":["gpt-4.1-mini-2025-04-14"],"serviceTiers":["priority"],"reasoningEfforts":[]}
```

### 1.4 Resultados medidos

**Ventana control** (`OPENAI_SERVICE_TIER_WEEK_CREATOR=default`, `gpt-4.1-mini-2025-04-14`, n=30):

| Escenario | n | p50 | p95 | Fallback | Timeouts |
|---|--:|--:|--:|--:|--:|
| standard | 10 | 13,5s | 20,7s | 0% | 0 |
| eight-doubles | 10 | 17,5s | 47,8s | 10% | 2 |
| partial-week | 5 | 11,0s | 21,8s | 0% | 0 |
| medical | 5 | **42,1s** | 47,5s | 20% | 4 |
| **overall** | 30 | 15,5s | 47,8s | 6,7% | 6 |

**Ventanas Priority** (2 × 30 = 60 agrupadas, mismo modelo):

| Escenario | n | p50 | p95 | Timeouts | SLO <10s |
|---|--:|--:|--:|--:|:--:|
| standard | 20 | 7,7s | **9,2s** | 0 | ✅ |
| partial-week | 10 | 7,7s | **9,3s** | 0 | ✅ |
| eight-doubles | 20 | 10,4s | 31,9s | 1 | ❌ |
| medical | 10 | 9,2s | 31,0s | 1 | ❌ |
| **overall** | 60 | 9,1s | 15,2s | 2/62 | — |

**Conclusiones:**
- Priority es una mejora clara y debe quedarse. p50 overall 15,5s → 9,1s. Fallback 6,7% → 0%.
- `standard` y `partial-week` **cumplen el SLO** de forma estable en dos ventanas.
- `medical` pasó de roto (42s p50, 60% timeout) a 9,2s p50 **solo con el tier** — el contrato `detailed` no necesitaba rediseño urgente.
- Queda una **cola de timeouts ~3%** (2 de 62 requests) concentrada en los escenarios pesados; el reintento los lleva a ~31s y eso rompe el p95 de esos dos escenarios.

### 1.5 Truncamiento encontrado (bug real) y su fix

En las 60 muestras Priority: `finishReasons: {stop: 59, length: 1}`.

Una generación **`medical`** pegó exactamente en el cap de 2.500 tokens, devolvió `finishReason=length`, **y pasó como `ok=true`** sin retry ni fallback. Una semana médica truncada se aceptó en silencio.

**Causa raíz:** el cap de 2.500 (Fase 1) se dimensionó midiendo únicamente el contrato **esqueleto** (máximo observado 1.779 tokens). Pero `medical` usa el contrato **`detailed`** (Fase 3 lo dejó así a propósito para cohortes médicas), que produce más salida.

**Fix implementado (TDD; commiteado en `bb795ca`):**
- `resolveWeekCreatorMaxTokens(useSkeletonContract)` en `src/services/ai/requestPolicy.ts`: skeleton → 2.500 (sin cambio), detailed → **4.000** (`WEEK_CREATOR_DETAILED_MAX_TOKENS`).
- `WeekCreatorEngine.ts` usa `effectiveMaxTokens` en request, telemetría y fallback.
- `netlify/functions/coach.ts`: techo `REQUEST_MAX_TOKENS.week_creator` 2.500 → **4.000** (validaba `maxTokens > techo` y habría rechazado el request detailed).
- Test cruzado `src/services/ai/__tests__/weekCreatorMaxTokens.test.ts` verifica que el cap detailed nunca supere el techo del proxy.

**Verificación:** 134 tests del área verdes, lint limpio, `audit:prompt` sin cambios.

### 1.6 Estado de week_creator — pendientes

- [x] **El fix del cap está commiteado en `bb795ca`** (corregido en review: la v1 decía que no lo estaba).
- [ ] Confirmar de forma independiente que `bb795ca` está desplegado en producción.
- [ ] Tras confirmar el deploy, regenerar una `medical` y verificar que no aparece `finishReason=length`.
- [ ] Decidir qué hacer con la cola de timeouts ~3% en `eight-doubles`/`medical`. Posible conclusión honesta: "el SLO se cumple en los caminos comunes; las configs máximas son más lentas por diseño".
- [ ] `eight-doubles` tiene p50 ~10,4s **inherente** (8 sesiones, hasta 2.137 tokens de salida).

---

## Parte 2 — Plan Builder (foco actual)

### 2.1 Objetivo y contexto

**El plan builder es el producto estrella.** Meta: mejorar velocidad, calidad y confiabilidad. La latencia dejó de ser dolor de UX porque la generación es **async** (background job + polling), pero sigue importando: una generación lenta es la que se trunca o cae a fallback, y la que cuesta.

### 2.2 Arquitectura actual (verificada en código)

- **Ya usa el patrón esqueleto + hidratación local.** `planBuilderResponseSchema.ts` lo dice explícitamente: *"Claude only decides the weekly skeleton. Sport-specific details are hydrated deterministically by repairWeek."* La palanca grande de la Fase 3 de week_creator **ya está aplicada**.
- **Ya tiene telemetría persistida:** migración `014` (`plan_generation_attempts`) guarda por intento: `input_tokens`, `output_tokens`, `cache_*`, `duration_ms`, `stop_reason`, `outcome`, `error_class`, `retry_used`, `max_tokens`, contadores de repair (`raw/valid/dropped/repaired/added_fallback_session_count`) y **calidad** (`quality_score`, `quality_grade`, `quality_critical_issue_count`, `quality_warning_count`).
- Escritura: `netlify/functions/_shared/planGenerationShared.ts:168` → `insertPlanGenerationAttempt` con service role. **Cualquier generación real puebla `014` automáticamente.**
- Ruta: `enqueue-plan-generation.ts` (escritura durable + `invokeBackground` por fetch) → `generate-plan-background.ts`.
- **No existe** un loadtest de plan builder equivalente al de week_creator (solo `scripts/e2e-plan-builder-test.mjs`, que es un smoke).

**Concurrencia y presupuestos (verificado, no estaba en la v1 de este handoff):**

- `asyncGenerationLoop.ts` usa un **worker pool de 3**, no oleadas en lockstep: `DEFAULT_CONCURRENCY = 3`, `MAX_CONCURRENCY = 6`, y `Promise.all(...)` sobre N workers que consumen una cola compartida (`asyncGenerationLoop.ts:861`). Un worker toma la semana 4 apenas termina la 1.
- `DEFAULT_WORKER_BUDGET_MS = 13 min` (Netlify background functions cortan a 15). Las semanas que no alcanzan a generarse quedan en error explícito, no colgadas.
- `MAX_WEEK_ATTEMPTS = 2`; cap inicial 5.000 y `TRUNCATED_RETRY_MAX_TOKENS = 12.000` solo para las que truncan.
- Cliente: `pollPlanGeneration.ts` con `DEFAULT_INTERVAL_MS = 4_000` y `DEFAULT_STALLED_AFTER_MS = 5 min`. **El tiempo hasta que el usuario ve la primera semana incluye hasta 4s de polling que hoy no se mide en ningún lado.**
- `previousWeek` (`asyncGenerationLoop.ts:709-710`): usa la semana previa generada si está lista y, si no, **cae al shell** de la semana previa. El shell conserva fase y carga objetivo — lo que falta bajo concurrencia no es la directiva de progresión, es el **contenido real de sesiones** de la semana anterior (drills usados, ejercicios de fuerza), que es lo que alimenta variedad y reparación cross-week.

### 2.3 Bug encontrado y diagnosticado (no es bug de generación)

**Síntoma:** "No pudimos completar la operación" al crear planes de running, ciclismo **y** squash. Logs mostraban `enqueued` pero semanas en `status=pending sessions=0 attempts=0 errorClass=none`.

**Causa raíz:** límite diario **client-side** de 12 semanas `plan_builder_week`/día (`src/services/ai/aiTelemetry.ts:12`), chequeado en `src/store/usePlanBuilderStore.ts:343` vía `assertPlanBuilderWeekRateLimit()` **antes de encolar**. Los 3 planes generados consumieron 4+3+3 = 10 semanas; el siguiente pedido de 3 excedía el límite.

Encaja con toda la evidencia: es agnóstico al deporte (el límite es por clase de request), funcionó para 2-3 planes y después no, `attempts=0` porque bloquea antes del proveedor, y no hay logs del worker.

**Defecto colateral (abierto):** `src/pages/PlanBuilderV2Page.tsx:728` reemplaza **cualquier** estado fallido por un mensaje genérico, tragándose el mensaje específico y útil que `rateLimit.ts:36` ya construye (*"Alcanzaste el límite diario para crear planes: necesitas X semana(s) y quedan Y/12"*). Eso convirtió un límite esperado en una cacería de bugs en logs de Netlify.

**Decisión del owner:** el rate limit se queda como está. El fix del mensaje genérico queda anotado como mejora pendiente, no priorizada.

### 2.4 Datos reales de `014` (3 planes, 10 intentos)

Ventana: 2026-07-24 00:06 → 00:12 UTC. **0 reintentos.**

| Métrica | Valor |
|---|---|
| `outcome` | **succeeded 100%** (10/10) |
| `stop_reason` | `tool_use` 100% — **cero truncamiento** |
| Modelo | `claude-sonnet-4-6` |
| Duración | **p50 21.903 ms / p95 27.117 ms** por semana |
| `output_tokens` | p95 = max = **1.506** |
| `max_tokens` (cap) | **5.000** |
| `input_tokens` | p50 3.198 / max 3.228 |
| Cache | `cache_reads = 0`, `cache_writes = 0` |
| Repair | 0 fallback, 0 drops, **`avg_repaired = 9,00`** |
| Calidad | excellent 6 (60%, score 95, 0 crit) · good 4 (40%, score 87, 0 crit) |

**Lectura (corregida en review):**

- **Confiabilidad: excelente.** Nada que arreglar.
- **La muestra es `n=3 planes`, no `n=10`.** Las 10 filas son 10 semanas agrupadas dentro de solo tres planes. Para elegir modelo o effort no son observaciones independientes.
- **La latencia NO es `21,9s × semanas`.** Con worker pool de 3, un plan de 4 semanas son ~2 tandas de camino crítico (~44s de proveedor) más persistencia y hasta 4s de polling, no ~88s. La métrica por semana no responde la pregunta del usuario, que es *cuándo veo mi primera semana* y *cuándo está listo el plan*.
- **`avg_repaired = 9,00` contamina la calidad, pero no por donde parecía.** El contador no representa nueve errores del modelo: `repairWeek.ts` incrementa `repairedSessionCount` en **30 sitios** (`++` y `+=`), y varios son hidratación determinística esperada por diseño (`completeSquashDetails`, `completeRunningDetails`, `completeStrengthExercises`, `completeMobilityDetails`, `completeCyclingDetails`).
- **El mecanismo de penalización NO es el warning.** `isGenerationReliabilitySignal` (`qualityReview.ts:639`) excluye todo `quality.generation.*` del penalty por issues, así que `quality.generation.high_repair_count` **aporta cero al score**. Lo que baja el techo es `repairPenalty`:
  - `countRepairs = repaired + moved + addedFallback + filtered` (`qualityReview.ts:643`).
  - `scoreWeek`: `min(10, floor(repairCount / 2))` (`qualityReview.ts:624`).
  - `scorePlan`: `min(8, floor(repairCount / 8))` (`qualityReview.ts:635`).
  - `repairWeek.ts:827` alimenta `repairedSessionCount` **y** `addedFallbackCount`, y `countRepairs` suma ambos: el mismo hecho se penaliza dos veces.
- **Consecuencia:** como `repairCount` **varía por semana**, sí puede explicar parte del spread 95 vs 87. El evaluador está penalizando la arquitectura esqueleto+hidratación, no la salida del modelo.
- **Por lo tanto, "60% excellent / 40% good, score_p50 95" no es un baseline comparable** y no debe usarse como invariante a proteger. Hay que reconstruirlo con `quality_version = 2`, que debe versionar `countRepairs()`, `scoreWeek()` y `scorePlan()` — no solo el warning.
- **`repairGeneratedWeek` es compartido con Week Creator** (5 call sites en prod), y `WeekCreatorEngine.ts:826` ramifica conductualmente sobre `repairedSessionCount === 0`. Los contadores nuevos deben ser aditivos, o Fase 0 cambiaría el comportamiento del producto recién cerrado.
- **Velocidad: sigue siendo el problema real**, pero medido por plan, no por semana.

### 2.5 Hallazgos en el código de request

`buildClaudeBody()` en `netlify/functions/_shared/anthropicCaller.ts:16` manda: `model`, `max_tokens` (default 3.500; el caller pasa 5.000), `temperature: 0.25`, `system`, `tools`, `tool_choice` (forzado a la tool estructurada).

**No manda:**

1. **`output_config.effort`** → Sonnet 4.6 lo toma como **`high`** por defecto. Anthropic lo documenta como trampa de migración: *"Sonnet 4.6 defaults to high. If you just switch the model string and do nothing else, you may see noticeably higher latency and token usage."* Para cargas sin thinking el patrón recomendado es `thinking: {type:"disabled"}` + `effort: "low"`/`"medium"`.
2. **`cache_control`** → cero prompt caching, confirmado por `cache_reads = 0`. El orden de render es `tools` → `system` → `messages`, o sea el prefijo estable entre las N semanas de un plan es `tools` + `system`. **Pero la v1 de este handoff se equivocó al declararlo elegible:**
   - El mínimo cacheable es **1.024 tokens** para Sonnet 4.6 y para Sonnet 5 (verificado en la doc oficial de prompt caching; el 2.048 que decía la v1 es incorrecto).
   - Los ~3.200 tokens de input **no prueban elegibilidad**: la mayor parte está en el mensaje variable de cada semana. El prefijo reutilizable real (tool schema + system prompt) mide ~1.923 caracteres ≈ **~480 tokens**, o sea aproximadamente **2× por debajo del umbral**. Hoy no cachearía aunque se marcara.
   - Además, con concurrencia 3 las primeras tres solicitudes salen en paralelo, y una entrada de caché solo queda legible **cuando la primera respuesta empieza a emitirse**. Sin prewarming, las tres primeras semanas pagarían precio completo igual.
   - Conclusión: caching es una optimización de **costo posterior**, condicionada a (a) medir el prefijo estable con Token Counting contra el modelo destino —no por chars/token—, (b) separar contexto estable del contenido de la semana, (c) resolver prewarming vs concurrencia, y (d) confirmar `cache_read_input_tokens > 0`. No es una ventana automática.
3. **`thinking`** → apagado por omisión en 4.6 (correcto), pero sin declararlo.

**El cap de 5.000 vs 1.506 máximo observado está sobredimensionado, pero bajarlo NO da velocidad** — en Anthropic `max_tokens` es techo, no driver de latencia. Es higiene de guardrail.

### 2.6 Análisis de Sonnet 5 (corrección de premisa)

El owner propuso migrar a `claude-sonnet-5` asumiendo menor costo por token. **La premisa no se sostiene:**

| Modelo | Input $/MTok | Output $/MTok |
|---|---|---|
| Sonnet 4.6 | $3,00 | $15,00 |
| Sonnet 5 | **$3,00** (intro $2,00 hasta 2026-08-31) | **$15,00** (intro $10,00) |

Precio de lista **idéntico**. El intro vence el **31-08-2026** (~5 semanas). Y Sonnet 5 usa un **tokenizer nuevo que produce ~30% más tokens para el mismo texto** → después del intro, el mismo trabajo cuesta **~30% más** que en 4.6.

Sonnet 5 sigue siendo defendible por calidad y actualidad (*"near-Opus quality on coding and agentic work"*), pero no por costo.

**La migración no es un swap de string.** Cambios obligatorios:

1. **Quitar `temperature: 0.25`** — Sonnet 5 rechaza sampling params no-default → **400**.
2. **Agregar `thinking: {type:"disabled"}` explícito** — en 4.6 omitir = sin thinking; en Sonnet 5 omitir = **thinking adaptativo ENCENDIDO**. Migrar tal cual lo encendería en silencio → más latencia y más tokens, lo contrario del objetivo. Además `max_tokens` es techo del total (thinking + respuesta) y podría truncar.
3. **Fijar `effort` explícito** — Sonnet 5 también default a `high`.

**El escalón quality-matched es `medium`, no `high`.** Anthropic publica el mapeo cross-model: Sonnet 5 en `medium` es comparable en inteligencia a Sonnet 4.6 en `high`. Como hoy el plan builder corre 4.6 en `high` por omisión, **`medium` en Sonnet 5 es la comparación de trabajo equivalente**; arrancar en `high` mediría un modelo más caro contra el baseline, no el mismo trabajo. `high` queda como variante posterior de mayor calidad/costo.

**Mínimo cacheable de Sonnet 5: 1.024 tokens** (verificado). Con el tokenizer nuevo (~30% más tokens) el prefijo estable de ~480 tokens subiría a ~620 — sigue por debajo del umbral. El recuento hay que rehacerlo con Token Counting contra Sonnet 5, no extrapolando.

---

## Parte 3 — Plan acordado (5 fases)

> Reemplaza el diseño de "dos ventanas" de la v1. Ese diseño era ejecutable pero medía contra una métrica de calidad contaminada (ver 2.4), así que cualquier comparación de modelo o effort habría heredado el sesgo.

### Objetivo

Bajar el tiempo **hasta primera semana visible** y **hasta plan completo** sin regresar calidad deportiva, confiabilidad ni revisión humana.

Por ser el producto estrella, **la calidad es la invariante, no la variable**: una ventana que mejore velocidad pero baje calidad se revierte. Pero el baseline de calidad hay que reconstruirlo primero — el actual no sirve como contrato.

### Orden

**Sin Fase 0, cualquier comparación de modelos o effort sigue apoyándose en una métrica contaminada.** Fase 0 bloquea Fase 2 y Fase 3. Fase 1 no bloquea nada.

### Fase 0 — Instrumentación y calidad v2 (bloqueante)

Spec: `docs/superpowers/specs/2026-07-23-plan-builder-measurement-foundation.md`.

- Migración `016`.
- Métricas **a nivel de plan**, no de intento ni de semana: `first_week_ready_ms` (desde worker start), `first_week_ready_e2e_ms` (desde el encolado), `plan_complete_ms`, y `terminal_ms` para error / cancelación / agotamiento del worker budget. El descubrimiento por el cliente se mide en el loadtest como `first_week_detected_ms`; `first_week_visible_ms` queda reservado para una medición real de render (ver §5.1 del spec).
- Intentos agrupados bajo su plan, para no volver a tratar diez filas como observaciones independientes.
- Registrar modelo, effort/thinking, concurrencia, prompt/schema version, tokens, cache y costo.
- `quality_version = 2`, separando: hidrataciones normales, reparaciones correctivas, reparaciones cross-week y errores estructurales reales.
- `hydrated_count` **no** debe activar `quality.generation.high_repair_count`.
- Los resultados viejos se conservan como `quality_version = 1`; no se intenta hacerlos artificialmente comparables.
- Load test específico del Plan Builder, con **unidad experimental = plan**.

### Fase 1 y Fase 2 en paralelo

- **Fase 1:** correcciones de producto confirmadas (lista abajo).
- **Fase 2:** preparar cambios del provider y experimentos de effort.
- El código puede desarrollarse en paralelo, pero **ninguna ventana experimental de Fase 2 debe incluir planes anteriores** al despliegue de `016` y `quality_version = 2`.

### Fase 2 — Baseline controlado en Sonnet 4.6

`buildClaudeBody()` en `netlify/functions/_shared/anthropicCaller.ts`, model-aware y configurable por env var (misma idea que `OPENAI_SERVICE_TIER_WEEK_CREATOR`):

- `thinking: { type: "disabled" }` explícito.
- `output_config: { effort: <env> }` validado.
- Variante persistida en telemetría.
- Modelo, temperatura, prompt, schema y concurrencia sin cambios.

Reconstruir baseline post-migración y recién entonces comparar effort, con ventanas identificables y planes independientes. Evaluar latencia, calidad v2, fallos, costo y efecto del límite de 13 minutos. Primer escalón: `medium`.

### Fase 3 — Sonnet 5

Solo después de aceptar o rechazar `4.6-medium`:

- `model` → `claude-sonnet-5`.
- **Quitar `temperature`** (Sonnet 5 rechaza sampling no-default → 400).
- Configurar thinking explícitamente para evitar activación adaptativa accidental (omitirlo lo enciende).
- **`medium` como comparación quality-matched** contra Sonnet 4.6 `high`; `high` es variante posterior de mayor calidad/costo, no baseline equivalente.
- Recontar prompt y schema contra Sonnet 5 (tokenizer nuevo) y revisar el cap.

No se migra por ahorro: el precio de lista vuelve a $3/$15 el 31-08-2026 y el tokenizer nuevo usa ~30% más tokens. Se migra solo si gana en calidad deportiva o en la frontera calidad/latencia.

### Fase 4 — Arquitectura

- Medir el impacto de pasar el **contenido real de las sesiones** de la semana anterior.
- El experimento debe observar **variedad de drills, duplicaciones y reparaciones cross-week** — no "progresión" genérica, porque el shell ya conserva fase y carga objetivo.
- Comparar: concurrencia 3 actual, primera semana serial + resto paralelo, generación por pares, y esqueleto global del plan + hidratación local.
- Evaluar caching **solo después** de conocer el tamaño real del prefijo y resolver el efecto de solicitudes concurrentes.

### Realidad de la muestra

El límite de 12 semanas/día (que se conserva a propósito) da ~3 planes diarios. Como la unidad experimental pasa a ser el **plan**, y se necesitan 30–50 semanas y ≥10 planes completos por variante, eso son varios días de generación deliberada por ventana — o un loadtest que no consuma el rate limit del owner. Hay que calendarizarlo.

### Fuera de alcance explícito

- Comparar otros modelos más allá de Sonnet 5.
- Bajar el cap de 5.000 (higiene, no velocidad).

---

## Parte 4 — Estado del repo

> **La v1 de esta sección estaba obsoleta.** Decía que el fix del cap estaba sin commitear; ya está en `HEAD`.

- **HEAD:** `bb795ca` ("Mejora week creator").
- **Ya commiteado en `bb795ca`** (verificado con `git show --stat`): el cap por contrato (`src/services/ai/requestPolicy.ts` con `WEEK_CREATOR_DETAILED_MAX_TOKENS = 4000`, `src/services/weekCreator/WeekCreatorEngine.ts`, `netlify/functions/coach.ts`, `src/services/ai/__tests__/weekCreatorMaxTokens.test.ts`) y los cambios del loadtest parametrizado.
- **En producción:** `OPENAI_SERVICE_TIER_WEEK_CREATOR=priority` (aplicado por el owner, con deploy).
- **Pendiente de verificación independiente:** confirmar que `bb795ca` está desplegado, y ejecutar un caso `medical` nuevo confirmando que no aparece `finishReason=length`.
- Suite del Plan Builder al día de esta revisión: 33 archivos / 143 tests en verde.

### Bugs de producto confirmados (entran a Fase 1)

Verificados contra el código, no reportes sueltos:

1. **"Nivel elite" hardcodeado** para cualquier usuario — `PlanBuilderLaunchDeck.tsx:117`.
2. **"Ver semanas generadas" no lleva al plan completo** — `planDashboardNavigation.ts:5` devuelve `ROUTES.WEEK` (planner de la semana actual) cuando el plan está `active`.
3. **Pérdida de `lastError`** — `PlanBuilderV2Page.tsx:729` reemplaza cualquier estado fallido por un genérico, tragándose el mensaje específico que `rateLimit.ts:36` ya construye ("Alcanzaste el límite diario… quedan Y/12"). **Sube de prioridad: afecta confianza y soporte**, y fue lo que convirtió un límite esperado en una cacería de bugs en logs de Netlify.
4. Preview del macroplan mostrando simultáneamente "Taper directo" y "Fase actual: Construcción" — usa el perfil anterior, no el estado no guardado del wizard.
5. Dashboard con plan histórico de 5 semanas pero edición indicando 4 desde hoy; falta explicitar si se regenera todo el plan o solo el tramo restante.
6. "Saltar este paso" en el paso de forma física/fatiga, con ambos campos obligatorios y luego forzados con `!` — `CompetitionPlanPage.tsx:351`.
7. Adherencia del dashboard sobre las últimas 8 semanas con datos, sin acotar al inicio del plan actual — `PlanDashboard.tsx:456`.
8. Filas recientes etiquetadas con la fase actual en vez de la que les correspondía; en producción aparecieron además varias filas `S5`.
9. Doble CTA: "Generar mi plan" guarda el wizard y luego otra pantalla pide "Crear plan".
10. Chips seleccionables y switch de dobles dependen principalmente del color; faltan `aria-pressed` y nombre accesible para el toggle.
11. **Nivel competitivo en ciclismo** muestra nomenclatura de squash ("aficionado 3ra/4ta", "Competitivo 1ra/2da").

### Decisión sobre el rate limit

El límite diario client-side de 12 semanas/día **se conserva a propósito** (decisión del owner). Lo que se arregla es el mensaje (bug 3), no el límite.

---

## Decisiones cerradas en review (2026-07-23)

Las cuatro preguntas abiertas de la v1 quedaron resueltas:

1. **Migración `016`, no ventanas por `created_at`.** Las métricas por plan (`first_week_ready_ms`, `first_week_ready_e2e_ms`, `plan_complete_ms`) no son derivables de fronteras horarias en ningún caso, así que la migración es necesaria de todos modos; y este producto ya tiene varios experimentos futuros, donde las fronteras horarias serían frágiles. La atribución la lleva `variant_id`, no el timestamp.
2. **`medium` primero.** `low` queda como variante posterior.
3. **`avg_repaired` entra al alcance y ya está diagnosticado** (ver 2.4): mezcla hidratación esperada, doble conteo y reparación real.
4. **El fix del cap de week_creator ya está commiteado** (`bb795ca`). Falta confirmar deploy + un canary `medical`, pero Plan Builder puede avanzar en paralelo.
