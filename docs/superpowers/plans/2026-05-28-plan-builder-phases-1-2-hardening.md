# Plan Builder Fases 1+2 — Hardening de hallazgos de review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los hallazgos concretos identificados en la review de Fase 1 y Fase 2 (bugs reales, gaps de tests, deuda documentada) sin re-arquitecturar. Devuelve coherencia entre spec y código antes de Fase 3.

**Architecture:** Trabajo quirúrgico de tres bloques: (A) Fase 1 — reconectar streaming silenciado, alinear timeouts cliente↔proxy a la realidad de Netlify Pro 26s, eliminar código muerto y agregar tests que detecten regresiones de consistencia. (B) Fase 2 — cerrar gaps de catálogo (cobertura 1RM, race block), cablear flags que se setean pero nadie consume (`partnerAvailability`, `requireExtraRecovery`), fijar el rotation index cuando una semana cae fuera de fase declarada, sumar test cross-week y warning de templates repetidos. (C) Verificación cruzada con `npm run lint && npm test && npm run build && npm run audit:prompt` y métrica empírica de IA real ≥80%.

**Tech Stack:** TypeScript, Vitest, Netlify Functions, Gemini Provider. Sin nuevas deps.

**Reviews de origen:**
- Review Fase 1 (resumen interno, mensaje 2026-05-28 del owner): bug `onChunk` desconectado en `generateWeek.ts:213`, inconsistencia `MAX_FUNCTION_WALLCLOCK_MS = 55000` vs Netlify Pro 26s sync real, env var renombrada sin documentar, código muerto del legacy batch prompt, falta `requestPolicy.timeout.test.ts`, doble `batchId`.
- Review Fase 2 (mismo): cobertura 1RM débil (11/73), `partnerAvailability` no cableada, `requireExtraRecovery` no consumido, `getWeekIndexInBlock` retorna índice global al caer fuera de fase, race block solo con core+plyo, slots todos `required: true` en Build B/C, falta test cross-week duplicates, falta warning `quality.strength.repeated_template`.

**Decisiones del owner (2026-05-28):**
- Renombrar env var `VITE_PLAN_BUILDER_GENERATION_STRATEGY` → `VITE_PLAN_BUILDER_STRATEGY` para alinearse con el spec.
- Netlify Pro: límite real **26s para funciones síncronas** (no 60s). Wallclock baja a 24s con buffer; cliente alinea timeouts.
- Spec 1.1 `drillIds` por referencia: **diferido** a iteración futura. No entra en este plan.

**Restricción operativa:** No deploy a prod antes de 2026-05-29 (ya cumplida al momento de iniciar). Cada task debe pasar `npm run lint && npm test && npm run build && npm run audit:prompt`.

**⚠️ Política de commits:** El owner hará UN commit grande al final. **NO ejecutar `git commit` ni `git add` dentro de cada task.** Tratarlos como no-op.

---

## File Structure

```
netlify/functions/
  coach.ts                                          [MODIFY: MAX_FUNCTION_WALLCLOCK_MS → 24000]

src/services/ai/
  requestPolicy.ts                                  [MODIFY: alinear timeouts y maxTokens a 24s real]
  __tests__/
    requestPolicyTimeoutConsistency.test.ts         [NEW: test de consistencia cliente↔proxy]

src/services/planBuilder/
  generateWeek.ts                                   [MODIFY: conectar onChunk + chunkCount]
  generatePlan.ts                                   [MODIFY: dejar de regenerar batchId; usar el que crea generateWeekPair]
  generationState.ts                                [MODIFY: rename env var + limpiar estrategia 'auto']
  __tests__/
    generateWeekChunkCount.test.ts                  [NEW]
    generationStateEnvVar.test.ts                   [MODIFY: usa nuevo nombre]

src/services/week/prompts/
  weekPrompt.ts                                     [MODIFY: eliminar buildWeekBatchSystemPromptMinimal legacy]

src/services/training/
  exerciseLibrary.ts                                [MODIFY: +incline_bench_press, close_grip_bench_press, sumo_deadlift, landmine_press + map 1RM]
  strengthSelector.ts                               [MODIFY: consumir requireExtraRecovery]
  strengthBlocks/
    raceBlock.ts                                    [MODIFY: estructura mínima activación + cool-down]
    buildBlock.ts                                   [MODIFY: slots required:false donde corresponde]
  __tests__/
    exerciseLibrary1RMCoverage.test.ts              [NEW: cobertura 1RM target]
    raceBlockStructure.test.ts                      [NEW]
    buildBlockOptionalSlots.test.ts                 [NEW]

src/services/planBuilder/
  repairWeek.ts                                     [MODIFY: cablea partnerAvailability + fix getWeekIndexInBlock cuando no hay fase]
  qualityReview.ts                                  [MODIFY: warning quality.strength.repeated_template]
  __tests__/
    repairWeekPartnerWiring.test.ts                 [NEW]
    repairWeekIndexOutOfPhase.test.ts               [NEW]
    qualityReviewRepeatedTemplate.test.ts           [NEW]
    crossWeekStrengthDuplicates.test.ts             [NEW: métrica 2.8 #1]

scripts/
  e2e-plan-builder-test.mjs                         [MODIFY: reporta fallbackUsed por semana al final]
```

---

# Bloque A — Fase 1 hardening

## Task 1: Reconectar `onChunk` y `chunkCount` en `generateWeek`

**Files:**
- Modify: `src/services/planBuilder/generateWeek.ts:206-260`
- Test: `src/services/planBuilder/__tests__/generateWeekChunkCount.test.ts` (NEW)

**Por qué:** Phase 1 hizo `single` el default. La función `generateWeek` declara `const chunkCount = 0` (constante) y nunca pasa `onChunk` al provider, así que el wizard no recibe streaming visual y la telemetría reporta 0 chunks para todas las weeks single. `generateSingleWeekWithRetry` ya recibe `onChunk` desde el caller y lo pasa a `generateWeek` (línea 294), pero `generateWeek` lo ignora.

- [ ] **Step 1: Test failing**

