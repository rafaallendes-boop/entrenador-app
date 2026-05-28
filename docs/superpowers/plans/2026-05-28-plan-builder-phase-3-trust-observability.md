# Plan Builder Fase 3 — Trust + observabilidad

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el cliente beta privada nunca vea "falló la IA", mientras internamente todo el plan es observable (quality review persistido, fallback badges) y regenerable (botón "regenerar semana" flag-gated). El flag `VITE_SHOW_PLAN_QUALITY` controla la UI debug.

**Architecture:** Tres bloques verticales que conviven con el flujo actual sin tocar prompts ni selectores:
1. **Quality review en commit:** `commitPlan` corre `reviewPlanQuality` antes de marcar el plan `active` y persiste el resultado en `plan.generationSummary.qualityReview`. La UI debug del plan lee de ahí. El cliente beta no ve nada.
2. **Regenerate single week:** un nuevo servicio `regeneratePlanWeek` reusa `generateSingleWeekWithRetry`, requiere confirmación, reemplaza sesiones aceptadas usando el mismo path de `applyCreateWeek` + rollback que ya existe en `commitPlan`. Status nuevo `regenerating` en `TrainingPlanWeek.status`.
3. **Plan history en Settings → Beta Quality:** lista compacta de planes con N/M semanas IA vs fallback, score global, link a issues. Reusa `recentRequests` para cruzar traces por plan.

**Tech Stack:** TypeScript, React, Vitest + React Testing Library, Dexie (v17), Zustand stores existentes. Sin nuevas deps.

**Spec:** `docs/superpowers/specs/2026-05-27-plan-builder-star-product-design.md` (Fase 3, secciones 3.1–3.5).

**Restricción operativa:** No deploy a prod antes de 2026-05-29. Cada task debe pasar `npm run lint && npm test && npm run build && npm run audit:prompt`. El flag `VITE_SHOW_PLAN_QUALITY` debe quedar `false` por default — un test lint-style debe romper si está `'true'` cuando `import.meta.env.PROD === true`.

**⚠️ Política de commits:** El usuario hará UN commit grande al final que agrupará spec + plan + cambios. **NO ejecutar `git commit` ni `git add` dentro de cada task.** Tratarlos como no-op. Dejar todos los cambios staged-pendientes para que el usuario los revise y commitee de forma consolidada.

---

## Contexto operativo previo a empezar

Antes de la primera task, el implementador debería leer en orden:

1. `src/services/planBuilder/qualityReview.ts` — el motor `reviewPlanQuality(plan, weeks): PlanQualityReview` ya existe, exporta `PlanQualityReview`, `PlanQualityWeekReview`, `PlanQualityGrade`. No se reescribe; solo se consume.
2. `src/services/planBuilder/commitPlan.ts` — flujo actual: `validatePlan` → `applyCreateWeek` por semana en `appliedSnapshots`, con rollback en `restoreWeekCommitSnapshots`. La integración del review entra **entre validación y commit a Dexie**, no antes.
3. `src/services/planBuilder/generatePlan.ts` — `generateSingleWeekWithRetry` (línea 265) es la función a reusar. Es `async` y privada de su módulo: hay que exportarla.
4. `src/types/planBuilder.ts` (línea 14) — `PlanWeekStatus = 'pending' | 'generating' | 'draft' | 'accepted' | 'error'`. Hay que agregar `'regenerating'`. **No es breaking**: las migraciones de Dexie/Supabase aceptan strings.
5. `src/pages/CompetitionPlanPage.tsx` — la página principal del plan aceptado. Aquí entra la sección "Calidad del plan" gated.
6. `src/pages/SettingsPage.tsx` — la sección Beta Quality empieza alrededor de la línea 700. La nueva subsección "Planes" vive ahí, no en una ruta nueva.
7. `src/services/ai/aiTelemetry.ts` — `BetaQualitySnapshot` ya existe. La lista de planes para Beta Quality se calcula en cliente cruzando `db.trainingPlans` con `recentRequests` por trace; no se inventa un store nuevo.

---

## File Structure

```
src/types/
  planBuilder.ts                                  [MODIFY: +'regenerating', PlanGenerationSummary.qualityReview, RegenerationMeta]

src/services/planBuilder/
  qualityReview.ts                                [no se toca]
  commitPlan.ts                                   [MODIFY: persistir qualityReview en plan.generationSummary]
  generatePlan.ts                                 [MODIFY: export generateSingleWeekWithRetry]
  regeneratePlanWeek.ts                           [NEW: regenera una semana, reemplaza sesiones aceptadas]
  __tests__/
    commitPlanQualityReview.test.ts               [NEW: review se persiste en generationSummary]
    regeneratePlanWeek.test.ts                    [NEW: regeneración mantiene resto intacto]

src/services/ai/
  showPlanQualityFlag.ts                          [NEW: helper único para leer VITE_SHOW_PLAN_QUALITY]
  __tests__/
    showPlanQualityFlag.test.ts                   [NEW: incluye guard para PROD]

src/components/planBuilder/
  PlanQualityBadge.tsx                            [NEW: badge global + por semana, flag-gated]
  RegenerateWeekButton.tsx                        [NEW: botón + modal de confirmación, flag-gated]
  PlanQualityBadge.test.tsx                       [NEW: render condicional por flag]
  RegenerateWeekButton.test.tsx                   [NEW: pide confirmación]

src/pages/
  CompetitionPlanPage.tsx                         [MODIFY: render flag-gated del badge + botón]
  SettingsPage.tsx                                [MODIFY: nueva subsección "Planes generados" en Beta Quality]

src/services/planBuilder/
  betaQualityPlanRollup.ts                        [NEW: cruza trainingPlans con recentRequests]
  __tests__/
    betaQualityPlanRollup.test.ts                 [NEW: rollup correcto]
```

---

## Task 1: Extender tipos para qualityReview + estado regenerating

**Files:**
- Modify: `src/types/planBuilder.ts:14` (PlanWeekStatus) y `:61-71` (PlanGenerationSummary)
- Test: `src/services/planBuilder/__tests__/typesQualityReview.test.ts` (NEW)

- [ ] **Step 1: Escribir el test failing**

Crear `src/services/planBuilder/__tests__/typesQualityReview.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PlanGenerationSummary, PlanWeekStatus, TrainingPlanWeek } from '../../../types/planBuilder'
import type { PlanQualityReview } from '../qualityReview'

describe('Phase 3 type extensions', () => {
  it('PlanWeekStatus includes regenerating', () => {
    const status: PlanWeekStatus = 'regenerating'
    expect(status).toBe('regenerating')
  })

  it('PlanGenerationSummary accepts qualityReview', () => {
    const review = {
      score: 80,
      grade: 'good',
      issues: [],
      weeks: [],
      repairCount: 0,
      criticalIssueCount: 0,
      warningCount: 0,
    } satisfies PlanQualityReview

    const summary: PlanGenerationSummary = {
      startedAt: 1,
      strategy: 'single',
      completedWeeks: 9,
      failedWeeks: [],
      totalAttempts: 9,
      qualityReview: review,
    }
    expect(summary.qualityReview?.grade).toBe('good')
  })

  it('TrainingPlanWeek accepts regenerationMeta with attempt history', () => {
    const week = {
      id: 'w',
      planId: 'p',
      weekIndex: 0,
      weekStartDate: '2026-06-01',
      phase: 'build',
      sessions: [],
      weekObjectives: [],
      status: 'accepted' as const,
      createdAt: 1,
      updatedAt: 1,
      regenerationMeta: {
        attempts: 1,
        lastRegeneratedAt: 2,
        previousFallbackUsed: true,
      },
    } satisfies TrainingPlanWeek
    expect(week.regenerationMeta?.attempts).toBe(1)
  })
})
```

