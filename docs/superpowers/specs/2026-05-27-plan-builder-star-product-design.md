# Plan Builder — Producto Estrella

**Estado:** Diseño aprobado, pendiente de implementación
**Fecha:** 2026-05-27
**Autor:** Rafael Allendes (colaboración con Claude)
**Stakeholder:** beta privada Entrenador App

---

## Contexto y motivación

El Plan Builder genera planes multi-semana orientados a un evento competitivo. Hoy es funcional pero no estrella: el plan exportado el 2026-05-27 muestra que el **100% de las semanas (9/9) terminó en `local-plan-fallback`** porque Gemini devolvió respuestas truncadas (`outcome: truncated_early`, `responseCharCount` 671–5070 chars). El plan queda usable porque el fallback local es robusto, pero el producto se siente plantillado:

- Fuerza clonada: Press Z + OHP + saltos laterales repetidos en 5 semanas seguidas.
- Ninguna sesión usa squat/deadlift/bench pese a que el atleta tiene 1RM completos (120/140/90 kg).
- Squash con metadata contradictoria (ya parchado defensivamente en `repairWeek` por el usuario).
- `degradeToSingle` está hardcoded a `false` en `generatePlan.ts:472` — si el batch pair falla, no hay recovery a single, va directo a fallback.

**Objetivo:** convertir Plan Builder en el módulo estrella de la app — un PF digital que genera planes ancla en el perfil real del atleta, se ve diseñado y no plantillado, y mantiene Gemini Flash como provider primario (costo cero/bajo) con apertura a migrar a Claude más adelante.

**Métrica de éxito global:** un atleta squash competitivo recibe en <2 min un plan de 8–12 semanas donde (a) las sesiones reflejan su perfil real, (b) ninguna semana se ve clonada, (c) ≥80% de las semanas vienen de IA real (no fallback).

**No-objetivos en este spec:**

- Migrar a Claude/OpenAI: queda como cambio de una sola línea después de Fase 1.
- Monetización, paywall, billing.
- Plan Builder accessible para usuarios beta abierta (sigue siendo beta privada).

---

## Roadmap de 3 fases (más Fase 4 condicional)

Las fases son secuenciales pero cada una entrega valor independiente y es mergeable por separado.

### Fase 1 — IA confiable con Gemini

**Objetivo:** que ≥80% de las semanas vengan de IA real (no fallback) en una corrida normal de plan de 9 semanas.

#### 1.1 Recorte del prompt batch

- `SESSION_SCHEMA_BLOCK_*` va solo en system prompt; nunca duplicado en user.
- `strengthStructureSection` y `strengthLoadPack` solo en user prompt, y solo cuando la semana incluye `strength` en deportes permitidos.
- Eliminar duplicación de reglas (race week, primary sport, schedule) entre semanas dentro del batch — usar referencias: "Semana 2 sigue las mismas reglas estructurales que la 1, con estos overrides: …".
- Drills/ejercicios por referencia: el prompt incluye `"drillIds": ["drop_contra_drop", "drives_100_target"]` en vez de objetos completos con name + notes + durationMin. La hidratación a `name/notes/duration` ocurre en `repairWeek` consultando los catálogos (que en Fase 2 son explícitos; mientras tanto, hidratación contra los maps actuales).
- Target medible: prompt batch ≤ 2000 tokens estimados (50% reducción desde ~3500 actuales).

#### 1.2 Alinear `maxTokens` y timeouts en `requestPolicy`

- `plan_builder_pair`: `maxTokens` 5500 y `timeout` 45s, alineado entre cliente y proxy.
- `plan_builder_week`: `maxTokens` 3500 y `timeout` 30s, alineado entre cliente y proxy.
- `MAX_FUNCTION_WALLCLOCK` revisado con buffer de finalización de respuesta.
- Gemini usa `thinkingBudget` explícito: 1024 para Plan Builder, 256 para acciones/Week Creator y 0 para solicitudes simples.

#### 1.3 Default a single, pair como optimización opcional

- `resolveStrategy` default cambia a `'single'`.
- Pair queda habilitable por env var (`VITE_PLAN_BUILDER_STRATEGY=pairs`) o flag explícito en `GeneratePlanWeeksInput.strategy`.
- Beta privada arranca con single. Pair vuelve cuando tengamos métricas de éxito IA ≥90% con single.

#### 1.4 `degradeToSingle` real