Crear `src/services/planBuilder/__tests__/generateWeekChunkCount.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { generateWeek } from '../generateWeek'
import type { AIProvider } from '../../ai/types'

const makeMockProvider = (chunks: string[]): AIProvider => ({
  name: 'mock',
  async call(request) {
    for (const c of chunks) request.onChunk?.(c)
    const fullText = JSON.stringify({
      actions: [{
        type: 'create_week',
        weekStartDate: '2026-06-01',
        sessions: [{
          date: '2026-06-01', timeBlock: 'AM', sessionType: 'mobility',
          durationMin: 30, rpe: 4, name: 'Mobility', source: 'coach',
        }],
      }],
    })
    return {
      text: fullText,
      provider: 'mock',
      model: 'mock-1',
      durationMs: 100,
      retryUsed: false,
      fallbackUsed: false,
      finishReason: 'stop',
    } as any
  },
} as AIProvider)

describe('generateWeek propagates onChunk and counts chunks', () => {
  it('calls onChunk with each provider chunk', async () => {
    const onChunk = vi.fn()
    const provider = makeMockProvider(['hello', ' world'])
    const result = await generateWeek({
      provider,
      plan: buildPlan() as any,
      week: buildWeek() as any,
      previousWeek: undefined,
      profile: buildProfile() as any,
      wizardConfig: buildWizardConfig() as any,
      onChunk: (idx, chunk) => onChunk(idx, chunk),
    })
    expect(onChunk).toHaveBeenCalledTimes(2)
    expect(result.meta.chunkCount).toBe(2)
  })

  it('reports chunkCount=0 when provider emits no chunks', async () => {
    const provider = makeMockProvider([])
    const result = await generateWeek({
      provider,
      plan: buildPlan() as any,
      week: buildWeek() as any,
      previousWeek: undefined,
      profile: buildProfile() as any,
      wizardConfig: buildWizardConfig() as any,
    })
    expect(result.meta.chunkCount).toBe(0)
  })
})

// Copiar buildPlan/buildWeek/buildProfile/buildWizardConfig de
// src/services/planBuilder/__tests__/generatePlanDegradation.test.ts
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/planBuilder/__tests__/generateWeekChunkCount.test.ts`
Expected: FAIL — `chunkCount` siempre 0 / `onChunk` no se llama 2 veces.

- [ ] **Step 3: Reescribir el bloque en `generateWeek.ts`**

En `generateWeek.ts` cambiar:

```ts
let outcome: CoachOutcome = 'error'
const chunkCount = 0
let requestStarted = false
```

por:

```ts
let outcome: CoachOutcome = 'error'
let chunkCount = 0
let requestStarted = false
```

Y en la llamada al provider (líneas 242-252) añadir `onChunk`:

```ts
const raw = await provider.call({
  requestClass,
  traceId,
  systemPrompt,
  userMessage,
  maxTokens: policy.maxTokens,
  temperature: input.temperature ?? policy.temperature,
  allowFallback: policy.allowFallback,
  responseMimeType: 'application/json',
  responseSchema: PLAN_BUILDER_WEEK_RESPONSE_SCHEMA,
  onChunk: (chunk) => {
    chunkCount += 1
    input.onChunk?.(chunk)
  },
})
```

Asegurar que `chunkCount` se propaga a `result.meta` en el camino de éxito y de error (buscar todos los retornos en el archivo y completar el campo).

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/planBuilder/__tests__/generateWeekChunkCount.test.ts`
Expected: 2 PASS.

Run: `npx vitest run src/services/planBuilder/__tests__/`
Expected: ningún test pre-existente roto.

- [ ] **Step 5: NO-OP commit**

---

## Task 2: Alinear `MAX_FUNCTION_WALLCLOCK_MS` y `requestPolicy` a Netlify Pro 26s

**Files:**
- Modify: `netlify/functions/coach.ts:108-109`
- Modify: `src/services/ai/requestPolicy.ts`

**Por qué:** Owner confirmó Netlify Pro plan. Límite real de funciones síncronas es **26s**, no 60s. Hoy:
- `MAX_FUNCTION_WALLCLOCK_MS = 55000` (irrealista, Netlify corta antes).
- `plan_builder_pair: timeout 45s` (cliente) — el proxy nunca llega ahí.
- `plan_builder_week: timeout 30s` (cliente) — también supera 26s.

Resultado: en prod los timeouts del cliente son ficticios; Netlify devuelve 504 antes de que el recovery a single ocurra. Hay que bajar a una ventana real con buffer.

**Objetivo:**
- `MAX_FUNCTION_WALLCLOCK_MS = 24000` (2s buffer antes del corte real 26s).
- `MIN_PROVIDER_ATTEMPT_MS = 4000` (se mantiene).
- Cliente `plan_builder_pair.timeoutMs = 23000`.
- Cliente `plan_builder_week.timeoutMs = 18000`.
- Cliente `chat_action.timeoutMs ≤ 18000` (ya está en 18s, confirmar).
- `maxTokens` baja proporcionalmente: `plan_builder_pair: 4200` (de 5500) — el espacio antes era teórico.

- [ ] **Step 1: Modificar `netlify/functions/coach.ts:108`**

```ts
const MAX_FUNCTION_WALLCLOCK_MS = 24000
```

Eliminar (o actualizar) cualquier comentario adyacente que diga "Netlify allows 60s".

- [ ] **Step 2: Modificar `src/services/ai/requestPolicy.ts`**

Buscar las entradas de `plan_builder_pair` y `plan_builder_week` y ajustar:

```ts
plan_builder_pair: {
  maxTokens: 4200,
  timeoutMs: 23000,
  // ...resto sin cambios
},
plan_builder_week: {
  maxTokens: 3500,
  timeoutMs: 18000,
  // ...resto sin cambios
},
```

Mantener `chat_general`, `chat_action`, `weekly_summary`, `import_extract` como están salvo que superen 18s.

- [ ] **Step 3: Actualizar `OPTIMIZATION_AND_COSTS.md`**

En la tabla "Después (realista...)", actualizar:

```
plan_builder_pair: 23s
plan_builder_week: 18s
MAX_FUNCTION_WALLCLOCK: 24s (2s buffer antes del corte real 26s de Netlify Pro)
```

Y al final del documento, agregar fecha de revisión y resumen del razonamiento (Netlify Pro síncrono = 26s, buffer 2s para serializar response).

- [ ] **Step 4: Confirmar que ningún test asume valores viejos**

Run: `npx vitest run src/services/ai/__tests__/`
Expected: si algún test tenía hardcoded 45000 o 30000, falla. Arreglar el test, no la constante.

Run: `npx vitest run src/services/planBuilder/__tests__/`
Expected: verde.

- [ ] **Step 5: NO-OP commit**

---

## Task 3: Test de consistencia timeouts cliente↔proxy

**Files:**
- Create: `src/services/ai/__tests__/requestPolicyTimeoutConsistency.test.ts`

**Por qué:** Spec 1.7 lo pedía explícitamente. Sin este test, alguien puede modificar `requestPolicy` o `coach.ts` por separado y romper la consistencia.

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAIRequestPolicy } from '../requestPolicy'
import type { AIRequestClass } from '../../../types'

const COACH_PATH = resolve(__dirname, '../../../../netlify/functions/coach.ts')

function readMaxWallclockFromCoach(): number {
  const src = readFileSync(COACH_PATH, 'utf8')
  const match = src.match(/MAX_FUNCTION_WALLCLOCK_MS\s*=\s*(\d+)/)
  if (!match) throw new Error('MAX_FUNCTION_WALLCLOCK_MS not found in coach.ts')
  return Number(match[1])
}

const CLASSES: AIRequestClass[] = [
  'chat_general', 'chat_action', 'weekly_summary',
  'week_creator', 'plan_builder_week', 'plan_builder_pair', 'import_extract',
]

describe('requestPolicy timeout consistency', () => {
  const wallclock = readMaxWallclockFromCoach()

  it.each(CLASSES)('client timeoutMs for %s does not exceed proxy wallclock', (cls) => {
    const policy = getAIRequestPolicy(cls)
    expect(policy.timeoutMs).toBeLessThanOrEqual(wallclock)
  })

  it('wallclock leaves enough room for at least one provider attempt', () => {
    expect(wallclock).toBeGreaterThanOrEqual(8000)
  })

  it('plan_builder_pair has more room than plan_builder_week', () => {
    const pair = getAIRequestPolicy('plan_builder_pair')
    const week = getAIRequestPolicy('plan_builder_week')
    expect(pair.timeoutMs).toBeGreaterThan(week.timeoutMs)
  })
})
```

