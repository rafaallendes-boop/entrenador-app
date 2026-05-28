# Plan Builder Fase 1 — IA confiable con Gemini

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conseguir que ≥80% de las semanas generadas vengan de IA real (no fallback) en un plan de 9 semanas, replicando el `responseSchema` que ya usa `week_creator` y arreglando el flujo de degradación.

**Architecture:** Tres cambios estructurales sin tocar prompts deportivos: (1) habilitar structured output (`responseSchema`) en `plan_builder_week` reusando `WEEK_CREATOR_RESPONSE_SCHEMA`, (2) hacer que `degradeToSingle` realmente caiga a single antes de fallback local, (3) introducir provider routing por `requestClass` para preparar migración futura a Claude. Se complementa con compactación del prompt batch y un parser de streaming progresivo. La estrategia `pairs` queda detrás de un flag — default cambia a `single` por confiabilidad.

**Tech Stack:** TypeScript, Vitest, Gemini 2.5 Flash via Netlify Function proxy. Sin nuevas deps.

**Spec:** `docs/superpowers/specs/2026-05-27-plan-builder-star-product-design.md` (Fase 1, secciones 1.1–1.8).

**Restricción operativa:** No deploy a prod antes de 2026-05-29. Cada task debe pasar `npm run lint && npm test && npm run build && npm run audit:prompt`.

**⚠️ Política de commits para esta ejecución:** El usuario hará UN commit grande al final que agrupará spec + plan + todos los cambios. **NO ejecutar los pasos `git commit` ni `git add` dentro de cada task.** Tratarlos como no-op. Dejar todos los cambios staged-pendientes para que el usuario los revise y commitee de forma consolidada.

---

## File Structure

```
src/services/planBuilder/
  generateWeek.ts                    [MODIFY: pasar responseSchema/responseMimeType]
  generatePlan.ts                    [MODIFY: degradeToSingle real + pasar responseSchema]
  generationState.ts                 [MODIFY: default strategy single]
  planBuilderResponseSchema.ts       [NEW: schema reutilizable]

src/services/ai/
  providerResolver.ts                [MODIFY: nuevo getProviderForRequestClass]

src/services/week/
  prompts/weekPrompt.ts              [MODIFY: compactar batch prompt]
  streamingActionsParser.ts          [NEW: parser progresivo]

src/services/planBuilder/__tests__/
  planBuilderResponseSchema.test.ts  [NEW]
  generatePlanDegradation.test.ts    [NEW]
  generationStateDefault.test.ts     [NEW]

src/services/ai/__tests__/
  providerResolver.test.ts           [NEW or extend if exists]

src/services/week/__tests__/
  streamingActionsParser.test.ts     [NEW]
  weekPromptCompact.test.ts          [NEW]
```

---

## Task 1: Crear schema reutilizable para plan_builder

**Files:**
- Create: `src/services/planBuilder/planBuilderResponseSchema.ts`
- Test: `src/services/planBuilder/__tests__/planBuilderResponseSchema.test.ts`

- [ ] **Step 1: Escribir el test failing**

Crear `src/services/planBuilder/__tests__/planBuilderResponseSchema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PLAN_BUILDER_WEEK_RESPONSE_SCHEMA } from '../planBuilderResponseSchema'

describe('PLAN_BUILDER_WEEK_RESPONSE_SCHEMA', () => {
  it('exposes a JSON schema with create_week as the discriminated action', () => {
    expect(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA).toMatchObject({
      type: 'object',
    })
    const serialized = JSON.stringify(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA)
    expect(serialized).toContain('create_week')
    expect(serialized).toContain('targetDate')
    expect(serialized).toContain('sessions')
  })

  it('matches the schema used by week_creator (single source of truth)', async () => {
    const { WEEK_CREATOR_RESPONSE_SCHEMA } = await import('../../weekCreator/weekCreatorResponseSchema')
    expect(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA).toEqual(WEEK_CREATOR_RESPONSE_SCHEMA)
  })
})
```

- [ ] **Step 2: Verificar que el test falla**

Run: `npx vitest run src/services/planBuilder/__tests__/planBuilderResponseSchema.test.ts`
Expected: FAIL with "Cannot find module '../planBuilderResponseSchema'"

- [ ] **Step 3: Crear el módulo**

Crear `src/services/planBuilder/planBuilderResponseSchema.ts`:

```ts
import { ACTION_CONTRACTS } from '../ai/prompt/core/outputContract'
import { renderActionAsJsonSchema } from '../ai/prompt/renderers/jsonSchema'

/**
 * Schema reused for plan_builder_week structured output.
 * Identical to WEEK_CREATOR_RESPONSE_SCHEMA: both consume create_week contract.
 * Defined here to keep plan_builder ownership of its provider config clear.
 */
export const PLAN_BUILDER_WEEK_RESPONSE_SCHEMA: Record<string, unknown> = renderActionAsJsonSchema(
  ACTION_CONTRACTS.create_week,
)
```

- [ ] **Step 4: Verificar que el test pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/planBuilderResponseSchema.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/planBuilder/planBuilderResponseSchema.ts src/services/planBuilder/__tests__/planBuilderResponseSchema.test.ts
git commit -m "feat(planBuilder): expose reusable response schema for structured output"
```

---

## Task 2: Habilitar structured output en `generateWeek`

**Files:**
- Modify: `src/services/planBuilder/generateWeek.ts` (sección donde se invoca `provider.call`)
- Test: `src/services/planBuilder/__tests__/generateWeek.structuredOutput.test.ts` (nuevo)

- [ ] **Step 1: Identificar la línea actual**

Run: `grep -n "maxTokens: policy.maxTokens" src/services/planBuilder/generateWeek.ts`
Expected output: una línea (alrededor de la 242) dentro de la llamada a `provider.call`.

- [ ] **Step 2: Escribir el test failing**

Crear `src/services/planBuilder/__tests__/generateWeek.structuredOutput.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { generateWeek } from '../generateWeek'
import { PLAN_BUILDER_WEEK_RESPONSE_SCHEMA } from '../planBuilderResponseSchema'
import type { AIProvider } from '../../ai/types'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'

function makeMinimalPlan(): TrainingPlan {
  return {
    id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'pending',
    title: 'Test', startDate: '2026-06-01', endDate: '2026-06-14', totalWeeks: 2,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1, blockFocus: '', intentBySport: {} }],
    wizardConfig: {} as PlanWizardConfig,
    macroSnapshot: {
      goalEventId: 'e1', goalEventDate: '2026-06-14', currentPhase: 'build', weeksRemaining: 2,
      blockFocus: '', headline: '', timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
      secondaryEvents: [], computedAt: 0,
    },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlan
}