- En `generateWeekPair`, calcular `degradeToSingle` dinámicamente: `true` si al menos una semana del batch no devolvió `create_week` válida.
- En `generatePlanWeeks`, cuando una semana del batch viene vacía, antes de ir a `makeLocalFallbackResolvedWeek`, intentar una vez como single con `generateSingleWeekWithRetry`. Solo si single también falla, fallback local.

#### 1.5 Streaming parser progresivo

- Nuevo módulo `src/services/week/streamingActionsParser.ts`:
  - Acumula chunks.
  - Detecta `<actions>` y `</actions>` parcialmente.
  - Intenta parsear JSON parcial buscando objetos `create_week` completos.
  - Emite eventos `onWeekParsed(weekStartDate, action)` antes del fin de respuesta.
- `generateWeekPair` consume este parser. Si la respuesta se trunca, ya tenemos las semanas que sí llegaron — no se pierden.

#### 1.6 Provider routing por requestClass

- Nuevo helper `getProviderForRequestClass(requestClass: RequestClass): AIProvider` en `src/services/ai/getActiveProvider.ts`.
- Lee override por env var: `VITE_AI_PROVIDER_${requestClass.toUpperCase()}`.
- Beta privada: sin overrides, todo Gemini. Migración futura a Claude: setear `VITE_AI_PROVIDER_PLAN_BUILDER_WEEK=claude` sin tocar código.

#### 1.7 Tests focalizados Fase 1

- `streamingActionsParser.test.ts` — parser parcial con respuestas truncadas reales (usar samples del beta-quality export).
- `generatePlan.degradation.test.ts` — pair falla 1 semana, single recupera.
- `weekPrompt.compact.test.ts` — prompt batch ≤ 2000 tokens estimado.
- `requestPolicy.timeout.test.ts` — todos los timeouts y maxTokens consistentes entre cliente y proxy.
- `providerRouting.test.ts` — env var override produce provider correcto.

#### 1.8 Métricas de cierre de Fase 1

1. `npm run loadtest:week-creator` — éxito ≥ 9/10.
2. Generar plan de 9 semanas en dev: ≥ 8/9 semanas vienen de IA real. Validar con `npm run e2e:plan:generate` extendido para reportar `fallbackUsed` por semana.
3. Ningún `plan_builder_pair` supera 45s wallclock y ningún `plan_builder_week` supera 30s wallclock.
4. Para cada semana de IA, `validSessionCount === expectedSessions`.
5. `npm run lint && npm run build && npm test` — verde.

---

### Fase 2 — Especificidad deportiva (catálogo + reglas)

**Objetivo:** ninguna sesión de fuerza es un clon de otra del mismo bloque; ningún ejercicio con 1RM disponible queda fuera del plan.

#### 2.1 Catálogo de ejercicios declarativo

Nueva estructura `src/services/training/exerciseCatalog/`:

```
exerciseCatalog/
  index.ts                 (registro + queries)
  types.ts                 (tipos del catálogo)
  exercises/
    squatPattern.ts        (sentadilla, front squat, búlgaras, zancadas)
    hingePattern.ts        (peso muerto, RDL, sumo, trap bar, hip thrust)
    pushPattern.ts         (banca, press inclinado, OHP, push press, Press Z)
    pullPattern.ts         (remos, dominadas, pull-up)
    plyoPattern.ts         (saltos laterales, patinador, drop jump)
    olympicPattern.ts      (tirón alto, cargada, snatch high pull)
    corePattern.ts         (dead bug, Pallof, plancha lateral, Copenhagen)
    carryPattern.ts        (farmer carry, suitcase)
    cardioSpecific.ts      (bici asalto 30/30, footwork, trotadora aire)
```

Schema canónico `CatalogExercise`:

```ts
interface CatalogExercise {
  id: string                      // 'squat_back', 'rdl_barbell', etc.
  name: string
  pattern: ExercisePattern        // 'squat'|'hinge'|'push'|'pull'|'lunge'|'plyo'|'olympic'|'core'|'carry'|'cardio'
  variant?: 'bilateral' | 'unilateral' | 'lateral'
  fatigueCost: 1 | 2 | 3 | 4 | 5
  equipment: ('barbell'|'dumbbell'|'kettlebell'|'bodyweight'|'cable'|'machine'|'ball')[]
  transfersTo: SupportedSport[]
  has1RMReference?: 'squat' | 'deadlift' | 'benchPress' | 'overheadPress'
  appropriateForPhases: TrainingPhase[]
  blockRotationGroup?: 'A' | 'B' | 'C'
  defaultPrescription: {
    sets: number
    reps: number | string
    targetPercent1RM?: number
    targetRpe?: number
    warmupSets?: WarmupSet[]
  }
  notes?: string
  contraindications?: string[]    // 'lower_back_pain', 'shoulder_issue'
}
```

