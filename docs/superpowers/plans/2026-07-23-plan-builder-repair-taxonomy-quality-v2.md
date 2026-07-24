# Repair Taxonomy + Quality v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar hidratación determinística de reparación real en `repairWeek.ts`, implementar una ruta opt-in de scoring `quality_version = 2`, y preservar exactamente el comportamiento y la telemetría legacy de Week Creator.

**Architecture:** Se agrega un módulo nuevo `repairTaxonomy.ts` con contadores por categoría de acción. `RepairMeta` lo incorpora como campo `taxonomy`. Cada sitio de incremento de `repairWeek.ts` pasa por un helper que registra la categoría **además** del contador legacy, que conserva su semántica exacta. `qualityReview.ts` gana una ruta v2 que puntúa sobre la taxonomía; la v1 queda intacta y sigue siendo el default productivo hasta que el Plan 3 calibre divisores y umbral.

**Tech Stack:** TypeScript, Vitest, Zustand/Dexie (no se tocan en este plan).

## Global Constraints

- **`repairedSessionCount` conserva su semántica exacta actual.** Los contadores nuevos son puramente aditivos. Fuente: spec §3.5.
- **`WeekCreatorEngine.ts:826` no cambia de comportamiento.** El retorno temprano exige la tupla legacy completa en cero (`repaired`, `moved`, `addedFallback`, `dropped`, `filtered`), además de no tener cambios de finalización ni warnings de acción. `repairedSessionCount` conserva exactamente su aporte a esa condición.
- **`repairGeneratedWeek` tiene 5 call sites en producción**: `generateWeekCore.ts:201`, `generateWeek.ts:166`, `fallbackWeek.ts:372`, `WeekCreatorLocalHydrator.ts:146`, `WeekCreatorEngine.ts:802`.
- **`hydrationActionCount` nunca entra al score.** Es la regla que define `quality_version = 2`.
- **Unidad de los contadores de taxonomía: acciones atómicas.** Los conteos de sesiones únicas van en campos separados y no puntúan.
- **`countRepairs_v2` = `correctiveActionCount + structuralActionCount + movedSessionCount + droppedSessionCount`.** `filteredSportCount` y `addedFallbackCount` quedan fuera: son subconjuntos de `droppedSessionCount` y de `structuralActionCount` respectivamente.
- **v2 es opt-in en este plan.** La UI y las filas históricas siguen resolviendo v1 por defecto. Este plan no activa un score v2 con `repairPenalty = 0` en producción.
- **Evaluar v2 exige taxonomía v2 completa.** Una llamada explícita con semanas sin `repairTaxonomyVersion = 2` falla; no interpreta ausencia de contadores históricos como cero.
- **La versión de taxonomía y la versión de score son dimensiones distintas.** Nuevas generaciones pueden persistir `repairTaxonomyVersion = 2` mientras `qualityVersion` sigue en 1 hasta la calibración.
- No se agregan dependencias. No se tocan migraciones ni Dexie en este plan.
- Comandos del proyecto: `npm run lint`, `npm test`, `npm run build`.
- Los commits los hace el owner — **no ejecutar `git commit` salvo pedido explícito**. Los pasos de commit quedan documentados para que el owner los ejecute.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/services/planBuilder/repairTaxonomy.ts` (**crear**) | Tipos de categoría, contadores, y el único punto de registro de acciones. Aislado para no engrosar `repairWeek.ts` (~2.766 líneas). |
| `src/services/planBuilder/repairWeek.ts` (**modificar**) | `RepairMeta` incorpora `taxonomy`; los 30 incrementos legacy pasan por `recordRepair` y `:2277` por `recordTaxonomyOnly`. |
| `src/services/planBuilder/qualityReview.ts` (**modificar**) | Ruta de scoring v2 junto a la v1. |
| `src/types/planBuilder.ts` (**modificar**) | `generationMeta` persiste los contadores de taxonomía. |
| `src/services/planBuilder/generateWeekCore.ts` (**modificar**) | Propaga el summary serializable desde `RepairMeta` al resultado de generación. |
| `src/services/planBuilder/asyncGenerationLoop.ts` (**modificar**) | Propaga taxonomía a revisión por intento, cache key y semana resuelta/fallback. |
| `src/services/planBuilder/generateWeek.ts` / `generatePlan.ts` (**modificar**) | Mantienen taxonomía en las rutas legacy/locales todavía activas. |
| `src/types/index.ts` (**modificar**) | Extiende `repairStats` de Week Creator de forma aditiva. |
| `src/services/planBuilder/__tests__/repairTaxonomy.test.ts` (**crear**) | Unidad del módulo nuevo. |
| `src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts` (**crear**) | Contratos de clasificación, preservación legacy y guard de cobertura. |
| `src/services/planBuilder/__tests__/helpers/repairTestFixtures.ts` (**crear**) | Contexto y sesiones tipadas que aíslan hidratación, corrección y fallbacks. |
| `src/services/planBuilder/__tests__/helpers/qualityTestFixtures.ts` (**crear**) | Plan/semanas válidos para comparar scoring v1/v2 sin casts. |
| `src/services/planBuilder/__tests__/qualityReviewV2.test.ts` (**crear**) | Contrato de la semana solo-hidratada y scoring v2. |
| `src/services/weekCreator/__tests__/weekCreatorRepairStatsRegression.test.ts` (**crear**) | Fija el comportamiento de Week Creator antes/después. |

## Dependencias dentro de Fase 0

Este documento es el **Plan 1 de 3**. Los planes son artefactos separados, pero no son independientes en rollout:

```text
Plan 1 — taxonomía + soporte v2 opt-in
        ↓
Plan 2 — migración 016 + persistencia de job/intento
        ↓
Plan 3 — loadtest + calibración + activación de v2
```

Plan 1 puede implementarse y verificarse localmente sin los otros dos. No debe activar v2 como default productivo: el Plan 3 congela divisores y umbral antes de cambiar el default.

---

### Task 1: Módulo de taxonomía

**Files:**
- Create: `src/services/planBuilder/repairTaxonomy.ts`
- Test: `src/services/planBuilder/__tests__/repairTaxonomy.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `RepairActionCategory`, `RepairTaxonomyMeta`, `createRepairTaxonomyMeta(): RepairTaxonomyMeta`, `recordRepairAction(taxonomy: RepairTaxonomyMeta, category: RepairActionCategory, sessionKey?: string): void`, `summarizeTaxonomy(taxonomy: RepairTaxonomyMeta): RepairTaxonomySummary`.

- [ ] **Step 1: Write the failing test**

Create `src/services/planBuilder/__tests__/repairTaxonomy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  createRepairTaxonomyMeta,
  recordRepairAction,
  summarizeTaxonomy,
} from '../repairTaxonomy'

describe('repairTaxonomy', () => {
  it('starts every counter at zero', () => {
    const summary = summarizeTaxonomy(createRepairTaxonomyMeta())
    expect(summary).toEqual({
      hydrationActionCount: 0,
      correctiveActionCount: 0,
      structuralActionCount: 0,
      hydratedSessionsAffected: 0,
      correctedSessionsAffected: 0,
      structurallyRepairedSessionsAffected: 0,
    })
  })

  it('counts actions, not sessions, when the same session is touched twice', () => {
    const taxonomy = createRepairTaxonomyMeta()
    recordRepairAction(taxonomy, 'corrective', '2026-08-03|AM')
    recordRepairAction(taxonomy, 'corrective', '2026-08-03|AM')

    const summary = summarizeTaxonomy(taxonomy)
    expect(summary.correctiveActionCount).toBe(2)
    expect(summary.correctedSessionsAffected).toBe(1)
  })

  it('keeps categories independent', () => {
    const taxonomy = createRepairTaxonomyMeta()
    recordRepairAction(taxonomy, 'hydration', 'a')
    recordRepairAction(taxonomy, 'structural', 'b')

    const summary = summarizeTaxonomy(taxonomy)
    expect(summary.hydrationActionCount).toBe(1)
    expect(summary.structuralActionCount).toBe(1)
    expect(summary.correctiveActionCount).toBe(0)
  })

  it('tracks an action without inventing a unique session when no key is supplied', () => {
    const taxonomy = createRepairTaxonomyMeta()
    recordRepairAction(taxonomy, 'hydration')
    const summary = summarizeTaxonomy(taxonomy)
    expect(summary.hydrationActionCount).toBe(1)
    expect(summary.hydratedSessionsAffected).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/repairTaxonomy.test.ts`
Expected: FAIL — `Failed to resolve import "../repairTaxonomy"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/planBuilder/repairTaxonomy.ts`:

