# Async Plan Builder — Bug Fixes & Tech Debt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir 4 bugs confirmados (ghost plan tras discard, poller zombi en cancel, isReadyWeek divergente, getPlan sin try/catch) y 6 ítems de deuda técnica detectados en la code review del commit f3c50c4.

**Architecture:** Se extrae una utilidad compartida `weekUtils.ts` que unifica `isReadyWeek`/`countReadyWeeks`/`sortWeeks`, se añade un método opcional `checkCancelled` al writer interface para una consulta ligera en cada iteración, y se limpian escrituras redundantes a Supabase (triple write) y código muerto en la función background.

**Tech Stack:** TypeScript · Vitest · Zustand · Supabase · Netlify Functions

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad del cambio |
|---|---|---|
| `src/services/planBuilder/weekUtils.ts` | **CREAR** | Utilidades compartidas: `isReadyWeek`, `countReadyWeeks`, `sortWeeks` |
| `src/services/planBuilder/__tests__/weekUtils.test.ts` | **CREAR** | Tests unitarios de weekUtils |
| `src/services/planBuilder/__tests__/pollPlanGeneration.test.ts` | **CREAR** | Tests para abort race (Bug #1) |
| `src/services/planBuilder/asyncGenerationLoop.ts` | **MODIFICAR** | weekUtils + `checkCancelled` interface + try/catch para `getPlan` |
| `src/services/planBuilder/pollPlanGeneration.ts` | **MODIFICAR** | weekUtils + guard abort antes de `onSnapshot` |
| `src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts` | **MODIFICAR** | Test para `checkCancelled` throwing |
| `src/store/usePlanBuilderStore.ts` | **MODIFICAR** | weekUtils + fix `cancelGeneration` (abort + optimistic + pushTrainingPlan) |
| `netlify/functions/generate-plan-background.ts` | **MODIFICAR** | `checkCancelled` lightweight + remover dead computation |
| `src/services/planBuilder/triggerBackgroundGeneration.ts` | **MODIFICAR** | Fix error guard `!response.ok` |
| `src/pages/PlanBuilderV2Page.tsx` | **MODIFICAR** | Inlinear `handleCancelGeneration` wrapper |

---

## Task 1 — Shared week utilities (Bug #3 + Debt #7)

**Files:**
- Create: `src/services/planBuilder/weekUtils.ts`
- Create: `src/services/planBuilder/__tests__/weekUtils.test.ts`
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts` (remove local definitions, import from weekUtils)
- Modify: `src/services/planBuilder/pollPlanGeneration.ts` (remove local `sortWeeks`, import from weekUtils)
- Modify: `src/store/usePlanBuilderStore.ts` (remove local definitions, fix `isReadyWeek` to include `'accepted'`)

**Contexto:** `isReadyWeek` en el store solo cuenta `status === 'draft'`, mientras que en `asyncGenerationLoop.ts` también cuenta `'accepted'`. Esto hace que `completedWeeks` se descuente en la UI cuando el usuario acepta una semana. Además `sortWeeks` está duplicado en tres lugares.

- [ ] **Step 1: Crear `weekUtils.ts`**

```typescript
// src/services/planBuilder/weekUtils.ts
import type { TrainingPlanWeek } from '../../types/planBuilder'

export function isReadyWeek(week: TrainingPlanWeek): boolean {
  return (week.status === 'draft' || week.status === 'accepted') && week.sessions.length > 0
}

export function countReadyWeeks(weeks: TrainingPlanWeek[]): number {
  return weeks.filter(isReadyWeek).length
}

export function sortWeeks(weeks: TrainingPlanWeek[]): TrainingPlanWeek[] {
  return [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)
}
```

- [ ] **Step 2: Escribir tests para weekUtils**

```typescript
// src/services/planBuilder/__tests__/weekUtils.test.ts
import { describe, expect, it } from 'vitest'
import type { TrainingPlanWeek } from '../../../types/planBuilder'
import { countReadyWeeks, isReadyWeek, sortWeeks } from '../weekUtils'

function makeWeek(overrides: Partial<TrainingPlanWeek> = {}): TrainingPlanWeek {
  return {
    id: 'w1',
    planId: 'p1',
    weekIndex: 0,
    weekStartDate: '2026-06-01',
    phase: 'build',
    status: 'pending',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('isReadyWeek', () => {
  it('returns true for draft week with sessions', () => {
    expect(isReadyWeek(makeWeek({ status: 'draft', sessions: [{}] as never }))).toBe(true)
  })

  it('returns true for accepted week with sessions', () => {
    expect(isReadyWeek(makeWeek({ status: 'accepted', sessions: [{}] as never }))).toBe(true)
  })

  it('returns false for draft week with no sessions', () => {
    expect(isReadyWeek(makeWeek({ status: 'draft', sessions: [] }))).toBe(false)
  })

  it('returns false for pending week', () => {
    expect(isReadyWeek(makeWeek({ status: 'pending', sessions: [{}] as never }))).toBe(false)
  })

  it('returns false for error week', () => {
    expect(isReadyWeek(makeWeek({ status: 'error', sessions: [] }))).toBe(false)
  })
})

describe('countReadyWeeks', () => {
  it('counts both draft and accepted weeks with sessions', () => {
    const weeks = [
      makeWeek({ weekIndex: 0, status: 'draft', sessions: [{}] as never }),
      makeWeek({ weekIndex: 1, status: 'accepted', sessions: [{}] as never }),
      makeWeek({ weekIndex: 2, status: 'pending', sessions: [] }),
      makeWeek({ weekIndex: 3, status: 'error', sessions: [] }),
    ]
    expect(countReadyWeeks(weeks)).toBe(2)
  })
})

describe('sortWeeks', () => {
  it('orders weeks by weekIndex ascending', () => {
    const weeks = [
      makeWeek({ weekIndex: 2 }),
      makeWeek({ weekIndex: 0 }),
      makeWeek({ weekIndex: 1 }),
    ]
    expect(sortWeeks(weeks).map((w) => w.weekIndex)).toEqual([0, 1, 2])
  })

  it('does not mutate the original array', () => {
    const weeks = [makeWeek({ weekIndex: 1 }), makeWeek({ weekIndex: 0 })]
    sortWeeks(weeks)
    expect(weeks[0].weekIndex).toBe(1)
  })
})
```

- [ ] **Step 3: Verificar que los tests pasan**

```bash
npx vitest run src/services/planBuilder/__tests__/weekUtils.test.ts
```

Esperado: todos PASS.

- [ ] **Step 4: Actualizar `asyncGenerationLoop.ts` — importar desde weekUtils, eliminar definiciones locales**

Eliminar las líneas 37-47 (las tres funciones locales) y agregar el import:

```typescript
// Agregar al bloque de imports al inicio del archivo (junto con el import existente de generateWeekCore):
import { countReadyWeeks, isReadyWeek, sortWeeks } from './weekUtils'
```

Eliminar estas funciones (líneas 37-47):
```typescript
// ELIMINAR:
function sortWeeks(weeks: TrainingPlanWeek[]): TrainingPlanWeek[] {
  return [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)
}

function isReadyWeek(week: TrainingPlanWeek): boolean {
  return (week.status === 'draft' || week.status === 'accepted') && week.sessions.length > 0
}

function countReadyWeeks(weeks: TrainingPlanWeek[]): number {
  return weeks.filter(isReadyWeek).length
}
```

- [ ] **Step 5: Actualizar `pollPlanGeneration.ts` — importar `sortWeeks` desde weekUtils**

Agregar import (línea 4, luego del import de planRows):
```typescript
import { sortWeeks } from './weekUtils'
```

Eliminar la función local (líneas 25-27):
```typescript
// ELIMINAR:
function sortWeeks(weeks: TrainingPlanWeek[]): TrainingPlanWeek[] {
  return [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)
}
```

- [ ] **Step 6: Actualizar `usePlanBuilderStore.ts` — importar desde weekUtils, eliminar locales**

Agregar al bloque de imports:
```typescript
import { countReadyWeeks, isReadyWeek, sortWeeks } from '../services/planBuilder/weekUtils'
```

Eliminar las funciones locales (líneas 90-100):
```typescript
// ELIMINAR:
function isReadyWeek(week: TrainingPlanWeek): boolean {
  return week.status === 'draft' && week.sessions.length > 0
}

function countReadyWeeks(weeks: TrainingPlanWeek[]): number {
  return weeks.filter(isReadyWeek).length
}

function sortWeeks(weeks: TrainingPlanWeek[]): TrainingPlanWeek[] {
  return [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)
}
```

- [ ] **Step 7: Correr tests para confirmar que no se rompió nada**

```bash
npx vitest run src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts src/services/planBuilder/__tests__/weekUtils.test.ts
```

Esperado: todos PASS.

- [ ] **Step 8: Lint + build**

```bash
npm run lint && npm run build
```

Esperado: sin errores.

- [ ] **Step 9: Commit**

```bash
git add src/services/planBuilder/weekUtils.ts \
        src/services/planBuilder/__tests__/weekUtils.test.ts \
        src/services/planBuilder/asyncGenerationLoop.ts \
        src/services/planBuilder/pollPlanGeneration.ts \
        src/store/usePlanBuilderStore.ts
git commit -m "$(cat <<'EOF'
refactor(plan-builder): extract shared week utilities, fix isReadyWeek to count accepted weeks

Unifica isReadyWeek/countReadyWeeks/sortWeeks en weekUtils.ts y corrige que
las semanas aceptadas no contaban como listas en el contador de progreso.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Fix Bug #1: onSnapshot race tras abort (pollPlanGeneration)

**Files:**
- Modify: `src/services/planBuilder/pollPlanGeneration.ts` (línea 86-88)
- Create: `src/services/planBuilder/__tests__/pollPlanGeneration.test.ts`

**Contexto:** Cuando `discard()` aborta el controller mientras `fetchPlanGenerationSnapshot` tiene una request en vuelo, la función resuelve y llama a `onSnapshot` con el snapshot stale. Esto re-popula el store con el plan que el usuario acaba de descartar.

**Fix:** Agregar `if (input.signal?.aborted) break` inmediatamente después del `await fetchPlanGenerationSnapshot` y antes de llamar a `onSnapshot`.

- [ ] **Step 1: Escribir el test que falla con el código actual**

```typescript
// src/services/planBuilder/__tests__/pollPlanGeneration.test.ts
import { describe, expect, it, vi } from 'vitest'
import * as pollModule from '../pollPlanGeneration'
import type { PlanGenerationSnapshot } from '../pollPlanGeneration'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'

function makePlan(generationState: TrainingPlan['generationState'] = 'generating'): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'a1',
    goalEventId: 'e1',
    status: 'draft',
    generationState,
    title: 'Test',
    startDate: '2026-06-01',
    endDate: '2026-06-14',
    totalWeeks: 2,
    phases: [],
    wizardConfig: {} as never,
    macroSnapshot: {} as never,
    createdAt: 1,
    updatedAt: 1,
    generationSummary: {
      startedAt: 1,
      jobId: 'j1',
      strategy: 'single',
      completedWeeks: 0,
      failedWeeks: [],
      totalAttempts: 0,
      heartbeatAt: Date.now(),
    },
  }
}

function makeSnapshot(state: TrainingPlan['generationState'] = 'generating'): PlanGenerationSnapshot {
  return {
    plan: makePlan(state),
    weeks: [] as TrainingPlanWeek[],
    isTerminal: state === 'complete' || state === 'failed' || state === 'cancelled' || state === 'partial',
    isStalled: false,
  }
}

describe('pollPlanGeneration — abort race', () => {
  it('does not call onSnapshot when signal aborts during in-flight fetchPlanGenerationSnapshot', async () => {
    const controller = new AbortController()
    const onSnapshot = vi.fn()

    // Simula una fetch lenta: resolvemos el deferred manualmente
    let resolveFetch!: (v: PlanGenerationSnapshot | null) => void
    const fetchDeferred = new Promise<PlanGenerationSnapshot | null>((res) => { resolveFetch = res })

    vi.spyOn(pollModule, 'fetchPlanGenerationSnapshot').mockImplementationOnce(() => fetchDeferred)

    const pollPromise = pollModule.pollPlanGeneration({
      planId: 'plan-1',
      signal: controller.signal,
      onSnapshot,
      intervalMs: 60_000, // evita que el loop vuelva a iterar
    })

    // Abort mientras la fetch está pendiente
    controller.abort()
    // La fetch resuelve DESPUÉS del abort (simula race condition)
    resolveFetch(makeSnapshot('generating'))

    await pollPromise

    expect(onSnapshot).not.toHaveBeenCalled()
  })

  it('calls onSnapshot when signal is not aborted', async () => {
    const onSnapshot = vi.fn()
    const snapshot = makeSnapshot('complete')

    vi.spyOn(pollModule, 'fetchPlanGenerationSnapshot').mockResolvedValueOnce(snapshot)

    await pollModule.pollPlanGeneration({
      planId: 'plan-1',
      onSnapshot,
      intervalMs: 60_000,
    })

    expect(onSnapshot).toHaveBeenCalledWith(snapshot)
  })
})
```

- [ ] **Step 2: Ejecutar el test para confirmar que FALLA con el código actual**

```bash
npx vitest run src/services/planBuilder/__tests__/pollPlanGeneration.test.ts
```

Esperado: FAIL — "does not call onSnapshot when signal aborts..." falla porque `onSnapshot` SÍ es llamado.

- [ ] **Step 3: Aplicar el fix en `pollPlanGeneration.ts`**

Reemplazar la función `pollPlanGeneration` (líneas 78-94) con:

```typescript
export async function pollPlanGeneration(input: PollPlanGenerationInput): Promise<PlanGenerationSnapshot | null> {
  let latest: PlanGenerationSnapshot | null = null
  const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS

  while (!input.signal?.aborted) {
    latest = await fetchPlanGenerationSnapshot(input.planId, {
      stalledAfterMs: input.stalledAfterMs,
    })
    if (input.signal?.aborted) break  // guard: abort pudo haber ocurrido durante el await
    if (latest) {
      input.onSnapshot?.(latest)
      if (latest.isTerminal || latest.isStalled) return latest
    }
    await sleep(intervalMs, input.signal)
  }

  return latest
}
```

- [ ] **Step 4: Verificar que el test ahora pasa**

```bash
npx vitest run src/services/planBuilder/__tests__/pollPlanGeneration.test.ts
```

Esperado: todos PASS.

- [ ] **Step 5: Lint + build**

```bash
npm run lint && npm run build
```

Esperado: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/services/planBuilder/pollPlanGeneration.ts \
        src/services/planBuilder/__tests__/pollPlanGeneration.test.ts
git commit -m "$(cat <<'EOF'
fix(plan-builder): guard onSnapshot against abort race in pollPlanGeneration

Agrega verificación de señal de abort después de fetchPlanGenerationSnapshot
para evitar que onSnapshot dispare y repopule el store tras un discard.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Fix Bug #2 + Debt #5: cancelGeneration aborta poller y usa pushTrainingPlan

**Files:**
- Modify: `src/store/usePlanBuilderStore.ts` (función `cancelGeneration`, líneas 623-662)

**Contexto (Bug #2):** `cancelGeneration()` escribe `cancelRequested: true` en Supabase pero no aborta `generationPollingController`. Si la Netlify function ya terminó sin escribir un estado terminal, el poller sigue corriendo indefinidamente (hasta el umbral de stall de 3 minutos).

**Contexto (Debt #5):** La función usa un raw `supabase.from().update()` parcial en vez de `pushTrainingPlan`, que tiene el mapeo completo de columnas y la guardia de syncability.

**Fix:** Abortar el poller al inicio, marcar el plan como `'cancelled'` optimísticamente (el background function lo confirmará), y usar `pushTrainingPlan`.

- [ ] **Step 1: Reemplazar la función `cancelGeneration` en el store**

Reemplazar desde la línea `cancelGeneration: async () => {` hasta el cierre `},` (líneas 623-662) con:

```typescript
  cancelGeneration: async () => {
    const { plan } = get()
    if (!plan || plan.generationState !== 'generating') return

    // Detener el poller inmediatamente — evita que onSnapshot sobreescriba el estado tras el abort
    generationPollingController?.abort()
    generationPollingController = null

    const updatedAt = Date.now()
    const nextPlan: TrainingPlan = {
      ...plan,
      generationState: 'cancelled',
      updatedAt,
      generationSummary: {
        ...(plan.generationSummary ?? {
          startedAt: updatedAt,
          strategy: 'single' as const,
          completedWeeks: get().completedWeeks,
          failedWeeks: get().failedWeekIndexes,
          totalAttempts: 0,
        }),
        cancelRequested: true,
        heartbeatAt: plan.generationSummary?.heartbeatAt ?? updatedAt,
      },
    }
    try {
      await db.trainingPlans.put(nextPlan)
      await pushTrainingPlan(nextPlan)
      set({
        plan: nextPlan,
        status: 'cancelled',
        lastError: 'Generación detenida. Las semanas ya generadas se conservan.',
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set({ lastError: msg })
    }
  },
```

- [ ] **Step 2: Correr los tests relevantes**

```bash
npx vitest run src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts
```

Esperado: todos PASS.

- [ ] **Step 3: Lint + build**

```bash
npm run lint && npm run build
```

Esperado: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/store/usePlanBuilderStore.ts
git commit -m "$(cat <<'EOF'
fix(plan-builder): cancelGeneration aborta poller y actualiza estado optimísticamente

Corrige que el poller quedaba vivo indefinidamente si el background function
no llegaba a escribir el estado terminal. Cancela optimísticamente el plan
localmente y usa pushTrainingPlan para consistencia con el resto de writes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Fix Bug #4 + Debt #8: getPlan en try/catch + checkCancelled ligero

**Files:**
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts` (interface `AsyncPlanGenerationWriter` + loop)
- Modify: `netlify/functions/generate-plan-background.ts` (agregar `checkCancelled` al writer)
- Modify: `src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts` (test para getPlan throwing)

**Contexto (Bug #4):** La llamada a `writer.getPlan(plan.id)` al inicio de cada iteración del loop está fuera del `try/catch`. Si Supabase devuelve un error de red, la excepción se propaga sin escribir un estado terminal, dejando el plan bloqueado en `'generating'` en Supabase.

**Contexto (Debt #8):** Para un plan de 12 semanas se hacen 12 llamadas a `getPlan` (que trae el plan completo) solo para chequear `cancelRequested`. Se introduce un método opcional `checkCancelled` que hace un `select` de un solo campo.

**Fix:** El método `checkCancelled` es opcional en la interface; si no está presente, cae al comportamiento actual con `getPlan`. La llamada se envuelve en try/catch; en caso de error, se asume `cancelRequested = false` y el loop continúa.

- [ ] **Step 1: Escribir el test que cubre el error de getPlan**

Agregar al final de `src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts`:

```typescript
  it('escribe estado terminal failed cuando getPlan lanza un error de red', async () => {
    const plan = makePlan()
    const weeks = [makeWeek(0, '2026-06-01')]

    // Writer cuyo getPlan siempre lanza
    const throwingWriter: AsyncPlanGenerationWriter & { plans: TrainingPlan[]; weeks: TrainingPlanWeek[] } = {
      plans: [],
      weeks: [],
      async getPlan() { throw new Error('Network error') },
      async putPlan(next) { this.plans.push(next) },
      async putWeek(next) { this.weeks.push(next) },
    }

    const result = await runAsyncPlanGeneration({
      plan,
      weeks,
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      jobId: 'job-err',
      writer: throwingWriter,
      callLLM: vi.fn(async () => makeRaw('2026-06-01')),
    })

    // El loop debe completar (no propagar la excepción) y generar la semana
    expect(result.plan.generationState).not.toBe('generating')
    expect(throwingWriter.plans.length).toBeGreaterThan(0)
    const lastPlan = throwingWriter.plans[throwingWriter.plans.length - 1]
    expect(['complete', 'partial', 'failed']).toContain(lastPlan.generationState)
  })

  it('usa checkCancelled en vez de getPlan cuando está disponible', async () => {
    const plan = makePlan()
    const weeks = [makeWeek(0, '2026-06-01')]

    let checkCancelledCalls = 0
    let getPlanCalls = 0

    const writer: AsyncPlanGenerationWriter & { plans: TrainingPlan[]; weeks: TrainingPlanWeek[] } = {
      plans: [],
      weeks: [],
      async checkCancelled() {
        checkCancelledCalls++
        return false
      },
      async getPlan() {
        getPlanCalls++
        return plan
      },
      async putPlan(next) { this.plans.push(next) },
      async putWeek(next) { this.weeks.push(next) },
    }

    await runAsyncPlanGeneration({
      plan,
      weeks,
      profile: makeProfile(),
      wizardConfig: makeWizardConfig(),
      jobId: 'job-cc',
      writer,
      callLLM: vi.fn(async () => makeRaw('2026-06-01')),
    })

    expect(checkCancelledCalls).toBe(1) // Una iteración = una llamada a checkCancelled
    expect(getPlanCalls).toBe(0)        // getPlan no debe llamarse si checkCancelled existe
  })
```

- [ ] **Step 2: Ejecutar el test para confirmar que FALLA con el código actual**

```bash
npx vitest run src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts
```

Esperado: el test "escribe estado terminal failed cuando getPlan lanza" FALLA porque la excepción se propaga y el runner arroja.

- [ ] **Step 3: Actualizar la interface `AsyncPlanGenerationWriter` en `asyncGenerationLoop.ts`**

Reemplazar la interface (líneas 6-10) con:

```typescript
export interface AsyncPlanGenerationWriter {
  /** Método ligero opcional. Si está presente, se usa en vez de getPlan para chequear cancelación. */
  checkCancelled?: (planId: string) => Promise<boolean>
  getPlan(planId: string): Promise<TrainingPlan | null>
  putPlan(plan: TrainingPlan): Promise<void>
  putWeek(week: TrainingPlanWeek): Promise<void>
}
```

- [ ] **Step 4: Reemplazar el bloque de cancel-check dentro del for-loop**

El bloque actual (líneas 212-241 dentro del for loop) es:

```typescript
    const freshPlan = await input.writer.getPlan(plan.id)
    if (freshPlan?.generationSummary?.cancelRequested) {
      const timestamp = getNow()
      plan = buildPlanCheckpoint(freshPlan, weeks, {
        generationState: 'cancelled',
        jobId: input.jobId,
        startedAt,
        updatedAt: timestamp,
        completedAt: timestamp,
        cancelRequested: true,
      })
      await input.writer.putPlan(plan)
      return { plan, weeks, cancelled: true }
    }

    const target = weeks.find((week) => week.weekIndex === weekIndex)
    if (!target) continue
    if (!input.targetWeekIndexes?.length && isReadyWeek(target)) continue

    const generatingWeek = makeGeneratingWeek(target, getNow())
    weeks = replaceWeek(weeks, generatingWeek)
    await input.writer.putWeek(generatingWeek)
    plan = buildPlanCheckpoint(freshPlan ?? plan, weeks, {
      generationState: 'generating',
```

Reemplazar con:

```typescript
    let cancelRequested = false
    try {
      cancelRequested = input.writer.checkCancelled
        ? await input.writer.checkCancelled(plan.id)
        : Boolean((await input.writer.getPlan(plan.id))?.generationSummary?.cancelRequested)
    } catch {
      // No se pudo leer el estado de cancelación — continuar generando
    }

    if (cancelRequested) {
      const timestamp = getNow()
      plan = buildPlanCheckpoint(plan, weeks, {
        generationState: 'cancelled',
        jobId: input.jobId,
        startedAt,
        updatedAt: timestamp,
        completedAt: timestamp,
        cancelRequested: true,
      })
      await input.writer.putPlan(plan)
      return { plan, weeks, cancelled: true }
    }

    const target = weeks.find((week) => week.weekIndex === weekIndex)
    if (!target) continue
    if (!input.targetWeekIndexes?.length && isReadyWeek(target)) continue

    const generatingWeek = makeGeneratingWeek(target, getNow())
    weeks = replaceWeek(weeks, generatingWeek)
    await input.writer.putWeek(generatingWeek)
    plan = buildPlanCheckpoint(plan, weeks, {
      generationState: 'generating',
```

Nota: se eliminó `freshPlan ??` en `buildPlanCheckpoint` — usamos el plan local directamente ya que `freshPlan` solo se necesitaba para el cancel check.

- [ ] **Step 5: Agregar `checkCancelled` al writer en `generate-plan-background.ts`**

Dentro de la función `createSupabaseWriter`, agregar el método antes de `getPlan`:

```typescript
    async checkCancelled(planId) {
      const { data, error } = await supabase
        .from('training_plans')
        .select('generation_summary')
        .eq('user_id', userId)
        .eq('id', planId)
        .maybeSingle()
      if (error) throw error
      return Boolean(
        (data?.generation_summary as { cancelRequested?: boolean } | null)?.cancelRequested,
      )
    },
```

- [ ] **Step 6: Verificar que todos los tests de asyncGenerationLoop pasan**

```bash
npx vitest run src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts
```

Esperado: todos PASS incluyendo los nuevos.

- [ ] **Step 7: Lint + build**

```bash
npm run lint && npm run build
```

Esperado: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/services/planBuilder/asyncGenerationLoop.ts \
        src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts \
        netlify/functions/generate-plan-background.ts
git commit -m "$(cat <<'EOF'
fix(plan-builder): checkCancelled opcional en writer + try/catch para getPlan en loop

Agrega checkCancelled para consulta ligera (un campo) en vez de traer el plan
completo en cada iteración. Envuelve getPlan en try/catch para que un error de
red no deje el plan bloqueado en estado generating sin escribir estado terminal.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Debt #6: Remover triple write de semanas antes de triggerBackgroundGeneration

**Files:**
- Modify: `src/store/usePlanBuilderStore.ts` (3 locations: `runGeneration`, `regenerateWeeks`, `retryFailedWeeks`)

**Contexto:** En el path remoto, el store hace `pushTrainingPlanWeeks` (escribe N semanas a Supabase), luego `triggerBackgroundGeneration` envía las mismas semanas en el body del POST, y la Netlify function las escribe de nuevo vía `Promise.all(body.weeks.map(putWeek))`. Las semanas se escriben al menos dos veces antes de que empiece la generación. `pushTrainingPlan` (para el plan) se mantiene como gate check de autenticación.

**Fix:** Eliminar las tres llamadas a `pushTrainingPlanWeeks` en los paths remotos. La Netlify function recibe las semanas en el cuerpo del POST y las persiste inmediatamente.

- [ ] **Step 1: Eliminar `pushTrainingPlanWeeks` en `runGeneration` (remote path)**

Localizar y eliminar la línea (aprox. línea 358):
```typescript
      await pushTrainingPlanWeeks(nextPlan, resetWeeks)
```

El bloque resultante queda:
```typescript
      await pushTrainingPlan(nextPlan)
      const recentContext = await buildPlanBuilderRecentContext(nextPlan).catch(() => undefined)
      await triggerBackgroundGeneration({
```

- [ ] **Step 2: Eliminar `pushTrainingPlanWeeks` en `regenerateWeeks` (remote path)**

Localizar y eliminar la línea (aprox. línea 488):
```typescript
      await pushTrainingPlanWeeks(generatingPlan, nextWeeks)
```

El bloque resultante queda:
```typescript
      await pushTrainingPlan(generatingPlan)
      const recentContext = await buildPlanBuilderRecentContext(generatingPlan).catch(() => undefined)
      await triggerBackgroundGeneration({
```

- [ ] **Step 3: Eliminar `pushTrainingPlanWeeks` en `retryFailedWeeks` (remote path)**

Localizar y eliminar la línea (aprox. línea 562):
```typescript
      await pushTrainingPlanWeeks(generatingPlan, nextWeeks)
```

El bloque resultante queda:
```typescript
      await pushTrainingPlan(generatingPlan)
      const recentContext = await buildPlanBuilderRecentContext(generatingPlan).catch(() => undefined)
      await triggerBackgroundGeneration({
```

- [ ] **Step 4: Verificar que `pushTrainingPlanWeeks` ya no se importa si quedó sin usos**

```bash
grep -n "pushTrainingPlanWeeks" src/store/usePlanBuilderStore.ts
```

Si el import en la línea 27 sigue pero `pushTrainingPlanWeeks` ya no se usa en el archivo, eliminarlo del import:

```typescript
// Cambiar:
import { pushTrainingPlan, pushTrainingPlanWeeks } from '../services/syncService'
// Por:
import { pushTrainingPlan } from '../services/syncService'
```

- [ ] **Step 5: Lint + build**

```bash
npm run lint && npm run build
```

Esperado: sin errores ni warnings de "unused import".

- [ ] **Step 6: Commit**

```bash
git add src/store/usePlanBuilderStore.ts
git commit -m "$(cat <<'EOF'
perf(plan-builder): eliminar pushTrainingPlanWeeks redundante antes de trigger async

La función background recibe las semanas en el body del POST y las persiste
de inmediato, por lo que la escritura previa desde el cliente era redundante.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Cleanup: dead computation, error guard, inline cancel wrapper

**Files:**
- Modify: `netlify/functions/generate-plan-background.ts` (Debt #9)
- Modify: `src/services/planBuilder/triggerBackgroundGeneration.ts` (Debt del review original #4)
- Modify: `src/pages/PlanBuilderV2Page.tsx` (Debt #10)

**Contexto:**
- **Debt #9:** `completedWeeks` y `failedWeeks` se calculan del body en el constructor inicial del plan, pero `runAsyncPlanGeneration` los recalcula y sobreescribe de inmediato. Los valores del constructor son muertos.
- **Error guard:** `if (!response.ok && response.status !== 202)` tiene la rama `&& response.status !== 202` muerta (202 siempre satisface `response.ok`). Además, si el servidor devuelve 200 con `{error: ...}` en body, la condición correcta es `!response.ok` sin más.
- **Debt #10:** `handleCancelGeneration` es un wrapper de una línea que no agrega ninguna lógica ni guardia.

- [ ] **Step 1: Simplificar `generationSummary` inicial en `generate-plan-background.ts`**

Reemplazar las líneas 160-168 (el cálculo de completedWeeks/failedWeeks/totalAttempts):

```typescript
    // Antes:
    generationSummary: {
      startedAt,
      jobId,
      strategy: 'single',
      completedWeeks: body.weeks.filter((week) => week.status === 'draft' && week.sessions.length > 0).length,
      failedWeeks: body.weeks.filter((week) => week.status === 'error').map((week) => week.weekIndex),
      totalAttempts: body.weeks.reduce((sum, week) => sum + (week.generationMeta.attempts ?? 0), 0),
      heartbeatAt: startedAt,
    },
```

Con:

```typescript
    // Después:
    generationSummary: {
      startedAt,
      jobId,
      strategy: 'single',
      completedWeeks: 0,
      failedWeeks: [],
      totalAttempts: 0,
      heartbeatAt: startedAt,
    },
```

- [ ] **Step 2: Corregir el error guard en `triggerBackgroundGeneration.ts`**

Reemplazar la línea (aprox. línea 44):

```typescript
  if (!response.ok && response.status !== 202) {
```

Con:

```typescript
  if (!response.ok) {
```

- [ ] **Step 3: Inlinear `handleCancelGeneration` en `PlanBuilderV2Page.tsx`**

Eliminar la función (líneas 683-685):
```typescript
  async function handleCancelGeneration() {
    await cancelGeneration()
  }
```

Reemplazar el `onClick` del botón Detener (aprox. línea 819):
```tsx
// Antes:
onClick={() => { void handleCancelGeneration() }}
// Después:
onClick={() => { void cancelGeneration() }}
```

- [ ] **Step 4: Lint + build**

```bash
npm run lint && npm run build
```

Esperado: sin errores.

- [ ] **Step 5: Correr suite completa**

```bash
npm test
```

Esperado: todos los tests pasan (686+).

- [ ] **Step 6: Commit final**

```bash
git add netlify/functions/generate-plan-background.ts \
        src/services/planBuilder/triggerBackgroundGeneration.ts \
        src/pages/PlanBuilderV2Page.tsx
git commit -m "$(cat <<'EOF'
chore(plan-builder): limpiar dead computation, fix error guard y wrapper innecesario

Elimina cálculo inicial muerto de completedWeeks/failedWeeks (el loop los
recomputa inmediatamente), simplifica condición de error en triggerBackground
y elimina wrapper handleCancelGeneration de una línea sin lógica propia.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### Cobertura del spec (10 hallazgos originales)

| # | Hallazgo | Task |
|---|---|---|
| Bug #1 | `onSnapshot` tras abort | Task 2 |
| Bug #2 | `cancelGeneration` no aborta poller | Task 3 |
| Bug #3 | `isReadyWeek` diverge | Task 1 |
| Bug #4 | `getPlan()` fuera de try/catch | Task 4 |
| Debt #5 | `cancelGeneration` bypassa `pushTrainingPlan` | Task 3 |
| Debt #6 | Triple write de semanas | Task 5 |
| Debt #7 | `sortWeeks` duplicado | Task 1 |
| Debt #8 | `getPlan` completo solo para chequear cancel | Task 4 |
| Debt #9 | Dead computation en background.ts | Task 6 |
| Debt #10 | `handleCancelGeneration` wrapper innecesario | Task 6 |

Todos los hallazgos están cubiertos.

### Verificación de tipos

- `checkCancelled` es `optional` en la interface → tests existentes sin `checkCancelled` siguen compilando.
- `pushTrainingPlan` ya está importado en el store → Task 3 no agrega imports nuevos.
- `sortWeeks`/`isReadyWeek`/`countReadyWeeks` exportados desde `weekUtils.ts` — las 3 importaciones las usan como funciones, no como tipos → compatible.
- `buildPlanCheckpoint(plan, ...)` en vez de `buildPlanCheckpoint(freshPlan ?? plan, ...)` — `plan` es `TrainingPlan` (no null) en ese punto del loop → correcto.

### Sin placeholders

Cada step tiene código completo o comandos exactos. Sin "TBD" ni "similar al anterior".