- [ ] **Step 2: Verificar pass**

Run: `npx vitest run src/services/ai/__tests__/requestPolicyTimeoutConsistency.test.ts`
Expected: 9 PASS (7 classes + 2 cross-checks).

Si falla porque `plan_builder_pair.timeoutMs > wallclock`, **no relajar el test** — los valores en Task 2 deben respetar `wallclock`.

- [ ] **Step 3: NO-OP commit**

---

## Task 4: Fix doble generación de `batchId`

**Files:**
- Modify: `src/services/planBuilder/generatePlan.ts:387, 550`

**Por qué:** `generateWeekPair` genera un `batchId` (línea 387) que va al `responsePreview` / telemetría del coach. `generatePlanWeeks` genera otro `batchId` (línea 550) que va al `makeGeneratingWeek` mientras la semana está pendiente. Cuando la semana resuelve, se rescribe con `batchResult.meta.batchId` (línea 581) — un id distinto. Resultado: la misma semana cambia de `batchId` entre estados, rompiendo trazabilidad cross-stage en Beta Quality.

**Decisión:** `generatePlanWeeks` debe crear el `batchId` **una sola vez** y pasárselo a `generateWeekPair` como parámetro.

- [ ] **Step 1: Test failing**

Extender `src/services/planBuilder/__tests__/generatePlanDegradation.test.ts` con:

```ts
it('preserves the same batchId across generating → resolved states', async () => {
  // Setup que llega hasta el callback onWeekUpdate de pair.
  const updates: string[] = []
  await generatePlanWeeks({
    plan, weeks, profile, wizardConfig,
    onWeekUpdate: (w) => {
      if (w.generationMeta?.batchId) updates.push(w.generationMeta.batchId)
    },
  })
  const unique = new Set(updates)
  expect(unique.size).toBeLessThanOrEqual(weeks.length / 2 + 1) // 1 batchId por pair, no doble
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/planBuilder/__tests__/generatePlanDegradation.test.ts`
Expected: FAIL (al menos 2x batchIds por pair).

- [ ] **Step 3: Modificar `generatePlan.ts`**

En la firma de `generateWeekPair`:

```ts
async function generateWeekPair(
  provider: AIProvider,
  plan: TrainingPlan,
  weeks: [TrainingPlanWeek, TrainingPlanWeek],
  previousWeek: TrainingPlanWeek | undefined,
  profile: AthleteProfile,
  wizardConfig: PlanWizardConfig,
  onChunk?: (chunk: string) => void,
  batchId?: string,      // NUEVO parámetro
): Promise<...>
```

Dentro de la función:

```ts
const effectiveBatchId = batchId ?? createBatchId(weeks[0].weekIndex)
```

Usar `effectiveBatchId` en todos los `meta` que se devuelven (en lugar de regenerar).

En `generatePlanWeeks` (línea 555), pasar el id ya creado:

```ts
const batchId = createBatchId(week.weekIndex)
// ...
const batchResult = await generateWeekPair(
  provider, input.plan, batchWeeks, previousWeek,
  input.profile, input.wizardConfig, input.onChunk, batchId,
)
```

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/planBuilder/__tests__/generatePlanDegradation.test.ts`
Expected: PASS.

- [ ] **Step 5: NO-OP commit**

---

## Task 5: Rename env var + limpiar estrategia 'auto'

**Files:**
- Modify: `src/services/planBuilder/generationState.ts`
- Modify: tests que referencien la variable
- Modify: `README.md` y/o `.env.example` si mencionan la variable

**Por qué:** Spec dice `VITE_PLAN_BUILDER_STRATEGY`, código usa `VITE_PLAN_BUILDER_GENERATION_STRATEGY`. La estrategia `'auto'` está declarada pero el resolver la trata como `'single'` — código muerto.

- [ ] **Step 1: Test failing**

`src/services/planBuilder/__tests__/generationStateEnvVar.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const importFresh = async () => {
  vi.resetModules()
  return await import('../generationState')
}