```ts
/**
 * Taxonomía de reparación para `quality_version = 2`.
 *
 * `repairWeek.ts` histórico usa un único `repairedSessionCount` que mezcla
 * hidratación determinística del contrato esqueleto (esperada por diseño) con
 * corrección real de salida del modelo. Ese contador penaliza el score vía
 * `countRepairs()`, así que la arquitectura esqueleto+hidratación se castiga a
 * sí misma.
 *
 * Este módulo NO reemplaza al contador legacy: lo acompaña. El legacy conserva
 * su semántica exacta porque Week Creator ramifica sobre él
 * (`WeekCreatorEngine.ts:826`).
 *
 * Unidad: **acciones atómicas**. Una misma sesión puede recibir varias
 * acciones. Los conteos de sesiones únicas se exponen aparte y no puntúan.
 */

export type RepairActionCategory = 'hydration' | 'corrective' | 'structural'

export interface RepairTaxonomyMeta {
  hydrationActionCount: number
  correctiveActionCount: number
  structuralActionCount: number
  hydratedSessions: Set<string>
  correctedSessions: Set<string>
  structurallyRepairedSessions: Set<string>
}

export interface RepairTaxonomySummary {
  hydrationActionCount: number
  correctiveActionCount: number
  structuralActionCount: number
  hydratedSessionsAffected: number
  correctedSessionsAffected: number
  structurallyRepairedSessionsAffected: number
}

export function createRepairTaxonomyMeta(): RepairTaxonomyMeta {
  return {
    hydrationActionCount: 0,
    correctiveActionCount: 0,
    structuralActionCount: 0,
    hydratedSessions: new Set<string>(),
    correctedSessions: new Set<string>(),
    structurallyRepairedSessions: new Set<string>(),
  }
}

export function recordRepairAction(
  taxonomy: RepairTaxonomyMeta,
  category: RepairActionCategory,
  sessionKey?: string,
): void {
  switch (category) {
    case 'hydration':
      taxonomy.hydrationActionCount++
      if (sessionKey) taxonomy.hydratedSessions.add(sessionKey)
      break
    case 'corrective':
      taxonomy.correctiveActionCount++
      if (sessionKey) taxonomy.correctedSessions.add(sessionKey)
      break
    case 'structural':
      taxonomy.structuralActionCount++
      if (sessionKey) taxonomy.structurallyRepairedSessions.add(sessionKey)
      break
  }
}

export function summarizeTaxonomy(taxonomy: RepairTaxonomyMeta): RepairTaxonomySummary {
  return {
    hydrationActionCount: taxonomy.hydrationActionCount,
    correctiveActionCount: taxonomy.correctiveActionCount,
    structuralActionCount: taxonomy.structuralActionCount,
    hydratedSessionsAffected: taxonomy.hydratedSessions.size,
    correctedSessionsAffected: taxonomy.correctedSessions.size,
    structurallyRepairedSessionsAffected: taxonomy.structurallyRepairedSessions.size,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/repairTaxonomy.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit (owner)**

```bash
git add src/services/planBuilder/repairTaxonomy.ts src/services/planBuilder/__tests__/repairTaxonomy.test.ts
git commit -m "feat(plan-builder): add repair taxonomy counters for quality v2"
```

---

### Task 2: Cablear la taxonomía en `RepairMeta` sin tocar el legacy

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:55-85`
- Test: `src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts`

**Interfaces:**
- Consumes: `createRepairTaxonomyMeta`, `recordRepairAction`, `RepairTaxonomyMeta` (Task 1).
- Produces: `RepairMeta.taxonomy: RepairTaxonomyMeta`; factory `createRepairMeta(rawSessionCount)`; helpers internos `recordRepair(meta, category, sessionKey?)` y `recordTaxonomyOnly(meta, category, sessionKey?)`; `sessionKeyOf(session): string`.

`recordRepair` incrementa el contador legacy **y** la taxonomía. `recordTaxonomyOnly` incrementa **solo** la taxonomía — es obligatorio para los sitios que hoy no tocan `repairedSessionCount` (ver Task 5).

- [ ] **Step 1: Write the failing test**

Create `src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createRepairMeta } from '../repairWeek'
import { summarizeTaxonomy } from '../repairTaxonomy'

describe('RepairMeta taxonomy wiring', () => {
  it('initialises the taxonomy alongside the legacy counters', () => {
    const meta = createRepairMeta(0)

    expect(meta.repairedSessionCount).toBe(0)
    expect(summarizeTaxonomy(meta.taxonomy).hydrationActionCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts`
Expected: FAIL — `createRepairMeta` no está exportado.

- [ ] **Step 3: Write minimal implementation**

En `src/services/planBuilder/repairWeek.ts`, agregar el import al inicio del archivo:

```ts
import {
  createRepairTaxonomyMeta,
  recordRepairAction,
  type RepairActionCategory,
  type RepairTaxonomyMeta,
} from './repairTaxonomy'
```

Extender la interfaz `RepairMeta` (línea 55):

```ts
export interface RepairMeta {
  rawSessionCount: number
  repairedSessionCount: number
  movedSessionCount: number
  addedFallbackCount: number
  droppedSessionCount: number
  filteredSportCount: number
  /**
   * Aditivo. `repairedSessionCount` conserva su semántica exacta porque
   * WeekCreatorEngine ramifica sobre él.
   */
  taxonomy: RepairTaxonomyMeta
  warnings: RepairWarning[]
}
```

Agregar el factory y los helpers justo después de `RepairResult`:

```ts
export function createRepairMeta(rawSessionCount: number): RepairMeta {
  return {
    rawSessionCount,
    repairedSessionCount: 0,
    movedSessionCount: 0,
    addedFallbackCount: 0,
    droppedSessionCount: 0,
    filteredSportCount: 0,
    taxonomy: createRepairTaxonomyMeta(),
    warnings: [],
  }
}

function sessionKeyOf(session: { date?: string; timeBlock?: string }): string {
  return `${session.date ?? '?'}|${session.timeBlock ?? '?'}`
}

/** Incrementa el contador legacy Y la taxonomía. Usar en todo sitio que hoy hace `repairedSessionCount++`. */
function recordRepair(
  meta: RepairMeta,
  category: RepairActionCategory,
  sessionKey?: string,
): void {
  meta.repairedSessionCount++
  recordRepairAction(meta.taxonomy, category, sessionKey)
}

/**
 * Incrementa SOLO la taxonomía. Para sitios que hoy no tocan
 * `repairedSessionCount`: promoverlos a `recordRepair` cambiaría la semántica
 * y la telemetría legacy, incluso si otro contador ya bloquea el early return.
 */
function recordTaxonomyOnly(
  meta: RepairMeta,
  category: RepairActionCategory,
  sessionKey?: string,
): void {
  recordRepairAction(meta.taxonomy, category, sessionKey)
}
```

Reemplazar la construcción inline de `meta` dentro de `repairGeneratedWeek` (línea 76) por:

```ts
  const meta: RepairMeta = createRepairMeta(rawSessions.length)
```

`date|timeBlock` es la identidad estable dentro del pipeline: las acciones de taxonomía corren después de mover fechas y resolver colisiones. No incluir `sessionType` ni `title`, porque varias reparaciones cambian ambos y convertirían una misma sesión en dos sesiones afectadas.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificar que nada se rompió**

Run: `npx vitest run src/services/planBuilder src/services/weekCreator`
Expected: PASS — la suite completa de ambas áreas sigue verde. `recordRepair` todavía no se usa en ningún sitio, así que los contadores legacy no cambiaron.

- [ ] **Step 6: Commit (owner)**

```bash
git add src/services/planBuilder/repairWeek.ts src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts
git commit -m "feat(plan-builder): wire repair taxonomy into RepairMeta (additive)"
```

---

### Task 3: Clasificar los sitios de hidratación

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:404,417,423,432,442`
- Create: `src/services/planBuilder/__tests__/helpers/repairTestFixtures.ts`
- Test: `src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts`

**Interfaces:**
- Consumes: `recordRepair`, `sessionKeyOf` (Task 2).
- Produces: nada nuevo.

Los cinco sitios de hidratación viven en `completeSportDetails`, en el `switch (session.sessionType)`. Son los que completan el contrato esqueleto cuando el detalle del deporte no vino del modelo.

- [ ] **Step 1: Write the failing test**

Añadir a `src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts`:

```ts
import { repairGeneratedWeek } from '../repairWeek'
import { buildRepairContextForTest, buildSkeletonSessionForTest } from './helpers/repairTestFixtures'