function makeMinimalWeek(): TrainingPlanWeek {
  return {
    id: 'w1', planId: 'p1', weekIndex: 0, weekStartDate: '2026-06-01', phase: 'build',
    status: 'pending', sessions: [], weekObjectives: [{ goal: 'test' }],
    targetLoadBySport: { squash: 50, running: 25, strength: 25, mobility: 25 },
    validationIssues: [],
    generationMeta: { attempts: 0, provider: '', model: '' },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlanWeek
}

it('generateWeek passes responseSchema and responseMimeType=application/json to the provider', async () => {
  const callSpy = vi.fn(async () => ({
    text: '<actions>[{"type":"create_week","targetDate":"2026-06-01","reason":"x","sessions":[],"weekObjectives":[]}]</actions>',
    provider: 'gemini', model: 'gemini-2.5-flash', durationMs: 100, traceId: 't', text_length: 0,
  } as never))
  const provider = { name: 'gemini', call: callSpy } as unknown as AIProvider

  await generateWeek({
    provider,
    plan: makeMinimalPlan(),
    week: makeMinimalWeek(),
    profile: { id: 'default', updatedAt: 0 } as AthleteProfile,
    wizardConfig: {
      goalEventId: 'e1', trainingDays: ['monday','tuesday','wednesday','thursday','friday','saturday'],
      doubleSessionDays: [], sessionsPerWeek: 6, sessionDurationMins: 60,
      allowDoubleSession: false, complementarySports: ['running','strength'],
      currentFitnessLevel: 'fit', currentFatigue: 'fresh',
      createdAt: '', updatedAt: '',
    },
  })

  expect(callSpy).toHaveBeenCalledTimes(1)
  const callArgs = callSpy.mock.calls[0]![0]
  expect(callArgs.responseMimeType).toBe('application/json')
  expect(callArgs.responseSchema).toEqual(PLAN_BUILDER_WEEK_RESPONSE_SCHEMA)
})
```

- [ ] **Step 3: Verificar que el test falla**

Run: `npx vitest run src/services/planBuilder/__tests__/generateWeek.structuredOutput.test.ts`
Expected: FAIL — `responseMimeType` is `undefined`, not `'application/json'`.

- [ ] **Step 4: Modificar `generateWeek.ts` para pasar el schema**

En `src/services/planBuilder/generateWeek.ts`, importar el schema al inicio (después de los imports existentes):

```ts
import { PLAN_BUILDER_WEEK_RESPONSE_SCHEMA } from './planBuilderResponseSchema'
```

Localizar la llamada `await provider.call({...})` (cerca de la línea 240). Añadir `responseMimeType` y `responseSchema` al objeto de argumentos:

```ts
const raw = await provider.call({
  requestClass: 'plan_builder_week',
  traceId,
  systemPrompt: buildWeekSystemPromptMinimal(),
  userMessage: buildWeekUserPrompt({ plan, week, previousWeek, profile, wizardConfig, retryInstruction, strictFormatting }),
  maxTokens: policy.maxTokens,
  temperature: policy.temperature,
  allowFallback: policy.allowFallback,
  responseMimeType: 'application/json',
  responseSchema: PLAN_BUILDER_WEEK_RESPONSE_SCHEMA,
  onChunk: (chunk) => {
    chunkCount += 1
    if (chunkCount === 1) {
      useAIDebugStore.getState().markFirstChunk(traceId)
    }
    onChunk?.(chunk)
  },
})
```

- [ ] **Step 5: Verificar que el test pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/generateWeek.structuredOutput.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Verificar suite existente no se rompió**

Run: `npx vitest run src/services/planBuilder src/services/weekCreator`
Expected: PASS para todos los archivos.

- [ ] **Step 7: Commit**

```bash
git add src/services/planBuilder/generateWeek.ts src/services/planBuilder/__tests__/generateWeek.structuredOutput.test.ts
git commit -m "feat(planBuilder): enable structured output (responseSchema) in generateWeek"
```

---

## Task 3: Activar structured output en `generateWeekPair` (batch)

**Files:**
- Modify: `src/services/planBuilder/generatePlan.ts:410-430` (dentro de `generateWeekPair`)
- Test: `src/services/planBuilder/__tests__/generateWeekPair.structuredOutput.test.ts`

**Nota:** El schema actual modela UN create_week. Para batch necesitamos un schema que acepte `actions: [create_week, create_week]`. Lo construimos sobre el mismo contract.

- [ ] **Step 1: Extender `planBuilderResponseSchema.ts` con schema batch**

Modificar `src/services/planBuilder/planBuilderResponseSchema.ts`:

```ts
import { ACTION_CONTRACTS } from '../ai/prompt/core/outputContract'
import { renderActionAsJsonSchema } from '../ai/prompt/renderers/jsonSchema'

export const PLAN_BUILDER_WEEK_RESPONSE_SCHEMA: Record<string, unknown> = renderActionAsJsonSchema(
  ACTION_CONTRACTS.create_week,
)

/**
 * Schema for plan_builder_pair: response is `{ actions: [create_week, create_week] }`.
 * Two create_week objects expected, one per requested week.
 */
export const PLAN_BUILDER_PAIR_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: PLAN_BUILDER_WEEK_RESPONSE_SCHEMA,
    },
  },
  required: ['actions'],
}
```

- [ ] **Step 2: Añadir test para el pair schema**

Añadir a `src/services/planBuilder/__tests__/planBuilderResponseSchema.test.ts`:

```ts
import { PLAN_BUILDER_PAIR_RESPONSE_SCHEMA, PLAN_BUILDER_WEEK_RESPONSE_SCHEMA } from '../planBuilderResponseSchema'

describe('PLAN_BUILDER_PAIR_RESPONSE_SCHEMA', () => {
  it('wraps two create_week schemas inside an actions array', () => {
    expect(PLAN_BUILDER_PAIR_RESPONSE_SCHEMA).toMatchObject({
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: PLAN_BUILDER_WEEK_RESPONSE_SCHEMA,
        },
      },
      required: ['actions'],
    })
  })
})
```

Run: `npx vitest run src/services/planBuilder/__tests__/planBuilderResponseSchema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Escribir test failing para `generateWeekPair`**