describe('generationState env var', () => {
  afterEach(() => {
    Object.assign(import.meta.env, { VITE_PLAN_BUILDER_STRATEGY: undefined })
  })

  it('reads VITE_PLAN_BUILDER_STRATEGY (spec name)', async () => {
    Object.assign(import.meta.env, { VITE_PLAN_BUILDER_STRATEGY: 'pairs' })
    const mod = await importFresh()
    expect(mod.resolvePlanBuilderStrategy()).toBe('pairs')
  })

  it('defaults to single when env var missing', async () => {
    const mod = await importFresh()
    expect(mod.resolvePlanBuilderStrategy()).toBe('single')
  })
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/planBuilder/__tests__/generationStateEnvVar.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modificar `generationState.ts`**

Cambiar:

```ts
const configured = (import.meta.env.VITE_PLAN_BUILDER_GENERATION_STRATEGY ?? '').toLowerCase()
```

por:

```ts
const configured = (import.meta.env.VITE_PLAN_BUILDER_STRATEGY ?? '').toLowerCase()
```

Y en el tipo `PlanBuilderGenerationStrategy`, eliminar `'auto'`:

```ts
export type PlanBuilderGenerationStrategy = 'single' | 'pairs'
```

Si hay manejo de `'auto'` en switch/condicional, eliminarlo.

- [ ] **Step 4: Buscar referencias al nombre viejo**

Run: `grep -rn "VITE_PLAN_BUILDER_GENERATION_STRATEGY" src/ docs/ scripts/ README.md .env*`

Reemplazar cada hit por `VITE_PLAN_BUILDER_STRATEGY`. Si aparece en un archivo `.env.local` del owner, recordarle actualizar.

- [ ] **Step 5: Verificar pass**

Run: `npx vitest run src/services/planBuilder/__tests__/generationStateEnvVar.test.ts`
Expected: 2 PASS.

Run: `npm run lint`
Expected: verde.

- [ ] **Step 6: NO-OP commit**

---

## Task 6: Eliminar legacy `buildWeekBatchSystemPromptMinimal`

**Files:**
- Modify: `src/services/week/prompts/weekPrompt.ts:193-195`

**Por qué:** La función queda como código muerto después de Fase 1 (todos los caminos usan `buildWeekBatchStructuredSystemPromptMinimal`). Confunde a futuros lectores y suma chars al bundle.

- [ ] **Step 1: Verificar 0 referencias en runtime**

Run: `grep -rn "buildWeekBatchSystemPromptMinimal\b" src/ scripts/ netlify/`

Si aparece solo en `weekPrompt.ts` (definición) y tests, es seguro eliminar. Si aparece en cualquier path runtime distinto del legacy esperado, **detener y reportar al owner**.

- [ ] **Step 2: Eliminar la función y sus tests directos**

En `weekPrompt.ts` borrar la función `buildWeekBatchSystemPromptMinimal`. Si hay tests que la importen directamente, eliminarlos también.

- [ ] **Step 3: Verificar suite**

Run: `npm test`
Expected: verde.

Run: `npm run audit:prompt`
Expected: rangos verdes.

- [ ] **Step 4: NO-OP commit**

---

# Bloque B — Fase 2 hardening

## Task 7: Ampliar cobertura 1RM con 4 ejercicios faltantes

**Files:**
- Modify: `src/services/training/exerciseLibrary.ts`
- Test: `src/services/training/__tests__/exerciseLibrary1RMCoverage.test.ts` (NEW)

**Por qué:** Solo 11/73 ejercicios tienen `has1RMReference`. El selector descarta opciones útiles. El owner tiene `benchPress: 90`, `squat: 120`, `deadlift: 140`, `overheadPress: 65` en perfil. Necesitamos:
- `incline_bench_press` → benchPress.
- `close_grip_bench_press` → benchPress.
- `sumo_deadlift` → deadlift.
- `landmine_press` → overheadPress.

- [ ] **Step 1: Test failing**

`src/services/training/__tests__/exerciseLibrary1RMCoverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EXERCISE_LIBRARY, getExerciseById } from '../exerciseLibrary'

const REQUIRED = [
  ['incline_bench_press', 'benchPress'],
  ['close_grip_bench_press', 'benchPress'],
  ['sumo_deadlift', 'deadlift'],
  ['landmine_press', 'overheadPress'],
] as const

describe('Exercise library 1RM coverage', () => {
  it.each(REQUIRED)('%s exists and references %s', (id, ref) => {
    const ex = getExerciseById(id)
    expect(ex).toBeDefined()
    expect(ex?.has1RMReference).toBe(ref)
  })

  it('has at least 15 exercises with has1RMReference', () => {
    const withRef = EXERCISE_LIBRARY.filter((e) => e.has1RMReference != null)
    expect(withRef.length).toBeGreaterThanOrEqual(15)
  })

  it('every entry with has1RMReference has a movement pattern compatible with that reference', () => {
    // squat → squat/lunge; deadlift → hinge; benchPress → push; overheadPress → push
    const PATTERN_MAP: Record<string, string[]> = {
      squat: ['squat', 'lunge'],
      deadlift: ['hinge'],
      benchPress: ['push'],
      overheadPress: ['push'],
    }
    for (const ex of EXERCISE_LIBRARY) {
      if (!ex.has1RMReference) continue
      const allowed = PATTERN_MAP[ex.has1RMReference]
      expect(allowed).toContain(ex.movement)
    }
  })
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/training/__tests__/exerciseLibrary1RMCoverage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Agregar entradas al library**

En `src/services/training/exerciseLibrary.ts`, sumar (usar `bench_press` como template estructural):

```ts
{
  id: 'incline_bench_press',
  name: 'Press inclinado con barra',
  movement: 'push',
  // ... resto análogo a bench_press, con focus en porción clavicular
},
{
  id: 'close_grip_bench_press',
  name: 'Press banca agarre cerrado',
  movement: 'push',
  // ...
},
{
  id: 'sumo_deadlift',
  name: 'Peso muerto sumo',
  movement: 'hinge',
  // ...
},
{
  id: 'landmine_press',
  name: 'Landmine press',
  movement: 'push',
  // ...
},
```

(El implementador debe inspeccionar la estructura real de un `ExerciseDefinition` y copiar las props requeridas: `tags`, `sportsTransfer`, `fatigueCost`, `equipment`, `notes`, etc. NO inventar campos.)

En `EXERCISE_1RM_REFERENCES` (línea 1173), agregar:

```ts
incline_bench_press: 'benchPress',
close_grip_bench_press: 'benchPress',
sumo_deadlift: 'deadlift',
landmine_press: 'overheadPress',
```

En `EXERCISE_ROTATION_GROUPS` (línea 1187), asignar grupos coherentes con la rotación existente:

```ts
incline_bench_press: 'B',
close_grip_bench_press: 'C',
sumo_deadlift: 'B',
landmine_press: 'C',
```

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/training/__tests__/exerciseLibrary1RMCoverage.test.ts src/services/training/__tests__/exerciseLibrarySchema.test.ts`
Expected: 7+ PASS.

- [ ] **Step 5: NO-OP commit**

---

## Task 8: Cablear `partnerAvailability` desde repair al selector de drills

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:340-348, 605-613`
- Test: `src/services/planBuilder/__tests__/repairWeekPartnerWiring.test.ts` (NEW)

**Por qué:** `drillSelector.ts:40` soporta `partnerAvailability`, pero `repairWeek` no lo cablea. Si el atleta marca "solo sin partner" en el wizard, el selector nunca lo recibe y siempre default `'either'`.

- [ ] **Step 1: Identificar dónde viene la info en wizard**

Run: `grep -n "partnerAvailability\|partner_availability" src/types/planBuilder.ts src/services/planBuilder/profileAdapter.ts src/services/training/drillSelector.ts | head -20`

Anotar la ruta del valor (probablemente `wizardConfig.partnerAvailability` o `profileAdapter.buildAthleteParameters(...).partnerAvailability`).

- [ ] **Step 2: Test failing**

`src/services/planBuilder/__tests__/repairWeekPartnerWiring.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import * as drillSel from '../../training/drillSelector'
import { repairWeek } from '../repairWeek'

describe('repairWeek wires partnerAvailability into drillSelector', () => {
  it('passes solo when wizard says so', async () => {
    const spy = vi.spyOn(drillSel, 'selectDrillSession')
    await repairWeek({
      plan: buildPlan({ wizardConfig: { partnerAvailability: 'solo' } }) as any,
      week: buildWeekWithSquashSession() as any,
      profile: buildProfile() as any,
      previousWeek: undefined,
      action: buildEmptyCreateWeekAction() as any,
    })
    const call = spy.mock.calls.find(([input]) => input.sessionContext)
    expect(call?.[0].partnerAvailability).toBe('solo')
    spy.mockRestore()
  })

  it('defaults to either when wizard omits it', async () => {
    const spy = vi.spyOn(drillSel, 'selectDrillSession')
    await repairWeek({
      plan: buildPlan({ wizardConfig: {} }) as any,
      week: buildWeekWithSquashSession() as any,
      profile: buildProfile() as any,
      previousWeek: undefined,
      action: buildEmptyCreateWeekAction() as any,
    })
    const call = spy.mock.calls.find(([input]) => input.sessionContext)
    expect(call?.[0].partnerAvailability ?? 'either').toBe('either')
    spy.mockRestore()
  })
})
```

(Helpers `buildPlan/buildWeekWithSquashSession/buildEmptyCreateWeekAction`: copiar de `repairWeek.test.ts` o `repairWeekPhase2Wiring.test.ts`.)

- [ ] **Step 3: Verificar fail**

Run: `npx vitest run src/services/planBuilder/__tests__/repairWeekPartnerWiring.test.ts`
Expected: FAIL.

- [ ] **Step 4: Conectar en `repairWeek.ts`**

En las dos llamadas a `selectDrillSession` (líneas 340-348 y 605-613), agregar `partnerAvailability` al input:

```ts
selectDrillSession({
  // ...campos existentes...
  partnerAvailability: context.plan.wizardConfig.partnerAvailability ?? 'either',
})
```

(Confirmar el path exacto leído en Step 1.)

- [ ] **Step 5: Verificar pass**

Run: `npx vitest run src/services/planBuilder/__tests__/repairWeekPartnerWiring.test.ts`
Expected: 2 PASS.

- [ ] **Step 6: NO-OP commit**

---

## Task 9: Consumir `requireExtraRecovery` en el selector de fuerza

**Files:**
- Modify: `src/services/training/strengthSelector.ts`
- Modify: `src/services/planBuilder/repairWeek.ts` (pasar el flag al selector)

**Por qué:** `profileAdapter.buildAthleteParameters` setea `requireExtraRecovery: true` para atletas ≥ 35 años, pero nadie lo lee. La regla del spec dice "+1 día de recovery mínimo entre sesiones de potencia".

**Decisión simple sin reescribir scheduling:** cuando `requireExtraRecovery === true`, el selector baja la `fatigueCost` esperada de la sesión por 1 nivel (de 4 a 3, p. ej.) y prefiere accesorios sobre olympic en bloques peak. La regla "+1 día" la respeta el plan macro que ya hoy alterna días; aquí solo evitamos doblar carga el mismo día.

- [ ] **Step 1: Test failing**

Extender `src/services/training/__tests__/strengthSelectorPhase2.test.ts` con:

```ts
it('reduces target fatigue when requireExtraRecovery is true', () => {
  const baseline = selectBlockStrengthSession({
    phase: 'peak', weekIndexInBlock: 0, durationMin: 60,
    available1RM: ['squat', 'deadlift', 'benchPress'],
    requireExtraRecovery: false,
  })
  const easy = selectBlockStrengthSession({
    phase: 'peak', weekIndexInBlock: 0, durationMin: 60,
    available1RM: ['squat', 'deadlift', 'benchPress'],
    requireExtraRecovery: true,
  })
  const baselineMaxFatigue = Math.max(...baseline.exercises.map((e: any) => e.fatigueCost ?? 0))
  const easyMaxFatigue = Math.max(...easy.exercises.map((e: any) => e.fatigueCost ?? 0))
  expect(easyMaxFatigue).toBeLessThanOrEqual(baselineMaxFatigue)
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorPhase2.test.ts`
Expected: el nuevo test FALLA.

- [ ] **Step 3: Modificar `strengthSelector.ts`**

En la firma de `selectBlockStrengthSession` (o el wrapper de Phase 2), aceptar `requireExtraRecovery?: boolean`. En el scoring, si está activo:

```ts
if (requireExtraRecovery) {
  // Penalizar fatigueCost >= 4 con -25 en el score.
  if ((exercise.fatigueCost ?? 0) >= 4) score -= 25
}
```

Y en `repairWeek.ts:875` (donde se llama `selectStrengthSession` con `weekIndexInBlock`), pasar el flag:

```ts
selectStrengthSession({
  // ...
  requireExtraRecovery: athleteParams.requireExtraRecovery,
})
```

(`athleteParams` viene de `buildAthleteParameters` en el mismo path. Confirmar nombre exacto.)

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorPhase2.test.ts`
Expected: PASS.

- [ ] **Step 5: NO-OP commit**

---

## Task 10: Fix `getWeekIndexInBlock` cuando la semana cae fuera de fase declarada

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:1418-1425`
- Test: `src/services/planBuilder/__tests__/repairWeekIndexOutOfPhase.test.ts` (NEW)

**Por qué:** Hoy, si `phases` no contiene la semana (puede ocurrir en planes legacy o cuando una semana cae en transición), retorna `context.week.weekIndex` global. Resultado: una semana 7 termina rotando templates por `(7 % 3) = 1` y aplicando progresión 1RM a `weekIndexInBlock = 7`, lo cual saca cargas raras (>100% en peak).

**Decisión:** retornar `0` cuando no hay `containingPhase`. La rotación arranca de A, la progresión usa la semana 1 del bloque (porcentajes seguros). El owner ya lo había marcado como pedido del plan original.

- [ ] **Step 1: Test failing**

```ts
import { describe, expect, it } from 'vitest'
// Helper: importar via export interno si no es público; sino testear el side-effect.

describe('getWeekIndexInBlock returns 0 when no containing phase', () => {
  it('returns 0 instead of global weekIndex when weeks fall outside declared phases', async () => {
    // Construir un context donde plan.phases existe pero no incluye week.weekIndex 7.
    // Llamar al helper expuesto (puede requerir extraer la función a un módulo testable, o un nuevo entrypoint).
    const result = computeWeekIndexInBlock({
      planPhases: [{ startWeekIndex: 0, endWeekIndex: 3 }, { startWeekIndex: 4, endWeekIndex: 6 }],
      weekIndex: 7,
    })
    expect(result).toBe(0)
  })

  it('returns relative index when inside a phase', () => {
    const result = computeWeekIndexInBlock({
      planPhases: [{ startWeekIndex: 0, endWeekIndex: 3 }, { startWeekIndex: 4, endWeekIndex: 6 }],
      weekIndex: 5,
    })
    expect(result).toBe(1)
  })
})
```

(Esto implica extraer `getWeekIndexInBlock` a un módulo exportable. La extracción es trivial: mover a `src/services/planBuilder/blockIndex.ts` o exportar desde `repairWeek.ts`. Decisión: exportarla desde `repairWeek.ts` para no romper el módulo:

```ts
export function computeWeekIndexInBlock(input: { planPhases?: { startWeekIndex: number; endWeekIndex: number }[]; weekIndex: number }): number {
  const containingPhase = input.planPhases?.find((phase) =>
    input.weekIndex >= phase.startWeekIndex && input.weekIndex <= phase.endWeekIndex,
  )
  if (!containingPhase) return 0
  return Math.max(0, input.weekIndex - containingPhase.startWeekIndex)
}
```

y luego `getWeekIndexInBlock(context)` la consume.)

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/planBuilder/__tests__/repairWeekIndexOutOfPhase.test.ts`
Expected: FAIL.

- [ ] **Step 3: Refactor + fix en `repairWeek.ts`**

Reemplazar la función actual:

```ts
function getWeekIndexInBlock(context: RepairContext): number {
  return computeWeekIndexInBlock({
    planPhases: context.plan.phases?.map((p) => ({
      startWeekIndex: p.startWeekIndex,
      endWeekIndex: p.endWeekIndex,
    })),
    weekIndex: context.week.weekIndex,
  })
}
```

Y exportar `computeWeekIndexInBlock`.

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/planBuilder/__tests__/repairWeekIndexOutOfPhase.test.ts src/services/planBuilder/__tests__/repairWeekPhase2Wiring.test.ts`
Expected: todos verde.

- [ ] **Step 5: NO-OP commit**

---

## Task 11: Test cross-week duplicates (métrica 2.8 #1)

**Files:**
- Create: `src/services/planBuilder/__tests__/crossWeekStrengthDuplicates.test.ts`

**Por qué:** Métrica del spec: "Plan de 9 semanas: 0 sesiones de fuerza con ≥3 ejercicios idénticos a otra semana del mismo bloque". Nunca hubo test focalizado.

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest'
import { selectStrengthSession } from '../../training/strengthSelector'

describe('Cross-week strength duplicates within block', () => {
  it('build block weeks 1-3 share at most 2 exercise ids', () => {
    const w1 = selectStrengthSession({
      phase: 'build', weekIndexInBlock: 0, durationMin: 60,
      available1RM: ['squat', 'deadlift', 'benchPress', 'overheadPress'],
    } as any)
    const w2 = selectStrengthSession({
      phase: 'build', weekIndexInBlock: 1, durationMin: 60,
      available1RM: ['squat', 'deadlift', 'benchPress', 'overheadPress'],
      recentExercises: w1.exercises.map((e: any) => e.id),
    } as any)
    const w3 = selectStrengthSession({
      phase: 'build', weekIndexInBlock: 2, durationMin: 60,
      available1RM: ['squat', 'deadlift', 'benchPress', 'overheadPress'],
      recentExercises: [...w1.exercises, ...w2.exercises].map((e: any) => e.id),
    } as any)

    const sharedW1W2 = intersect(w1.exercises, w2.exercises)
    const sharedW2W3 = intersect(w2.exercises, w3.exercises)
    expect(sharedW1W2.length).toBeLessThan(3)
    expect(sharedW2W3.length).toBeLessThan(3)
  })

  it('peak block also rotates', () => {
    // Analogo a build pero phase='peak'.
  })
})

function intersect(a: { id: string }[], b: { id: string }[]) {
  const ids = new Set(b.map((x) => x.id))
  return a.filter((x) => ids.has(x.id))
}
```

- [ ] **Step 2: Verificar baseline**

Run: `npx vitest run src/services/planBuilder/__tests__/crossWeekStrengthDuplicates.test.ts`
Expected: PASS si la rotación funciona, FAIL si revela un bug real. Si falla → reportar al owner antes de tocar el selector.

- [ ] **Step 3: NO-OP commit**

---

## Task 12: Warning `quality.strength.repeated_template` en qualityReview

**Files:**
- Modify: `src/services/planBuilder/qualityReview.ts`
- Test: `src/services/planBuilder/__tests__/qualityReviewRepeatedTemplate.test.ts` (NEW)

**Por qué:** Métrica 2.8 #5 del spec. El review debe levantar warning si dos semanas del mismo bloque comparten ≥3 ejercicios.

- [ ] **Step 1: Test failing**

```ts
import { describe, expect, it } from 'vitest'
import { reviewPlanQuality } from '../qualityReview'

describe('qualityReview surfaces repeated strength templates', () => {
  it('warns when two weeks of the same phase share ≥3 exercises', () => {
    const plan = buildPlan({ phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 2 }] }) as any
    const weeks = [
      buildWeek({ weekIndex: 0, status: 'accepted',
        strengthExerciseIds: ['back_squat', 'bench_press', 'overhead_press', 'pull_up'] }),
      buildWeek({ weekIndex: 1, status: 'accepted',
        strengthExerciseIds: ['back_squat', 'bench_press', 'overhead_press', 'farmer_carry'] }),
    ] as any
    const review = reviewPlanQuality(plan, weeks)
    expect(review.issues.some((i) => i.code === 'quality.strength.repeated_template')).toBe(true)
  })

  it('does not warn when weeks share <3 exercises', () => {
    const plan = buildPlan({ phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 2 }] }) as any
    const weeks = [
      buildWeek({ weekIndex: 0, strengthExerciseIds: ['back_squat', 'bench_press'] }),
      buildWeek({ weekIndex: 1, strengthExerciseIds: ['front_squat', 'incline_dumbbell_press'] }),
    ] as any
    const review = reviewPlanQuality(plan, weeks)
    expect(review.issues.some((i) => i.code === 'quality.strength.repeated_template')).toBe(false)
  })
})
```

(El helper `buildWeek` tiene que aceptar `strengthExerciseIds` y construir `sessions` con esos exercises. Inspeccionar el helper actual en `qualityReview.test.ts` y extender.)

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/planBuilder/__tests__/qualityReviewRepeatedTemplate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar en `qualityReview.ts`**

Agregar una función `findRepeatedStrengthTemplates(plan, weeks)` que:
1. Agrupa semanas por `phase` declarada en `plan.phases`.
2. Para cada par de semanas del mismo grupo, cuenta IDs compartidos en sesiones `sessionType === 'strength'`.
3. Si ≥3, emite issue `{ severity: 'warning', code: 'quality.strength.repeated_template', message: 'Semanas X y Y del bloque Z comparten N ejercicios.' }`.

Llamar la función dentro de `reviewPlanQuality` y agregar las issues al array global. Ajustar `warningCount` para reflejarlo.

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/planBuilder/__tests__/qualityReviewRepeatedTemplate.test.ts src/services/__tests__/qualityReview.test.ts`
Expected: todos verde.

- [ ] **Step 5: NO-OP commit**

---

## Task 13: Completar `raceBlock` con estructura mínima

**Files:**
- Modify: `src/services/training/strengthBlocks/raceBlock.ts`
- Test: `src/services/training/__tests__/raceBlockStructure.test.ts` (NEW)

**Por qué:** Hoy `raceBlock` solo declara `core` (required) + `plyo` (optional). Una sesión de race queda con 1-2 ejercicios y fillers genéricos. Debe tener al menos: core (required), plyo light (optional), un push o pull ligero (optional), mobility/cool-down (required).

- [ ] **Step 1: Test failing**

```ts
import { describe, expect, it } from 'vitest'
import { RACE } from '../strengthBlocks/raceBlock'

describe('raceBlock structure', () => {
  it('has at least 3 slots including core and cool-down', () => {
    expect(RACE.slots.length).toBeGreaterThanOrEqual(3)
    const patterns = RACE.slots.map((s) => s.pattern)
    expect(patterns).toContain('core')
    expect(patterns).toContain('mobility') // o el nombre real del cool-down
  })

  it('keeps high-fatigue patterns optional in race week', () => {
    const plyoSlot = RACE.slots.find((s) => s.pattern === 'plyo')
    if (plyoSlot) expect(plyoSlot.required).toBe(false)
  })
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/training/__tests__/raceBlockStructure.test.ts`
Expected: FAIL.

- [ ] **Step 3: Editar `raceBlock.ts`**

```ts
import type { StrengthBlockTemplate } from './types'

export const RACE: StrengthBlockTemplate = {
  id: 'race',
  phase: 'race',
  subTemplate: 'A',
  description: 'Race - activacion pre-evento sin fatiga residual',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'plyo', required: false },
    { pattern: 'push', required: false },     // press ligero opcional
    { pattern: 'mobility', required: true },  // cool-down
  ],
}
```

(Si el tipo `StrengthBlockSlot.pattern` no incluye `'mobility'`, hay dos opciones: (a) extender el union para incluir `mobility`, (b) usar el nombre que tu `MovementPattern` tenga para cool-down. **Confirmar antes de editar el tipo**.)

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/training/__tests__/raceBlockStructure.test.ts src/services/training/__tests__/strengthBlocks.test.ts`
Expected: todos verde.

- [ ] **Step 5: NO-OP commit**

---

## Task 14: Soltar slots obligatorios en Build B/C para sesiones <55 min

**Files:**
- Modify: `src/services/training/strengthBlocks/buildBlock.ts`
- Test: `src/services/training/__tests__/buildBlockOptionalSlots.test.ts` (NEW)

**Por qué:** Build B y C declaran todos los main slots `required: true`. En sesiones de 45 min eso sobre-restringe: el selector puede dejarse fuera 1-2 slots críticos por falta de tiempo. El spec pedía `minDurationMin: 55` para que sean required solo en sesiones largas.

- [ ] **Step 1: Test failing**

```ts
import { describe, expect, it } from 'vitest'
import { BUILD_B, BUILD_C } from '../strengthBlocks/buildBlock'

describe('Build B/C templates respect durationMin gating', () => {
  it.each([BUILD_B, BUILD_C])('marks accessory slots optional', (block) => {
    const requiredCount = block.slots.filter((s) => s.required && !s.minDurationMin).length
    // Esperamos a lo sumo 3 slots required incondicionales (core + squat/hinge + push o pull).
    expect(requiredCount).toBeLessThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/training/__tests__/buildBlockOptionalSlots.test.ts`
Expected: FAIL.

- [ ] **Step 3: Editar `buildBlock.ts`**

Para BUILD_B y BUILD_C, dejar los slots de accesorios con `required: false` o con `minDurationMin: 55`. Ejemplo:

```ts
slots: [
  { pattern: 'core', required: true },
  { pattern: 'squat', required: true },        // o hinge, según template
  { pattern: 'push', required: false, minDurationMin: 55 },
  { pattern: 'pull', required: false, minDurationMin: 55 },
  { pattern: 'unilateral', required: false },
  { pattern: 'plyo', required: false, minDurationMin: 60 },
],
```

(Confirmar tipo `StrengthBlockSlot` para saber si `minDurationMin` existe; si no, agregarlo opcional al tipo.)

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/training/__tests__/buildBlockOptionalSlots.test.ts src/services/training/__tests__/strengthBlocks.test.ts src/services/training/__tests__/strengthSelectorPhase2.test.ts`
Expected: todos verde.

- [ ] **Step 5: NO-OP commit**

---

# Bloque C — Verificación + métrica

## Task 15: Reportar `fallbackUsed` por semana en E2E

**Files:**
- Modify: `scripts/e2e-plan-builder-test.mjs`

**Por qué:** Métrica spec 1.8 #2 — "≥ 8/9 semanas vienen de IA real". El script E2E hoy reporta éxito/falla, no breakdown por semana. Hay que sumar al final un resumen `aiWeeks/totalWeeks`.

- [ ] **Step 1: Localizar dónde se itera por semana**

Run: `grep -n "weekIndex\|fallbackUsed\|generationMeta" scripts/e2e-plan-builder-test.mjs | head -20`

- [ ] **Step 2: Sumar reporte final**

Al final del script, después de procesar el plan generado:

```js
const aiWeeks = generated.weeks.filter((w) => !w.generationMeta?.fallbackUsed).length
const totalWeeks = generated.weeks.length
const ratio = (aiWeeks / totalWeeks * 100).toFixed(1)
console.log(`\n=== Phase 1 metric ===\n${aiWeeks}/${totalWeeks} weeks from AI (${ratio}%)`)
if (aiWeeks / totalWeeks < 0.8) {
  console.warn('⚠️ Below 80% AI threshold — investigate fallbackReason per week.')
  for (const week of generated.weeks) {
    console.warn(`  week ${week.weekIndex}: fallback=${!!week.generationMeta?.fallbackUsed} reason=${week.generationMeta?.repairWarnings?.map((w) => w.code).join(',') ?? '-'}`)
  }
}
```

(Adaptar a la estructura real del script; usar `generationMeta` que ya viene poblada.)

- [ ] **Step 3: Smoke**

Run: `npm run e2e:plan:generate` (requiere Gemini real y env vars válidos).
Expected: el reporte final muestra el ratio. Si <80%, queda evidencia para iterar.

- [ ] **Step 4: NO-OP commit**

---

## Task 16: Validación completa + auditoría de prompt

- [ ] **Step 1: Validación local**

```bash
npm run lint
npm test
npm run build
npm run audit:prompt
```

Expected: todo verde.

Si `audit:prompt` reporta delta de tokens, anotar en `PROJECT_REVIEW_AND_ROADMAP.md` cuál fue el cambio efectivo (Task 6 elimina chars de la rama legacy, así que el conteo de `plan_builder_pair`/`week_creator` puede bajar 100-500 chars).

- [ ] **Step 2: Comparativa pre/post hardening**

Generar un plan local con perfil real del owner (squat 120, deadlift 140, bench 90, OHP 65). Confirmar visualmente:
- Las semanas siguen alternando templates (rotación Phase 2 sigue funcionando).
- Aparecen ejercicios nuevos: incline bench, sumo deadlift, close grip bench, landmine press en alguna semana.
- El plan no rompe en build/peak/race con los slots opcionales.
- El warning `quality.strength.repeated_template` no aparece (debería ser raro tras Task 11).

- [ ] **Step 3: Actualizar `PROJECT_REVIEW_AND_ROADMAP.md`**

Bajo "Mejoras Recientes Detectadas", agregar subsección "Hardening Fases 1+2 (post-review)" listando:
- Bug `onChunk` desconectado → fix Task 1.
- Wallclock realineado a Netlify Pro 26s → Task 2.
- Env var renombrada a `VITE_PLAN_BUILDER_STRATEGY` → Task 5.
- Cobertura 1RM ampliada a 15 ejercicios → Task 7.
- `partnerAvailability` y `requireExtraRecovery` ahora se consumen → Tasks 8-9.
- `getWeekIndexInBlock` retorna 0 fuera de fase → Task 10.
- Race block + Build B/C reorganizados → Tasks 13-14.
- Warning `quality.strength.repeated_template` operativo → Task 12.
- E2E reporta ratio IA vs fallback → Task 15.
- Test `requestPolicyTimeoutConsistency` previene drift cliente↔proxy → Task 3.

Riesgos abiertos (no resueltos en este hardening):
- Métrica empírica ≥80% IA real requiere correr `e2e:plan:generate` en DEV con Gemini real y un plan de 9 semanas (no automatizable sin créditos).
- Drill-by-id por referencia (spec 1.1) sigue diferido.
- Spec 2.1 schema canónico (`pattern`, `variant`, `fatigueCost: 1-5`, `transfersTo`, `contraindications`) inferido en runtime, no declarativo.

- [ ] **Step 4: Self-review final**

Releer cada bullet de las reviews originales y confirmar que tiene una task que lo cubre. Lista de cierre esperada:

**Fase 1:**
- ✅ Bug `onChunk` (Task 1)
- ✅ Wallclock (Task 2)
- ✅ Test consistencia timeouts (Task 3)
- ✅ Doble `batchId` (Task 4)
- ✅ Env var rename (Task 5)
- ✅ Limpiar legacy batch prompt (Task 6)
- ✅ Reporte E2E IA real (Task 15)
- ⚠️ Drill-by-id: explícitamente diferido.

**Fase 2:**
- ✅ Cobertura 1RM (Task 7)
- ✅ `partnerAvailability` (Task 8)
- ✅ `requireExtraRecovery` (Task 9)
- ✅ `getWeekIndexInBlock` (Task 10)
- ✅ Cross-week duplicates test (Task 11)
- ✅ Warning repeated_template (Task 12)
- ✅ Race block (Task 13)
- ✅ Build B/C slots opcionales (Task 14)
- ⚠️ Schema canónico declarativo: queda como deuda Phase 2.5 si llega a hacer falta.

- [ ] **Step 5: NO-OP commit**

---

## Métricas de cierre

1. ✅ `npm run lint && npm test && npm run build && npm run audit:prompt` verde.
2. ✅ `requestPolicyTimeoutConsistency.test.ts` previene drift cliente↔proxy.
3. ✅ `chunkCount > 0` para weeks single con providers que emiten stream.
4. ✅ Atleta con 1RM completo usa al menos 4 ejercicios de un pool >= 15 con `has1RMReference`.
5. ✅ Una semana fuera de fase no rompe la rotación de templates.
6. ✅ Plan de 9 semanas en `e2e:plan:generate` reporta `aiWeeks/totalWeeks` al final.
7. ⚠️ Métrica IA real ≥80%: el script ahora reporta el ratio, pero queda como observación abierta hasta correrlo en DEV con Gemini real.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Bajar wallclock a 24s puede aumentar fallbacks en plan_builder_pair | El recovery a single (Task 4 de Fase 1, ya hecho) absorbe la mayoría. Si crece el fallback, evaluar si single con `responseSchema` es suficiente y desactivar pair por env var. |
| Agregar 4 ejercicios al library puede romper tests pre-existentes que asumen counts exactos | Tests deberían usar `>=` no `===` para totales. Si rompen, ampliar el test, no el código. |
| `getWeekIndexInBlock = 0` para semanas fuera de fase puede ocultar bugs de wiring | Logging breve en `repairWeek` cuando se ejerce ese branch, para detectar planes mal estructurados. |
| `requireExtraRecovery` reduce fatigueCost puede chocar con perfiles que esperan sesiones intensas | El flag se setea SOLO si `age >= 35`. Si el atleta pide sesión exigente vía chat, el override manual sigue funcionando. |
| Warning de repeated_template puede ser ruidoso si el spec es estricto | El warning entra como `severity: warning`, no `error`. No bloquea commit. Si aparece demasiado, ajustar threshold a ≥4 ejercicios. |

---

## Qué NO hacer en este plan

- No reescribir `promptBuilder.ts`.
- No tocar selectores deportivos más allá de cablear flags ya existentes.
- No reabrir la decisión de `single` vs `pairs` como default (Fase 1 ya la cerró).
- No migrar a Claude (Fase 1.6 dejó el routing listo; activación post-beta).
- No implementar drill-by-id (decisión explícita del owner, diferido).
- No agregar campos canónicos del schema spec 2.1 (`pattern`, `variant`, `fatigueCost: 1-5`, `transfersTo`, `contraindications`) declarativos — la inferencia actual cubre.
- No tocar `commitPlan`, `regeneratePlanWeek` ni otros entregables de Fase 3 (en plan separado).
- No tocar sync ni auth.