describe('hydration classification', () => {
  it('classifies skeleton hydration as hydration, never corrective', () => {
    const context = buildRepairContextForTest({
      primarySport: 'running',
      phase: 'base',
      sessionsPerWeek: 1,
      targetLoadBySport: {},
    })
    const sessions = [buildSkeletonSessionForTest({ sessionType: 'running', date: '2026-08-03' })]

    const { meta } = repairGeneratedWeek(sessions, context)
    const summary = summarizeTaxonomy(meta.taxonomy)

    expect(summary.hydrationActionCount).toBeGreaterThan(0)
    expect(summary.correctiveActionCount).toBe(0)
    expect(summary.structuralActionCount).toBe(0)
  })

  it('replaces the isolated hydration increment one-for-one in the legacy counter', () => {
    const context = buildRepairContextForTest({
      primarySport: 'running',
      phase: 'base',
      sessionsPerWeek: 1,
      targetLoadBySport: {},
    })
    const sessions = [buildSkeletonSessionForTest({ sessionType: 'running', date: '2026-08-03' })]

    const { meta } = repairGeneratedWeek(sessions, context)
    const summary = summarizeTaxonomy(meta.taxonomy)

    expect(meta.repairedSessionCount).toBe(summary.hydrationActionCount)
  })
})
```

Crear el fixture tipado junto al test. No usar `as never`: el helper debe fallar al compilar si cambia el contrato real.

```ts
// src/services/planBuilder/__tests__/helpers/repairTestFixtures.ts
import type {
  AthleteProfile,
  CoachSessionProposal,
  MacroPlanPhase,
  PlanWizardConfig,
  SupportedSport,
} from '../../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../../types/planBuilder'
import type { RepairContext } from '../../repairWeek'

interface RepairContextFixtureOptions {
  primarySport?: SupportedSport
  phase?: MacroPlanPhase
  sessionsPerWeek?: number
  targetLoadBySport?: Partial<Record<SupportedSport, number>>
}

export function buildRepairContextForTest(
  options: RepairContextFixtureOptions = {},
): RepairContext {
  const primarySport = options.primarySport ?? 'squash'
  const phase = options.phase ?? 'base'
  const sessionsPerWeek = options.sessionsPerWeek ?? 1
  const wizardConfig: PlanWizardConfig = {
    goalEventId: 'event-1',
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    sessionsPerWeek,
    sessionDurationMins: 45,
    allowDoubleSession: false,
    doubleSessionDays: [],
    complementarySports: [],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    partnerAvailability: 'either',
    createdAt: '',
    updatedAt: '',
  }
  const plan: TrainingPlan = {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'shell',
    title: 'Fixture plan',
    startDate: '2026-08-03',
    endDate: '2026-08-09',
    totalWeeks: 1,
    phases: [{
      phase,
      startWeekIndex: 0,
      endWeekIndex: 0,
      blockFocus: 'fixture',
      intentBySport: {},
    }],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-08-09',
      currentPhase: phase,
      weeksRemaining: 1,
      blockFocus: 'fixture',
      headline: '',
      timeline: [],
      sportDetails: [{
        sport: primarySport,
        role: 'primary',
        phaseFocus: '',
        weeklyIntent: '',
        volumeBias: 'hold',
        intensityBias: 'hold',
        notes: '',
      }],
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 0,
    updatedAt: 0,
  }
  const week: TrainingPlanWeek = {
    id: 'week-0',
    planId: plan.id,
    weekIndex: 0,
    weekStartDate: '2026-08-03',
    phase,
    status: 'pending',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: options.targetLoadBySport ?? {},
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 0,
    updatedAt: 0,
  }
  const profile: AthleteProfile = {
    id: 'athlete-1',
    updatedAt: 0,
    primarySport,
    mainGoal: 'Fixture goal',
    sportContext: {
      primarySport,
      enabledSports: [primarySport],
      secondarySports: [],
      trainingPriority: 'performance',
    },
    goalEvents: [{
      id: 'event-1',
      title: 'Fixture event',
      date: plan.endDate,
      sport: primarySport,
      priority: 'primary',
      competitiveLevel: 'competitive',
    }],
  }

  return { plan, week, profile, wizardConfig }
}

type SkeletonSessionFixtureInput = Partial<CoachSessionProposal> & {
  fullyHydrated?: boolean
}

export function buildSkeletonSessionForTest(
  input: SkeletonSessionFixtureInput = {},
): CoachSessionProposal {
  const { fullyHydrated = false, ...overrides } = input
  const session: CoachSessionProposal = {
    date: '2026-08-03',
    timeBlock: 'AM',
    sessionType: 'running',
    title: 'Fixture session',
    objective: 'Fixture objective',
    durationMin: 45,
    rpe: 5,
    ...overrides,
  }

  if (!fullyHydrated) return session
  if (session.sessionType !== 'running') {
    throw new Error('fullyHydrated fixture is defined only for running')
  }

  return {
    ...session,
    runningType: session.runningType ?? 'z2',
    targetPaceMin: session.targetPaceMin ?? '5:30',
    targetPaceMax: session.targetPaceMax ?? '6:00',
    targetHrMin: session.targetHrMin ?? 130,
    targetHrMax: session.targetHrMax ?? 145,
    intervalStructure: session.intervalStructure ?? {
      blocks: [{ label: 'Rodaje Z2', durationMin: session.durationMin }],
    },
  }
}
```

Estos defaults aíslan una sola política: semana completa, fechas válidas, carga objetivo vacía, fase `base` y una sesión esperada. `fullyHydrated` existe solo para running porque es el fixture usado para probar `balanceSessionCount` sin activar hidratación.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts -t "hydration"`
Expected: FAIL — `hydrationActionCount` es 0 porque los sitios todavía usan `meta.repairedSessionCount++`.

- [ ] **Step 3: Write minimal implementation**

En `completeSportDetails`, reemplazar los cinco incrementos de hidratación. Ejemplo del bloque de squash (línea ~402):

```ts
        case 'squash':
          if (!hasValidSquashDetails(session)) {
            completeSquashDetails(session, context, currentWeekSquashDrills)
            recordRepair(meta, 'hydration', sessionKeyOf(session))
          } else if (hasUnresolvedSquashDrills(session)) {
```

Aplicar el mismo patrón en:

| Línea original | Sitio | Categoría |
|---|---|---|
| 404 | `completeSquashDetails` | `hydration` |
| 417 | `completeRunningDetails` | `hydration` |
| 423 | `completeStrengthExercises` | `hydration` |
| 432 | `completeMobilityDetails` | `hydration` |
| 442 | `completeCyclingDetails` | `hydration` |

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts -t "hydration"`
Expected: PASS.

- [ ] **Step 5: Verificar que el legacy no cambió**

Run: `npx vitest run src/services/planBuilder src/services/weekCreator`
Expected: PASS — `recordRepair` incrementa `repairedSessionCount` exactamente como el `++` que reemplazó.

- [ ] **Step 6: Commit (owner)**

```bash
git add src/services/planBuilder/repairWeek.ts src/services/planBuilder/__tests__/
git commit -m "feat(plan-builder): classify skeleton hydration repair sites"
```

---

### Task 4: Clasificar los sitios correctivos

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts` — sitios correctivos (`407`, `410`, `425`, `436`, `658`, `761`, `771`, `782`, `793`, `921`, `1060`, `1258`, `1371`, `1499`, `1912`, `1943`, `2036`, `2080`)
- Test: `src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts`

**Interfaces:**
- Consumes: `recordRepair`, `sessionKeyOf` (Task 2).
- Produces: nada nuevo.

**Regla de clasificación.** Un sitio es `corrective` cuando el modelo produjo contenido inválido, incoherente o fuera de catálogo y se corrigió sin fabricar sesiones nuevas. Es `structural` (Task 5) cuando se **añade, fuerza o materializa** una sesión que el modelo no pidió.

**Tabla revisada de los 30 incrementos legacy:**

| Categoría | Líneas originales |
|---|---|
| `hydration` | 404, 417, 423, 432, 442 |
| `corrective` | 407, 410, 425, 436, 658, 761, 771, 782, 793, 921, 1060, 1258, 1371, 1499, 1912, 1943, 2036, 2080 |
| `structural` | 751, 827, 850, 2124, 2138, 2401, 2457 |

`:2277` no está entre esos 30 porque no toca el contador legacy; se registra como `structural` mediante `recordTaxonomyOnly` en Task 5.

- [ ] **Step 1: Write the failing test**

Añadir a `repairTaxonomyClassification.test.ts`:

```ts
describe('corrective classification', () => {
  it('classifies out-of-catalogue squash drills as corrective, not hydration', () => {
    const context = buildRepairContextForTest()
    const sessions = [
      buildSkeletonSessionForTest({
        sessionType: 'squash',
        date: '2026-08-03',
        squashDetails: {
          drills: [{ name: 'drill-que-no-existe-en-el-catalogo', durationMin: 30 }],
          blocks: [],
          trainingFocus: 'technical',
          sessionMode: 'drill_session',
          sessionKind: 'technical',
        },
      }),
    ]

    const { meta } = repairGeneratedWeek(sessions, context)
    const summary = summarizeTaxonomy(meta.taxonomy)

    expect(summary.correctiveActionCount).toBeGreaterThan(0)
    expect(summary.hydrationActionCount).toBe(0)
  })
})
```