Hidratación: cuando el prompt pide `"exerciseId": "squat_back"`, `repairWeek` mira el catálogo y arma el objeto completo con `name`, `notes`, `warmupSets` calculados vs 1RM real.

#### 2.2 Periodización por bloque

Nueva estructura `src/services/training/strengthBlocks/`:

```
strengthBlocks/
  buildBlock.ts        (Build A=squat-dominant+olympic, B=hinge+pull, C=unilateral+plyo)
  peakBlock.ts         (Peak A=potencia lateral, B=accesorios+core, C=mantenimiento de fuerza)
  taperBlock.ts        (Taper A=activación ligera, B=movilidad+core)
  raceBlock.ts         (Race=activación pre-evento)
```

Cada template declara:

- 6–8 slots de ejercicio con `pattern` requerido y `blockRotationGroup` preferido.
- Cuáles son obligatorios vs opcionales según `sessionDurationMin`.
- Cuál es el "lift estrella" de la semana (progresión clara para el atleta).

#### 2.3 Motor de selección reescrito

`src/services/training/strengthSelector.ts` se reescribe:

1. Recibe `(fase, weekIndexInBlock, durationMin, profile, recentExercises, currentFatigue)`.
2. Elige template según `fase + (weekIndexInBlock % 3)`.
3. Para cada slot, busca en catálogo ejercicios que matcheen el `pattern` y `appropriateForPhases.includes(phase)`.
4. Aplica filtros: `recentExercises` (no repetir lo de la semana anterior), `equipment` disponible, `contraindications` del perfil.
5. Prefiere ejercicios con `has1RMReference` que matchee el perfil del atleta.
6. Aplica prescripción default + override por fase + override por `currentFatigue`.

#### 2.4 Lift estrella por semana

Para dar sensación de progresión clara:

- Build week 1: squat 4×5 @75% — Build week 2: squat 4×5 @80% — Build week 3: squat 5×3 @85%.
- Peak: cambia a olympic lift estrella (cargada o tirón alto).
- El "lift estrella" se marca en `Session.metadata` y la UI puede destacarlo.

#### 2.5 Catálogo de drills squash paralelo

Estructura idéntica en `src/services/training/squashCatalog/`:

```
squashCatalog/
  index.ts
  drills/
    solo.ts          (ghosting, voleas solo, 100 drives, sombras)
    partner.ts       (drill cross-court, condicionado al fondo, ataque ¾ cancha)
    match.ts         (partido condicionado, mejor de 3, juego con ataque temprano)
    pressure.ts      (presión y reacción, time-pressure rallies)
```

Tags: `executionMode`, `sessionKind` (`'shadows'|'control'|'technical'|'pressure'|'match'`), `phaseAppropriate`, `fatigueCost`, `partnerRequired`.

Referencia existente: `mobilitySessionLibrary` ya tiene estructura similar.

#### 2.6 Integración del perfil del atleta

Nuevo `src/services/planBuilder/profileAdapter.ts`:

- Traduce `AthleteProfile + PlanWizardConfig` a "athlete parameters" usados por todos los selectores.
- Reglas explícitas:
  - `age >= 35` → +1 día de recovery mínimo entre sesiones de potencia.
  - Sin 1RM de bench → bench no aparece como lift estrella, baja a accesorio.
  - `currentFatigue === 'overloaded'` → todos los `targetRpe` bajan 1 unidad.
  - `goalEvents` secundarios influyen en la fase del evento secundario (caso futuro).

#### 2.7 Tests focalizados Fase 2

- `exerciseCatalog.test.ts` — catálogo completo válido, no IDs duplicados, todos los `pattern` cubiertos.
- `strengthBlocks.test.ts` — cada template produce sesión válida con los slots esperados.
- `strengthSelector.rotation.test.ts` — 3 semanas seguidas, 0 ejercicios duplicados entre semanas adyacentes del mismo bloque.
- `strengthSelector.profile.test.ts` — con 1RM completo → usa squat/deadlift; sin OHP → no aparece OHP como principal.
- `squashCatalog.test.ts` — coherencia drill ↔ tags.
- `profileAdapter.test.ts` — atleta masters → params correctos.