Crear `src/services/planBuilder/__tests__/generateWeekPair.structuredOutput.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { PLAN_BUILDER_PAIR_RESPONSE_SCHEMA } from '../planBuilderResponseSchema'

// generateWeekPair no se exporta — testeamos a través de generatePlanWeeks con un provider spy
import { generatePlanWeeks } from '../generatePlan'
import type { AIProvider } from '../../ai/types'

it('generatePlanWeeks(strategy=pairs) passes PAIR responseSchema to the provider', async () => {
  const callSpy = vi.fn(async () => ({
    text: '<actions>[{"type":"create_week","targetDate":"2026-06-01","reason":"x","sessions":[],"weekObjectives":[]},{"type":"create_week","targetDate":"2026-06-08","reason":"x","sessions":[],"weekObjectives":[]}]</actions>',
    provider: 'gemini', model: 'gemini-2.5-flash', durationMs: 100, traceId: 't',
  } as never))
  const provider = { name: 'gemini', call: callSpy } as unknown as AIProvider

  await generatePlanWeeks({
    plan: { /* fill minimal plan, totalWeeks 2 */ } as never,
    weeks: [/* two weeks */] as never,
    profile: { id: 'default', updatedAt: 0 } as never,
    wizardConfig: { sessionsPerWeek: 4, sessionDurationMins: 60, allowDoubleSession: false, trainingDays: ['monday','tuesday','wednesday','thursday'], complementarySports: [], currentFitnessLevel: 'fit', currentFatigue: 'fresh', doubleSessionDays: [], goalEventId: 'e', createdAt: '', updatedAt: '' } as never,
    provider,
    strategy: 'pairs',
  })

  const firstCall = callSpy.mock.calls[0]![0] as { responseSchema?: unknown; requestClass: string }
  expect(firstCall.requestClass).toBe('plan_builder_pair')
  expect(firstCall.responseSchema).toEqual(PLAN_BUILDER_PAIR_RESPONSE_SCHEMA)
})
```

> Si rellenar el plan minimal en este test resulta demasiado verboso, prefiere extraer `generateWeekPair` como export y testearlo directamente.

Run: `npx vitest run src/services/planBuilder/__tests__/generateWeekPair.structuredOutput.test.ts`
Expected: FAIL — `responseSchema` undefined o test inválido por shape de plan.

- [ ] **Step 4: Modificar `generateWeekPair`**

En `src/services/planBuilder/generatePlan.ts`, añadir import:

```ts
import { PLAN_BUILDER_PAIR_RESPONSE_SCHEMA } from './planBuilderResponseSchema'
```

Localizar la llamada `await provider.call({...})` dentro de `generateWeekPair` (línea ~410). Añadir:

```ts
responseMimeType: 'application/json',
responseSchema: PLAN_BUILDER_PAIR_RESPONSE_SCHEMA,
```

- [ ] **Step 5: Verificar que el test pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/generateWeekPair.structuredOutput.test.ts`
Expected: PASS.

- [ ] **Step 6: Verificar suite completa**

Run: `npx vitest run src/services/planBuilder`
Expected: PASS para todos los archivos del directorio.

- [ ] **Step 7: Commit**

```bash
git add src/services/planBuilder/generatePlan.ts src/services/planBuilder/planBuilderResponseSchema.ts src/services/planBuilder/__tests__/planBuilderResponseSchema.test.ts src/services/planBuilder/__tests__/generateWeekPair.structuredOutput.test.ts
git commit -m "feat(planBuilder): enable structured output for plan_builder_pair batches"
```

---

## Task 4: Default strategy = single

**Files:**
- Modify: `src/services/planBuilder/generationState.ts`
- Test: `src/services/planBuilder/__tests__/generationStateDefault.test.ts`

- [ ] **Step 1: Leer estado actual**

Run: `cat src/services/planBuilder/generationState.ts`
Anotar mentalmente cuál es la lógica actual de `resolveConfiguredGenerationStrategy`.

- [ ] **Step 2: Escribir test failing**

Crear `src/services/planBuilder/__tests__/generationStateDefault.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { resolveConfiguredGenerationStrategy } from '../generationState'

describe('resolveConfiguredGenerationStrategy', () => {
  const originalEnv = { ...import.meta.env }

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv)
  })

  it('defaults to single when no override and no explicit input', () => {
    expect(resolveConfiguredGenerationStrategy(9, undefined)).toBe('single')
  })

  it('respects explicit input strategy', () => {
    expect(resolveConfiguredGenerationStrategy(9, 'pairs')).toBe('pairs')
    expect(resolveConfiguredGenerationStrategy(9, 'single')).toBe('single')
  })

  it('honors VITE_PLAN_BUILDER_STRATEGY env var when input is undefined', () => {
    ;(import.meta.env as Record<string, string>).VITE_PLAN_BUILDER_STRATEGY = 'pairs'
    expect(resolveConfiguredGenerationStrategy(9, undefined)).toBe('pairs')
  })
})
```

- [ ] **Step 3: Verificar que el test falla**

Run: `npx vitest run src/services/planBuilder/__tests__/generationStateDefault.test.ts`
Expected: FAIL — el actual default probablemente es 'pairs' para totalWeeks >= cierto valor.

- [ ] **Step 4: Reescribir `generationState.ts`**

Reemplazar el contenido de `src/services/planBuilder/generationState.ts`:

```ts
export type PlanGenerationStrategy = 'single' | 'pairs'

/**
 * Resolves the generation strategy for plan builder weeks.
 *
 * Default is 'single' (more reliable, no truncation risk, easier to observe per-week).
 * 'pairs' can be opted-in via:
 *   - explicit input.strategy (e.g. from internal QA UI)
 *   - VITE_PLAN_BUILDER_STRATEGY=pairs env var (e.g. for cost/latency optimization tests)
 */
export function resolveConfiguredGenerationStrategy(
  _totalWeeks: number,
  inputStrategy: PlanGenerationStrategy | undefined,
): PlanGenerationStrategy {
  if (inputStrategy) return inputStrategy
  const envOverride = (import.meta.env as Record<string, string | undefined>).VITE_PLAN_BUILDER_STRATEGY
  if (envOverride === 'pairs' || envOverride === 'single') return envOverride
  return 'single'
}
```

> Si el archivo actual exporta otros símbolos, preservarlos.

- [ ] **Step 5: Verificar que el test pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/generationStateDefault.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Verificar suite completa**

Run: `npx vitest run src/services/planBuilder`
Expected: PASS. Si algún test asumía default 'pairs', actualizarlo a que pase `strategy: 'pairs'` explícito.

- [ ] **Step 7: Commit**

```bash
git add src/services/planBuilder/generationState.ts src/services/planBuilder/__tests__/generationStateDefault.test.ts
git commit -m "feat(planBuilder): default generation strategy to single for reliability"
```

---

## Task 5: `degradeToSingle` real cuando pair falla

**Files:**
- Modify: `src/services/planBuilder/generatePlan.ts:466-480` (cálculo de `degradeToSingle`) y `:564-619` (consumo de fallback)
- Test: `src/services/planBuilder/__tests__/generatePlanDegradation.test.ts`

- [ ] **Step 1: Escribir test failing**

Crear `src/services/planBuilder/__tests__/generatePlanDegradation.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { generatePlanWeeks } from '../generatePlan'
import type { AIProvider } from '../../ai/types'

