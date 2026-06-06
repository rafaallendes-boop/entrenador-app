# Async Plan Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover la generación del Plan Builder a una Netlify Background Function que genera el plan completo server-side (Claude Sonnet 4.6, sin el cap de 26s), escribe cada semana en Supabase, y un cliente que dispara y hace polling del progreso.

**Architecture:** Se extrae el pipeline puro de generación de una semana (`generateWeekCore`, con la llamada al LLM inyectada) para compartirlo entre cliente y servidor. Una Background Function recorre las semanas secuencialmente llamando a Anthropic directo y escribiendo en `training_plan_weeks` / `training_plans` de Supabase. El cliente dispara la función (202) y hace polling cada ~4s, reconciliando hacia Dexie. Cancelación vía `generationSummary.cancelRequested`; recuperación vía heartbeat.

**Tech Stack:** TypeScript, Vitest, Netlify Functions (Background), Supabase JS (service-role), Anthropic Messages API, Dexie, Zustand.

**Spec:** `docs/superpowers/specs/2026-06-06-async-plan-builder-design.md`

---

## File Structure

**Fase 1 — Core puro compartido**
- Create: `src/services/planBuilder/generateWeekCore.ts` — pipeline puro `prompt → callLLM → normalize → validate → repair`, con `callLLM` inyectado. Sin Dexie/stores.
- Create: `src/services/planBuilder/__tests__/generateWeekCore.test.ts`
- Modify: `src/services/planBuilder/generateWeek.ts` — pasa a envolver `generateWeekCore` (añade telemetría/debug-store alrededor).
- Create: `netlify/functions/_shared/planRows.ts` — `trainingPlanToRow` / `trainingPlanWeekToRow` reutilizables por el server.
- Modify: `src/services/syncService.ts` — importa los mappers desde `_shared/planRows.ts` (elimina duplicación).
- Create: `netlify/functions/_shared/planRows.test.ts`

**Fase 2 — Background Function**
- Create: `netlify/functions/_shared/anthropicCaller.ts` — `callAnthropicForWeek(req): Promise<AIRawResponse>` (reusa `buildClaudeBody` de `coach.ts`).
- Create: `netlify/functions/generate-plan-background.ts` — handler + loop de orquestación.
- Create: `netlify/functions/_shared/planGenerationLoop.ts` — loop puro testeable (recibe writer + caller inyectados).
- Create: `src/services/__tests__/planGenerationLoop.test.ts`

**Fase 3 — Cliente: disparo + polling**
- Create: `src/services/planBuilder/triggerBackgroundGeneration.ts` — POST a la función + 202.
- Create: `src/services/planBuilder/pollPlanGeneration.ts` — lógica pura del reducer de polling + el loop de polling.
- Create: `src/services/planBuilder/__tests__/pollPlanGeneration.test.ts`
- Modify: `src/store/usePlanBuilderStore.ts` — `runGeneration` dispara+pollea en vez de `runPlanGenerationJob`.

**Fase 4 — Cancelación + stalled + regeneración async**
- Modify: `src/types/planBuilder.ts` — `PlanGenerationState` añade `'cancelled'`; `PlanGenerationSummary` añade `cancelRequested?`, `heartbeatAt?`.
- Modify: `netlify/functions/_shared/planGenerationLoop.ts` — chequea `cancelRequested` por semana; escribe `heartbeatAt`.
- Modify: `src/store/usePlanBuilderStore.ts` — acción `cancelGeneration`; deriva `stalled` en UI.
- Modify: `src/pages/PlanBuilderV2Page.tsx` — botón "Detener".

---

## Fase 1 — Extraer el core puro compartido

### Task 1: `generateWeekCore` — pipeline puro con LLM inyectado

**Files:**
- Create: `src/services/planBuilder/generateWeekCore.ts`
- Test: `src/services/planBuilder/__tests__/generateWeekCore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/planBuilder/__tests__/generateWeekCore.test.ts
import { describe, expect, it, vi } from 'vitest'
import type { AIRawResponse } from '../../ai/types'
import { generateWeekCore } from '../generateWeekCore'
import { makeTestPlan, makeTestWeek, makeTestProfile, makeTestWizardConfig } from './fixtures'

function makeRaw(text: string): AIRawResponse {
  return { text, provider: 'claude', model: 'claude-sonnet-4-6', traceId: 't', durationMs: 100 }
}

describe('generateWeekCore', () => {
  const plan = makeTestPlan()
  const week = makeTestWeek(plan, 0)
  const profile = makeTestProfile()
  const wizardConfig = makeTestWizardConfig()

  it('returns sessions when the LLM emits a valid create_week', async () => {
    const validAction = JSON.stringify({
      type: 'create_week',
      targetDate: week.weekStartDate,
      sessions: [/* fixture sessions filling expected count for the week */],
    })
    const callLLM = vi.fn(async () => makeRaw(validAction))

    const result = await generateWeekCore({
      plan, week, profile, wizardConfig, traceId: 't', callLLM,
    })

    expect(callLLM).toHaveBeenCalledOnce()
    expect(result.sessions.length).toBeGreaterThan(0)
    expect(result.meta.lastError).toBeUndefined()
    expect(result.meta.provider).toBe('claude')
  })

  it('returns an error result (no sessions) when the LLM emits an empty week', async () => {
    const callLLM = vi.fn(async () => makeRaw(JSON.stringify({ type: 'create_week', targetDate: week.weekStartDate, sessions: [] })))

    const result = await generateWeekCore({ plan, week, profile, wizardConfig, traceId: 't', callLLM })

    expect(result.sessions).toHaveLength(0)
    expect(result.meta.lastError).toBeTruthy()
  })

  it('passes retryInstruction through to the prompt builder', async () => {
    const callLLM = vi.fn(async (req) => { expect(req.userMessage).toContain('Corrección del intento anterior'); return makeRaw('{}') })
    await generateWeekCore({ plan, week, profile, wizardConfig, traceId: 't', retryInstruction: 'Corrige X', callLLM })
    expect(callLLM).toHaveBeenCalledOnce()
  })
})
```