#### 2.8 Métricas de cierre de Fase 2

1. Plan de 9 semanas: 0 sesiones de fuerza con ≥3 ejercicios idénticos a otra semana del mismo bloque.
2. Atleta con 1RM completos → al menos 4 ejercicios en el plan usan esas referencias.
3. Cada sesión de fuerza de 60 min tiene: 1 core, 1 squat/hinge, 1 push/pull, 1 unilateral, +1–2 accesorios.
4. Las 9 semanas de squash usan al menos 6 drills distintos entre sí (no en una sola semana, sino across el plan).
5. `quality.strength.repeated_template` (warning de `qualityReview`) nunca aparece en planes nuevos.

---

### Fase 3 — Trust + observabilidad

**Objetivo:** el usuario beta privada nunca ve "falló la IA", pero internamente todo es observable y regenerable.

#### 3.1 Quality review pre-commit

- En `commitPlan`, antes de marcar el plan como `accepted`, correr `reviewPlanQuality(plan, weeks)` y guardar el resultado en `plan.generationSummary.qualityReview`.
- En `CompetitionPlanPage`, mostrar resumen del score por semana **solo si `import.meta.env.VITE_SHOW_PLAN_QUALITY === 'true'`** (flag interno).
- Cliente beta: no se muestra nada, se persiste en metadata.
- QA interno: vista expandible con score por semana, issues, repair count, fallback flag.

#### 3.2 Regenerar una semana

- Botón "Regenerar semana" en vista interna (oculto detrás del mismo flag).
- Estado nuevo `regenerating` en `TrainingPlanWeek.status` (distinto de `generating` para no confundir con primera generación).
- Reutiliza `generateSingleWeekWithRetry` pasando el `previousWeek` actualizado.
- Persistencia: el plan ya está aceptado pero se actualiza esa semana (`updatedAt`, `generationMeta`). Reemplaza sesiones aceptadas para esa semana tras confirmación.

#### 3.3 Badge interno de fallback

- `Settings → Beta Quality` recibe vista nueva: para cada plan generado, mostrar `N/M semanas de IA, K de fallback`, score global, link a expandir issues por semana.
- Reutiliza estructura de `recentRequests` ya existente en Beta Quality export.
- Cliente beta nunca llega aquí (Settings/Beta Quality es vista de debug).

#### 3.4 Tests focalizados Fase 3

- `qualityReview.commit.test.ts` — review se persiste en `generationSummary` durante `commitPlan`.
- `regenerateWeek.test.ts` — regenerar una semana mantiene el resto intacto.
- `planQualityBadge.test.tsx` (component test) — el badge solo aparece con flag activo.

#### 3.5 Métricas de cierre de Fase 3

1. Cualquier plan aceptado tiene `generationSummary.qualityReview` poblado.
2. QA puede regenerar una semana específica sin tocar las demás.
3. Cliente beta nunca ve "falló la IA" ni badges de fallback.
4. Beta Quality export incluye `qualityReview` por plan.

---

### Fase 4 — Telemetría persistida (condicional)

**Estado:** explícitamente fuera del MVP del spec actual. Se considera cuando la beta privada haya corrido al menos 2 semanas y haya volumen suficiente para análisis cross-sesión.

**Si entra en alcance futuro:**

- Persistir trace summary en Supabase: `outcome, requestClass, provider, model, duration, token counts, retry/fallback, errorClass`.
- Asociar feedback de usuario a `trace/proposal/session`.
- RLS policy: solo el propio atleta y rol admin pueden leer.
- Retención: 90 días por default.

**Razón de excluirlo del MVP:** el export manual de Beta Quality cubre el caso de QA actual sin volumen alto. Persistir añade complejidad (schema migration, RLS, retención) sin justificación de volumen hoy.

---

## Arquitectura cross-fase

### Provider abstraction (Fase 1 establece la base)

```
src/services/ai/
  getActiveProvider.ts              (existente, se extiende)
  requestPolicy.ts                  (existente, se actualizan límites)
  providers/                        (existentes, sin cambios)
```

Helper nuevo:

```ts
export function getProviderForRequestClass(requestClass: RequestClass): AIProvider {
  const override = import.meta.env[`VITE_AI_PROVIDER_${requestClass.toUpperCase()}`]
  if (override) return providerFromName(override)
  return getActiveProvider()
}
```