- [ ] **Step 2: Verificar que el test falla**

Run: `npx vitest run src/services/planBuilder/__tests__/typesQualityReview.test.ts`
Expected: FAIL con error de TS sobre `'regenerating'`, `qualityReview` o `regenerationMeta` no existentes.

- [ ] **Step 3: Modificar `src/types/planBuilder.ts`**

En la línea 14, ampliar `PlanWeekStatus`:

```ts
export type PlanWeekStatus = 'pending' | 'generating' | 'draft' | 'accepted' | 'error' | 'regenerating'
```

En la línea 61, después de `discardedAt`, agregar `qualityReview` opcional al `PlanGenerationSummary`. Importar `PlanQualityReview` arriba del archivo:

```ts
import type { PlanQualityReview } from '../services/planBuilder/qualityReview'
```

Y dentro de la interface:

```ts
export interface PlanGenerationSummary {
  startedAt: number
  completedAt?: number
  totalDurationMs?: number
  strategy: 'single' | 'pairs'
  completedWeeks: number
  failedWeeks: number[]
  totalAttempts: number
  acceptedAt?: number
  discardedAt?: number
  qualityReview?: PlanQualityReview
}
```

En la `TrainingPlanWeek` interface, agregar `regenerationMeta` opcional:

```ts
export interface RegenerationMeta {
  attempts: number
  lastRegeneratedAt: number
  previousFallbackUsed?: boolean
}

export interface TrainingPlanWeek {
  /* ...campos actuales... */
  regenerationMeta?: RegenerationMeta
}
```

(Mira el archivo actual y añade `regenerationMeta` al final de la interface existente, sin reescribir los demás campos.)

- [ ] **Step 4: Verificar que el test pasa y no rompió tipos**

Run: `npx vitest run src/services/planBuilder/__tests__/typesQualityReview.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 5: NO-OP commit**

Per política de commits: NO ejecutar `git add` ni `git commit`. Dejar staged-pendiente.

---

## Task 2: Helper único `showPlanQualityFlag` con guard de PROD

**Files:**
- Create: `src/services/ai/showPlanQualityFlag.ts`
- Test: `src/services/ai/__tests__/showPlanQualityFlag.test.ts`

El spec marca como riesgo "QA flag VITE_SHOW_PLAN_QUALITY queda activo en producción por error" y propone "lint rule o test que falla si el flag es true cuando import.meta.env.PROD". Implementamos test, no lint.

- [ ] **Step 1: Escribir el test failing**

Crear `src/services/ai/__tests__/showPlanQualityFlag.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const importFresh = async () => {
  vi.resetModules()
  return await import('../showPlanQualityFlag')
}