> Nota: si `./fixtures` no existe aún, créalo con builders mínimos (`makeTestPlan`, `makeTestWeek`, `makeTestProfile`, `makeTestWizardConfig`) reutilizando los fixtures ya presentes en `src/services/planBuilder/__tests__/` (buscar con `grep -rn "makeTestPlan\|function makePlan" src/services/planBuilder/__tests__`). Las sesiones válidas del primer test deben cumplir `getExpectedSessionsForPlanWeek(plan, week)` con fechas dentro del rango.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/generateWeekCore.test.ts`
Expected: FAIL — "Cannot find module '../generateWeekCore'".

- [ ] **Step 3: Implement `generateWeekCore` (y MOVER aquí las piezas puras)**

**Evita la dependencia circular:** mueve desde `generateWeek.ts` a `generateWeekCore.ts` las
piezas puras y sus tipos — `GenerateWeekResult`, `WeekActionEvaluation`, `pickCreateWeekAction`,
`validateGeneratedWeekAction`, `summarizeWeekGenerationError`, `formatCountMismatchError`,
`getRetryableWeekIssues`. Luego `generateWeek.ts` las **reexporta** (`export { ... } from './generateWeekCore'`)
para no romper a `generatePlan.ts`, que las importa desde `generateWeek`.

```typescript
// src/services/planBuilder/generateWeekCore.ts
import type { AthleteProfile, CoachAction, PlanWizardConfig } from '../../types'
import type { AIRawResponse, AIRequest, CreateWeekNormalizationDiagnostic } from '../ai/types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { normalizeResponse } from '../ai/responseNormalizer'
import { buildWeekStructuredSystemPromptMinimal, buildWeekUserPrompt } from '../week/prompts/weekPrompt'
import { pickCreateWeekDiagnostic } from '../week/shared'
import { repairGeneratedWeek, type RepairContext } from './repairWeek'
import { validatePlanWeek } from './validator'
import { getExpectedSessionsForPlanWeek, getPlanWeekDateRange } from './dateRange'
import { PLAN_BUILDER_WEEK_RESPONSE_SCHEMA } from './planBuilderResponseSchema'
import type { PlanBuilderRecentContext } from './recentContext'

// GenerateWeekResult, WeekActionEvaluation, pickCreateWeekAction,
// validateGeneratedWeekAction, summarizeWeekGenerationError, formatCountMismatchError,
// getRetryableWeekIssues  ← movidas tal cual desde generateWeek.ts (sin cambios de lógica).

/** The LLM call, injected so the same pipeline runs in the client (proxy) and the
 *  server (Anthropic direct). Same shape as `AIProvider.call`. */
export type WeekLLMCaller = (req: AIRequest) => Promise<AIRawResponse>

export interface GenerateWeekCoreInput {
  plan: TrainingPlan
  week: TrainingPlanWeek
  previousWeek?: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  recentContext?: PlanBuilderRecentContext
  retryInstruction?: string
  strictFormatting?: boolean
  temperature?: number
  maxTokens?: number
  traceId: string
  callLLM: WeekLLMCaller
}

/**
 * Pure week-generation pipeline: build prompt → callLLM → normalize → validate → repair.
 * No Dexie, no stores, no telemetry. Callers add side effects around it.
 */