### Catálogos como fuente única de verdad (Fase 2)

```
src/services/training/
  exerciseCatalog/      (NUEVO)
  squashCatalog/        (NUEVO)
  mobilitySessionLibrary.ts (existente, no se toca en este spec)
  strengthBlocks/       (NUEVO)
  strengthSelector.ts   (reescrito)
  squashSelector.ts     (reescrito)
  profileAdapter.ts     (NUEVO)
```

### Quality + observabilidad (Fase 3)

```
src/services/planBuilder/
  qualityReview.ts            (existente, integrado en commitPlan)
  commitPlan.ts               (existente, persiste qualityReview)
  regenerateWeek.ts           (NUEVO, single-week regeneration)

src/components/planBuilder/
  PlanQualityBadge.tsx        (NUEVO, flag-gated)
  RegenerateWeekButton.tsx    (NUEVO, flag-gated)
```

---

## Restricciones operativas

- No deploy a producción hasta 2026-05-29 por límite Netlify (ver `PROJECT_REVIEW_AND_ROADMAP.md`).
- Cada fase es mergeable de forma independiente. Cada fase debe pasar `npm run lint && npm run test && npm run build && npm run audit:prompt`.
- No tocar `promptBuilder.ts` ni `syncService` salvo donde el spec lo indica explícitamente (Fase 1 toca `requestPolicy`, no `promptBuilder`).
- Mantener Gemini como provider default. Migración a Claude es cambio de env var (post Fase 1).

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Recortar el prompt batch rompe semanas que hoy sí funcionan | Tests con samples reales del beta-quality export; A/B comparando outputs single vs batch antes/después |
| Streaming parser introduce bugs sutiles con JSON parcial | Tests con muestras truncadas reales del export; failsafe: si parse parcial falla, esperar al final como hoy |
| Catálogo de ejercicios crece y deja al modelo sin libertad creativa | El catálogo es el set canónico para fallback y selectores; la IA puede sugerir IDs adicionales y `repairWeek` los acepta si pasan validación |
| Lift estrella con progresión rígida no calza con un atleta específico | `profileAdapter` ajusta porcentajes según fatigue/age; lift estrella se puede sobre-escribir manualmente vía chat |
| QA flag `VITE_SHOW_PLAN_QUALITY` queda activo en producción por error | Lint rule o test que falla si el flag es `true` cuando `import.meta.env.PROD` |

---

## Métricas de éxito globales

Al cerrar las 3 fases:

1. Plan de 9 semanas: ≥8 de IA real, score ≥ 'good' por defecto, 0 sesiones de fuerza clonadas.
2. Atleta con perfil completo (1RM, eventos, fatiga): plan usa ≥4 ejercicios con 1RM real.
3. Cliente beta privada nunca ve mensajes de "falló la IA".
4. QA puede diagnosticar y regenerar cualquier semana específica.
5. Migrar plan_builder a Claude es cambiar una env var, sin deploy de código.

---

## Apéndice — Hallazgos concretos del export 2026-05-27

Tomado de `entrenador-beta-quality-2026-05-27T15-50-07-674Z.json` y `entrenador-backup-2026-05-27T15-50-19-196Z.json`:

- 6 traces `plan_builder_pair` con `outcome: truncated_early`, `responseCharCount` entre 671 y 5070 chars.
- 10 traces `plan_builder_week` previos todos en `validation_error` ("El modelo no devolvió sesiones válidas").
- 9/9 semanas del plan aceptado tienen `generationMeta.model: 'gemini-2.5-flash+local-plan-fallback'`.
- 9/9 semanas tienen `repairWarnings` incluyendo `local_plan_fallback`.
- 5 semanas con misma plantilla de fuerza casi exacta: Press Z, Press sobre cabeza, Tirón alto cargada, Plancha lateral con press de disco, Lanzamiento rotacional, Salto lateral, Saltos laterales patinador.
- Atleta tiene `strengthProfile.squat1RM: 120, deadlift1RM: 140, benchPress1RM: 90, overheadPress1RM: 65`.
- En las 9 semanas del plan: 0 sesiones usan squat/deadlift/bench como ejercicio principal. Solo OHP y Press Z.
- `dailyUsage.plan_builder_pair: 4` y `plan_builder_week: 2` — está dentro de límites (6 y 12 respectivamente).