describe('showPlanQualityFlag', () => {
  const originalEnv = { ...import.meta.env }

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv)
  })

  it('returns true when VITE_SHOW_PLAN_QUALITY is "true" and not PROD', async () => {
    Object.assign(import.meta.env, { VITE_SHOW_PLAN_QUALITY: 'true', PROD: false })
    const mod = await importFresh()
    expect(mod.shouldShowPlanQuality()).toBe(true)
  })

  it('returns false in PROD even if VITE_SHOW_PLAN_QUALITY is "true"', async () => {
    Object.assign(import.meta.env, { VITE_SHOW_PLAN_QUALITY: 'true', PROD: true })
    const mod = await importFresh()
    expect(mod.shouldShowPlanQuality()).toBe(false)
  })

  it('returns false when VITE_SHOW_PLAN_QUALITY is missing', async () => {
    Object.assign(import.meta.env, { VITE_SHOW_PLAN_QUALITY: undefined, PROD: false })
    const mod = await importFresh()
    expect(mod.shouldShowPlanQuality()).toBe(false)
  })

  it('returns false for non-"true" values', async () => {
    for (const value of ['1', 'yes', 'TRUE', 'false', '']) {
      Object.assign(import.meta.env, { VITE_SHOW_PLAN_QUALITY: value, PROD: false })
      const mod = await importFresh()
      expect(mod.shouldShowPlanQuality()).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/services/ai/__tests__/showPlanQualityFlag.test.ts`
Expected: FAIL with "Cannot find module '../showPlanQualityFlag'"

- [ ] **Step 3: Crear el helper**

`src/services/ai/showPlanQualityFlag.ts`:

```ts
/**
 * Plan Builder Phase 3 debug flag.
 * - Local/dev: set `VITE_SHOW_PLAN_QUALITY=true` to enable badges + regenerate button.
 * - PROD: forcibly OFF, regardless of env value. Prevents accidental beta exposure.
 */
export function shouldShowPlanQuality(): boolean {
  if (import.meta.env.PROD === true) return false
  return import.meta.env.VITE_SHOW_PLAN_QUALITY === 'true'
}
```

- [ ] **Step 4: Verificar que el test pasa**

Run: `npx vitest run src/services/ai/__tests__/showPlanQualityFlag.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: NO-OP commit**

---

## Task 3: Persistir qualityReview en `commitPlan`

**Files:**
- Modify: `src/services/planBuilder/commitPlan.ts:156-194` (bloque `if (errors.length === 0)`)
- Test: `src/services/planBuilder/__tests__/commitPlanQualityReview.test.ts` (NEW)

- [ ] **Step 1: Escribir el test failing**

Crear `src/services/planBuilder/__tests__/commitPlanQualityReview.test.ts`. Sigue el patrón de `src/services/__tests__/commitPlan.test.ts` para inicializar Dexie, plan, y semanas mock:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../../../db/db'
import { commitPlan } from '../commitPlan'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'

// Helper: ver `commitPlan.test.ts` para `buildPlan(...)` y `buildWeek(...)`.
// Copiar esos helpers aquí, no abstraerlos a un fixture compartido todavía.

describe('commitPlan persists qualityReview', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('writes plan.generationSummary.qualityReview after successful commit', async () => {
    const plan = buildPlan() // status draft, 1 semana
    const week = buildWeek({ status: 'draft' }) // 1 sesión válida

    await db.trainingPlans.put(plan)
    await db.trainingPlanWeeks.put(week)

    const result = await commitPlan(plan, [week])
    expect(result.errors).toEqual([])

    const persisted = await db.trainingPlans.get(plan.id)
    expect(persisted?.status).toBe('active')
    expect(persisted?.generationSummary?.qualityReview).toBeDefined()
    expect(persisted?.generationSummary?.qualityReview?.grade).toMatch(/excellent|good|needs_review|poor/)
    expect(persisted?.generationSummary?.qualityReview?.weeks).toHaveLength(1)
  })

  it('does NOT overwrite qualityReview computed during generation', async () => {
    const plan = buildPlan()
    plan.generationSummary = {
      startedAt: 1, strategy: 'single', completedWeeks: 1,
      failedWeeks: [], totalAttempts: 1,
      qualityReview: {
        score: 42, grade: 'poor', issues: [], weeks: [],
        repairCount: 0, criticalIssueCount: 0, warningCount: 0,
      },
    }
    const week = buildWeek({ status: 'draft' })

    await db.trainingPlans.put(plan)
    await db.trainingPlanWeeks.put(week)

    await commitPlan(plan, [week])
    const persisted = await db.trainingPlans.get(plan.id)
    // commit recomputa el review a partir del estado real, no preserva el viejo.
    expect(persisted?.generationSummary?.qualityReview?.score).not.toBe(42)
  })

  it('does not persist qualityReview when commit fails (errors > 0)', async () => {
    const plan = buildPlan()
    const week = buildWeek({ status: 'pending' }) // pending → readiness error

    await db.trainingPlans.put(plan)
    await db.trainingPlanWeeks.put(week)

    const result = await commitPlan(plan, [week])
    expect(result.errors.length).toBeGreaterThan(0)

    const persisted = await db.trainingPlans.get(plan.id)
    expect(persisted?.generationSummary?.qualityReview).toBeUndefined()
  })
})
```

(Si `buildPlan` y `buildWeek` no se reusan del test existente, copia los helpers concretos de `src/services/__tests__/commitPlan.test.ts` al principio del archivo nuevo.)

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/commitPlanQualityReview.test.ts`
Expected: el primer test FALLA porque `qualityReview` está `undefined`.

- [ ] **Step 3: Importar `reviewPlanQuality` en `commitPlan.ts`**

En `src/services/planBuilder/commitPlan.ts`, top del archivo:

```ts
import { reviewPlanQuality } from './qualityReview'
```

- [ ] **Step 4: Calcular el review antes del transaction de Dexie**

Reemplazar el bloque `if (errors.length === 0) { ... }` (líneas 156-194 aprox) por:

```ts
if (errors.length === 0) {
  const nowTs = Date.now()
  const nextWeeksPreview = orderedWeeks.map((w) => ({
    ...w,
    status: acceptedWeeks.includes(w.weekIndex) ? ('accepted' as const) : w.status,
    updatedAt: nowTs,
  }))
  const qualityReview = reviewPlanQuality(plan, nextWeeksPreview)
  const nextPlan: TrainingPlan = {
    ...plan,
    status: 'active',
    acceptedAt: nowTs,
    updatedAt: nowTs,
    generationSummary: plan.generationSummary
      ? {
        ...plan.generationSummary,
        acceptedAt: plan.generationSummary.acceptedAt ?? nowTs,
        qualityReview,
      }
      : {
        startedAt: plan.createdAt,
        strategy: 'single',
        completedWeeks: orderedWeeks.length,
        failedWeeks: [],
        totalAttempts: orderedWeeks.length,
        acceptedAt: nowTs,
        qualityReview,
      },
  }
  const nextWeeks = nextWeeksPreview
  try {
    await db.transaction('rw', db.trainingPlans, db.trainingPlanWeeks, async () => {
      await db.trainingPlans.put(nextPlan)
      await Promise.all(nextWeeks.map((w) => db.trainingPlanWeeks.put(w)))
    })
  } catch (error) {
    if (appliedSnapshots.length > 0) {
      await restoreWeekCommitSnapshots(appliedSnapshots)
      warnings.push(`Se revirtieron ${appliedSnapshots.length} semanas afectadas porque no se pudo activar el plan.`)
      acceptedWeeks.length = 0
    }
    const msg = error instanceof Error ? error.message : String(error)
    errors.push(`No se pudo activar el plan: ${msg}`)
    return { errors, warnings, acceptedWeeks }
  }
  void syncService.pushTrainingPlan(nextPlan)
  void syncService.pushTrainingPlanWeeks(nextPlan, nextWeeks.filter((week) => week.status === 'accepted'))
}
```

Notas:
- Si `plan.generationSummary` viene `undefined` (planes legacy), construimos uno mínimo. Esto cubre el camino del plan builder histórico que no setea `generationSummary` hasta este punto.
- El review se computa con los `nextWeeksPreview` para reflejar los estados post-commit, no el snapshot pre-commit.

- [ ] **Step 5: Correr los tests**

Run: `npx vitest run src/services/planBuilder/__tests__/commitPlanQualityReview.test.ts`
Expected: 3 PASS.

Run: `npx vitest run src/services/__tests__/commitPlan.test.ts`
Expected: ningún test pre-existente roto.

- [ ] **Step 6: NO-OP commit**

---

## Task 4: Componente `PlanQualityBadge`

**Files:**
- Create: `src/components/planBuilder/PlanQualityBadge.tsx`
- Test: `src/components/planBuilder/PlanQualityBadge.test.tsx`

El badge muestra solamente cuando el flag está activo. Es puramente presentacional.

- [ ] **Step 1: Escribir el test failing**

`src/components/planBuilder/PlanQualityBadge.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlanQualityBadge } from './PlanQualityBadge'
import type { PlanQualityReview } from '../../services/planBuilder/qualityReview'

const review: PlanQualityReview = {
  score: 81,
  grade: 'good',
  issues: [],
  weeks: [
    { weekIndex: 0, weekStartDate: '2026-06-01', score: 90, grade: 'excellent', issues: [], repairCount: 0 },
    { weekIndex: 1, weekStartDate: '2026-06-08', score: 72, grade: 'needs_review', issues: [
      { severity: 'warning', code: 'demo', message: 'demo issue' },
    ], repairCount: 1 },
  ],
  repairCount: 1,
  criticalIssueCount: 0,
  warningCount: 1,
}

describe('PlanQualityBadge', () => {
  beforeEach(() => {
    Object.assign(import.meta.env, { VITE_SHOW_PLAN_QUALITY: 'true', PROD: false })
  })
  afterEach(() => {
    Object.assign(import.meta.env, { VITE_SHOW_PLAN_QUALITY: undefined })
  })

  it('renders global grade when flag is on', () => {
    render(<PlanQualityBadge review={review} />)
    expect(screen.getByText(/good/i)).toBeInTheDocument()
    expect(screen.getByText(/81/)).toBeInTheDocument()
  })

  it('renders nothing when flag is off', () => {
    Object.assign(import.meta.env, { VITE_SHOW_PLAN_QUALITY: undefined })
    const { container } = render(<PlanQualityBadge review={review} />)
    expect(container.firstChild).toBeNull()
  })

  it('expands per-week scores on click', async () => {
    const { user } = renderWithUser(<PlanQualityBadge review={review} />) // helper local — copiar de tests existentes
    await user.click(screen.getByRole('button', { name: /detalle/i }))
    expect(screen.getByText(/Semana 1/i)).toBeInTheDocument()
    expect(screen.getByText(/Semana 2/i)).toBeInTheDocument()
    expect(screen.getByText(/needs_review/i)).toBeInTheDocument()
  })
})

function renderWithUser(ui: React.ReactElement) {
  const { default: userEvent } = require('@testing-library/user-event') as typeof import('@testing-library/user-event')
  return { ...render(ui), user: userEvent.setup() }
}
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/components/planBuilder/PlanQualityBadge.test.tsx`
Expected: FAIL "Cannot find module './PlanQualityBadge'".

- [ ] **Step 3: Implementar el componente**

`src/components/planBuilder/PlanQualityBadge.tsx`:

```tsx
import { useState } from 'react'
import { shouldShowPlanQuality } from '../../services/ai/showPlanQualityFlag'
import type { PlanQualityReview, PlanQualityGrade } from '../../services/planBuilder/qualityReview'

interface Props {
  review: PlanQualityReview
}

const GRADE_LABELS: Record<PlanQualityGrade, string> = {
  excellent: 'excellent',
  good: 'good',
  needs_review: 'needs_review',
  poor: 'poor',
}

const GRADE_TONE: Record<PlanQualityGrade, string> = {
  excellent: 'bg-emerald-100 text-emerald-800',
  good: 'bg-sky-100 text-sky-800',
  needs_review: 'bg-amber-100 text-amber-800',
  poor: 'bg-rose-100 text-rose-800',
}

export function PlanQualityBadge({ review }: Props) {
  const [open, setOpen] = useState(false)
  if (!shouldShowPlanQuality()) return null

  return (
    <section
      className="rounded-md border border-dashed border-zinc-300 bg-zinc-50/50 p-3 text-xs"
      data-testid="plan-quality-badge"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 font-medium ${GRADE_TONE[review.grade]}`}>
            {GRADE_LABELS[review.grade]}
          </span>
          <span className="text-zinc-700">score {review.score}</span>
          {review.repairCount > 0 && <span className="text-zinc-500">· {review.repairCount} reparaciones</span>}
          {review.criticalIssueCount > 0 && (
            <span className="text-rose-700">· {review.criticalIssueCount} críticos</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-zinc-500 underline-offset-2 hover:underline"
          aria-expanded={open}
        >
          {open ? 'ocultar detalle' : 'ver detalle'}
        </button>
      </header>
      {open && (
        <ul className="mt-2 space-y-1">
          {review.weeks.map((week) => (
            <li key={week.weekIndex} className="flex items-baseline gap-2">
              <span className="font-medium text-zinc-700">Semana {week.weekIndex + 1}</span>
              <span className={`rounded px-1.5 py-0.5 ${GRADE_TONE[week.grade]}`}>{week.grade}</span>
              <span className="text-zinc-500">score {week.score}</span>
              {week.issues.length > 0 && (
                <span className="text-zinc-500">· {week.issues.length} issue(s)</span>
              )}
              {week.repairCount > 0 && (
                <span className="text-zinc-500">· {week.repairCount} reparaciones</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/components/planBuilder/PlanQualityBadge.test.tsx`
Expected: 3 PASS.

- [ ] **Step 5: NO-OP commit**

---

## Task 5: Renderizar `PlanQualityBadge` en `CompetitionPlanPage`

**Files:**
- Modify: `src/pages/CompetitionPlanPage.tsx`

- [ ] **Step 1: Localizar el header del plan**

Run: `grep -n "generationSummary\|generationState\|Plan aceptado\|<header" src/pages/CompetitionPlanPage.tsx | head -20` para encontrar dónde se renderiza el resumen del plan.

- [ ] **Step 2: Importar el componente**

Top del archivo:

```tsx
import { PlanQualityBadge } from '../components/planBuilder/PlanQualityBadge'
```

- [ ] **Step 3: Renderizar bajo el título del plan**

Dentro del JSX, justo después de la cabecera principal (donde ya se muestra título, fechas, fase) y antes del listado de semanas, añadir:

```tsx
{plan.generationSummary?.qualityReview && (
  <div className="mt-3">
    <PlanQualityBadge review={plan.generationSummary.qualityReview} />
  </div>
)}
```

El badge se autoencubre si el flag está off, así que no hay que envolverlo en otra condición.

- [ ] **Step 4: Test manual rápido**

Run: `VITE_SHOW_PLAN_QUALITY=true npm run dev` → abrir un plan activo. Confirmar que aparece el badge. Quitar el env var → confirmar que desaparece tras recargar.

(No es un test automatizado: las pruebas E2E del plan builder ya cubren el resto del flujo.)

- [ ] **Step 5: NO-OP commit**

---

## Task 6: Exportar `generateSingleWeekWithRetry` desde `generatePlan.ts`

**Files:**
- Modify: `src/services/planBuilder/generatePlan.ts:265`

Hoy la función es local del módulo. La regeneración la necesita.

- [ ] **Step 1: Test de import**

`src/services/planBuilder/__tests__/generatePlanExports.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

describe('generatePlan exports', () => {
  it('exports generateSingleWeekWithRetry for regenerate path', async () => {
    const mod = await import('../generatePlan')
    expect(typeof (mod as Record<string, unknown>).generateSingleWeekWithRetry).toBe('function')
  })
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/planBuilder/__tests__/generatePlanExports.test.ts`
Expected: FAIL.

- [ ] **Step 3: Agregar `export`**

En `src/services/planBuilder/generatePlan.ts` línea 265, cambiar:

```ts
async function generateSingleWeekWithRetry(
```

por:

```ts
export async function generateSingleWeekWithRetry(
```

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/planBuilder/__tests__/generatePlanExports.test.ts`
Expected: PASS.

- [ ] **Step 5: NO-OP commit**

---

## Task 7: Servicio `regeneratePlanWeek`

**Files:**
- Create: `src/services/planBuilder/regeneratePlanWeek.ts`
- Test: `src/services/planBuilder/__tests__/regeneratePlanWeek.test.ts`

Contrato:

```ts
interface RegeneratePlanWeekInput {
  plan: TrainingPlan
  week: TrainingPlanWeek          // semana actualmente 'accepted'
  previousWeek?: TrainingPlanWeek // semana N-1 (puede ser undefined si es la primera)
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  abortSignal?: AbortSignal
}

interface RegeneratePlanWeekResult {
  status: 'replaced' | 'failed'
  week?: TrainingPlanWeek         // si replaced
  errors: string[]
  warnings: string[]
}
```

Flujo:

1. Validar `week.status === 'accepted'`. Si no, devolver error.
2. Capturar snapshot de las sesiones actuales para esa semana (reutiliza la lógica de `commitPlan.captureWeekCommitSnapshot` — extraerla a helper compartido en este task).
3. Marcar semana como `'regenerating'` en Dexie (`db.trainingPlanWeeks.put({...week, status: 'regenerating', updatedAt: nowTs})`).
4. Llamar `generateSingleWeekWithRetry` con `previousWeek`.
5. Si el resultado vuelve vacío o solo fallback: restaurar snapshot, marcar la semana como `accepted` de nuevo (sin cambios), devolver `status: 'failed'`.
6. Si vino con sesiones reales: borrar sesiones actuales del rango, aplicar las nuevas vía `applyCreateWeek`, marcar semana como `accepted` con `regenerationMeta` actualizado.
7. Recomputar `reviewPlanQuality` del plan completo y persistirlo en `plan.generationSummary.qualityReview`.

- [ ] **Step 1: Extraer helper de snapshot a un módulo compartido**

Crear `src/services/planBuilder/weekSnapshot.ts`:

```ts
import { addDays } from 'date-fns'
import type { Session, WeekSummary } from '../../types'
import type { TrainingPlanWeek } from '../../types/planBuilder'
import { db } from '../../db/db'
import { getWeekSummary } from '../../db/queries'
import * as syncService from '../syncService'
import { useTrainingStore } from '../../store/useTrainingStore'
import { fromISO, toISO } from '../../utils/date'

export interface WeekCommitSnapshot {
  weekIndex: number
  weekStartDate: string
  sessions: Session[]
  summary: WeekSummary | null
}

function getWeekEndDate(weekStartDate: string): string {
  return toISO(addDays(fromISO(weekStartDate), 6))
}

export async function captureWeekCommitSnapshot(week: TrainingPlanWeek): Promise<WeekCommitSnapshot> {
  const sessions = await db.sessions
    .where('date')
    .between(week.weekStartDate, getWeekEndDate(week.weekStartDate), true, true)
    .toArray()
  const summary = await getWeekSummary(week.weekStartDate)
  return {
    weekIndex: week.weekIndex,
    weekStartDate: week.weekStartDate,
    sessions: sessions.map((s) => ({ ...s })),
    summary: summary ? { ...summary } : null,
  }
}

export async function restoreWeekCommitSnapshots(snapshots: WeekCommitSnapshot[]): Promise<void> {
  const trainingStore = useTrainingStore.getState()
  const affectedWeekStarts = new Set<string>()

  for (const snapshot of [...snapshots].reverse()) {
    const currentSessions = await db.sessions
      .where('date')
      .between(snapshot.weekStartDate, getWeekEndDate(snapshot.weekStartDate), true, true)
      .toArray()
    const snapshotIds = new Set(snapshot.sessions.map((s) => s.id))

    for (const session of currentSessions) {
      if (snapshotIds.has(session.id)) continue
      await db.sessions.delete(session.id)
      void syncService.deleteSession(session.id)
    }

    for (const session of snapshot.sessions) {
      await db.sessions.put(session)
      void syncService.pushSession(session)
    }

    const currentSummary = await getWeekSummary(snapshot.weekStartDate)
    if (snapshot.summary) {
      await db.weekSummaries.put(snapshot.summary)
      void syncService.pushWeekSummary(snapshot.summary)
    } else if (currentSummary) {
      await db.weekSummaries.delete(currentSummary.id)
    }
    affectedWeekStarts.add(snapshot.weekStartDate)
  }

  if (trainingStore.loadedWeekStart && affectedWeekStarts.has(trainingStore.loadedWeekStart)) {
    await trainingStore.loadWeek(trainingStore.loadedWeekStart)
  }
  await trainingStore.loadAllSummaries()
}
```

- [ ] **Step 2: Refactor `commitPlan.ts` para reusar el helper**

En `src/services/planBuilder/commitPlan.ts`, eliminar las funciones locales `captureWeekCommitSnapshot` y `restoreWeekCommitSnapshots`, y importarlas:

```ts
import { captureWeekCommitSnapshot, restoreWeekCommitSnapshots, type WeekCommitSnapshot } from './weekSnapshot'
```

Run: `npx vitest run src/services/__tests__/commitPlan.test.ts src/services/planBuilder/__tests__/commitPlanQualityReview.test.ts`
Expected: todo verde. Si rompe, revisar imports.

- [ ] **Step 3: Escribir tests de `regeneratePlanWeek`**

`src/services/planBuilder/__tests__/regeneratePlanWeek.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../../../db/db'
import { regeneratePlanWeek } from '../regeneratePlanWeek'
import * as generatePlan from '../generatePlan'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'

// Copiar helpers buildPlan / buildWeek de commitPlanQualityReview.test.ts.

describe('regeneratePlanWeek', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    vi.restoreAllMocks()
  })

  it('replaces sessions when generation succeeds', async () => {
    const plan = buildPlan({ status: 'active' })
    const week = buildWeek({ status: 'accepted', weekIndex: 1 })
    const previousWeek = buildWeek({ status: 'accepted', weekIndex: 0 })

    await db.trainingPlans.put(plan)
    await db.trainingPlanWeeks.bulkPut([previousWeek, week])

    vi.spyOn(generatePlan, 'generateSingleWeekWithRetry').mockResolvedValue({
      ...week,
      sessions: [
        // sesión nueva válida
        buildSessionProposal({ id: 'new-1' }),
      ],
      status: 'draft',
      generationMeta: { ...week.generationMeta, fallbackUsed: false } as any,
    } as TrainingPlanWeek)

    const result = await regeneratePlanWeek({
      plan, week, previousWeek,
      profile: buildProfile(), wizardConfig: buildWizardConfig(),
    })

    expect(result.status).toBe('replaced')
    expect(result.week?.status).toBe('accepted')
    expect(result.week?.regenerationMeta?.attempts).toBe(1)
    expect(result.week?.sessions.map((s) => s.id)).toContain('new-1')

    const persistedPlan = await db.trainingPlans.get(plan.id)
    expect(persistedPlan?.generationSummary?.qualityReview).toBeDefined()
  })

  it('rolls back to snapshot when generation falls back', async () => {
    const plan = buildPlan({ status: 'active' })
    const week = buildWeek({ status: 'accepted', weekIndex: 0 })
    const originalSessionIds = week.sessions.map((s) => s.id)

    await db.trainingPlans.put(plan)
    await db.trainingPlanWeeks.put(week)

    vi.spyOn(generatePlan, 'generateSingleWeekWithRetry').mockResolvedValue({
      ...week,
      sessions: [],
      generationMeta: { ...week.generationMeta, fallbackUsed: true } as any,
    } as TrainingPlanWeek)

    const result = await regeneratePlanWeek({
      plan, week, previousWeek: undefined,
      profile: buildProfile(), wizardConfig: buildWizardConfig(),
    })

    expect(result.status).toBe('failed')
    const persistedWeek = await db.trainingPlanWeeks.get(week.id)
    expect(persistedWeek?.status).toBe('accepted')
    expect(persistedWeek?.sessions.map((s) => s.id)).toEqual(originalSessionIds)
  })

  it('rejects when week is not accepted', async () => {
    const week = buildWeek({ status: 'draft' })
    const plan = buildPlan({ status: 'active' })

    const result = await regeneratePlanWeek({
      plan, week, previousWeek: undefined,
      profile: buildProfile(), wizardConfig: buildWizardConfig(),
    })
    expect(result.status).toBe('failed')
    expect(result.errors[0]).toMatch(/aceptada/i)
  })
})
```

(`buildSessionProposal`, `buildProfile`, `buildWizardConfig`: copiar de fixtures existentes en `src/services/__tests__/`.)

- [ ] **Step 4: Verificar fail**

Run: `npx vitest run src/services/planBuilder/__tests__/regeneratePlanWeek.test.ts`
Expected: FAIL ("Cannot find module").

- [ ] **Step 5: Implementar `regeneratePlanWeek.ts`**

`src/services/planBuilder/regeneratePlanWeek.ts`:

```ts
import { addDays } from 'date-fns'
import type { AthleteProfile } from '../../types'
import type { TrainingPlan, TrainingPlanWeek, PlanWizardConfig } from '../../types/planBuilder'
import { db } from '../../db/db'
import { useTrainingStore } from '../../store/useTrainingStore'
import * as syncService from '../syncService'
import { fromISO, toISO } from '../../utils/date'
import { applyCreateWeek } from '../planning/applyCreateWeek'
import { generateSingleWeekWithRetry } from './generatePlan'
import { reviewPlanQuality } from './qualityReview'
import { captureWeekCommitSnapshot, restoreWeekCommitSnapshots } from './weekSnapshot'
import { getActiveProvider } from '../ai/getActiveProvider'

export interface RegeneratePlanWeekInput {
  plan: TrainingPlan
  week: TrainingPlanWeek
  previousWeek?: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  abortSignal?: AbortSignal
}

export interface RegeneratePlanWeekResult {
  status: 'replaced' | 'failed'
  week?: TrainingPlanWeek
  errors: string[]
  warnings: string[]
}

function getWeekEndDate(weekStartDate: string): string {
  return toISO(addDays(fromISO(weekStartDate), 6))
}

export async function regeneratePlanWeek(
  input: RegeneratePlanWeekInput,
): Promise<RegeneratePlanWeekResult> {
  const { plan, week, previousWeek, profile, wizardConfig, abortSignal } = input
  const errors: string[] = []
  const warnings: string[] = []

  if (week.status !== 'accepted') {
    errors.push(`Solo se puede regenerar una semana aceptada (estado actual ${week.status}).`)
    return { status: 'failed', errors, warnings }
  }

  const snapshot = await captureWeekCommitSnapshot(week)
  const nowTs = Date.now()
  await db.trainingPlanWeeks.put({ ...week, status: 'regenerating', updatedAt: nowTs })

  try {
    const provider = getActiveProvider() // Phase 3 no toca provider routing
    const regenerated = await generateSingleWeekWithRetry(
      provider, plan, week, previousWeek, profile, wizardConfig, undefined,
    )

    if (regenerated.sessions.length === 0 || regenerated.generationMeta?.fallbackUsed) {
      // Restaurar snapshot y mantener el estado aceptado anterior.
      await restoreWeekCommitSnapshots([snapshot])
      await db.trainingPlanWeeks.put({ ...week, status: 'accepted', updatedAt: nowTs })
      errors.push('La regeneración no produjo una semana de IA válida. Se mantuvo la semana anterior.')
      return { status: 'failed', errors, warnings }
    }

    if (abortSignal?.aborted) {
      await restoreWeekCommitSnapshots([snapshot])
      await db.trainingPlanWeeks.put({ ...week, status: 'accepted', updatedAt: nowTs })
      errors.push('Regeneración cancelada.')
      return { status: 'failed', errors, warnings }
    }

    // Borrar sesiones actuales del rango.
    const startDate = week.weekStartDate
    const endDate = getWeekEndDate(week.weekStartDate)
    const currentSessions = await db.sessions
      .where('date').between(startDate, endDate, true, true).toArray()
    for (const session of currentSessions) {
      await db.sessions.delete(session.id)
      void syncService.deleteSession(session.id)
    }

    const trainingStore = useTrainingStore.getState()
    const applyResult = await applyCreateWeek({
      sessions: regenerated.sessions,
      weekObjectives: regenerated.weekObjectives.map((o) => o.goal),
      athleteProfile: profile,
      store: trainingStore,
    })
    warnings.push(...applyResult.warnings)

    const previousAttempts = week.regenerationMeta?.attempts ?? 0
    const nextWeek: TrainingPlanWeek = {
      ...regenerated,
      id: week.id,
      planId: week.planId,
      status: 'accepted',
      updatedAt: nowTs,
      regenerationMeta: {
        attempts: previousAttempts + 1,
        lastRegeneratedAt: nowTs,
        previousFallbackUsed: week.generationMeta?.fallbackUsed,
      },
    }

    // Persistir la semana actualizada.
    await db.trainingPlanWeeks.put(nextWeek)

    // Recomputar quality review del plan completo.
    const allWeeks = await db.trainingPlanWeeks
      .where('planId').equals(plan.id).toArray()
    const orderedWeeks = allWeeks.sort((a, b) => a.weekIndex - b.weekIndex)
    const qualityReview = reviewPlanQuality(plan, orderedWeeks)

    const nextPlan: TrainingPlan = {
      ...plan,
      updatedAt: nowTs,
      generationSummary: plan.generationSummary
        ? { ...plan.generationSummary, qualityReview }
        : {
          startedAt: plan.createdAt,
          strategy: 'single',
          completedWeeks: orderedWeeks.length,
          failedWeeks: [],
          totalAttempts: orderedWeeks.length,
          acceptedAt: plan.acceptedAt,
          qualityReview,
        },
    }
    await db.trainingPlans.put(nextPlan)

    void syncService.pushTrainingPlan(nextPlan)
    void syncService.pushTrainingPlanWeeks(nextPlan, [nextWeek])

    return { status: 'replaced', week: nextWeek, errors, warnings }
  } catch (error) {
    await restoreWeekCommitSnapshots([snapshot])
    await db.trainingPlanWeeks.put({ ...week, status: 'accepted', updatedAt: nowTs })
    const msg = error instanceof Error ? error.message : String(error)
    errors.push(`Regeneración falló: ${msg}`)
    return { status: 'failed', errors, warnings }
  }
}
```

- [ ] **Step 6: Verificar pass**

Run: `npx vitest run src/services/planBuilder/__tests__/regeneratePlanWeek.test.ts`
Expected: 3 PASS.

- [ ] **Step 7: NO-OP commit**

---

## Task 8: Componente `RegenerateWeekButton` con confirmación

**Files:**
- Create: `src/components/planBuilder/RegenerateWeekButton.tsx`
- Test: `src/components/planBuilder/RegenerateWeekButton.test.tsx`

Comportamiento:
- No renderiza si `shouldShowPlanQuality()` retorna false.
- Click abre modal con título "Regenerar semana N", lista las sesiones actuales (resumen), y un botón "Confirmar y reemplazar".
- Loading state mientras corre.
- Muestra errors/warnings devueltos.

- [ ] **Step 1: Escribir test failing**

`src/components/planBuilder/RegenerateWeekButton.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegenerateWeekButton } from './RegenerateWeekButton'

const onRegenerate = vi.fn()

const baseProps = {
  weekIndex: 2,
  weekStartDate: '2026-06-15',
  sessionCount: 5,
  isRegenerating: false,
  onRegenerate,
}

describe('RegenerateWeekButton', () => {
  beforeEach(() => {
    onRegenerate.mockReset().mockResolvedValue({ status: 'replaced', errors: [], warnings: [] })
    Object.assign(import.meta.env, { VITE_SHOW_PLAN_QUALITY: 'true', PROD: false })
  })
  afterEach(() => {
    Object.assign(import.meta.env, { VITE_SHOW_PLAN_QUALITY: undefined })
  })

  it('renders nothing when flag is off', () => {
    Object.assign(import.meta.env, { VITE_SHOW_PLAN_QUALITY: undefined })
    const { container } = render(<RegenerateWeekButton {...baseProps} />)
    expect(container.firstChild).toBeNull()
  })

  it('opens confirmation modal on click', async () => {
    const user = userEvent.setup()
    render(<RegenerateWeekButton {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /regenerar/i }))
    expect(screen.getByText(/reemplazar/i)).toBeInTheDocument()
    expect(screen.getByText(/Semana 3/i)).toBeInTheDocument()
  })

  it('calls onRegenerate after confirmation', async () => {
    const user = userEvent.setup()
    render(<RegenerateWeekButton {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /regenerar/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledTimes(1))
  })

  it('shows errors returned by onRegenerate', async () => {
    onRegenerate.mockResolvedValue({ status: 'failed', errors: ['boom'], warnings: [] })
    const user = userEvent.setup()
    render(<RegenerateWeekButton {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /regenerar/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(await screen.findByText(/boom/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/components/planBuilder/RegenerateWeekButton.test.tsx`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implementar**

`src/components/planBuilder/RegenerateWeekButton.tsx`:

```tsx
import { useState } from 'react'
import { shouldShowPlanQuality } from '../../services/ai/showPlanQualityFlag'

export interface RegenerateResult {
  status: 'replaced' | 'failed'
  errors: string[]
  warnings: string[]
}

interface Props {
  weekIndex: number
  weekStartDate: string
  sessionCount: number
  isRegenerating: boolean
  onRegenerate: () => Promise<RegenerateResult>
}

export function RegenerateWeekButton({
  weekIndex, weekStartDate, sessionCount, isRegenerating, onRegenerate,
}: Props) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<RegenerateResult | null>(null)
  const [pending, setPending] = useState(false)

  if (!shouldShowPlanQuality()) return null

  const confirm = async () => {
    setPending(true)
    setResult(null)
    try {
      const r = await onRegenerate()
      setResult(r)
      if (r.status === 'replaced') {
        setOpen(false)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setResult(null) }}
        disabled={isRegenerating || pending}
        className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100 disabled:opacity-50"
      >
        {pending || isRegenerating ? 'Regenerando…' : 'Regenerar semana'}
      </button>
      {open && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-md bg-white p-4 shadow-lg">
            <h2 className="text-sm font-semibold">Regenerar Semana {weekIndex + 1}</h2>
            <p className="mt-2 text-xs text-zinc-600">
              Semana del {weekStartDate}. Esto reemplazará las {sessionCount} sesiones aceptadas con una nueva
              versión generada por la IA. No se puede deshacer automáticamente.
            </p>
            {result?.errors.length ? (
              <ul className="mt-2 list-disc rounded bg-rose-50 p-2 pl-5 text-xs text-rose-800">
                {result.errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            ) : null}
            {result?.warnings.length ? (
              <ul className="mt-2 list-disc rounded bg-amber-50 p-2 pl-5 text-xs text-amber-800">
                {result.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded border border-zinc-300 px-3 py-1 text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={pending}
                className="rounded bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {pending ? 'Regenerando…' : 'Confirmar y reemplazar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/components/planBuilder/RegenerateWeekButton.test.tsx`
Expected: 4 PASS.

- [ ] **Step 5: NO-OP commit**

---

## Task 9: Cablear `RegenerateWeekButton` en `CompetitionPlanPage`

**Files:**
- Modify: `src/pages/CompetitionPlanPage.tsx`

- [ ] **Step 1: Identificar el render por semana**

Run: `grep -n "TrainingPlanWeek\|week.sessions\|weekIndex" src/pages/CompetitionPlanPage.tsx | head -20`

- [ ] **Step 2: Importar el botón y el servicio**

```tsx
import { RegenerateWeekButton } from '../components/planBuilder/RegenerateWeekButton'
import { regeneratePlanWeek } from '../services/planBuilder/regeneratePlanWeek'
```

- [ ] **Step 3: Render por semana**

Dentro del loop que renderiza cada semana del plan, añadir junto al header de la semana:

```tsx
<RegenerateWeekButton
  weekIndex={week.weekIndex}
  weekStartDate={week.weekStartDate}
  sessionCount={week.sessions.length}
  isRegenerating={week.status === 'regenerating'}
  onRegenerate={async () => {
    const previousWeek = allWeeks.find((w) => w.weekIndex === week.weekIndex - 1)
    const result = await regeneratePlanWeek({
      plan,
      week,
      previousWeek,
      profile: athleteProfile,
      wizardConfig: plan.wizardConfig,
    })
    if (result.status === 'replaced') {
      await reloadPlan() // función ya existente que recarga `plan` y `allWeeks`
    }
    return result
  }}
/>
```

(Si la página todavía no tiene `reloadPlan` ni `allWeeks`, identificar el patrón actual que recarga el plan después de un commit y reutilizarlo. No introducir un store nuevo.)

- [ ] **Step 4: Test manual rápido**

Run: `VITE_SHOW_PLAN_QUALITY=true npm run dev`. Abrir un plan activo, click en "Regenerar semana", confirmar, verificar que las sesiones se actualizan en pantalla y que el badge global recalcula.

- [ ] **Step 5: NO-OP commit**

---

## Task 10: Rollup de planes para Beta Quality

**Files:**
- Create: `src/services/planBuilder/betaQualityPlanRollup.ts`
- Test: `src/services/planBuilder/__tests__/betaQualityPlanRollup.test.ts`

El rollup combina cada plan en Dexie con los `recentRequests` (que ya existen en el snapshot) por trace para reportar "N/M semanas de IA, K fallback, score global".

- [ ] **Step 1: Test failing**

`src/services/planBuilder/__tests__/betaQualityPlanRollup.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import { rollupPlansForBetaQuality } from '../betaQualityPlanRollup'
// Reusa buildPlan / buildWeek helpers.

describe('rollupPlansForBetaQuality', () => {
  beforeEach(async () => { await db.delete(); await db.open() })

  it('emits one entry per plan with ai vs fallback counts and quality grade', async () => {
    const plan = buildPlan({ status: 'active' })
    plan.generationSummary = {
      startedAt: 1, strategy: 'single', completedWeeks: 2,
      failedWeeks: [], totalAttempts: 2,
      qualityReview: { score: 80, grade: 'good', issues: [], weeks: [], repairCount: 0, criticalIssueCount: 0, warningCount: 0 },
    }
    const weekAi = buildWeek({ weekIndex: 0, status: 'accepted' })
    weekAi.generationMeta = { ...(weekAi.generationMeta ?? {} as any), fallbackUsed: false } as any
    const weekFallback = buildWeek({ weekIndex: 1, status: 'accepted' })
    weekFallback.generationMeta = { ...(weekFallback.generationMeta ?? {} as any), fallbackUsed: true } as any

    await db.trainingPlans.put(plan)
    await db.trainingPlanWeeks.bulkPut([weekAi, weekFallback])

    const rollup = await rollupPlansForBetaQuality()
    expect(rollup).toHaveLength(1)
    expect(rollup[0]).toMatchObject({
      planId: plan.id,
      aiWeekCount: 1,
      fallbackWeekCount: 1,
      totalWeeks: 2,
      grade: 'good',
      score: 80,
    })
  })

  it('handles plans without qualityReview gracefully', async () => {
    const plan = buildPlan({ status: 'draft' })
    await db.trainingPlans.put(plan)
    const rollup = await rollupPlansForBetaQuality()
    expect(rollup[0].grade).toBeNull()
    expect(rollup[0].score).toBeNull()
  })
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/planBuilder/__tests__/betaQualityPlanRollup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/services/planBuilder/betaQualityPlanRollup.ts`:

```ts
import { db } from '../../db/db'
import type { PlanQualityGrade } from './qualityReview'

export interface PlanBetaQualityEntry {
  planId: string
  title: string
  status: string
  totalWeeks: number
  aiWeekCount: number
  fallbackWeekCount: number
  regeneratedWeekCount: number
  grade: PlanQualityGrade | null
  score: number | null
  criticalIssueCount: number
  warningCount: number
  acceptedAt: number | null
  updatedAt: number
}

export async function rollupPlansForBetaQuality(): Promise<PlanBetaQualityEntry[]> {
  const plans = await db.trainingPlans.toArray()
  const result: PlanBetaQualityEntry[] = []
  for (const plan of plans) {
    const weeks = await db.trainingPlanWeeks.where('planId').equals(plan.id).toArray()
    const aiWeekCount = weeks.filter((w) => !w.generationMeta?.fallbackUsed).length
    const fallbackWeekCount = weeks.length - aiWeekCount
    const regeneratedWeekCount = weeks.filter((w) => (w.regenerationMeta?.attempts ?? 0) > 0).length
    const review = plan.generationSummary?.qualityReview
    result.push({
      planId: plan.id,
      title: plan.title,
      status: plan.status,
      totalWeeks: weeks.length,
      aiWeekCount,
      fallbackWeekCount,
      regeneratedWeekCount,
      grade: review?.grade ?? null,
      score: review?.score ?? null,
      criticalIssueCount: review?.criticalIssueCount ?? 0,
      warningCount: review?.warningCount ?? 0,
      acceptedAt: plan.acceptedAt ?? null,
      updatedAt: plan.updatedAt,
    })
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt)
}
```

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/planBuilder/__tests__/betaQualityPlanRollup.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: NO-OP commit**

---

## Task 11: Mostrar rollup en `SettingsPage` → Beta Quality

**Files:**
- Modify: `src/pages/SettingsPage.tsx` (subsección Beta Quality, ~ línea 700)

- [ ] **Step 1: Importar el rollup**

Top del archivo:

```tsx
import { rollupPlansForBetaQuality, type PlanBetaQualityEntry } from '../services/planBuilder/betaQualityPlanRollup'
```

- [ ] **Step 2: State y carga**

En el componente `SettingsPage`:

```tsx
const [planRollup, setPlanRollup] = useState<PlanBetaQualityEntry[]>([])
const refreshPlanRollup = useCallback(async () => {
  setPlanRollup(await rollupPlansForBetaQuality())
}, [])
useEffect(() => { void refreshPlanRollup() }, [refreshPlanRollup, aiDebugRequests.length])
```

(`aiDebugRequests.length` ya está siendo usado como trigger de `refreshBetaQualitySnapshot`. Reusar la misma dependencia.)

- [ ] **Step 3: Render**

Dentro del bloque Beta Quality (cerca de la línea 706), después del botón "Exportar", añadir:

```tsx
<section className="mt-4 rounded border border-zinc-200 p-3">
  <header className="flex items-center justify-between">
    <h3 className="text-sm font-semibold">Planes generados</h3>
    <button
      type="button"
      onClick={() => void refreshPlanRollup()}
      className="text-xs text-zinc-500 hover:underline"
    >
      Recargar
    </button>
  </header>
  {planRollup.length === 0 ? (
    <p className="mt-2 text-xs text-zinc-500">No hay planes generados.</p>
  ) : (
    <ul className="mt-2 space-y-2">
      {planRollup.map((entry) => (
        <li key={entry.planId} className="rounded bg-zinc-50 p-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium">{entry.title}</span>
            <span className="text-zinc-500">{entry.status}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-zinc-700">
            <span>{entry.aiWeekCount}/{entry.totalWeeks} IA</span>
            {entry.fallbackWeekCount > 0 && (
              <span className="text-amber-700">{entry.fallbackWeekCount} fallback</span>
            )}
            {entry.regeneratedWeekCount > 0 && (
              <span className="text-sky-700">{entry.regeneratedWeekCount} regeneradas</span>
            )}
            {entry.grade && (
              <span>grade {entry.grade}</span>
            )}
            {entry.score != null && (
              <span>score {entry.score}</span>
            )}
            {entry.criticalIssueCount > 0 && (
              <span className="text-rose-700">{entry.criticalIssueCount} críticos</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  )}
</section>
```

(El bloque no necesita flag-gating porque la vista Settings → Beta Quality ya es interna.)

- [ ] **Step 4: Verificar visual**

Run: `npm run dev`, ir a Settings → Beta Quality, confirmar la nueva sección "Planes generados".

- [ ] **Step 5: NO-OP commit**

---

## Task 12: Hardening + métricas de cierre

**Files:**
- Verificación cruzada, no nuevos archivos.

- [ ] **Step 1: Audit completo**

```bash
npm run lint
npm test
npm run build
npm run audit:prompt
```

Expected: todo verde. Si rompe, leer el error y arreglar (no commitear).

- [ ] **Step 2: Smoke manual: regenerar una semana real**

1. `VITE_SHOW_PLAN_QUALITY=true npm run dev`
2. Generar plan corto (3 semanas) en dev.
3. Aceptarlo. Confirmar que aparece el badge `good`/`needs_review`.
4. Click "Regenerar semana" en la semana 2.
5. Verificar: modal de confirmación, status `regenerating` visible (puede ser fugaz), sesiones reemplazadas, badge global recalculado, `regeneratedWeekCount` en Settings → Beta Quality.

- [ ] **Step 3: Verificar el guard PROD**

```bash
VITE_SHOW_PLAN_QUALITY=true npm run build
```

Cargar el dist en un preview (`npm run preview`) y confirmar que `PlanQualityBadge` y `RegenerateWeekButton` NO renderizan, aunque el env diga `true`.

- [ ] **Step 4: Documentar en `PROJECT_REVIEW_AND_ROADMAP.md`**

Bajo "Mejoras Recientes Detectadas", agregar una subsección "Fase 3 — Trust + observabilidad" con:
- Quality review se persiste en `plan.generationSummary.qualityReview` en `commitPlan` y en `regeneratePlanWeek`.
- UI gated por `VITE_SHOW_PLAN_QUALITY` (forzado off en PROD).
- Settings → Beta Quality muestra rollup de planes (N/M IA vs fallback, score, regeneradas).
- Riesgos pendientes: el rollup se calcula client-side por plan; si Dexie tiene miles de planes la query puede degradarse — paliable con índices ya existentes, evaluar si hace falta paginar.

- [ ] **Step 5: Self-review final**

Releer el spec sección 3.1–3.5 con el código en mano. Verificar punto por punto:

- 3.1 ✅ `commitPlan` corre `reviewPlanQuality` y persiste en `generationSummary.qualityReview` — Task 3.
- 3.1 ✅ UI flag-gated — Tasks 4-5.
- 3.2 ✅ Status `regenerating` — Task 1.
- 3.2 ✅ Reusa `generateSingleWeekWithRetry` — Tasks 6-7.
- 3.2 ✅ Reemplaza sesiones tras confirmación — Tasks 7-8.
- 3.3 ✅ Beta Quality muestra N/M IA vs fallback — Tasks 10-11.
- 3.4 ✅ Tests: `commitPlanQualityReview.test.ts`, `regeneratePlanWeek.test.ts`, `PlanQualityBadge.test.tsx`, `betaQualityPlanRollup.test.ts`.

---

## Métricas de cierre (espejo del spec 3.5)

1. ✅ Cualquier plan aceptado en dev tiene `generationSummary.qualityReview` poblado.
2. ✅ QA puede regenerar una semana específica sin tocar las demás (verificado en smoke Task 12.2).
3. ✅ Cliente beta (build prod) nunca ve "falló la IA" ni badges de fallback (verificado en Task 12.3).
4. ✅ Beta Quality export incluye `qualityReview` por plan (vía `db.trainingPlans` que `dataExport.ts` ya serializa).

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `regeneratePlanWeek` deja la semana en `regenerating` si el proceso crash-ea entre el `put` inicial y el resultado | El `try/catch` final restaura snapshot y marca `accepted`. Si el browser cierra antes, al reabrir la semana queda en `regenerating` huérfana. Añadir en una iteración futura un guard al cargar el plan que revierta `regenerating > 5 min` a `accepted`. **No bloqueante hoy** — el usuario beta puede tocar "Regenerar" otra vez. |
| Quality review se recomputa en cada regenerate, costoso si las semanas crecen | El motor es O(weeks × sessions). Para 12 semanas × 10 sesiones es trivial. No optimizar antes de medir. |
| El usuario beta cambia el flag por error en un build prod | El guard de `import.meta.env.PROD` lo bloquea. Test cubierto en Task 2. |
| `rollupPlansForBetaQuality` lee todas las semanas de todos los planes en cada refresh | Acceptable hasta volumen alto; en el peor caso N planes × ~12 semanas. Si llega a doler, paginar en Task 11 (Phase 4). |

---

## Qué NO hacer en esta fase

- No tocar `promptBuilder.ts` ni los selectores de fuerza/squash.
- No agregar persistencia remota de quality review en Supabase (eso es Fase 4).
- No exponer el badge de fallback al cliente beta — todo lo que se ve es interno por flag.
- No reescribir `qualityReview.ts` ni su scoring.
- No agregar telemetría persistida cross-sesión (Fase 4).
- No tocar sync o auth.