export async function generateWeekCore(input: GenerateWeekCoreInput): Promise<GenerateWeekResult> {
  const { plan, week, previousWeek, profile, wizardConfig } = input
  const requestClass = 'plan_builder_week' as const

  const systemPrompt = buildWeekStructuredSystemPromptMinimal()
  const userMessage = buildWeekUserPrompt({
    plan, week, previousWeek, profile, wizardConfig,
    retryInstruction: input.retryInstruction,
    strictFormatting: input.strictFormatting,
    outputFormat: 'json',
    recentContext: input.recentContext,
  })

  const raw = await input.callLLM({
    requestClass,
    traceId: input.traceId,
    systemPrompt,
    userMessage,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    responseMimeType: 'application/json',
    responseSchema: PLAN_BUILDER_WEEK_RESPONSE_SCHEMA,
  })

  const normalized = normalizeResponse(raw)
  const action = pickCreateWeekAction(normalized.actions, week.weekStartDate)
  const diagnostic = pickCreateWeekDiagnostic(normalized, week.weekStartDate, action)
  const evaluation = validateGeneratedWeekAction(plan, week, profile, action, diagnostic, previousWeek)

  return {
    sessions: evaluation.error ? [] : evaluation.sessions,
    meta: {
      attempts: 1,
      provider: raw.provider,
      model: raw.model,
      requestClass,
      traceId: raw.traceId ?? input.traceId,
      lastError: evaluation.error,
      durationMs: raw.durationMs,
      retryUsed: raw.retryUsed,
      fallbackUsed: raw.fallbackUsed,
      rawSessionCount: evaluation.rawSessionCount,
      validSessionCount: evaluation.validSessionCount,
      droppedSessionCount: evaluation.droppedSessionCount,
      repairedSessionCount: evaluation.repairedSessionCount,
      movedSessionCount: evaluation.movedSessionCount,
      addedFallbackCount: evaluation.addedFallbackCount,
      filteredSportCount: evaluation.filteredSportCount,
      repairWarnings: evaluation.repairWarnings,
      errorClass: normalized.meta?.errorClass,
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/generateWeekCore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/planBuilder/generateWeekCore.ts src/services/planBuilder/__tests__/generateWeekCore.test.ts
git commit -m "feat(plan-builder): extract pure generateWeekCore with injected LLM caller"
```

---

### Task 2: `generateWeek.ts` usa `generateWeekCore`

**Files:**
- Modify: `src/services/planBuilder/generateWeek.ts` (función `generateWeek`, líneas ~208-381)

- [ ] **Step 1: Run existing tests to capture green baseline**

Run: `npx vitest run src/services/planBuilder/__tests__`
Expected: PASS (baseline actual). Anota el número de tests.

- [ ] **Step 1b: Reexportar las piezas movidas**

En `src/services/planBuilder/generateWeek.ts`, añade arriba:
```typescript
export {
  pickCreateWeekAction, validateGeneratedWeekAction, summarizeWeekGenerationError,
  type GenerateWeekResult, type WeekActionEvaluation,
} from './generateWeekCore'
```
Así `generatePlan.ts` (que importa estas desde `./generateWeek`) sigue compilando sin cambios.

- [ ] **Step 2: Refactor `generateWeek` to delegate to `generateWeekCore`**

Reemplaza el cuerpo del bloque `provider_call` + `normalize` + `repair` de `generateWeek` por una llamada a `generateWeekCore`, conservando la telemetría (`tracker`, `useAIDebugStore`, `assertDailyAIRequestLimit`, `chunkCount`) alrededor. El `callLLM` inyectado es `(req) => provider.call({ ...req, allowFallback: policy.allowFallback, onChunk: (c) => { chunkCount++; input.onChunk?.(c) } })`. El manejo de `evaluation.error` (failRequest/completeRequest) se mantiene leyendo `result.meta`.

```typescript
// dentro de generateWeek, reemplazando el tramo provider_call→repair:
const providerStage = tracker.stage('provider_call')
const result = await generateWeekCore({
  plan, week, previousWeek, profile, wizardConfig,
  recentContext: input.recentContext,
  retryInstruction: input.retryInstruction,
  strictFormatting: input.strictFormatting,
  temperature: input.temperature ?? policy.temperature,
  maxTokens: policy.maxTokens,
  traceId,
  callLLM: (req) => provider.call({
    ...req,
    allowFallback: policy.allowFallback,
    onChunk: (chunk) => { chunkCount += 1; input.onChunk?.(chunk) },
  }),
})
providerStage.end({ ok: !result.meta.lastError })

if (result.meta.lastError) {
  outcome = 'invalid_schema'
  useAIDebugStore.getState().failRequest(traceId, {
    provider: result.meta.provider, model: result.meta.model, durationMs: result.meta.durationMs,
    errorCode: 'validation_error', retryUsed: result.meta.retryUsed, fallbackUsed: result.meta.fallbackUsed,
    warnings: [`validation_error:${result.meta.lastError}`, `sessions:${result.meta.validSessionCount ?? 0}/${result.meta.rawSessionCount ?? 0}`],
  })
  return { sessions: [], meta: { ...result.meta, chunkCount, stageTimings: tracker.timings() } }
}

useAIDebugStore.getState().completeRequest(traceId, {
  provider: result.meta.provider, model: result.meta.model, durationMs: result.meta.durationMs,
  retryUsed: result.meta.retryUsed, fallbackUsed: result.meta.fallbackUsed,
})
outcome = 'ok'
return { sessions: result.sessions, meta: { ...result.meta, chunkCount, stageTimings: tracker.timings() } }
```

> Mantén intactos `assertDailyAIRequestLimit`, `startRequest`, el `try/catch` externo y el `finally` con `tracker.flush`.

- [ ] **Step 3: Run the full plan-builder + AI test suites**

Run: `npx vitest run src/services/planBuilder/__tests__ src/services/ai/__tests__`
Expected: PASS — mismo conteo que el baseline del Step 1 (sin regresiones).

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: ambos OK.

- [ ] **Step 5: Commit**

```bash
git add src/services/planBuilder/generateWeek.ts
git commit -m "refactor(plan-builder): generateWeek delegates to generateWeekCore"
```

---

### Task 3: Extraer row mappers a `_shared/planRows.ts`

**Files:**
- Create: `netlify/functions/_shared/planRows.ts`
- Create: `netlify/functions/_shared/planRows.test.ts`
- Modify: `src/services/syncService.ts` (funciones `trainingPlanToRow` ~1330, `trainingPlanWeekToRow` ~1375)

- [ ] **Step 1: Write the failing test**

```typescript
// netlify/functions/_shared/planRows.test.ts
import { describe, expect, it } from 'vitest'
import { trainingPlanToRow, trainingPlanWeekToRow } from './planRows'
import { makeTestPlan, makeTestWeek } from '../../../src/services/planBuilder/__tests__/fixtures'

describe('planRows', () => {
  it('maps a plan to a Supabase row with user_id and snake_case keys', () => {
    const plan = makeTestPlan()
    const row = trainingPlanToRow(plan, 'user-1')
    expect(row).toMatchObject({ id: plan.id, user_id: 'user-1', total_weeks: plan.totalWeeks, generation_state: plan.generationState })
  })

  it('maps a week to a row with sessions and status', () => {
    const plan = makeTestPlan()
    const week = makeTestWeek(plan, 0)
    const row = trainingPlanWeekToRow(week, 'user-1')
    expect(row).toMatchObject({ id: week.id, user_id: 'user-1', plan_id: week.planId, week_index: week.weekIndex, status: week.status })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/planRows.test.ts`
Expected: FAIL — "Cannot find module './planRows'".

- [ ] **Step 3: Implement by MOVING the mappers**

Copia el cuerpo COMPLETO de `trainingPlanToRow` y `trainingPlanWeekToRow` desde `src/services/syncService.ts` a `netlify/functions/_shared/planRows.ts`, exportándolas, con los imports de tipos necesarios (`TrainingPlan`, `TrainingPlanWeek` desde `../../../src/types/planBuilder`). No cambies la lógica de mapeo.

- [ ] **Step 4: Re-point syncService to the shared module**

En `src/services/syncService.ts`, elimina las definiciones locales y añade:
```typescript
import { trainingPlanToRow, trainingPlanWeekToRow } from '../../netlify/functions/_shared/planRows'
```
(Ajusta la ruta relativa real. Verifica que los call sites en líneas ~1847-1873 sigan compilando.)

- [ ] **Step 5: Run tests + build**

Run: `npx vitest run netlify/functions/_shared/planRows.test.ts src/services/__tests__/syncService.test.ts && npm run build`
Expected: PASS + build OK.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/planRows.ts netlify/functions/_shared/planRows.test.ts src/services/syncService.ts
git commit -m "refactor(sync): share plan/week row mappers with server via _shared/planRows"
```

---

## Fase 2 — Background Function

### Task 4: `anthropicCaller` — llamada directa que devuelve `AIRawResponse`

**Files:**
- Create: `netlify/functions/_shared/anthropicCaller.ts`
- Test: `netlify/functions/_shared/anthropicCaller.test.ts`

- [ ] **Step 1: Write the failing test (mock global fetch)**

```typescript
// netlify/functions/_shared/anthropicCaller.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { callAnthropicForWeek } from './anthropicCaller'

afterEach(() => vi.restoreAllMocks())

describe('callAnthropicForWeek', () => {
  it('returns the tool_use JSON as text and the model', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'tool_use', input: { type: 'create_week', targetDate: '2026-06-01', sessions: [] } }],
      model: 'claude-sonnet-4-6', stop_reason: 'tool_use',
    }), { status: 200 }))

    const res = await callAnthropicForWeek({
      requestClass: 'plan_builder_week', traceId: 't', systemPrompt: 's', userMessage: 'u',
      responseSchema: { type: 'object' }, maxTokens: 3500,
    }, { apiKey: 'k', model: 'claude-sonnet-4-6', timeoutMs: 1000 })

    expect(JSON.parse(res.text)).toMatchObject({ type: 'create_week' })
    expect(res.provider).toBe('claude')
    expect(res.model).toBe('claude-sonnet-4-6')
  })

  it('throws on non-200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad', { status: 500 }))
    await expect(callAnthropicForWeek(
      { requestClass: 'plan_builder_week', traceId: 't', systemPrompt: 's', userMessage: 'u' },
      { apiKey: 'k', model: 'm', timeoutMs: 1000 },
    )).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/anthropicCaller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// netlify/functions/_shared/anthropicCaller.ts
import type { AIRawResponse, AIRequest } from '../../../src/services/ai/types'

interface CallOptions { apiKey: string; model: string; timeoutMs: number }

const STRUCTURED_TOOL_NAME = 'emit_structured_result'

export async function callAnthropicForWeek(req: AIRequest, opts: CallOptions): Promise<AIRawResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs)
  const startedAt = Date.now()
  try {
    const body: Record<string, unknown> = {
      model: opts.model,
      max_tokens: req.maxTokens ?? 3500,
      temperature: req.temperature ?? 0.35,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userMessage }],
    }
    if (req.responseSchema) {
      body.tools = [{ name: STRUCTURED_TOOL_NAME, description: 'Devuelve el resultado estructurado.', input_schema: req.responseSchema }]
      body.tool_choice = { type: 'tool', name: STRUCTURED_TOOL_NAME }
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
      signal: controller.signal,
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
    const data = await res.json() as { content?: Array<{ type?: string; text?: string; input?: unknown }>; model?: string; stop_reason?: string }
    const toolBlock = data.content?.find((b) => b.type === 'tool_use')
    const text = toolBlock?.input !== undefined ? JSON.stringify(toolBlock.input) : (data.content?.find((b) => b.type === 'text')?.text ?? '')
    if (!text) throw new Error('Anthropic devolvió respuesta vacía.')
    return { text, provider: 'claude', model: data.model ?? opts.model, traceId: req.traceId, durationMs: Date.now() - startedAt, finishReason: data.stop_reason }
  } finally {
    clearTimeout(timeout)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/anthropicCaller.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/anthropicCaller.ts netlify/functions/_shared/anthropicCaller.test.ts
git commit -m "feat(server): add direct Anthropic caller for background week generation"
```

---

### Task 5: `planGenerationLoop` — orquestación pura testeable

**Files:**
- Create: `netlify/functions/_shared/planGenerationLoop.ts`
- Test: `src/services/__tests__/planGenerationLoop.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/__tests__/planGenerationLoop.test.ts
import { describe, expect, it, vi } from 'vitest'
import { runPlanGenerationLoop } from '../../../netlify/functions/_shared/planGenerationLoop'
import { makeTestPlan, makeTestWeek, makeTestProfile, makeTestWizardConfig } from '../planBuilder/__tests__/fixtures'

describe('runPlanGenerationLoop', () => {
  const plan = makeTestPlan({ totalWeeks: 3 })
  const weeks = [0, 1, 2].map((i) => makeTestWeek(plan, i))
  const base = { plan, weeks, profile: makeTestProfile(), wizardConfig: makeTestWizardConfig(), recentContext: undefined }

  it('generates each week sequentially and writes draft weeks', async () => {
    const writeWeek = vi.fn(async () => {})
    const writePlan = vi.fn(async () => {})
    const generateOne = vi.fn(async (week) => ({ ...week, status: 'draft' as const, sessions: [{ id: 's' }] }))
    const isCancelled = vi.fn(async () => false)

    await runPlanGenerationLoop({ ...base, generateOne, writeWeek, writePlan, isCancelled })

    expect(generateOne).toHaveBeenCalledTimes(3)
    expect(writeWeek).toHaveBeenCalledTimes(3 + 3) // generating + resolved per week (adjust to impl)
    expect(writePlan).toHaveBeenLastCalledWith(expect.objectContaining({ generationState: 'complete' }))
  })

  it('marks plan partial when a week fails and continues', async () => {
    const writeWeek = vi.fn(async () => {})
    const writePlan = vi.fn(async () => {})
    const generateOne = vi.fn(async (week) => (week.weekIndex === 1
      ? { ...week, status: 'error' as const, sessions: [] }
      : { ...week, status: 'draft' as const, sessions: [{ id: 's' }] }))
    await runPlanGenerationLoop({ ...base, generateOne, writeWeek, writePlan, isCancelled: async () => false })
    expect(generateOne).toHaveBeenCalledTimes(3)
    expect(writePlan).toHaveBeenLastCalledWith(expect.objectContaining({ generationState: 'partial' }))
  })

  it('stops early and marks cancelled when isCancelled returns true', async () => {
    const generateOne = vi.fn(async (week) => ({ ...week, status: 'draft' as const, sessions: [{ id: 's' }] }))
    const writePlan = vi.fn(async () => {})
    const isCancelled = vi.fn(async (i: number) => i >= 1) // cancel before week index 1
    await runPlanGenerationLoop({ ...base, generateOne, writeWeek: async () => {}, writePlan, isCancelled })
    expect(generateOne).toHaveBeenCalledTimes(1)
    expect(writePlan).toHaveBeenLastCalledWith(expect.objectContaining({ generationState: 'cancelled' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/planGenerationLoop.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the loop**

```typescript
// netlify/functions/_shared/planGenerationLoop.ts
import type { AthleteProfile, PlanWizardConfig } from '../../../src/types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../src/types/planBuilder'
import type { PlanBuilderRecentContext } from '../../../src/services/planBuilder/recentContext'

export interface PlanGenerationLoopInput {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  recentContext?: PlanBuilderRecentContext
  generateOne: (week: TrainingPlanWeek, previousWeek: TrainingPlanWeek | undefined) => Promise<TrainingPlanWeek>
  writeWeek: (week: TrainingPlanWeek) => Promise<void>
  writePlan: (plan: TrainingPlan) => Promise<void>
  isCancelled: (nextWeekIndex: number) => Promise<boolean>
}

export async function runPlanGenerationLoop(input: PlanGenerationLoopInput): Promise<void> {
  const ordered = [...input.weeks].sort((a, b) => a.weekIndex - b.weekIndex)
  let previousWeek: TrainingPlanWeek | undefined
  const resolved: TrainingPlanWeek[] = []
  let cancelled = false

  for (const week of ordered) {
    if (await input.isCancelled(week.weekIndex)) { cancelled = true; break }

    await input.writeWeek({ ...week, status: 'generating', updatedAt: Date.now() })
    const result = await input.generateOne(week, previousWeek)
    await input.writeWeek(result)
    resolved.push(result)
    if (result.status === 'draft') previousWeek = result

    await input.writePlan({
      ...input.plan,
      generationState: 'generating',
      updatedAt: Date.now(),
      generationSummary: { ...(input.plan.generationSummary ?? { startedAt: Date.now(), strategy: 'single', completedWeeks: 0, failedWeeks: [], totalAttempts: 0 }), heartbeatAt: Date.now() },
    })
  }

  const failed = resolved.filter((w) => w.status !== 'draft').map((w) => w.weekIndex)
  const generationState = cancelled ? 'cancelled' : failed.length > 0 ? 'partial' : 'complete'
  await input.writePlan({
    ...input.plan,
    generationState,
    updatedAt: Date.now(),
    generationSummary: {
      ...(input.plan.generationSummary ?? { startedAt: Date.now(), strategy: 'single', totalAttempts: 0 }),
      completedAt: Date.now(),
      completedWeeks: resolved.filter((w) => w.status === 'draft').length,
      failedWeeks: failed,
      strategy: 'single',
      totalAttempts: resolved.length,
    },
  })
}
```

> Ajusta el `expect(writeWeek).toHaveBeenCalledTimes(...)` del Step 1 al conteo real (generating + resolved = 2 por semana).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/planGenerationLoop.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/planGenerationLoop.ts src/services/__tests__/planGenerationLoop.test.ts
git commit -m "feat(server): add pure plan generation loop (sequential, cancellable)"
```

---

### Task 6: `generate-plan-background` — handler que cablea todo

**Files:**
- Create: `netlify/functions/generate-plan-background.ts`

- [ ] **Step 1: Implement the handler (no unit test — integración manual)**

```typescript
// netlify/functions/generate-plan-background.ts
import { createClient } from '@supabase/supabase-js'
import type { AthleteProfile, PlanWizardConfig } from '../../src/types'
import type { TrainingPlan, TrainingPlanWeek } from '../../src/types/planBuilder'
import type { PlanBuilderRecentContext } from '../../src/services/planBuilder/recentContext'
import { generateWeekCore } from '../../src/services/planBuilder/generateWeekCore'
import { runPlanGenerationLoop } from './_shared/planGenerationLoop'
import { callAnthropicForWeek } from './_shared/anthropicCaller'
import { trainingPlanToRow, trainingPlanWeekToRow } from './_shared/planRows'

interface Payload {
  planId: string; plan: TrainingPlan; weeks: TrainingPlanWeek[]
  profile: AthleteProfile; wizardConfig: PlanWizardConfig; recentContext?: PlanBuilderRecentContext
}

const PER_WEEK_TIMEOUT_MS = 60000
const MAX_ATTEMPTS = 2

export default async function handler(req: Request): Promise<Response> {
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: userData, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !userData.user) return new Response('Unauthorized', { status: 401 })
  const userId = userData.user.id

  const payload = await req.json() as Payload
  const model = process.env.CLAUDE_MODEL_PLAN_BUILDER_WEEK ?? process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'
  const apiKey = process.env.CLAUDE_API_KEY!

  const generateOne = async (week: TrainingPlanWeek, previousWeek?: TrainingPlanWeek): Promise<TrainingPlanWeek> => {
    let lastError: string | undefined
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await generateWeekCore({
        plan: payload.plan, week, previousWeek, profile: payload.profile, wizardConfig: payload.wizardConfig,
        recentContext: payload.recentContext, traceId: `bg-${week.weekIndex}-${attempt}`,
        retryInstruction: attempt > 1 ? lastError : undefined,
        temperature: attempt === 1 ? 0.4 : 0.25,
        callLLM: (r) => callAnthropicForWeek(r, { apiKey, model, timeoutMs: PER_WEEK_TIMEOUT_MS }),
      })
      if (result.sessions.length > 0) {
        return { ...week, status: 'draft', sessions: result.sessions, generationMeta: { ...week.generationMeta, attempts: attempt, provider: 'claude', model, generationSource: 'ai' }, updatedAt: Date.now() }
      }
      lastError = result.meta.lastError
    }
    return { ...week, status: 'error', sessions: [], generationMeta: { ...week.generationMeta, attempts: MAX_ATTEMPTS, lastError }, updatedAt: Date.now() }
  }

  const isCancelled = async (): Promise<boolean> => {
    const { data } = await supabase.from('training_plans').select('generation_summary').eq('id', payload.planId).eq('user_id', userId).single()
    return Boolean((data?.generation_summary as { cancelRequested?: boolean } | null)?.cancelRequested)
  }

  // Background functions return 202 immediately; the work continues after the response.
  void runPlanGenerationLoop({
    plan: payload.plan, weeks: payload.weeks, profile: payload.profile, wizardConfig: payload.wizardConfig,
    recentContext: payload.recentContext,
    generateOne,
    writeWeek: async (week) => { await supabase.from('training_plan_weeks').upsert(trainingPlanWeekToRow(week, userId)) },
    writePlan: async (plan) => { await supabase.from('training_plans').upsert(trainingPlanToRow(plan, userId)) },
    isCancelled,
  }).catch((err) => console.error('[generate-plan-background] loop failed', err))

  return new Response(JSON.stringify({ accepted: true }), { status: 202 })
}

export const config = { type: 'experimental-background' as const }
```

> Verifica el contrato actual de Background Functions en la versión instalada de `@netlify/functions` (nombre del archivo con sufijo `-background` ya activa el modo; el `config.type` puede no ser necesario). Confirma con `npx netlify --version` y la doc de la versión.

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build OK (la función entra en el bundle de Netlify; si `@supabase/supabase-js` no está en deps del server, agrégalo).

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/generate-plan-background.ts package.json
git commit -m "feat(server): add generate-plan-background function (Sonnet, writes Supabase)"
```

---

## Fase 3 — Cliente: disparo + polling

### Task 7: `triggerBackgroundGeneration`

**Files:**
- Create: `src/services/planBuilder/triggerBackgroundGeneration.ts`
- Test: `src/services/planBuilder/__tests__/triggerBackgroundGeneration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest'
import { triggerBackgroundGeneration } from '../triggerBackgroundGeneration'

afterEach(() => vi.restoreAllMocks())

describe('triggerBackgroundGeneration', () => {
  it('POSTs payload + auth token and resolves on 202', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"accepted":true}', { status: 202 }))
    await triggerBackgroundGeneration({ planId: 'p', plan: {} as never, weeks: [], profile: {} as never, wizardConfig: {} as never, recentContext: undefined }, 'jwt-token')
    expect(fetchSpy).toHaveBeenCalledWith('/.netlify/functions/generate-plan-background', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer jwt-token' }),
    }))
  })

  it('throws when the function rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 401 }))
    await expect(triggerBackgroundGeneration({ planId: 'p' } as never, 'jwt')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/triggerBackgroundGeneration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/services/planBuilder/triggerBackgroundGeneration.ts
import type { AthleteProfile, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import type { PlanBuilderRecentContext } from './recentContext'

export interface BackgroundGenerationPayload {
  planId: string
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  recentContext?: PlanBuilderRecentContext
}

export async function triggerBackgroundGeneration(payload: BackgroundGenerationPayload, accessToken: string): Promise<void> {
  const res = await fetch('/.netlify/functions/generate-plan-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  })
  if (res.status !== 202) throw new Error(`No se pudo iniciar la generación (${res.status}).`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/triggerBackgroundGeneration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/planBuilder/triggerBackgroundGeneration.ts src/services/planBuilder/__tests__/triggerBackgroundGeneration.test.ts
git commit -m "feat(plan-builder): client trigger for background generation"
```

---

### Task 8: `pollPlanGeneration` — reducer puro + loop

**Files:**
- Create: `src/services/planBuilder/pollPlanGeneration.ts`
- Test: `src/services/planBuilder/__tests__/pollPlanGeneration.test.ts`

- [ ] **Step 1: Write the failing test (pure reducer)**

```typescript
import { describe, expect, it } from 'vitest'
import { derivePollStatus } from '../pollPlanGeneration'

describe('derivePollStatus', () => {
  const now = 1_000_000
  it('returns generating while the plan is generating and heartbeat is fresh', () => {
    expect(derivePollStatus({ generationState: 'generating', heartbeatAt: now - 5000 }, now)).toBe('generating')
  })
  it('returns stalled when generating but heartbeat is older than 3 min', () => {
    expect(derivePollStatus({ generationState: 'generating', heartbeatAt: now - 200_000 }, now)).toBe('stalled')
  })
  it('returns terminal states verbatim', () => {
    expect(derivePollStatus({ generationState: 'complete', heartbeatAt: now }, now)).toBe('complete')
    expect(derivePollStatus({ generationState: 'partial', heartbeatAt: now }, now)).toBe('partial')
    expect(derivePollStatus({ generationState: 'cancelled', heartbeatAt: now }, now)).toBe('cancelled')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/pollPlanGeneration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement reducer + poll loop**

```typescript
// src/services/planBuilder/pollPlanGeneration.ts
import type { PlanGenerationState } from '../../types/planBuilder'

export type PollStatus = PlanGenerationState | 'stalled'
const STALE_MS = 3 * 60 * 1000

export function derivePollStatus(input: { generationState: PlanGenerationState; heartbeatAt?: number }, now: number): PollStatus {
  if (input.generationState === 'generating') {
    if (input.heartbeatAt != null && now - input.heartbeatAt > STALE_MS) return 'stalled'
    return 'generating'
  }
  return input.generationState
}

export function isTerminalPollStatus(status: PollStatus): boolean {
  return status === 'complete' || status === 'partial' || status === 'failed' || status === 'cancelled' || status === 'stalled'
}
```

> El loop de polling en sí (setInterval que llama a Supabase, escribe Dexie y corta en terminal) se cablea en el store (Task 9) usando `derivePollStatus`/`isTerminalPollStatus`. Mantén la lógica de decisión aquí (pura, testeada) y solo el efecto en el store.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/pollPlanGeneration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/planBuilder/pollPlanGeneration.ts src/services/planBuilder/__tests__/pollPlanGeneration.test.ts
git commit -m "feat(plan-builder): pure poll-status reducer for async generation"
```

---

### Task 9: `usePlanBuilderStore.runGeneration` dispara + pollea

**Files:**
- Modify: `src/store/usePlanBuilderStore.ts` (`runGeneration`, ~244-286)

- [ ] **Step 1: Implement new runGeneration**

Reemplaza el cuerpo de `runGeneration` para: (a) asegurar sync del shell a Supabase, (b) computar `recentContext` con `buildPlanBuilderRecentContext`, (c) obtener el access token de Supabase (`supabase.auth.getSession()`), (d) `triggerBackgroundGeneration(...)`, (e) arrancar un `setInterval` cada 4s que lee `training_plans` + `training_plan_weeks` desde Supabase, escribe en Dexie (`persistPlanState`), actualiza el store, y corta con `isTerminalPollStatus(derivePollStatus(...))`. Guarda el id del intervalo en una ref del módulo para poder limpiarlo en `cancelGeneration`/`discard`.

```typescript
runGeneration: async (profile) => {
  const { plan, weeks } = get()
  if (!plan) return
  try {
    await syncPlanToSupabase(plan, weeks) // helper existente o upsert vía syncService
    const recentContext = await buildPlanBuilderRecentContext(plan).catch(() => undefined)
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Sesión no válida para iniciar la generación.')
    set({ status: 'generating', lastError: null, completedWeeks: 0, failedWeekIndexes: [] })
    await triggerBackgroundGeneration({ planId: plan.id, plan, weeks, profile, wizardConfig: plan.wizardConfig, recentContext }, token)
    startPolling(plan.id, set, get)
  } catch (error) {
    set({ status: 'error', lastError: error instanceof Error ? error.message : String(error) })
  }
},
```

> `startPolling` y `syncPlanToSupabase` son helpers nuevos en el mismo archivo. `startPolling` usa `derivePollStatus`/`isTerminalPollStatus`, lee Supabase (`supabase.from('training_plans')` / `training_plan_weeks`), mapea filas→tipos (reusa el mapper de pull de `syncService`), persiste en Dexie y actualiza el store. Corta y limpia el intervalo en estado terminal.

- [ ] **Step 2: Run store + plan-builder tests**

Run: `npx vitest run src/store src/services/planBuilder/__tests__`
Expected: PASS (ajusta/añade tests del store si existían para runGeneration).

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add src/store/usePlanBuilderStore.ts
git commit -m "feat(plan-builder): runGeneration triggers background function + polls Supabase"
```

---

## Fase 4 — Cancelación, stalled y regeneración async

### Task 10: Tipos — `cancelled` state + `cancelRequested`/`heartbeatAt`

**Files:**
- Modify: `src/types/planBuilder.ts` (`PlanGenerationState` línea 13, `PlanGenerationSummary` línea 65)

- [ ] **Step 1: Update types**

```typescript
export type PlanGenerationState = 'shell' | 'generating' | 'partial' | 'failed' | 'complete' | 'cancelled'

export interface PlanGenerationSummary {
  // ...campos existentes...
  cancelRequested?: boolean
  heartbeatAt?: number
}
```

- [ ] **Step 2: Update `toBuilderStatus` + `derivePlanGenerationState`**

En `src/store/usePlanBuilderStore.ts` (`toBuilderStatus`) y `src/services/planBuilder/generationState.ts` (`derivePlanGenerationState`), maneja `'cancelled'` (mapea a un estado de UI revisable, p.ej. `'partial'`/`'ready'` según corresponda). Añade el caso al `switch` para evitar fallthrough.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: OK (sin switches no exhaustivos).

- [ ] **Step 4: Commit**

```bash
git add src/types/planBuilder.ts src/store/usePlanBuilderStore.ts src/services/planBuilder/generationState.ts
git commit -m "feat(plan-builder): add cancelled state + cancelRequested/heartbeat fields"
```

---

### Task 11: `cancelGeneration` en el store

**Files:**
- Modify: `src/store/usePlanBuilderStore.ts`

- [ ] **Step 1: Add the action**

```typescript
cancelGeneration: async () => {
  const { plan } = get()
  if (!plan) return
  const summary = { ...(plan.generationSummary ?? {}), cancelRequested: true }
  await supabase.from('training_plans').update({ generation_summary: summary }).eq('id', plan.id)
  // el worker corta en la siguiente semana; el polling detectará 'cancelled'
},
```

Añade `cancelGeneration` a la interfaz `PlanBuilderState` y deja que el polling existente (Task 9) refleje el estado `cancelled` cuando llegue.

- [ ] **Step 2: Build + lint**

Run: `npm run lint && npm run build`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add src/store/usePlanBuilderStore.ts
git commit -m "feat(plan-builder): cancelGeneration sets cancelRequested in Supabase"
```

---

### Task 12: Botón "Detener" en la UI

**Files:**
- Modify: `src/pages/PlanBuilderV2Page.tsx` (zona de acciones durante `status==='generating'`)

- [ ] **Step 1: Wire the button**

Añade, cuando `status === 'generating'`, un botón "Detener" que llama `void cancelGeneration()` (desestructurado del store). Sigue el estilo de los botones existentes (clases Tailwind del archivo). Muestra estado "Deteniendo…" mientras `generationSummary.cancelRequested` esté activo y aún no llegue el estado terminal.

- [ ] **Step 2: Manual verification**

Run: `npm run dev` → genera un plan → toca "Detener" → la generación corta tras la semana en curso, el plan queda revisable.

- [ ] **Step 3: Build + lint**

Run: `npm run lint && npm run build`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add src/pages/PlanBuilderV2Page.tsx
git commit -m "feat(plan-builder): add Detener (stop) button during generation"
```

---

### Task 13: Regeneración async (semanas marcadas / fallidas / plan completo)

**Files:**
- Modify: `src/store/usePlanBuilderStore.ts` (`regenerateWeeks`, `retryFailedWeeks`, `retryFullGeneration`)
- Modify: `netlify/functions/generate-plan-background.ts` (aceptar `targetWeekIndexes`)

- [ ] **Step 1: Server accepts `targetWeekIndexes`**

En el handler, lee `payload.targetWeekIndexes?: number[]`; si viene, filtra `weeks` a esos índices antes del loop (y no resetea las demás). Default: todas.

- [ ] **Step 2: Store regeneration paths trigger the background function**

Reescribe `regenerateWeeks`, `retryFailedWeeks` y `retryFullGeneration` para: marcar las semanas objetivo `pending` en Supabase, disparar `triggerBackgroundGeneration` con `targetWeekIndexes` (y `repairInstructions` cuando aplique, pasadas en el payload y usadas como `retryInstruction` del primer intento en `generateOne`), y arrancar polling. Elimina las llamadas a `createPlanGenerationJob`/`runPlanGenerationJob`.

- [ ] **Step 3: Tests + build + lint**

Run: `npx vitest run && npm run lint && npm run build`
Expected: PASS + OK. Elimina/actualiza tests que dependían del runner client-side (`generationJobRunner`) para estas rutas.

- [ ] **Step 4: Commit**

```bash
git add src/store/usePlanBuilderStore.ts netlify/functions/generate-plan-background.ts
git commit -m "feat(plan-builder): async regeneration via background function with targetWeekIndexes"
```

---

## Cierre

- [ ] **Suite completa + checks**

Run: `npm run lint && npm test && npm run build && npm run audit:prompt`
Expected: todo verde.

- [ ] **Pre-prod (owner):** agregar en Netlify `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLAUDE_MODEL_PLAN_BUILDER_WEEK=claude-sonnet-4-6`; confirmar que `@supabase/supabase-js` esté disponible para las functions; smoke test de un plan real end-to-end.
- [ ] **Actualizar** `PROJECT_REVIEW_AND_ROADMAP.md` con el estado async.