// Plan minimal helper omitted for brevity — implement helper at top of test file
// (replicar shape de generateWeek.structuredOutput.test.ts)

it('when pair returns only week A, degrades to single for week B before fallback', async () => {
  let callIndex = 0
  const callSpy = vi.fn(async () => {
    callIndex += 1
    if (callIndex === 1) {
      // First call: pair — devuelve solo una de las dos semanas
      return {
        text: '<actions>[{"type":"create_week","targetDate":"2026-06-01","reason":"ok","sessions":[{"date":"2026-06-01","timeBlock":"AM","sessionType":"squash","title":"S1","durationMin":60}],"weekObjectives":[]}]</actions>',
        provider: 'gemini', model: 'gemini-2.5-flash', durationMs: 1000, traceId: 't1',
      } as never
    }
    // Second call: single para la semana B
    return {
      text: '<actions>[{"type":"create_week","targetDate":"2026-06-08","reason":"ok","sessions":[{"date":"2026-06-08","timeBlock":"AM","sessionType":"squash","title":"S2","durationMin":60}],"weekObjectives":[]}]</actions>',
      provider: 'gemini', model: 'gemini-2.5-flash', durationMs: 1000, traceId: 't2',
    } as never
  })
  const provider = { name: 'gemini', call: callSpy } as unknown as AIProvider

  const results = await generatePlanWeeks({
    plan: /* minimal plan, totalWeeks=2 */ {} as never,
    weeks: /* two weeks: 2026-06-01 and 2026-06-08 */ [] as never,
    profile: { id: 'default', updatedAt: 0 } as never,
    wizardConfig: /* minimal */ {} as never,
    provider,
    strategy: 'pairs',
  })

  expect(callSpy).toHaveBeenCalledTimes(2) // pair + degraded single
  expect(callSpy.mock.calls[0]![0].requestClass).toBe('plan_builder_pair')
  expect(callSpy.mock.calls[1]![0].requestClass).toBe('plan_builder_week')
  expect(results).toHaveLength(2)
  expect(results[0]!.sessions.length).toBeGreaterThan(0)
  expect(results[1]!.sessions.length).toBeGreaterThan(0)
  expect(results[1]!.generationMeta.fallbackUsed).not.toBe(true) // ¡NO cayó a fallback local!
})

it('when pair returns nothing AND single also returns nothing, falls back to local', async () => {
  const callSpy = vi.fn(async () => ({
    text: '<actions>[]</actions>',
    provider: 'gemini', model: 'gemini-2.5-flash', durationMs: 1000, traceId: 't',
  } as never))
  const provider = { name: 'gemini', call: callSpy } as unknown as AIProvider

  const results = await generatePlanWeeks({
    plan: {} as never, weeks: [] as never, profile: {} as never, wizardConfig: {} as never,
    provider, strategy: 'pairs',
  })

  expect(results.every((week) => week.generationMeta.fallbackUsed === true)).toBe(true)
})
```

- [ ] **Step 2: Verificar que el test falla**

Run: `npx vitest run src/services/planBuilder/__tests__/generatePlanDegradation.test.ts`
Expected: FAIL — el primer test falla porque hoy va directo a fallback local (no llama single como segundo intento).

- [ ] **Step 3: Modificar `generateWeekPair` para calcular `degradeToSingle` dinámicamente**

En `src/services/planBuilder/generatePlan.ts` localizar:

```ts
const degradeToSingle = false
```

Reemplazar por:

```ts
const degradeToSingle = Array.from(weekResults.values())
  .some((result) => result.sessions.length === 0)
```

- [ ] **Step 4: Modificar el consumo en `generatePlanWeeks`**

En el bucle de batch (líneas ~564–619), cuando un `batchWeekResult.sessions.length === 0`, antes de invocar `makeLocalFallbackResolvedWeek`, intentar single:

```ts
// Antes:
// const localFallback = makeLocalFallbackResolvedWeek({ ... })

// Después:
let recovered: TrainingPlanWeek | undefined
if (batchResult.meta.degradeToSingle) {
  recovered = await generateSingleWeekWithRetry(
    provider,
    input.plan,
    batchWeekResult.week,
    previousWeek,
    input.profile,
    input.wizardConfig,
    input.onChunk,
  )
  if (recovered.sessions.length > 0 && !recovered.generationMeta.fallbackUsed) {
    input.onWeekUpdate?.(recovered)
    results.push(recovered)
    previousWeek = recovered
    continue
  }
}

const localFallback = recovered ?? makeLocalFallbackResolvedWeek({
  plan: input.plan,
  week: batchWeekResult.week,
  previousWeek,
  profile: input.profile,
  wizardConfig: input.wizardConfig,
  attempts: 1,
  provider: batchResult.meta.provider,
  model: batchResult.meta.model,
  requestClass: 'plan_builder_pair',
  traceId: batchResult.meta.traceId,
  lastError: batchWeekResult.error,
  durationMs: batchResult.meta.durationMs,
  chunkCount: batchResult.meta.chunkCount,
  strategy: 'pairs',
  batchId: batchResult.meta.batchId,
  rawSessionCount: batchWeekResult.rawSessionCount,
  droppedSessionCount: batchWeekResult.droppedSessionCount,
  degradedFromPairs: true, // marca que sí intentamos single y también falló
})
input.onWeekUpdate?.(localFallback)
results.push(localFallback)
if (localFallback.status === 'draft') {
  previousWeek = localFallback
}
```

- [ ] **Step 5: Verificar que ambos tests pasan**

Run: `npx vitest run src/services/planBuilder/__tests__/generatePlanDegradation.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Verificar suite completa**

Run: `npx vitest run src/services/planBuilder`
Expected: PASS. Si algún test mock cuenta llamadas a provider.call para batches y ahora dan +1, ajustar.