El `sessionKind` hace que `hasValidSquashDetails` sea verdadero; el nombre inexistente hace que entre por `hasUnresolvedSquashDrills`. Así el test distingue corrección de hidratación, en vez de aceptar cualquiera de las dos rutas.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts -t "corrective"`
Expected: FAIL — `correctiveActionCount` es 0.

- [ ] **Step 3: Write minimal implementation**

Reemplazar cada sitio correctivo. Patrón para los `++`:

```ts
            recordRepair(meta, 'corrective', sessionKeyOf(session))
```

Los sitios `+= repairedCount` (1258, 1371, 1499) **no** se registran como un bulk anónimo. Mover el `recordRepair` al punto del loop donde se confirma cada reparación:

```ts
    recordRepair(meta, 'corrective', sessionKeyOf(session))
    repairedCount++
```

Conservar `repairedCount` para construir el warning, pero eliminar el `meta.repairedSessionCount += repairedCount` del final: los incrementos one-for-one dentro del loop preservan el total legacy y permiten contar sesiones únicas correctamente. La línea 2457 sigue el mismo patrón en Task 5, pero como `structural`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts -t "corrective"`
Expected: PASS.

- [ ] **Step 5: Verificar que el legacy no cambió**

Run: `npx vitest run src/services/planBuilder src/services/weekCreator`
Expected: PASS.

- [ ] **Step 6: Commit (owner)**

```bash
git add src/services/planBuilder/repairWeek.ts src/services/planBuilder/__tests__/
git commit -m "feat(plan-builder): classify corrective repair sites"
```

---

### Task 5: Clasificar los sitios estructurales, incluido el fallback huérfano

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:751,827,850,2124,2138,2277,2401,2457`
- Test: `src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts`

**Interfaces:**
- Consumes: `recordRepair`, `recordTaxonomyOnly`, `sessionKeyOf` (Task 2).
- Produces: nada nuevo.

**El sitio crítico es `:2277`.** `addedFallbackCount` tiene tres sitios: `826`, `2123` y `2277`. Los dos primeros están pareados con `repairedSessionCount++` (en `827` y `2124`). El de `balanceSessionCount` (`2277`) **no**. Como `countRepairs_v2` excluye `addedFallbackCount` para evitar doble penalización, si `:2277` no se mapea a `structuralActionCount` ese fallback queda sin penalizar.

Debe usar `recordTaxonomyOnly`, **no** `recordRepair`, para conservar exactamente la semántica y comparabilidad del contador legacy. El argumento no es el early return: `:2277` ya incrementa `addedFallbackCount`, y esa misma rama exige `addedFallbackCount === 0`, por lo que ya no tomaría el retorno temprano.

- [ ] **Step 1: Write the failing tests**

Añadir a `repairTaxonomyClassification.test.ts` contratos de clasificación estructural y preservación legacy. Los contratos de score/no-doble-penalización viven en Task 7, donde ya existe `countRepairsV2`; ninguna task depende de código futuro.

```ts
describe('structural classification', () => {
  it('balanceSessionCount fallback records one structural action', () => {
    const context = buildRepairContextForTest({
      primarySport: 'running',
      phase: 'base',
      sessionsPerWeek: 2,
      targetLoadBySport: {},
    })
    const sessions = [
      buildSkeletonSessionForTest({
        sessionType: 'running',
        date: '2026-08-03',
        fullyHydrated: true,
      }),
    ]

    const { meta } = repairGeneratedWeek(sessions, context)
    const summary = summarizeTaxonomy(meta.taxonomy)

    expect(meta.addedFallbackCount).toBe(1)
    expect(summary.structuralActionCount).toBe(1)
  })

  it('keeps the orphan fallback out of the legacy repaired counter', () => {
    const context = buildRepairContextForTest({
      primarySport: 'running',
      phase: 'base',
      sessionsPerWeek: 2,
      targetLoadBySport: {},
    })
    const sessions = [
      buildSkeletonSessionForTest({
        sessionType: 'running',
        date: '2026-08-03',
        fullyHydrated: true,
      }),
    ]

    const { meta } = repairGeneratedWeek(sessions, context)

    // Caracterización del comportamiento previo: :2277 incrementa fallback,
    // pero nunca incrementó repairedSessionCount.
    expect(meta.addedFallbackCount).toBe(1)
    expect(meta.repairedSessionCount).toBe(0)
  })

  it('pairs a competitive fallback with one structural action', () => {
    const context = buildRepairContextForTest({
      primarySport: 'squash',
      phase: 'peak',
      sessionsPerWeek: 3,
      targetLoadBySport: {},
    })
    const sessions = [
      buildSkeletonSessionForTest({
        sessionType: 'squash',
        date: '2026-08-03',
        squashDetails: {
          trainingFocus: 'technical',
          sessionMode: 'drill_session',
          sessionKind: 'technical',
          drills: [
            { name: 'Tiros paralelos profundos', durationMin: 15 },
            { name: 'Tiros cruzados profundos', durationMin: 15 },
            { name: 'Cambio de paralelo a cruzado', durationMin: 15 },
          ],
        },
      }),
      buildSkeletonSessionForTest({
        sessionType: 'squash',
        date: '2026-08-04',
        squashDetails: {
          trainingFocus: 'technical',
          sessionMode: 'drill_session',
          sessionKind: 'technical',
          drills: [
            { name: 'Boast y drive paralelo de salida', durationMin: 15 },
            { name: 'Drop y contra-drop por ambos lados', durationMin: 15 },
            { name: '100 drives desde media cancha', durationMin: 15 },
          ],
        },
      }),
    ]

    const { meta } = repairGeneratedWeek(sessions, context)
    const summary = summarizeTaxonomy(meta.taxonomy)

    expect(meta.addedFallbackCount).toBe(1)
    expect(summary.structuralActionCount).toBe(1)
  })
})
```

`fullyHydrated: true` para running debe incluir `runningType`, targets e `intervalStructure`, de modo que el único cambio sea el fallback añadido por balance. Si el fixture dispara otra política, corregir el fixture; no relajar los valores exactos.

El tercer caso parte con dos sesiones squash válidas y cupo exacto para una tercera. La fase `peak` y el evento competitivo del fixture activan `ensureSquashCompetitionMatchExposure`; al completar tres sesiones, `balanceSessionCount` ya no agrega otro fallback. Así queda aislado el par `addedFallbackCount = 1` / `structuralActionCount = 1` de `:826/:827`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts -t "structural classification"`
Expected: FAIL — los valores legacy ya coinciden, pero `structuralActionCount` todavía es 0 para `:2277`.

- [ ] **Step 3: Write minimal implementation**

Sitios estructurales:

| Línea | Sitio | Helper |
|---|---|---|
| 751 | match mode resuelto sin contexto | `recordRepair(meta, 'structural', sessionKeyOf(session))` |
| 827 | sesión de partido de competencia añadida | `recordRepair(meta, 'structural', sessionKeyOf(added))` |
| 850 | sesión forzada a `competition_match` | `recordRepair(meta, 'structural', sessionKeyOf(candidate))` |
| 2123/2124 | fallback pareado | `recordRepair(meta, 'structural', ...)` |
| 2138 | sesión reemplazada por running requerido por el macroplan | `recordRepair(meta, 'structural', sessionKeyOf(next[replacementIndex]))` |
| **2277** | fallback de `balanceSessionCount` | **`recordTaxonomyOnly(meta, 'structural', sessionKeyOf(fallback))`** |
| 2401 | sesión accesoria reemplazada para cumplir mínimo primario | `recordRepair(meta, 'structural', sessionKeyOf(next[i]))` |
| 2457 | sesiones convertidas para forzar dominancia primaria | `recordRepair(meta, 'structural', sessionKeyOf(next[i]))` dentro del loop |

Como en los bulk correctivos, mover el registro de 2457 al loop y conservar `converted` únicamente para el warning. El total legacy debe seguir siendo idéntico.

Para `:2277`, el bloque queda:

```ts
      result.push(fallback)
      meta.addedFallbackCount++
      // Taxonomía solamente: este sitio nunca incrementó repairedSessionCount, y
      // hacerlo ahora cambiaría la semántica y telemetría legacy.
      recordTaxonomyOnly(meta, 'structural', sessionKeyOf(fallback))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts`
Expected: PASS — Task 5 termina verde sin depender de funciones creadas en tasks posteriores.