- [ ] **Step 7: Commit**

```bash
git add src/services/planBuilder/generatePlan.ts src/services/planBuilder/__tests__/generatePlanDegradation.test.ts
git commit -m "fix(planBuilder): degrade pair to single before falling back to local"
```

---

## Task 6: Provider routing por `requestClass`

**Files:**
- Modify: `src/services/ai/providerResolver.ts` (añadir nuevo export, mantener `getActiveProvider` retrocompatible)
- Test: `src/services/ai/__tests__/providerResolver.test.ts` (nuevo)
- Modify: `src/services/planBuilder/generateWeek.ts` y `generatePlan.ts` (consumir nuevo helper)

- [ ] **Step 1: Leer `providerResolver.ts` actual**

Run: `cat src/services/ai/providerResolver.ts`

Identificar la firma actual de `getActiveProvider` y `isRealProviderConfigured`.

- [ ] **Step 2: Escribir test failing**

Crear `src/services/ai/__tests__/providerResolver.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest'
import { getProviderForRequestClass } from '../providerResolver'

const ENV_KEYS = [
  'VITE_AI_PROVIDER',
  'VITE_AI_PROVIDER_PLAN_BUILDER_WEEK',
  'VITE_AI_PROVIDER_PLAN_BUILDER_PAIR',
]

describe('getProviderForRequestClass', () => {
  const snapshot: Record<string, string | undefined> = {}
  ENV_KEYS.forEach((k) => { snapshot[k] = (import.meta.env as Record<string, string | undefined>)[k] })

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (snapshot[k] === undefined) delete (import.meta.env as Record<string, unknown>)[k]
      else (import.meta.env as Record<string, string>)[k] = snapshot[k]!
    })
  })

  it('falls back to getActiveProvider when no override env is set', () => {
    delete (import.meta.env as Record<string, unknown>).VITE_AI_PROVIDER_PLAN_BUILDER_WEEK
    const provider = getProviderForRequestClass('plan_builder_week')
    expect(provider.name).toBeTruthy()
  })

  it('honors per-requestClass env override', () => {
    ;(import.meta.env as Record<string, string>).VITE_AI_PROVIDER_PLAN_BUILDER_WEEK = 'mock'
    const provider = getProviderForRequestClass('plan_builder_week')
    expect(provider.name).toBe('mock')
  })

  it('ignores unrelated overrides (chat_general override does not affect plan_builder_week)', () => {
    ;(import.meta.env as Record<string, string>).VITE_AI_PROVIDER_CHAT_GENERAL = 'claude'
    const provider = getProviderForRequestClass('plan_builder_week')
    expect(provider.name).not.toBe('claude')
  })
})
```

- [ ] **Step 3: Verificar que el test falla**

Run: `npx vitest run src/services/ai/__tests__/providerResolver.test.ts`
Expected: FAIL — `getProviderForRequestClass` no existe.

- [ ] **Step 4: Implementar el helper**

Añadir a `src/services/ai/providerResolver.ts` (manteniendo el resto del archivo):

```ts
import type { AIRequestClass } from '../../types'

function providerFromName(name: string): AIProvider {
  switch (name.toLowerCase()) {
    case 'proxy': return new ProxyProvider()
    case 'claude': return new ClaudeProvider()
    case 'openai': return new OpenAIProvider()
    case 'gemini': return new GeminiProvider()
    case 'mock': return new MockProvider()
    default: return getActiveProvider()
  }
}

/**
 * Returns a provider, optionally overridden per requestClass via env var.
 * Env var convention: VITE_AI_PROVIDER_<REQUEST_CLASS_UPPER> (e.g. VITE_AI_PROVIDER_PLAN_BUILDER_WEEK=claude).
 * Falls back to getActiveProvider() when no override is set.
 */
export function getProviderForRequestClass(requestClass: AIRequestClass): AIProvider {
  if (import.meta.env.PROD) {
    return getActiveProvider()
  }
  const envKey = `VITE_AI_PROVIDER_${requestClass.toUpperCase()}`
  const override = (import.meta.env as Record<string, string | undefined>)[envKey]
  if (!override) return getActiveProvider()
  return providerFromName(override)
}
```

- [ ] **Step 5: Verificar que el test pasa**

Run: `npx vitest run src/services/ai/__tests__/providerResolver.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Cambiar el consumidor `generatePlan.ts`**

En `src/services/planBuilder/generatePlan.ts` reemplazar:

```ts
import { ClaudeProvider } from '../ai/providers/ClaudeProvider'
import { OpenAIProvider } from '../ai/providers/OpenAIProvider'
import { GeminiProvider } from '../ai/providers/GeminiProvider'
import { MockProvider } from '../ai/providers/MockProvider'
import { ProxyProvider } from '../ai/providers/ProxyProvider'
```

Por:

```ts
import { getProviderForRequestClass } from '../ai/providerResolver'
```

Y eliminar `getActiveProvider()` local (líneas 30–40). Reemplazar la línea:

```ts
const provider = input.provider ?? getActiveProvider()
```

Por:

```ts
const provider = input.provider ?? getProviderForRequestClass(
  resolveStrategy(input) === 'pairs' ? 'plan_builder_pair' : 'plan_builder_week',
)
```

- [ ] **Step 7: Verificar tests**

Run: `npx vitest run src/services/planBuilder src/services/ai`
Expected: PASS para todos.

- [ ] **Step 8: Commit**

```bash
git add src/services/ai/providerResolver.ts src/services/ai/__tests__/providerResolver.test.ts src/services/planBuilder/generatePlan.ts
git commit -m "feat(ai): provider routing per requestClass via VITE_AI_PROVIDER_<CLASS> env"
```

---

## Task 7: Compactar prompt batch en `weekPrompt.ts`

**Files:**
- Modify: `src/services/week/prompts/weekPrompt.ts` (`buildWeekBatchUserPrompt` y `buildWeekSystemPromptBase` para `batch` mode)
- Test: `src/services/week/__tests__/weekPromptCompact.test.ts`

- [ ] **Step 1: Escribir test failing**

Crear `src/services/week/__tests__/weekPromptCompact.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildWeekBatchUserPrompt, buildWeekBatchSystemPromptMinimal } from '../prompts/weekPrompt'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'

function makePlan(): TrainingPlan {
  // Reusar helper de fixtures si existe; sino implementar minimal aquí
  return { /* ... */ } as TrainingPlan
}

function makeWeek(weekStart: string, idx: number): TrainingPlanWeek {
  return {
    id: `w${idx}`, planId: 'p', weekIndex: idx, weekStartDate: weekStart,
    phase: 'build', status: 'pending', sessions: [],
    weekObjectives: [{ goal: 'g' }], targetLoadBySport: { squash: 70 },
    validationIssues: [], generationMeta: { attempts: 0, provider: '', model: '' },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlanWeek
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

it('batch user prompt for 2 weeks stays under 2000 estimated tokens', () => {
  const plan = makePlan()
  const weeks: [TrainingPlanWeek, TrainingPlanWeek] = [makeWeek('2026-06-01', 0), makeWeek('2026-06-08', 1)]
  const profile = { id: 'default', updatedAt: 0, name: 'Test' } as AthleteProfile
  const wizardConfig = {
    goalEventId: 'e', trainingDays: ['monday','tuesday','wednesday','thursday','friday','saturday'],
    doubleSessionDays: ['monday','wednesday','friday'], sessionsPerWeek: 6, sessionDurationMins: 60,
    allowDoubleSession: true, complementarySports: ['running','strength'],
    currentFitnessLevel: 'fit', currentFatigue: 'fresh', createdAt: '', updatedAt: '',
  } as PlanWizardConfig

  const userPrompt = buildWeekBatchUserPrompt({ plan, weeks, profile, wizardConfig })
  expect(estimateTokens(userPrompt)).toBeLessThan(2000)
})

it('batch system prompt minimal stays under 700 estimated tokens', () => {
  const sys = buildWeekBatchSystemPromptMinimal()
  expect(estimateTokens(sys)).toBeLessThan(700)
})
```

- [ ] **Step 2: Verificar que el test falla**

Run: `npx vitest run src/services/week/__tests__/weekPromptCompact.test.ts`
Expected: FAIL — prompts actuales superan los límites.

- [ ] **Step 3: Compactar `buildWeekBatchSystemPromptMinimal`**

En `src/services/week/prompts/weekPrompt.ts`, dentro de `buildWeekSystemPromptBase`, cuando `mode === 'batch' && density === 'minimal'`, reducir a líneas esenciales (no duplicar reglas con single mode):

Reemplazar el array de líneas para `batchMode` por:

```ts
const lines = standaloneMode
  ? buildWeekCreatorCoachContract()
  : [
      batchMode
        ? 'Eres el generador de DOS semanas consecutivas dentro de un plan por evento.'
        : 'Eres el generador de una sola semana dentro de un plan por evento.',
      batchMode
        ? 'Responde SOLO con `{"actions":[create_week, create_week]}` JSON. Sin texto fuera.'
        : 'Responde SOLO con `<actions>[{"type":"create_week",...}]</actions>`. Sin texto fuera.',
      batchMode
        ? 'Cada create_week: type, targetDate (lunes), reason, sessions[] (cantidad EXACTA pedida), weekObjectives[].'
        : 'La create_week: type, targetDate, reason, sessions[] (cantidad EXACTA pedida), weekObjectives[].',
      'Cada sesión: fecha ISO dentro del rango, timeBlock AM/PM, title, durationMin>=5.',
      batchMode
        ? 'Nunca mezcles fechas entre semanas. Nunca devuelvas menos sesiones que las pedidas.'
        : 'Nunca devuelvas menos sesiones que las pedidas.',
    ]
```

Eliminar `SESSION_SCHEMA_BLOCK_MINIMAL` y `SESSION_SCHEMA_BLOCK_FULL` del system prompt cuando `responseSchema` se va a pasar al provider (lo cubre el schema estructurado, no necesita repetirse en texto). En batch minimal mode, omitir esos bloques:

```ts
return [
  ...lines,
  // Schema block only when responseSchema is NOT used (single without structured output mode)
  ...(standaloneMode || mode === 'single' && density === 'full' ? [fullSchema ? SESSION_SCHEMA_BLOCK_FULL : SESSION_SCHEMA_BLOCK_MINIMAL] : []),
  standaloneMode ? 'La app completará detalles deportivos avanzados cuando falten.' : '',
].filter(Boolean).join('\n')
```

- [ ] **Step 4: Compactar `buildWeekBatchUserPrompt`**

Cambios concretos:
1. Eliminar `buildStrengthLoadPack(...)` y `buildStrengthStructureSection()` del system; mantenerlos en user solo si `allowed.includes('strength')` Y al menos una semana del batch tiene `targetLoadBySport.strength > 0`.
2. Mover reglas comunes (días, sesiones por semana, duración, doble sesión, fatiga) a un solo bloque "Reglas globales" en vez de implícito en system + user.
3. Por semana: solo lo específico (targetDate, rango válido, expectedSessions, phase, blockFocus, primarySportRule, raceWeekRule). NO repetir reglas globales.

Esqueleto:

```ts
export function buildWeekBatchUserPrompt(input: WeekBatchPromptInput): string {
  const { plan, weeks, previousWeek, profile, wizardConfig, retryInstruction, strictFormatting } = input
  const allowed = allowedSportsList(plan, wizardConfig)
  const primarySport = getPrimarySport(plan)
  const anyStrength = weeks.some((w) => (w.targetLoadBySport.strength ?? 0) > 0)

  const weeksText = weeks.map((week) => {
    const validRange = getPlanWeekDateRange(plan, week)
    const expectedSessions = getExpectedSessionsForPlanWeek(plan, week)
    const targetLoads = Object.entries(week.targetLoadBySport).map(([s, l]) => `${s}:${l}`).join(',')
    const blockFocus = plan.phases.find((p) => week.weekIndex >= p.startWeekIndex && week.weekIndex <= p.endWeekIndex)?.blockFocus ?? ''
    return [
      `Semana ${week.weekIndex + 1}/${plan.totalWeeks} lunes=${week.weekStartDate} fase=${PHASE_LABEL[week.phase] ?? week.phase}`,
      `rango=${validRange.startDate}→${validRange.endDate} sesiones=${expectedSessions} cargas=${targetLoads}`,
      `foco: ${blockFocus}`,
      `objetivos: ${week.weekObjectives.map((o) => o.goal).join(' | ')}`,
      ...buildPrimarySportRule(plan, week),
      ...buildRaceWeekRule(plan, week),
    ].join('\n')
  }).join('\n\n')

  return [
    `Plan "${plan.title}" — evento ${plan.macroSnapshot.goalEventDate}`,
    briefAthlete(profile),
    `Reglas globales: días=${wizardConfig.trainingDays.join(',')} dobleSesion=${wizardConfig.allowDoubleSession ? 'sí' : 'no'} duración=${wizardConfig.sessionDurationMins}min fitness=${wizardConfig.currentFitnessLevel} fatiga=${wizardConfig.currentFatigue} deportes=${allowed.join(',')}`,
    primarySport ? `Deporte principal: ${primarySport}` : '',
    wizardConfig.injuryNotes ? `Restricciones: ${wizardConfig.injuryNotes}` : '',
    ...buildDoubleSessionPreferenceRule(wizardConfig, weeks[0].phase),
    '',
    briefPreviousWeek(previousWeek),
    '',
    weeksText,
    '',
    retryInstruction ? `Corrección intento anterior:\n${retryInstruction}` : '',
    strictFormatting ? 'Estricto: dos create_week, fechas correctas, cantidad exacta.' : '',
    anyStrength ? buildStrengthStructureSection() : '',
    anyStrength ? buildStrengthLoadPack({ strengthProfile: profile.strengthProfile }) : '',
  ].filter(Boolean).join('\n')
}
```

- [ ] **Step 5: Verificar que los tests pasan**

Run: `npx vitest run src/services/week/__tests__/weekPromptCompact.test.ts`
Expected: PASS.

- [ ] **Step 6: Correr audit de prompt**

Run: `npm run audit:prompt`
Expected: PASS. Si plan_builder_pair queda fuera de su rango baseline, actualizar baseline en `docs/prompt-baseline-2026-05-13.json` con justificación en el commit message.

- [ ] **Step 7: Verificar suite completa**

Run: `npx vitest run src/services/week src/services/planBuilder`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/week/prompts/weekPrompt.ts src/services/week/__tests__/weekPromptCompact.test.ts docs/prompt-baseline-2026-05-13.json
git commit -m "perf(planBuilder): compact batch prompt by ~50% (relies on responseSchema for structure)"
```

---

## Task 8: Streaming actions parser progresivo

**Files:**
- Create: `src/services/week/streamingActionsParser.ts`
- Test: `src/services/week/__tests__/streamingActionsParser.test.ts`
- Modify: `src/services/planBuilder/generatePlan.ts` (`generateWeekPair` consume el parser)

- [ ] **Step 1: Escribir test failing**

Crear `src/services/week/__tests__/streamingActionsParser.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createStreamingActionsParser } from '../streamingActionsParser'

describe('createStreamingActionsParser', () => {
  it('emits a parsed action as soon as one complete create_week object closes', () => {
    const onAction = vi.fn()
    const parser = createStreamingActionsParser({ onAction })
    parser.push('{"actions":[{"type":"create_week","targetDate":"2026-06-01","reason":"r","sessions":[],"weekObjectives":[]}')
    expect(onAction).not.toHaveBeenCalled() // sin cierre de objeto aún
    parser.push('}')
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0]![0]).toMatchObject({ type: 'create_week', targetDate: '2026-06-01' })
  })

  it('emits second action when batch continues with comma + second object', () => {
    const onAction = vi.fn()
    const parser = createStreamingActionsParser({ onAction })
    parser.push('{"actions":[{"type":"create_week","targetDate":"2026-06-01","reason":"r","sessions":[],"weekObjectives":[]},{"type":"create_week","targetDate":"2026-06-08","reason":"r","sessions":[],"weekObjectives":[]}]}')
    expect(onAction).toHaveBeenCalledTimes(2)
    expect(onAction.mock.calls[0]![0].targetDate).toBe('2026-06-01')
    expect(onAction.mock.calls[1]![0].targetDate).toBe('2026-06-08')
  })

  it('handles wrapper <actions>...</actions> markup too', () => {
    const onAction = vi.fn()
    const parser = createStreamingActionsParser({ onAction })
    parser.push('<actions>[{"type":"create_week","targetDate":"2026-06-01","reason":"r","sessions":[],"weekObjectives":[]}]</actions>')
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('returns partial actions on flush even if stream was cut mid-second-object', () => {
    const onAction = vi.fn()
    const parser = createStreamingActionsParser({ onAction })
    parser.push('{"actions":[{"type":"create_week","targetDate":"2026-06-01","reason":"r","sessions":[],"weekObjectives":[]},{"type":"create_w')
    const result = parser.flush()
    expect(result.completeActions).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })
})
```

- [ ] **Step 2: Verificar que el test falla**

Run: `npx vitest run src/services/week/__tests__/streamingActionsParser.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar el parser**

Crear `src/services/week/streamingActionsParser.ts`:

```ts
import type { CoachAction } from '../../types'

export interface StreamingActionsParserOptions {
  onAction?: (action: CoachAction) => void
}

export interface StreamingActionsParser {
  push: (chunk: string) => void
  flush: () => { completeActions: CoachAction[]; truncated: boolean }
}

/**
 * Progressive parser for streamed <actions>JSON</actions> or raw {"actions":[...]}.
 *
 * Strategy: track open/close brace depth inside the actions array. When depth returns
 * to 1 (we're back at array level), the JSON between the last comma/[ and now is one
 * complete object. Attempt to parse it; if it parses as a CoachAction-shaped object,
 * emit via onAction and remember it for the final flush.
 */
export function createStreamingActionsParser(options: StreamingActionsParserOptions = {}): StreamingActionsParser {
  let buffer = ''
  const emitted: CoachAction[] = []
  let cursor = 0
  let insideArray = false
  let arrayStart = -1
  let depth = 0
  let objectStart = -1
  let inString = false
  let escapeNext = false

  function tryAdvance() {
    for (; cursor < buffer.length; cursor++) {
      const ch = buffer[cursor]!

      if (escapeNext) { escapeNext = false; continue }
      if (ch === '\\' && inString) { escapeNext = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue

      if (!insideArray) {
        if (ch === '[') {
          insideArray = true
          arrayStart = cursor
          depth = 0
        }
        continue
      }

      if (ch === '{') {
        if (depth === 0) objectStart = cursor
        depth++
      } else if (ch === '}') {
        depth--
        if (depth === 0 && objectStart >= 0) {
          const slice = buffer.slice(objectStart, cursor + 1)
          try {
            const parsed = JSON.parse(slice) as CoachAction
            if (parsed && typeof parsed === 'object' && 'type' in parsed) {
              emitted.push(parsed)
              options.onAction?.(parsed)
            }
          } catch {
            // not a clean object yet — keep waiting
          }
          objectStart = -1
        }
      } else if (ch === ']' && depth === 0) {
        insideArray = false
      }
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk
      tryAdvance()
    },
    flush() {
      tryAdvance()
      return {
        completeActions: emitted.slice(),
        truncated: insideArray && depth > 0,
      }
    },
  }
}
```

- [ ] **Step 4: Verificar que los tests pasan**

Run: `npx vitest run src/services/week/__tests__/streamingActionsParser.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Integrar el parser en `generateWeekPair`**

En `src/services/planBuilder/generatePlan.ts` añadir import:

```ts
import { createStreamingActionsParser } from '../week/streamingActionsParser'
```

En `generateWeekPair`, dentro del `onChunk` del provider.call, además del `chunkRouter`, alimentar el parser:

```ts
const partialActions: CoachAction[] = []
const streamingParser = createStreamingActionsParser({
  onAction: (action) => { partialActions.push(action) },
})

// dentro del onChunk:
onChunk: (chunk) => {
  chunkCount += 1
  if (chunkCount === 1) {
    useAIDebugStore.getState().markFirstChunk(traceId)
  }
  chunkRouter.push(chunk)
  streamingParser.push(chunk)
},
```

Después de la llamada, si `normalized.actions` está vacío pero `partialActions.length > 0`, usar `partialActions` como respaldo:

```ts
const finalActions = (normalized.actions?.length ?? 0) > 0
  ? normalized.actions!
  : streamingParser.flush().completeActions
```

Y reemplazar `(normalized.actions ?? [])` por `finalActions` en el bucle de processing.

- [ ] **Step 6: Verificar suite**

Run: `npx vitest run src/services/week src/services/planBuilder`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/week/streamingActionsParser.ts src/services/week/__tests__/streamingActionsParser.test.ts src/services/planBuilder/generatePlan.ts
git commit -m "feat(planBuilder): salvage partial create_week actions from truncated streams"
```

---

## Task 9: Lint, build, audit y tests completos

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 2: Tests completos**

Run: `npm test`
Expected: PASS. Si hay regresiones por cambios de default (single vs pairs), ajustar tests que asuman strategy 'pairs' default a pasar `strategy: 'pairs'` explícito.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Audit de prompts**

Run: `npm run audit:prompt`
Expected: PASS. Si plan_builder_pair queda fuera del baseline, actualizar `docs/prompt-baseline-2026-05-13.json` documentando la reducción.

- [ ] **Step 5: Commit (si hubo cambios en baseline)**

```bash
git add docs/prompt-baseline-2026-05-13.json
git commit -m "chore(prompt-baseline): record plan_builder_pair size reduction post Phase 1"
```

---

## Task 10: Smoke E2E en dev contra Gemini real

Validación Playwright contra Gemini real para confirmar que la fase cumple su métrica de éxito.

- [ ] **Step 1: Setup dev**

```bash
npm run dev
```

Confirmar `VITE_AI_PROVIDER=gemini` (o equivalente para hitting Gemini real, no mock).

- [ ] **Step 2: Generar plan de 9 semanas con Playwright**

```bash
npm run e2e:plan:generate
```

Si necesitas ver el navegador o regenerar login:

```bash
npm run e2e:plan:generate:headed
```

Si quieres dejar el JSON de Beta Quality listo para revisión:

```bash
npm run e2e:plan:generate:quality
```

Configuración mínima del wizard:
- Evento: torneo squash a 9 semanas vista
- 6 sesiones/semana
- 60 min por sesión
- Doble sesión permitido
- Deportes: squash + running + strength + mobility
- Nivel: fit, fatiga: fresh

- [ ] **Step 3: Validar en Settings → Beta Quality**

Después de generar, abrir Settings → Beta Quality o revisar `scripts/e2e-artifacts/entrenador-beta-quality-*.json` si usaste `e2e:plan:generate:quality`. Confirmar:
- `dailyUsage.plan_builder_week`: 9 (single como default).
- Outcome de cada uno: `ok` (no `truncated_early`).
- `responseCharCount` por trace > 5000 chars.
- En el plan generado, < 2 semanas con `fallbackUsed: true`.

- [ ] **Step 4: Loadtest opcional**

Run: `npm run loadtest:week-creator`
Expected: success rate >= 9/10.

- [ ] **Step 5: Documentar resultados en commit final**

Si todo cumple métricas:

```bash
git commit --allow-empty -m "chore(planBuilder): Phase 1 closed — IA reliability ≥ 80%, see beta-quality export"
```

---

## Self-Review (escrito antes de entregar a executing-plans)

**Cobertura del spec Fase 1:**
- 1.1 Recorte prompt batch → Task 7 ✓
- 1.2 Subir maxTokens/timeouts → **NO REQUERIDO**: investigación reveló que ya están altos (5500/45s). El bottleneck era `responseSchema` ausente, no tokens. Ajuste documentado en la introducción del plan.
- 1.3 Default single → Task 4 ✓
- 1.4 `degradeToSingle` real → Task 5 ✓
- 1.5 Streaming parser → Task 8 ✓
- 1.6 Provider routing → Task 6 ✓
- 1.7 Tests focalizados → cubiertos dentro de cada task ✓
- 1.8 Métricas de cierre → Task 9 + Task 10 ✓

**Placeholder scan:**
- Step 3 de Task 3 tiene un test con `plan: {} as never` y `weeks: [] as never` que requiere relleno mínimo. Aceptable como guía — el agente lo completará usando el helper que ya existe en Task 2; agregada nota explícita pidiendo extraer `generateWeekPair` si rellenar es muy verboso.
- Step 4 de Task 5 referencia "helper de fixtures si existe; sino implementar minimal aquí" — aceptable por consistencia con el patrón del repo, pero podría ser placeholder. Si causa fricción al ejecutor, debe extraerse a `src/services/planBuilder/__tests__/fixtures.ts`. No es bloqueante.

**Type consistency:**
- `PLAN_BUILDER_WEEK_RESPONSE_SCHEMA` y `PLAN_BUILDER_PAIR_RESPONSE_SCHEMA` se usan en Tasks 1, 2, 3 consistentemente.
- `getProviderForRequestClass` firma consistente en Tasks 6 y los consumidores.
- `createStreamingActionsParser({ onAction })` firma consistente en Tasks 8.

**Hueco identificado:** Task 5 modifica `generateWeekPair`, pero no actualiza `degradeToSingle` cuando solo UNA de las dos semanas falla. Lo cubrí en Step 3 de Task 5 (`degradeToSingle` se calcula con `.some(...)`). ✓