- [ ] **Step 5: Verificar que Week Creator no cambió**

Run: `npx vitest run src/services/weekCreator`
Expected: PASS — los contadores legacy no cambian.

- [ ] **Step 6: Commit (owner)**

```bash
git add src/services/planBuilder/repairWeek.ts src/services/planBuilder/__tests__/
git commit -m "feat(plan-builder): classify structural repair sites incl. orphan fallback"
```

---

### Task 6: Guard de cobertura del inventario

**Files:**
- Test: `src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: nada.

El spec exige un test que falle si aparece un sitio legacy sin clasificar. Tras las tasks 3–5, el único write directo permitido sobre `repairedSessionCount` vive dentro de `recordRepair`. Los tres writes de `addedFallbackCount` se conservan, pero cada uno debe quedar asociado explícitamente a una acción `structural`.

- [ ] **Step 1: Write the failing test**

Añadir a `repairTaxonomyClassification.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

describe('taxonomy coverage guard', () => {
  it('leaves no unclassified repair increment in repairWeek.ts', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, '..', 'repairWeek.ts'), 'utf8')
    const lines = source.split('\n')

    const rawLegacyIncrements = lines
      .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
      .filter(({ line }) => /meta\.repairedSessionCount\s*(\+\+|\+=)/.test(line))
      .filter(({ line }) => !line.startsWith('//'))

    // El helper recordRepair es el único lugar legítimo que toca el legacy.
    // Exigir exactamente una ocurrencia evita que un incremento idéntico se
    // cuele en producción y quede oculto por un filtro demasiado permisivo.
    expect(rawLegacyIncrements.map((item) => item.line)).toEqual([
      'meta.repairedSessionCount++',
    ])

    const helperStart = source.indexOf('function recordRepair(')
    const helperEnd = source.indexOf('function recordTaxonomyOnly(')
    expect(helperStart).toBeGreaterThanOrEqual(0)
    expect(helperEnd).toBeGreaterThan(helperStart)
    expect(source.slice(helperStart, helperEnd)).toContain(
      'meta.repairedSessionCount++',
    )

    const fallbackMutations = lines
      .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
      .filter(({ line }) => /meta\.addedFallbackCount\s*(\+\+|\+=)/.test(line))
      .filter(({ line }) => !line.startsWith('//'))

    expect(fallbackMutations).toHaveLength(3)
    for (const mutation of fallbackMutations) {
      const window = lines.slice(mutation.lineNumber - 1, mutation.lineNumber + 4).join('\n')
      expect(window).toMatch(
        /record(?:Repair|TaxonomyOnly)\(\s*meta,\s*'structural'/,
      )
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails (o pasa, si las tasks 3–5 fueron exhaustivas)**

Run: `npx vitest run src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts -t "coverage guard"`
Expected: si falla, la salida lista incrementos legacy sin reemplazar o un fallback sin categoría estructural. **Clasifícalos** volviendo a Task 4 o 5 y repite.

- [ ] **Step 3: Cerrar los sitios que reporte el guard**

Aplicar `recordRepair` / `recordTaxonomyOnly` a cada línea listada, según la regla de clasificación.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts`
Expected: PASS — exactamente un write legacy, dentro del helper, y tres fallbacks estructurales cubiertos.

- [ ] **Step 5: Commit (owner)**

```bash
git add src/services/planBuilder/__tests__/repairTaxonomyClassification.test.ts src/services/planBuilder/repairWeek.ts
git commit -m "test(plan-builder): guard against unclassified repair increments"
```

---

### Task 7: `quality_version = 2` — scoring

**Files:**
- Modify: `src/services/planBuilder/qualityReview.ts:405-441,617-641,643-649`
- Modify: `src/types/planBuilder.ts:57-62`
- Modify: `src/components/planBuilder/PlanQualityBadge.tsx`
- Modify: `src/services/planBuilder/__tests__/typesQualityReview.test.ts`
- Modify: `src/components/planBuilder/PlanQualityBadge.test.tsx`
- Modify: `src/services/__tests__/commitPlan.test.ts`
- Create: `src/services/planBuilder/__tests__/helpers/qualityTestFixtures.ts`
- Test: `src/services/planBuilder/__tests__/qualityReviewV2.test.ts`

**Interfaces:**
- Consumes: `RepairTaxonomySummary` (Task 1); los campos nuevos de `generationMeta`.
- Produces: `countRepairsV2FromRepairMeta(meta: RepairMeta): number`, `LATEST_QUALITY_VERSION`, `PersistedPlanQualityReview`, resolución histórica segura de versión, `reviewPlanQuality(..., { qualityVersion })`.

- [ ] **Step 1: Write the failing test**

Create `src/services/planBuilder/__tests__/qualityReviewV2.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { countRepairsV2, reviewPlanQuality } from '../qualityReview'
import { buildPlanForTest, buildWeekForTest } from './helpers/qualityTestFixtures'

describe('quality_version = 2', () => {
  it('does not penalise a hydration-only week', () => {
    const baselineWeek = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        repairTaxonomyVersion: 2,
        hydrationActionCount: 0,
        correctiveActionCount: 0,
        structuralActionCount: 0,
        movedSessionCount: 0,
        droppedSessionCount: 0,
        addedFallbackCount: 0,
        filteredSportCount: 0,
        repairedSessionCount: 0,
      },
    })
    const hydratedWeek = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        repairTaxonomyVersion: 2,
        hydrationActionCount: 12,
        correctiveActionCount: 0,
        structuralActionCount: 0,
        movedSessionCount: 0,
        droppedSessionCount: 0,
        addedFallbackCount: 0,
        filteredSportCount: 0,
        repairedSessionCount: 12,
      },
    })

    expect(countRepairsV2(hydratedWeek)).toBe(0)

    const baseline = reviewPlanQuality(buildPlanForTest(), [baselineWeek], { qualityVersion: 2 })
    const hydrated = reviewPlanQuality(buildPlanForTest(), [hydratedWeek], { qualityVersion: 2 })
    expect(hydrated.qualityVersion).toBe(2)
    expect(hydrated.weeks[0].score).toBe(baseline.weeks[0].score)
    expect(hydrated.weeks[0].repairCount).toBe(0)
    expect(hydrated.weeks[0].issues.map((i) => i.code)).not.toContain(
      'quality.generation.high_repair_count',
    )
  })

  it('still preserves the observational hydration counters', () => {
    const week = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        repairTaxonomyVersion: 2,
        hydrationActionCount: 12,
        repairedSessionCount: 12,
      },
    })
    expect(week.generationMeta.hydrationActionCount).toBe(12)
  })

  it('counts a filtered sport once, not twice', () => {
    const week = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        droppedSessionCount: 1,
        filteredSportCount: 1,
        correctiveActionCount: 0,
        structuralActionCount: 0,
        movedSessionCount: 0,
      },
    })
    expect(countRepairsV2(week)).toBe(1)
  })

  it('counts a structural fallback once, not twice', () => {
    const week = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        structuralActionCount: 1,
        addedFallbackCount: 1,
        correctiveActionCount: 0,
        movedSessionCount: 0,
        droppedSessionCount: 0,
      },
    })
    expect(countRepairsV2(week)).toBe(1)
  })

  it('leaves v1 scoring untouched for historical rows', () => {
    const baselineWeek = buildWeekForTest({
      generationMeta: { attempts: 1, repairedSessionCount: 0 },
    })
    const repairedWeek = buildWeekForTest({
      generationMeta: { attempts: 1, repairedSessionCount: 12 },
    })
    // Sin versión explícita ni marca v2 en la semana: debe resolver v1.
    const baseline = reviewPlanQuality(buildPlanForTest(), [baselineWeek])
    const review = reviewPlanQuality(buildPlanForTest(), [repairedWeek])
    expect(review.qualityVersion).toBe(1)
    expect(review.weeks[0].repairCount).toBe(12)
    expect(review.weeks[0].score).toBeLessThan(baseline.weeks[0].score)
    expect(review.weeks[0].issues.map((i) => i.code)).toContain(
      'quality.generation.high_repair_count',
    )
  })

  it('only infers v2 when every reviewed week is explicitly marked v2', () => {
    const v2Week = buildWeekForTest({
      generationMeta: {
        attempts: 1,
        qualityVersion: 2,
        repairTaxonomyVersion: 2,
      },
    })
    const legacyWeek = buildWeekForTest({
      weekIndex: 1,
      generationMeta: { attempts: 1 },
    })

    expect(reviewPlanQuality(buildPlanForTest(), [v2Week]).qualityVersion).toBe(2)
    expect(reviewPlanQuality(buildPlanForTest(), [v2Week, legacyWeek]).qualityVersion).toBe(1)
  })

  it('rejects explicit v2 for a week without v2 taxonomy', () => {
    const legacyWeek = buildWeekForTest({
      generationMeta: { attempts: 1, repairedSessionCount: 4 },
    })

    expect(() => reviewPlanQuality(
      buildPlanForTest(),
      [legacyWeek],
      { qualityVersion: 2 },
    )).toThrow('quality_version 2 requires repairTaxonomyVersion 2')
  })
})
```

Crear el fixture tipado a partir de `qualityReviewRepeatedTemplate.test.ts` y reutilizar la sesión running hidratada de Task 3:

```ts
// src/services/planBuilder/__tests__/helpers/qualityTestFixtures.ts
import type { PlanWizardConfig } from '../../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../../types/planBuilder'
import { buildSkeletonSessionForTest } from './repairTestFixtures'

const DAY_MS = 24 * 60 * 60 * 1000

function weekStartFor(weekIndex: number): string {
  return new Date(Date.UTC(2026, 7, 3) + weekIndex * 7 * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

export function buildPlanForTest(
  overrides: Partial<TrainingPlan> = {},
): TrainingPlan {
  const wizardConfig: PlanWizardConfig = {
    goalEventId: 'event-1',
    trainingDays: ['monday'],
    sessionsPerWeek: 1,
    sessionDurationMins: 45,
    allowDoubleSession: false,
    doubleSessionDays: [],
    complementarySports: [],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    createdAt: '',
    updatedAt: '',
  }
  const base: TrainingPlan = {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'complete',
    title: 'Quality fixture',
    startDate: '2026-08-03',
    endDate: '2026-08-16',
    totalWeeks: 2,
    phases: [{
      phase: 'base',
      startWeekIndex: 0,
      endWeekIndex: 1,
      blockFocus: 'fixture',
      intentBySport: {},
    }],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-08-16',
      currentPhase: 'base',
      weeksRemaining: 2,
      blockFocus: 'fixture',
      headline: '',
      timeline: [],
      sportDetails: [{
        sport: 'running',
        role: 'primary',
        phaseFocus: '',
        weeklyIntent: '',
        volumeBias: 'hold',
        intensityBias: 'hold',
        notes: '',
      }],
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 0,
    updatedAt: 0,
  }

  return { ...base, ...overrides }
}

export function buildWeekForTest(
  overrides: Partial<TrainingPlanWeek> = {},
): TrainingPlanWeek {
  const weekIndex = overrides.weekIndex ?? 0
  const weekStartDate = overrides.weekStartDate ?? weekStartFor(weekIndex)
  const base: TrainingPlanWeek = {
    id: `week-${weekIndex}`,
    planId: 'plan-1',
    weekIndex,
    weekStartDate,
    phase: 'base',
    status: 'draft',
    sessions: [buildSkeletonSessionForTest({
      date: weekStartDate,
      sessionType: 'running',
      fullyHydrated: true,
    })],
    weekObjectives: [],
    targetLoadBySport: { running: 225 },
    validationIssues: [],
    generationMeta: { attempts: 1 },
    createdAt: 0,
    updatedAt: 0,
  }

  return {
    ...base,
    ...overrides,
    generationMeta: {
      ...base.generationMeta,
      ...overrides.generationMeta,
    },
  }
}
```

Los tests comparan semanas construidas por el mismo helper y que difieren solo en `generationMeta`; no dependen de un score absoluto ni esconden errores de tipo con casts.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/qualityReviewV2.test.ts`
Expected: FAIL — `countRepairsV2` no está exportado.

- [ ] **Step 3: Write minimal implementation**

En `src/types/planBuilder.ts`, agregar a `generationMeta` (después de la línea 62):

```ts
  hydrationActionCount?: number
  correctiveActionCount?: number
  structuralActionCount?: number
  hydratedSessionsAffected?: number
  correctedSessionsAffected?: number
  structurallyRepairedSessionsAffected?: number
  repairTaxonomyVersion?: 2
  qualityVersion?: 1 | 2
```

Agregar `qualityVersion: 1 | 2` a cada `PlanQualityReview` nuevo. Modelar aparte la frontera persistida, porque las revisiones existentes no tienen el campo y no se migran:

```ts
export type PersistedPlanQualityReview =
  Omit<PlanQualityReview, 'qualityVersion'>
  & { qualityVersion?: 1 | 2 }

export function resolvePersistedQualityVersion(
  review: Pick<PersistedPlanQualityReview, 'qualityVersion'>,
): 1 | 2 {
  return review.qualityVersion ?? 1
}
```

En `src/types/planBuilder.ts`, cambiar `PlanGenerationSummary.qualityReview` a `PersistedPlanQualityReview`; un review nuevo sigue siendo asignable porque su versión es requerida. `PlanQualityBadge` acepta el tipo persistido, llama el helper y expone el resultado como `data-quality-version` en el `<section>` raíz. No cambia el texto visible, pero evita que el único consumidor de revisiones históricas trate una ausencia como versión desconocida. Añadir un test de componente con un literal legacy tipado, sin casts ni campo de versión, que verifique `data-quality-version="1"`.

Actualizar los tres literales existentes que satisfacen o fluyen como `PlanQualityReview` (`typesQualityReview.test.ts`, `PlanQualityBadge.test.tsx`, `commitPlan.test.ts`) con `qualityVersion: 1`. Son fixtures históricos; marcarlos v2 cambiaría el significado de sus scores.

Extender también el contexto de entrada:

```ts
export interface PlanQualityContext {
  profile?: AthleteProfile
  qualityVersion?: 1 | 2
}
```

En `src/services/planBuilder/qualityReview.ts`, junto a `countRepairs` (línea 643):

```ts
export const LATEST_QUALITY_VERSION = 2 as const

/**
 * v2: la hidratación determinística del contrato esqueleto NO penaliza.
 *
 * Excluidos deliberadamente de la suma:
 * - `filteredSportCount`: subconjunto estricto de `droppedSessionCount`
 *   (`repairWeek.ts:363-364` incrementa ambos en el mismo `return false`).
 * - `addedFallbackCount`: el mismo evento entra por `structuralActionCount`.
 * - `hydrationActionCount`: por definición de la versión.
 */
export function countRepairsV2(week: TrainingPlanWeek): number {
  const meta = week.generationMeta
  return (meta.correctiveActionCount ?? 0)
    + (meta.structuralActionCount ?? 0)
    + (meta.movedSessionCount ?? 0)
    + (meta.droppedSessionCount ?? 0)
}
```

Mantener la ruta legacy sin cambios y hacer explícito el dispatch:

```ts
function countRepairs(week: TrainingPlanWeek, qualityVersion: 1 | 2): number {
  if (qualityVersion === 2) return countRepairsV2(week)

  const meta = week.generationMeta
  return (meta.repairedSessionCount ?? 0)
    + (meta.movedSessionCount ?? 0)
    + (meta.addedFallbackCount ?? 0)
    + (meta.filteredSportCount ?? 0)
}
```

Parametrizar `scoreWeek` y `scorePlan` por versión:

```ts
function scoreWeek(issues: PlanValidationIssue[], repairCount: number, qualityVersion: 1 | 2): number {
  const penalty = issues.reduce((total, item) => {
    if (isGenerationReliabilitySignal(item)) return total
    if (item.severity === 'error') return total + 22
    if (item.severity === 'warning') return total + 7
    return total + 3
  }, 0)
  // v2: el divisor se calibra con la distribución del control (spec §5.3).
  // Hasta congelarlo, v2 no aplica repairPenalty — un divisor heredado sobre
  // una métrica de otro orden de magnitud no significa nada.
  const repairPenalty = qualityVersion === 1 ? Math.min(10, Math.floor(repairCount / 2)) : 0
  return clampScore(100 - penalty - repairPenalty)
}

function scorePlan(
  weeks: PlanQualityWeekReview[],
  planIssues: PlanValidationIssue[],
  repairCount: number,
  qualityVersion: 1 | 2,
): number {
  if (weeks.length === 0) return 0
  const average = weeks.reduce((total, week) => total + week.score, 0) / weeks.length
  const planPenalty = planIssues.reduce((total, item) => {
    if (isGenerationReliabilitySignal(item)) return total
    return total + (item.severity === 'error' ? 14 : item.severity === 'warning' ? 5 : 2)
  }, 0)
  const repairPenalty = qualityVersion === 1 ? Math.min(8, Math.floor(repairCount / 8)) : 0
  return clampScore(average - planPenalty - repairPenalty)
}
```

En `getGenerationReliabilityIssues`, cambiar el bloque de la línea 429 para que lea la taxonomía y quede **desactivado** en v2 hasta congelar el umbral (spec §5.3):

```ts
  const repaired = qualityVersion === 1
    ? (week.generationMeta.repairedSessionCount ?? 0)
    : (week.generationMeta.correctiveActionCount ?? 0)
      + (week.generationMeta.structuralActionCount ?? 0)

  // v2: umbral DESACTIVADO hasta calibrarlo con el control Sonnet 4.6 `high`.
  // No poner un número "alto": desactivar explícitamente (spec §5.3).
  const repairWarningEnabled = qualityVersion === 1

  if (repairWarningEnabled && repaired >= 8) {
    issues.push(issue({
      severity: 'warning',
      code: 'quality.generation.high_repair_count',
      message: `Semana ${week.weekIndex + 1} requirió ${repaired} reparaciones automáticas; revisar coherencia manualmente.`,
      weekIndex: week.weekIndex,
    }))
  }
```

Resolver la versión de forma históricamente segura:

```ts
function resolveQualityVersion(
  weeks: TrainingPlanWeek[],
  requested?: 1 | 2,
): 1 | 2 {
  const hasV2Taxonomy = weeks.length > 0
    && weeks.every((week) => week.generationMeta.repairTaxonomyVersion === 2)

  if (requested === 2 && !hasV2Taxonomy) {
    throw new Error('quality_version 2 requires repairTaxonomyVersion 2')
  }
  if (requested != null) return requested
  return hasV2Taxonomy
    && weeks.every((week) => week.generationMeta.qualityVersion === 2)
    ? 2
    : 1
}
```

La precondición evita que una llamada explícita a v2 interprete contadores ausentes de una fila histórica como ceros reales. Al inicio de `reviewPlanQuality`, después de ordenar semanas:

```ts
  const qualityVersion = resolveQualityVersion(sortedWeeks, context.qualityVersion)
```

Cambiar `getGenerationReliabilityIssues(week)` a `getGenerationReliabilityIssues(week, qualityVersion)`. Usar también esa versión en `countRepairs(week, qualityVersion)`, `scoreWeek`, `scorePlan`, y devolverla en `PlanQualityReview`. Una fila histórica sin marca resuelve v1. Durante este plan, v2 se invoca explícitamente desde tests y, más adelante, desde el loadtest; no se cambia todavía el default productivo.

Exportar también una variante sobre `RepairMeta` para anclar la fórmula con la forma serializada. **Opera sobre `RepairMeta`, no sobre `TrainingPlanWeek`**: el primero trae `Set`s vivos y `generationMeta` trae números. Castear una forma a la otra devolvería 0 en silencio.

```ts
import { summarizeTaxonomy, type RepairTaxonomyMeta } from './repairTaxonomy'

/** Misma fórmula que `countRepairsV2`, aplicada a un `RepairMeta` recién salido de `repairGeneratedWeek`. */
export function countRepairsV2FromRepairMeta(meta: {
  movedSessionCount: number
  droppedSessionCount: number
  taxonomy: RepairTaxonomyMeta
}): number {
  const summary = summarizeTaxonomy(meta.taxonomy)
  return summary.correctiveActionCount
    + summary.structuralActionCount
    + meta.movedSessionCount
    + meta.droppedSessionCount
}
```

Las dos funciones deben mantenerse en sincronía; si diverge una, el score de producción y el de los tests dejan de medir lo mismo. Añadir el test que las ancla:

```ts
it('countRepairsV2 and countRepairsV2FromRepairMeta agree', () => {
  const meta = createRepairMeta(0)
  meta.movedSessionCount = 2
  meta.droppedSessionCount = 1
  for (let i = 0; i < 3; i++) {
    recordRepairAction(meta.taxonomy, 'corrective', `corrective-${i}`)
  }
  recordRepairAction(meta.taxonomy, 'structural', 'structural-0')
  for (let i = 0; i < 9; i++) {
    recordRepairAction(meta.taxonomy, 'hydration', `hydration-${i}`)
  }

  const week = buildWeekForTest({
    generationMeta: {
      attempts: 1,
      movedSessionCount: 2,
      droppedSessionCount: 1,
      correctiveActionCount: 3,
      structuralActionCount: 1,
      hydrationActionCount: 9,
    },
  })

  expect(countRepairsV2FromRepairMeta(meta)).toBe(countRepairsV2(week))
  expect(countRepairsV2(week)).toBe(7)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/qualityReviewV2.test.ts`
Expected: PASS — incluidos contrato de hidratación, no-doble-penalización, consistencia entre formas y default histórico v1.

- [ ] **Step 5: Verificar que la v1 histórica no se movió**

Run: `npx vitest run src/services/planBuilder`
Expected: PASS — los tests existentes de calidad siguen verdes porque la ruta v1 es idéntica.

- [ ] **Step 6: Commit (owner)**

```bash
git add src/services/planBuilder/qualityReview.ts src/types/planBuilder.ts src/services/planBuilder/__tests__/ src/components/planBuilder/PlanQualityBadge.tsx src/components/planBuilder/PlanQualityBadge.test.tsx src/services/__tests__/commitPlan.test.ts
git commit -m "feat(plan-builder): add quality_version 2 scoring without hydration penalty"
```

---

### Task 8: Propagar la taxonomía y fijar la regresión de Week Creator

**Files:**
- Modify: `src/services/planBuilder/generateWeekCore.ts`
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts`
- Modify: `src/services/planBuilder/generateWeek.ts`
- Modify: `src/services/planBuilder/generatePlan.ts`
- Modify: `src/services/weekCreator/WeekCreatorEngine.ts:879-903` (`buildRepairStats`)
- Modify: `src/types/index.ts`
- Test: `src/services/planBuilder/__tests__/generateWeekCore.test.ts`
- Test: `src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts`
- Test: `src/services/planBuilder/__tests__/generatePlanDegradation.test.ts`
- Test: `src/services/planBuilder/__tests__/deterministicPrimarySquashPlan.test.ts`
- Test: `src/services/weekCreator/__tests__/weekCreatorRepairStatsRegression.test.ts`
- Test: `src/services/weekCreator/__tests__/WeekCreatorEnginePhase3.test.ts`

**Interfaces:**
- Consumes: `summarizeTaxonomy` (Task 1), campos de `generationMeta` (Task 7).
- Produces: taxonomía serializable de punta a punta en `TrainingPlanWeek.generationMeta` y `repairStats`; `repairTaxonomyVersion = 2`. No activa `qualityVersion = 2`.

- [ ] **Step 1: Write characterization tests for the legacy contract**

Create `src/services/weekCreator/__tests__/weekCreatorRepairStatsRegression.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { repairGeneratedWeek } from '../../planBuilder/repairWeek'
import {
  buildRepairContextForTest,
  buildSkeletonSessionForTest,
} from '../../planBuilder/__tests__/helpers/repairTestFixtures'

describe('Week Creator repair contract regression', () => {
  it('keeps the exact all-zero tuple used by the Week Creator early return', () => {
    const context = buildRepairContextForTest({
      primarySport: 'running',
      phase: 'base',
      sessionsPerWeek: 1,
      targetLoadBySport: {},
    })
    const sessions = [
      buildSkeletonSessionForTest({
        sessionType: 'running',
        date: '2026-08-03',
        fullyHydrated: true,
      }),
    ]

    const { meta } = repairGeneratedWeek(sessions, context)

    expect([
      meta.repairedSessionCount,
      meta.movedSessionCount,
      meta.addedFallbackCount,
      meta.droppedSessionCount,
      meta.filteredSportCount,
    ]).toEqual([0, 0, 0, 0, 0])
  })

  it('keeps the orphan fallback legacy tuple exact', () => {
    const context = buildRepairContextForTest({
      primarySport: 'running',
      phase: 'base',
      sessionsPerWeek: 2,
      targetLoadBySport: {},
    })
    const sessions = [
      buildSkeletonSessionForTest({
        sessionType: 'running',
        date: '2026-08-03',
        fullyHydrated: true,
      }),
    ]

    const { meta } = repairGeneratedWeek(sessions, context)

    expect(meta.repairedSessionCount).toBe(0)
    expect(meta.movedSessionCount).toBe(0)
    expect(meta.addedFallbackCount).toBe(1)
    expect(meta.droppedSessionCount).toBe(0)
    expect(meta.filteredSportCount).toBe(0)
  })
})
```

Además, extender el fixture skeleton ya usado por `WeekCreatorEnginePhase3.test.ts`: antes de modificar `buildRepairStats`, ejecutar el test, capturar los cinco contadores legacy observados —incluido el objeto `hydration`— y fijarlos como literales en una aserción `toMatchObject`. Después de agregar campos, esos valores deben seguir idénticos. No usar tests de `typeof`.

- [ ] **Step 2: Run characterization tests before production changes**

Run: `npx vitest run src/services/weekCreator/__tests__/weekCreatorRepairStatsRegression.test.ts src/services/weekCreator/__tests__/WeekCreatorEnginePhase3.test.ts`
Expected: PASS. Estos tests caracterizan el contrato existente; si no pasan antes del cambio, corregir el fixture, no producción.

- [ ] **Step 3: Extender `buildRepairStats` de forma aditiva**

En `src/services/weekCreator/WeekCreatorEngine.ts:882`, agregar los campos nuevos **sin quitar ninguno**:

```ts
function buildRepairStats(
  meta: RepairMeta | undefined,
  hydrationMeta?: RepairMeta,
): AITechnicalResult['repairStats'] {
  if (!meta) return undefined
  return {
    repairedSessionCount: meta.repairedSessionCount,
    movedSessionCount: meta.movedSessionCount,
    addedFallbackCount: meta.addedFallbackCount,
    droppedSessionCount: meta.droppedSessionCount,
    filteredSportCount: meta.filteredSportCount,
    ...summarizeTaxonomy(meta.taxonomy),
    codes: [...new Set(meta.warnings.map((warning) => warning.code))],
    ...(hydrationMeta
      ? {
          hydration: {
            repairedSessionCount: hydrationMeta.repairedSessionCount,
            movedSessionCount: hydrationMeta.movedSessionCount,
            addedFallbackCount: hydrationMeta.addedFallbackCount,
            droppedSessionCount: hydrationMeta.droppedSessionCount,
            filteredSportCount: hydrationMeta.filteredSportCount,
            ...summarizeTaxonomy(hydrationMeta.taxonomy),
          },
        }
      : {}),
  }
}
```

Extender `AITechnicalResult['repairStats']` en `src/types/index.ts` con `repairTaxonomyVersion?: 2` y los seis campos opcionales de `RepairTaxonomySummary`, tanto en el nivel superior como dentro de `hydration`. La versión es necesaria para distinguir un summary completo en cero de una fila histórica sin instrumentación. La hidratación del skeleton ocurre en el primer paso; omitir el summary anidado perdería la señal central de esta fase.

Los ajustes de horario que `WeekCreatorEngine.ts` y `WeekCreatorLocalHydrator.ts` suman directamente a `repairedSessionCount` siguen siendo legacy-only en este plan. No inventarles categoría dentro de `buildRepairStats`: la taxonomía describe las acciones observadas por `repairGeneratedWeek`, y ampliar su frontera requeriría instrumentar esos loops por sesión en un cambio conductualmente separado.

- [ ] **Step 4: Propagar el summary por todas las capas del Plan Builder**

`generateWeekCore.ts:201` no escribe `generationMeta`; devuelve un meta intermedio. Propagar los seis campos serializables por:

1. `WeekActionEvaluation` y `GenerateWeekResult.meta`, en retornos exitosos y rechazados.
2. `asyncGenerationLoop.ts`:
   - `buildAttemptQualityReviewCacheKey`;
   - la `candidateWeek.generationMeta` usada por `reviewAttemptWeek`;
   - `makeResolvedWeek`;
   - `makeFallbackResolvedWeek`.
3. `generateWeek.ts` y `generatePlan.ts`, incluidas rutas determinísticas y de fallback local.

En cada `TrainingPlanWeek.generationMeta` nuevo agregar:

```ts
repairTaxonomyVersion: 2,
...taxonomySummary,
```

**No** agregar todavía `qualityVersion: 2`. El default productivo sigue en v1 hasta que el Plan 3 calibre y congele la penalización. El loadtest invoca v2 explícitamente.

La persistencia en `plan_generation_attempts` queda para el Plan 2, junto a la migración. Este task cierra la propagación en memoria/Dexie y evita que los campos se pierdan antes de esa frontera.

- [ ] **Step 5: Add end-to-end propagation tests**

En `generateWeekCore.test.ts`, verificar que una hidratación devuelve `hydrationActionCount > 0` y conserva `repairedSessionCount`.

En `asyncGenerationLoop.test.ts`, verificar que:

- la semana resuelta contiene los seis contadores y `repairTaxonomyVersion = 2`;
- la revisión por intento recibe `correctiveActionCount` / `structuralActionCount`;
- la ruta de fallback usa la taxonomía de `fallback.meta`, no la del intento fallido.

El quality gate productivo dentro de `runAsyncPlanGeneration` sigue evaluando v1 durante este plan. Los campos se propagan para no perderlos, pero el loadtest del Plan 3 calcula su lectura v2 al final con `reviewPlanQuality(plan, weeks, { qualityVersion: 2 })`; no cambia silenciosamente la política de retries.

En `generatePlanDegradation.test.ts`, cubrir la ruta `pairs` y el fallback local vacío; ambas deben conservar un summary versionado completo. En `deterministicPrimarySquashPlan.test.ts`, verificar la ruta determinística y que `qualityVersion` siga ausente. Si `WeekCreatorEnginePhase3.test.ts` usa una semana fija, mockear `todayISO` para que el fixture no cambie al cruzar esa fecha.

- [ ] **Step 6: Run the full affected suites**

Run: `npx vitest run src/services/planBuilder src/services/weekCreator`
Expected: PASS.

- [ ] **Step 7: Full verification**

Run: `npm run lint && npm test && npm run build`
Expected: los tres en verde. Registrar el conteo final de archivos/tests para actualizar `CLAUDE.md`.

- [ ] **Step 8: Commit (owner)**

```bash
git add src/services/planBuilder src/services/weekCreator src/types/planBuilder.ts src/types/index.ts
git commit -m "feat(plan-builder): propagate repair taxonomy and lock week creator regression"
```

---

## Cobertura del spec

| Requisito del spec | Task |
|---|---|
| §3.2 taxonomía por acciones atómicas | 1, 3, 4, 5 |
| §3.2 sesiones únicas separadas y fuera del score | 1, 7 |
| §3.2 `:2277` mapeado a estructural | 5 |
| §3.3 `countRepairs_v2` sin hidratación | 7 |
| §3.3 `filteredSportCount` fuera de la suma | 7 |
| §3.3 `addedFallbackCount` fuera de la suma | 7 |
| §3.3 `scoreWeek`/`scorePlan` versionados | 7 |
| §3.3 contrato de semana solo-hidratada | 7 |
| §3.3 contratos de no-doble-penalización | 5, 7 |
| §3.3 histórico sin marca resuelve v1 | 7 |
| §3.3 v2 rechaza semanas sin taxonomía v2 | 7 |
| §3.3 reviews persistidos sin versión resuelven v1 | 7 |
| §3.5 legacy intacto / Week Creator sin cambio conductual | 2, 5, 8 |
| §4 inventario completo clasificado con guard | 6 |
| §4 regresión de Week Creator | 8 |
| §5.3 umbral desactivado explícitamente | 7 |
| §5.3 v2 no se activa antes de calibración | 7, 8 |

**Fuera de este plan:** migración `016` y telemetría a nivel de job/intento (§3.1) van en el Plan 2. Instrumentación cross-week (§3.4), loadtest (§3.6), calibración de divisores/umbral y activación productiva de v2 (§5.3) van en el Plan 3.

---

## Riesgos

1. **La clasificación es criterio, no mecánica.** La tabla revisada fija 5 hidrataciones, 18 correctivas y 7 estructurales entre los 30 incrementos legacy, más `:2277` como estructural solo-taxonomía. Task 6 atrapa omisiones; los tests representativos y esta tabla mitigan categorías incorrectas.
2. **Activar v2 antes de calibrarlo inflaría scores.** El código queda opt-in y v1 sigue siendo el default. No cambiar `qualityVersion` de nuevas semanas a 2 hasta que el Plan 3 congele divisores y umbral.
3. **Los fixtures deben aislar una sola política.** Los helpers tipados de Tasks 3 y 7 parten de `repairWeekPhase2Wiring.test.ts` y `qualityReviewRepeatedTemplate.test.ts`, con fase `base`, fechas válidas y carga objetivo vacía donde corresponde. No usar `as never`; si cambia un contrato real, el fixture debe fallar al compilar.
4. **`:2277` es un punto de deriva legacy.** `recordTaxonomyOnly` preserva `repairedSessionCount`; el motivo es comparabilidad de `repairStats`, no la rama de early return, que ya observa `addedFallbackCount`.
5. **La propagación tiene varias capas enumerativas.** Los tests de Task 8 deben fallar si un campo llega a `generateWeekCore` pero se pierde en la semana resuelta, el fallback o la revisión por intento.
6. **Una mezcla de semanas legacy y v2 no es evaluable como v2.** La precondición de Task 7 falla de forma explícita en lugar de convertir campos ausentes en ceros. El Plan 3 debe filtrar ventanas completas con `repairTaxonomyVersion = 2`.
