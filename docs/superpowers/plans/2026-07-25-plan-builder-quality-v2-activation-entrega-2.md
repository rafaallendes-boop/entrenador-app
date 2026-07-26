# Quality v2 Activation — Entrega 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Congelar la calibración de reparación de `quality_version = 2` contra el control ya medido y activarla de forma efectiva, de modo que el score que se calcula y la versión que reporta la telemetría no puedan divergir.

**Architecture:** Un módulo nuevo de calibración guarda los tres contratos y la procedencia del control; `qualityReview.ts` los consume en vez de sus ceros y literales actuales; y el loop resuelve **una sola vez por corrida** la versión efectiva, la estampa en cada semana generada y la pasa explícitamente a todo review, en vez de dejar que se infiera del estado parcial del plan.

**Tech Stack:** TypeScript, Vitest, el runtime existente del Plan Builder.

Spec: `docs/superpowers/specs/2026-07-25-plan-builder-loadtest-and-quality-v2-activation.md`, §3.7-§3.10.
Control: `docs/superpowers/calibrations/plan-builder-v2-control-2026-07-25.json`, SHA-256 `6c45885a870cf7e019906a0b4d786e828b2653fe1643f95d436be3aa0ee94d7a`.

## Global Constraints

- Valores congelados por el owner el 2026-07-25 (registrados en `docs/superpowers/calibrations/README.md`): penalización semanal **divisor 1, tope 10**; penalización de plan **divisor 4, tope 8**; `highRepairWarningThreshold` **5**.
- **Nunca recalibrar por variante** (§5.3). Comparar contra otra variante exige repetir el manifest y contrastar contra estos valores.
- El guard de procedencia se ancla al **artefacto de control versionado**, no a la configuración productiva del momento: comparar contra producción rompería legítimamente al probar otra variante.
- El fingerprint del control cubre todas las dimensiones del descriptor **salvo `qualityVersion`**, incluido `provider`. El control se generó con `q1` y producción pasa a `q2`; exigir igualdad de `variant_id` es insatisfacible por construcción.
- `resolveEffectiveRunQualityVersion` corre **una sola vez y antes** de construir el descriptor de variante, para que etiqueta y scoring no puedan divergir.
- Las filas históricas quedan en `quality_version = 1`. No se recalculan, no se migran y **no se comparan** con v2.
- v1 debe quedar intacto: cualquier cambio que mueva un score v1 existente es un fallo de este plan.
- Los commits los hace el owner. Los pasos de commit se dejan listos pero no se ejecutan sin pedido explícito.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/services/planBuilder/qualityCalibrationV2.ts` | **Crear.** Los tres contratos congelados + registro de procedencia del control. |
| `src/services/planBuilder/telemetryVersions.ts` | **Modificar.** `buildRequestFingerprint` (todas las dimensiones menos `qualityVersion`). |
| `src/services/planBuilder/qualityReview.ts` | **Modificar.** Consumir la calibración; acotar la precondición de taxonomía; exportar `resolveEffectiveRunQualityVersion`. |
| `src/services/planBuilder/asyncGenerationLoop.ts` | **Modificar.** Resolver la versión efectiva, estamparla en cada semana y pasarla a todo review y a la telemetría. |
| `netlify/functions/_shared/planBuilderRunConfig.ts` | **Modificar.** Aceptar la versión efectiva de la corrida en vez de leer siempre la constante global. |
| `src/services/planBuilder/__tests__/qualityCalibrationV2.test.ts` | **Crear.** Guard de procedencia contra el artefacto versionado. |
| `src/services/planBuilder/__tests__/qualityReviewV2Calibrated.test.ts` | **Crear.** Bordes de divisor, tope, umbral y v1 intacto. |
| `src/services/planBuilder/__tests__/effectiveRunQualityVersion.test.ts` | **Crear.** Las cuatro formas de corrida de §3.10. |

---

### Task 1: Fingerprint de request sin `qualityVersion`

**Files:**
- Modify: `src/services/planBuilder/telemetryVersions.ts`
- Test: `src/services/planBuilder/__tests__/telemetryVersions.test.ts`

**Interfaces:**
- Consumes: `PlanBuilderVariantDescriptor` (existente).
- Produces: `buildRequestFingerprint(descriptor: PlanBuilderVariantDescriptor): string`.

- [ ] **Step 1: Write the failing test**

Agregar a `src/services/planBuilder/__tests__/telemetryVersions.test.ts`:

```ts
import { buildRequestFingerprint } from '../telemetryVersions'

const BASE = {
  provider: 'claude', model: 'claude-sonnet-4-6', effort: 'omitted', thinkingMode: 'omitted',
  temperature: 0.25, maxTokens: 5000, promptVersion: 'p1', schemaVersion: 's1',
  qualityVersion: 1 as const, concurrency: 3,
}

describe('buildRequestFingerprint', () => {
  it('ignores qualityVersion so a control survives the v1 to v2 flip', () => {
    expect(buildRequestFingerprint({ ...BASE, qualityVersion: 1 }))
      .toBe(buildRequestFingerprint({ ...BASE, qualityVersion: 2 }))
  })

  it('changes when any other dimension changes, including provider', () => {
    const base = buildRequestFingerprint(BASE)
    expect(buildRequestFingerprint({ ...BASE, provider: 'gemini' })).not.toBe(base)
    expect(buildRequestFingerprint({ ...BASE, model: 'otro' })).not.toBe(base)
    expect(buildRequestFingerprint({ ...BASE, effort: 'high' })).not.toBe(base)
    expect(buildRequestFingerprint({ ...BASE, thinkingMode: 'on' })).not.toBe(base)
    expect(buildRequestFingerprint({ ...BASE, temperature: 0.3 })).not.toBe(base)
    expect(buildRequestFingerprint({ ...BASE, maxTokens: 6000 })).not.toBe(base)
    expect(buildRequestFingerprint({ ...BASE, promptVersion: 'p2' })).not.toBe(base)
    expect(buildRequestFingerprint({ ...BASE, schemaVersion: 's2' })).not.toBe(base)
    expect(buildRequestFingerprint({ ...BASE, concurrency: 1 })).not.toBe(base)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/telemetryVersions.test.ts`
Expected: FAIL — `buildRequestFingerprint` no existe.

- [ ] **Step 3: Write the implementation**

En `telemetryVersions.ts`, después de `buildVariantId`:

```ts
/**
 * Identidad de la REQUEST, deliberadamente sin `qualityVersion`. Un control se
 * corre con `q1` y producción pasa a `q2`, así que el `variant_id` cambia por
 * construcción; el fingerprint es lo único que puede seguir representando "el
 * mismo control" a través del flip.
 */
export function buildRequestFingerprint(descriptor: PlanBuilderVariantDescriptor): string {
  const canonical = JSON.stringify([
    descriptor.provider, descriptor.model, descriptor.effort, descriptor.thinkingMode,
    descriptor.temperature, descriptor.maxTokens, descriptor.promptVersion,
    descriptor.schemaVersion, descriptor.concurrency,
  ])
  return fnv1a(canonical)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/telemetryVersions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (owner)**

```bash
git add src/services/planBuilder/telemetryVersions.ts src/services/planBuilder/__tests__/telemetryVersions.test.ts
git commit -m "feat(plan-builder): add a request fingerprint that survives the quality flip"
```

---

### Task 2: Calibración congelada y guard de procedencia

**Files:**
- Create: `src/services/planBuilder/qualityCalibrationV2.ts`
- Test: `src/services/planBuilder/__tests__/qualityCalibrationV2.test.ts`

**Interfaces:**
- Consumes: `buildRequestFingerprint` (Task 1).
- Produces:
  - `QUALITY_V2_CALIBRATION`: `{ weekRepairDivisor: 1, weekRepairPenaltyCap: 10, planRepairDivisor: 4, planRepairPenaltyCap: 8, highRepairWarningThreshold: 5 }`.
  - `QUALITY_V2_CONTROL`: registro de procedencia.

- [ ] **Step 1: Write the failing test**

Crear `src/services/planBuilder/__tests__/qualityCalibrationV2.test.ts`:

```ts
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { QUALITY_V2_CALIBRATION, QUALITY_V2_CONTROL } from '../qualityCalibrationV2'
import { PRODUCTIVE_QUALITY_VERSION } from '../qualityReview'
import { buildRequestFingerprint, buildVariantId } from '../telemetryVersions'

function readControl() {
  const path = resolve(process.cwd(), QUALITY_V2_CONTROL.artifactPath)
  const raw = readFileSync(path, 'utf8')
  return { raw, artifact: JSON.parse(raw) as Record<string, never> }
}

describe('quality v2 calibration provenance', () => {
  it('freezes the three contracts the owner chose', () => {
    expect(QUALITY_V2_CALIBRATION).toEqual({
      weekRepairDivisor: 1,
      weekRepairPenaltyCap: 10,
      planRepairDivisor: 4,
      planRepairPenaltyCap: 8,
      highRepairWarningThreshold: 5,
    })
  })

  it('cites an artifact that exists with the exact recorded hash', () => {
    const { raw } = readControl()
    expect(createHash('sha256').update(raw).digest('hex')).toBe(QUALITY_V2_CONTROL.artifactSha256)
  })

  it('matches the control descriptor: fingerprint, variant id and counts', () => {
    const { artifact } = readControl()
    const variant = (artifact as { variant: Parameters<typeof buildVariantId>[0] }).variant
    expect(buildVariantId(variant)).toBe(QUALITY_V2_CONTROL.controlGenerationVariantId)
    expect(buildRequestFingerprint(variant)).toBe(QUALITY_V2_CONTROL.controlRequestFingerprint)

    const plans = (artifact as { plans: { outcome: string, weeks: { scorable: boolean }[] }[] }).plans
    const complete = plans.filter((plan) => plan.outcome === 'succeeded')
    expect(complete).toHaveLength(QUALITY_V2_CONTROL.completePlans)
    expect(complete.reduce((sum, plan) => sum + plan.weeks.filter((week) => week.scorable).length, 0))
      .toBe(QUALITY_V2_CONTROL.scorableWeeks)
  })

  it('refuses a control produced from a dirty tree', () => {
    const { artifact } = readControl()
    expect((artifact as { git: { dirty: boolean, sha: string } }).git.dirty).toBe(false)
    expect(QUALITY_V2_CONTROL.gitDirty).toBe(false)
    expect((artifact as { git: { sha: string } }).git.sha).toBe(QUALITY_V2_CONTROL.gitSha)
  })

  it('does not let v2 go productive without a calibration record', () => {
    if (PRODUCTIVE_QUALITY_VERSION === 2) {
      expect(QUALITY_V2_CONTROL.artifactPath.length).toBeGreaterThan(0)
      expect(QUALITY_V2_CONTROL.artifactSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(QUALITY_V2_CONTROL.completePlans).toBeGreaterThanOrEqual(10)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/qualityCalibrationV2.test.ts`
Expected: FAIL — no se resuelve `../qualityCalibrationV2`.

- [ ] **Step 3: Write the calibration module**

Crear `src/services/planBuilder/qualityCalibrationV2.ts`:

```ts
/**
 * Calibración CONGELADA de la penalización de reparación de `quality_version = 2`,
 * elegida por el owner sobre el control medido (spec §3.8, §5.3).
 *
 * Los topes quedan deliberadamente POR ENCIMA del máximo observado en el control
 * (semana 6, plan 4): un tope igual al máximo saturaría justo donde empieza la
 * degradación que esta fase existe para detectar, y una variante peor puntuaría
 * igual que la peor semana del control.
 *
 * **Nunca recalibrar por variante.** Comparar contra otra variante exige repetir
 * el mismo manifest y contrastar contra estos valores; derivar valores nuevos
 * normalizaría una degradación real.
 */

export interface QualityV2Calibration {
  weekRepairDivisor: number
  weekRepairPenaltyCap: number
  planRepairDivisor: number
  planRepairPenaltyCap: number
  /** Sobre `correctiveActionCount + structuralActionCount`, NO sobre countRepairsV2. */
  highRepairWarningThreshold: number
}

export const QUALITY_V2_CALIBRATION: QualityV2Calibration = {
  weekRepairDivisor: 1,
  weekRepairPenaltyCap: 10,
  planRepairDivisor: 4,
  planRepairPenaltyCap: 8,
  highRepairWarningThreshold: 5,
}

export interface QualityV2ControlRecord {
  calibratedQualityVersion: 2
  /** Lleva `q1`: el control se corre ANTES del flip. */
  controlGenerationVariantId: string
  /** Todas las dimensiones salvo `qualityVersion`, incluido `provider`. */
  controlRequestFingerprint: string
  artifactPath: string
  artifactSha256: string
  artifactSchemaVersion: number
  completePlans: number
  scorableWeeks: number
  gitSha: string
  gitDirty: false
  calibratedAt: string
}

export const QUALITY_V2_CONTROL: QualityV2ControlRecord = {
  calibratedQualityVersion: 2,
  controlGenerationVariantId: 's46-q1-01bxcrr9',
  controlRequestFingerprint: '<completar en Step 4>',
  artifactPath: 'docs/superpowers/calibrations/plan-builder-v2-control-2026-07-25.json',
  artifactSha256: '6c45885a870cf7e019906a0b4d786e828b2653fe1643f95d436be3aa0ee94d7a',
  artifactSchemaVersion: 1,
  completePlans: 12,
  scorableWeeks: 42,
  gitSha: '7da37f94d656448810be0bb8cad240195814a372',
  gitDirty: false,
  calibratedAt: '2026-07-25',
}
```

- [ ] **Step 4: Fill the fingerprint from the artifact itself**

El fingerprint no se inventa: se computa del descriptor del control.

Run:
```bash
node --input-type=module -e "
import { readFile } from 'node:fs/promises'
const a = JSON.parse(await readFile('docs/superpowers/calibrations/plan-builder-v2-control-2026-07-25.json','utf8'))
console.log(JSON.stringify(a.variant))
"
```

Cargar `buildRequestFingerprint` con ese descriptor (vía un test temporal o `vite-node`) y pegar el valor resultante en `controlRequestFingerprint`. El test del Step 1 falla mientras no coincida, así que no hay forma de dejarlo mal.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/qualityCalibrationV2.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit (owner)**

```bash
git add src/services/planBuilder/qualityCalibrationV2.ts src/services/planBuilder/__tests__/qualityCalibrationV2.test.ts
git commit -m "feat(plan-builder): freeze the quality v2 calibration with control provenance"
```

---

### Task 3: Penalización de reparación calibrada

**Files:**
- Modify: `src/services/planBuilder/qualityReview.ts:651` (`scoreWeek`), `:670` (`scorePlan`)
- Test: `src/services/planBuilder/__tests__/qualityReviewV2Calibrated.test.ts`

**Interfaces:**
- Consumes: `QUALITY_V2_CALIBRATION` (Task 2).
- Produces: sin API nueva; cambia el valor de `scoreWeek`/`scorePlan` cuando `qualityVersion === 2`.

- [ ] **Step 1: Write the failing test**

Crear `src/services/planBuilder/__tests__/qualityReviewV2Calibrated.test.ts`. Usar los helpers de fixtures ya existentes en `qualityReviewV2.test.ts` para construir semanas con taxonomía v2; el patrón es una semana `draft` con `generationMeta.repairTaxonomyVersion = 2` y los contadores puestos a mano.

```ts
import { describe, expect, it } from 'vitest'

import { QUALITY_V2_CALIBRATION } from '../qualityCalibrationV2'
import { reviewPlanQuality } from '../qualityReview'
import { makePlanWithWeeks } from './helpers/qualityFixtures'

/** countRepairsV2 = corrective + structural + moved + dropped. */
function weekWithRepairs(weekIndex: number, corrective: number, structural: number) {
  return {
    weekIndex,
    repairTaxonomyVersion: 2 as const,
    correctiveActionCount: corrective,
    structuralActionCount: structural,
    movedSessionCount: 0,
    droppedSessionCount: 0,
  }
}

function scoreOf(weeks: ReturnType<typeof weekWithRepairs>[]) {
  const { plan, planWeeks } = makePlanWithWeeks(weeks)
  return reviewPlanQuality(plan, planWeeks, { qualityVersion: 2 })
}

describe('quality v2 calibrated repair penalty', () => {
  it('applies the frozen weekly divisor', () => {
    // divisor 1: 3 reparaciones = 3 puntos.
    const review = scoreOf([weekWithRepairs(0, 2, 1)])
    expect(review.weeks[0].score).toBe(100 - 3)
  })

  it('saturates the weekly penalty at the frozen cap', () => {
    const over = QUALITY_V2_CALIBRATION.weekRepairPenaltyCap + 5
    const review = scoreOf([weekWithRepairs(0, over, 0)])
    expect(review.weeks[0].score).toBe(100 - QUALITY_V2_CALIBRATION.weekRepairPenaltyCap)
  })

  it('applies the frozen plan divisor over the plan total', () => {
    // divisor 4 sobre 8 reparaciones totales = 2 puntos de plan.
    const review = scoreOf([weekWithRepairs(0, 4, 0), weekWithRepairs(1, 4, 0)])
    const average = (review.weeks[0].score + review.weeks[1].score) / 2
    expect(review.score).toBe(Math.round(average) - 2)
  })

  it('saturates the plan penalty at the frozen cap', () => {
    const perWeek = QUALITY_V2_CALIBRATION.planRepairDivisor
      * (QUALITY_V2_CALIBRATION.planRepairPenaltyCap + 3)
    const review = scoreOf([weekWithRepairs(0, perWeek, 0)])
    const average = review.weeks[0].score
    expect(review.score).toBe(average - QUALITY_V2_CALIBRATION.planRepairPenaltyCap)
  })

  it('leaves a hydration-only week at zero penalty', () => {
    const { plan, planWeeks } = makePlanWithWeeks([{
      weekIndex: 0,
      repairTaxonomyVersion: 2 as const,
      correctiveActionCount: 0,
      structuralActionCount: 0,
      movedSessionCount: 0,
      droppedSessionCount: 0,
      hydrationActionCount: 7,
    }])
    expect(reviewPlanQuality(plan, planWeeks, { qualityVersion: 2 }).weeks[0].score).toBe(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/qualityReviewV2Calibrated.test.ts`
Expected: FAIL — hoy la penalización v2 está cableada a `0`, así que los scores dan 100.

- [ ] **Step 3: Wire the calibration**

En `qualityReview.ts`, importar la calibración:

```ts
import { QUALITY_V2_CALIBRATION } from './qualityCalibrationV2'
```

En `scoreWeek`, reemplazar el cero por la fórmula calibrada:

```ts
  const repairPenalty = qualityVersion === 1
    ? Math.min(10, Math.floor(repairCount / 2))
    : Math.min(
        QUALITY_V2_CALIBRATION.weekRepairPenaltyCap,
        Math.floor(repairCount / QUALITY_V2_CALIBRATION.weekRepairDivisor),
      )
```

En `scorePlan`, lo mismo con los valores de plan:

```ts
  const repairPenalty = qualityVersion === 1
    ? Math.min(8, Math.floor(repairCount / 8))
    : Math.min(
        QUALITY_V2_CALIBRATION.planRepairPenaltyCap,
        Math.floor(repairCount / QUALITY_V2_CALIBRATION.planRepairDivisor),
      )
```

- [ ] **Step 4: Run tests, including the v1 regression**

Run: `npx vitest run src/services/planBuilder/__tests__/qualityReviewV2Calibrated.test.ts src/services/planBuilder/__tests__/qualityReviewV2.test.ts src/services/planBuilder/__tests__/typesQualityReview.test.ts`
Expected: PASS. **Cualquier score v1 que cambie es un fallo de este plan**, no un test que haya que actualizar.

- [ ] **Step 5: Commit (owner)**

```bash
git add src/services/planBuilder/qualityReview.ts src/services/planBuilder/__tests__/qualityReviewV2Calibrated.test.ts
git commit -m "feat(plan-builder): apply the frozen v2 repair penalty"
```

---

### Task 4: Umbral calibrado del warning

**Files:**
- Modify: `src/services/planBuilder/qualityReview.ts:448-457`
- Test: `src/services/planBuilder/__tests__/qualityReviewV2Calibrated.test.ts`

- [ ] **Step 1: Write the failing test**

Agregar al archivo de Task 3:

```ts
describe('quality v2 calibrated high repair warning', () => {
  const codeOf = (review: ReturnType<typeof scoreOf>) =>
    review.weeks[0].issues.map((issue) => issue.code)

  it('stays silent one repair below the frozen threshold', () => {
    const below = QUALITY_V2_CALIBRATION.highRepairWarningThreshold - 1
    expect(codeOf(scoreOf([weekWithRepairs(0, below, 0)])))
      .not.toContain('quality.generation.high_repair_count')
  })

  it('fires exactly at the frozen threshold', () => {
    const at = QUALITY_V2_CALIBRATION.highRepairWarningThreshold
    expect(codeOf(scoreOf([weekWithRepairs(0, at, 0)])))
      .toContain('quality.generation.high_repair_count')
  })

  it('reads corrective plus structural, not countRepairsV2', () => {
    // 6 reparaciones totales, pero solo 2 corrective+structural: no dispara.
    const review = scoreOf([{
      weekIndex: 0,
      repairTaxonomyVersion: 2 as const,
      correctiveActionCount: 1,
      structuralActionCount: 1,
      movedSessionCount: 2,
      droppedSessionCount: 2,
    }])
    expect(codeOf(review)).not.toContain('quality.generation.high_repair_count')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/qualityReviewV2Calibrated.test.ts`
Expected: FAIL en "fires exactly at the frozen threshold" — hoy `repairWarningEnabled` es `false` para v2.

- [ ] **Step 3: Enable the warning with the frozen threshold**

En `getGenerationReliabilityIssues`, reemplazar el gate deshabilitado:

```ts
  const threshold = qualityVersion === 1
    ? 8
    : QUALITY_V2_CALIBRATION.highRepairWarningThreshold
  if (repaired >= threshold) {
```

Borrar el comentario `// v2: threshold disabled until calibrated…` y la constante `repairWarningEnabled`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/qualityReviewV2Calibrated.test.ts src/services/planBuilder/__tests__/qualityReviewV2.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (owner)**

```bash
git add src/services/planBuilder/qualityReview.ts src/services/planBuilder/__tests__/qualityReviewV2Calibrated.test.ts
git commit -m "feat(plan-builder): enable the calibrated high repair warning for v2"
```

---

### Task 5: Versión efectiva de la corrida

**Files:**
- Modify: `src/services/planBuilder/qualityReview.ts`
- Test: `src/services/planBuilder/__tests__/effectiveRunQualityVersion.test.ts`

**Interfaces:**
- Produces: `resolveEffectiveRunQualityVersion(input: { weeks: TrainingPlanWeek[], targetWeekIndexes?: number[], productiveVersion: 1 | 2 }): 1 | 2`.

- [ ] **Step 1: Write the failing test**

Crear `src/services/planBuilder/__tests__/effectiveRunQualityVersion.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { TrainingPlanWeek } from '../../../types/planBuilder'
import { resolveEffectiveRunQualityVersion } from '../qualityReview'

function week(weekIndex: number, kind: 'legacy' | 'v2' | 'pending'): TrainingPlanWeek {
  const base = {
    id: `w${weekIndex}`, planId: 'p', weekIndex, weekStartDate: '2026-08-03',
    phase: 'build' as const, weekObjectives: [], targetLoadBySport: {},
    validationIssues: [], createdAt: 1, updatedAt: 1,
  }
  if (kind === 'pending') {
    return { ...base, status: 'pending', sessions: [], generationMeta: { attempts: 0 } } as TrainingPlanWeek
  }
  return {
    ...base,
    status: 'draft',
    sessions: [{}] as TrainingPlanWeek['sessions'],
    generationMeta: kind === 'v2'
      ? { attempts: 1, repairTaxonomyVersion: 2, qualityVersion: 2 }
      : { attempts: 1 },
  } as TrainingPlanWeek
}

describe('resolveEffectiveRunQualityVersion', () => {
  it('stays v1 while the productive constant is 1', () => {
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'pending'), week(1, 'pending')], productiveVersion: 1,
    })).toBe(1)
  })

  it('is v2 for a brand new plan where every week is a target', () => {
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'pending'), week(1, 'pending')], productiveVersion: 2,
    })).toBe(2)
  })

  it('is v2 for an explicit full regeneration of a legacy plan', () => {
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'legacy'), week(1, 'legacy')],
      targetWeekIndexes: [0, 1],
      productiveVersion: 2,
    })).toBe(2)
  })

  it('falls back to v1 when a legacy week stays outside the targets', () => {
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'legacy'), week(1, 'pending')],
      targetWeekIndexes: [1],
      productiveVersion: 2,
    })).toBe(1)
  })

  it('is v2 when every non-target week is already v2', () => {
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'v2'), week(1, 'pending')],
      targetWeekIndexes: [1],
      productiveVersion: 2,
    })).toBe(2)
  })

  it('treats a ready legacy week as an implicit target when no targets are given', () => {
    // Sin targets explícitos el loop OMITE las semanas listas, así que una
    // legacy lista NO la regenera nadie y la corrida no puede ser v2.
    expect(resolveEffectiveRunQualityVersion({
      weeks: [week(0, 'legacy'), week(1, 'pending')], productiveVersion: 2,
    })).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/effectiveRunQualityVersion.test.ts`
Expected: FAIL — la función no existe.

- [ ] **Step 3: Write the resolver**

En `qualityReview.ts`:

```ts
/**
 * Versión de calidad EFECTIVA de una corrida, resuelta una sola vez y antes de
 * construir el descriptor de variante, para que la etiqueta de la telemetría y
 * el score no puedan divergir.
 *
 * Los targets efectivos espejan el skip del loop: sin `targetWeekIndexes`
 * explícito, el loop lista todas las semanas pero OMITE las ya listas
 * (`asyncGenerationLoop.ts`). Tomar "todas" como targets haría que el conjunto
 * "fuera de targets" quedara vacío y una semana legacy ya lista activara v2 por
 * verdad vacua.
 */
export function resolveEffectiveRunQualityVersion(input: {
  weeks: TrainingPlanWeek[]
  targetWeekIndexes?: number[]
  productiveVersion: 1 | 2
}): 1 | 2 {
  if (input.productiveVersion === 1) return 1

  const effectiveTargets = new Set(
    input.targetWeekIndexes?.length
      ? input.targetWeekIndexes
      : input.weeks.filter((week) => !isReadyWeek(week)).map((week) => week.weekIndex),
  )

  const outsideTargets = input.weeks.filter((week) => !effectiveTargets.has(week.weekIndex))
  const allOutsideAreV2 = outsideTargets.every((week) =>
    week.generationMeta.repairTaxonomyVersion === 2 && week.generationMeta.qualityVersion === 2)

  return allOutsideAreV2 ? 2 : 1
}
```

`isReadyWeek` ya se importa en este módulo desde `./weekUtils`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/effectiveRunQualityVersion.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit (owner)**

```bash
git add src/services/planBuilder/qualityReview.ts src/services/planBuilder/__tests__/effectiveRunQualityVersion.test.ts
git commit -m "feat(plan-builder): resolve the effective quality version of a run"
```

---

### Task 6: Precondición de taxonomía acotada a semanas puntuables

**Files:**
- Modify: `src/services/planBuilder/qualityReview.ts:727` (`resolveQualityVersion`), `:42` (`PlanQualityContext`)
- Test: `src/services/planBuilder/__tests__/effectiveRunQualityVersion.test.ts`

**Interfaces:**
- Produces: `PlanQualityContext` gana `pendingTargetWeekIndexes?: number[]`.

- [ ] **Step 1: Write the failing test**

Agregar al archivo de Task 5:

```ts
import { reviewPlanQuality } from '../qualityReview'

describe('quality version precondition during a run', () => {
  const plan = { id: 'p', totalWeeks: 2, phases: [], macroSnapshot: { sportDetails: [] } } as never

  it('ignores pending shells when v2 is requested mid-run', () => {
    expect(() => reviewPlanQuality(plan, [week(0, 'v2'), week(1, 'pending')], {
      qualityVersion: 2,
    })).not.toThrow()
  })

  it('ignores target weeks this run has not replaced yet', () => {
    // Regeneración completa de un plan legacy: las semanas target todavía
    // llevan contenido viejo y por estado PARECEN listas.
    expect(() => reviewPlanQuality(plan, [week(0, 'legacy'), week(1, 'legacy')], {
      qualityVersion: 2,
      pendingTargetWeekIndexes: [0, 1],
    })).not.toThrow()
  })

  it('still throws when a non-target week lacks v2 taxonomy', () => {
    expect(() => reviewPlanQuality(plan, [week(0, 'legacy'), week(1, 'v2')], {
      qualityVersion: 2,
      pendingTargetWeekIndexes: [1],
    })).toThrow(/repairTaxonomyVersion/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/effectiveRunQualityVersion.test.ts`
Expected: FAIL — hoy `resolveQualityVersion` exige taxonomía v2 en **todas** las semanas.

- [ ] **Step 3: Narrow the precondition**

En `PlanQualityContext`:

```ts
export interface PlanQualityContext {
  profile?: AthleteProfile
  qualityVersion?: 1 | 2
  /** Targets que esta corrida todavía no reemplazó; no vetan la versión pedida. */
  pendingTargetWeekIndexes?: number[]
}
```

En `resolveQualityVersion`, acotar a semanas puntuables:

```ts
function resolveQualityVersion(
  weeks: TrainingPlanWeek[],
  requested?: 1 | 2,
  pendingTargetWeekIndexes?: number[],
): 1 | 2 {
  const pending = new Set(pendingTargetWeekIndexes ?? [])
  // Puntuable = lleva contenido generado Y no está pendiente de ser reemplazada
  // por esta corrida. Un shell no tiene metadata de reparación que interpretar,
  // y un target aún no procesado conserva contenido viejo que por estado parece
  // listo: incluirlos haría fallar la precondición contra su propia taxonomía
  // legacy justo en la corrida que viene a reemplazarla.
  const scorable = weeks.filter((week) =>
    !pending.has(week.weekIndex) && isReadyWeek(week))
  const hasV2Taxonomy = scorable.length > 0
    && scorable.every((week) => week.generationMeta.repairTaxonomyVersion === 2)

  if (requested === 2 && scorable.length > 0 && !hasV2Taxonomy) {
    throw new Error('quality_version 2 requires repairTaxonomyVersion 2')
  }
  if (requested != null) return requested

  return hasV2Taxonomy
    && scorable.every((week) => week.generationMeta.qualityVersion === 2)
    ? 2
    : 1
}
```

Y en `reviewPlanQuality`, pasar el tercer argumento:

```ts
  const qualityVersion = resolveQualityVersion(
    sortedWeeks,
    context.qualityVersion,
    context.pendingTargetWeekIndexes,
  )
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/services/planBuilder/__tests__/effectiveRunQualityVersion.test.ts src/services/planBuilder/__tests__/qualityReviewV2.test.ts src/services/planBuilder/__tests__/typesQualityReview.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (owner)**

```bash
git add src/services/planBuilder/qualityReview.ts src/services/planBuilder/__tests__/effectiveRunQualityVersion.test.ts
git commit -m "feat(plan-builder): scope the v2 taxonomy precondition to scorable weeks"
```

---

### Task 7: El loop estampa y consume la versión efectiva

**Files:**
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts` (`makeResolvedWeek`, `makeFallbackResolvedWeek`, `runAsyncPlanGeneration`, `reviewAttemptWeek`)
- Modify: `netlify/functions/_shared/planBuilderRunConfig.ts`
- Test: `src/services/planBuilder/__tests__/asyncGenerationLoopQualityVersion.test.ts`

**Interfaces:**
- Consumes: `resolveEffectiveRunQualityVersion` (Task 5), `pendingTargetWeekIndexes` (Task 6).
- Produces: `resolveEffectivePlanBuilderConfig(env, qualityVersion?)` acepta la versión efectiva de la corrida.

- [ ] **Step 1: Write the failing test**

Crear `src/services/planBuilder/__tests__/asyncGenerationLoopQualityVersion.test.ts`, reusando `makeRunInputForTest` de `./helpers/asyncLoopTestFixtures`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { runAsyncPlanGeneration } from '../asyncGenerationLoop'
import { makeRunInputForTest } from './helpers/asyncLoopTestFixtures'

vi.mock('../qualityReview', async (importActual) => {
  const actual = await importActual<typeof import('../qualityReview')>()
  return { ...actual, PRODUCTIVE_QUALITY_VERSION: 2 as const }
})

describe('quality version stamping', () => {
  it('stamps the effective run version on every generated week', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 2 })
    const written: { weekIndex: number, qualityVersion?: 1 | 2 }[] = []
    const writer = {
      ...base,
      async putWeek(week: { weekIndex: number, generationMeta: { qualityVersion?: 1 | 2 }, status: string }) {
        if (week.status === 'draft') {
          written.push({ weekIndex: week.weekIndex, qualityVersion: week.generationMeta.qualityVersion })
        }
      },
    }

    await runAsyncPlanGeneration({ ...input, writer: writer as never })

    expect(written).toHaveLength(2)
    for (const week of written) expect(week.qualityVersion).toBe(2)
  })

  it('reports the effective version on the job row, not the global constant', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 1, preReadyWeekIndexes: [] })
    const jobs: { variant: { qualityVersion: 1 | 2 } }[] = []
    const writer = { ...base, async putJob(job: { variant: { qualityVersion: 1 | 2 } }) { jobs.push(job) } }

    await runAsyncPlanGeneration({
      ...input,
      writer: writer as never,
      variant: {
        provider: 'claude', model: 'm', effort: null, thinkingMode: null,
        temperature: 0.25, maxTokens: 5000, promptVersion: 'p', schemaVersion: 's',
        qualityVersion: 2, concurrency: 3, variantId: 'v',
      },
    })

    expect(jobs[0].variant.qualityVersion).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/asyncGenerationLoopQualityVersion.test.ts`
Expected: FAIL — `qualityVersion` viene `undefined` en las semanas escritas.

- [ ] **Step 3: Stamp the week metadata**

`makeResolvedWeek` y `makeFallbackResolvedWeek` reciben la versión efectiva y la escriben junto a `repairTaxonomyVersion`. Agregar el parámetro a ambas firmas:

```ts
function makeResolvedWeek(
  week: TrainingPlanWeek,
  result: Awaited<ReturnType<typeof generateWeekCore>>,
  timestamp: number,
  qualityVersion: 1 | 2,
): TrainingPlanWeek {
```

y dentro de su `generationMeta`, junto a `repairTaxonomyVersion`:

```ts
      qualityVersion,
```

Idéntico en `makeFallbackResolvedWeek`. Actualizar las dos llamadas en `runAsyncPlanGeneration` para pasar `effectiveQualityVersion`.

- [ ] **Step 4: Resolve the effective version once, before the descriptor**

En `runAsyncPlanGeneration`, dentro del bloque previo al primer await (el mismo que ya calcula `targetWeekIndexes`):

```ts
  const effectiveQualityVersion = resolveEffectiveRunQualityVersion({
    weeks,
    targetWeekIndexes: input.targetWeekIndexes,
    productiveVersion: PRODUCTIVE_QUALITY_VERSION,
  })
```

El review de attempt pasa a ser explícito, con los targets todavía no escritos:

```ts
        const review = reviewPlanQuality(
          plan,
          replaceWeek(weeks, candidateWeek),
          {
            profile: input.profile,
            qualityVersion: effectiveQualityVersion,
            pendingTargetWeekIndexes: targetWeekIndexes.filter(
              (index) => index !== weekIndex && !terminalTargets.has(index)),
          },
        ).weeks.find((weekReview) => weekReview.weekIndex === weekIndex)
```

Y la revisión final del plan:

```ts
          qualityReview: reviewPlanQuality(plan, weeks, {
            profile: input.profile,
            qualityVersion: effectiveQualityVersion,
          }),
```

La telemetría de attempt y el descriptor del job reportan `effectiveQualityVersion` en vez de `input.variant?.qualityVersion`:

```ts
              qualityVersion: effectiveQualityVersion,
```

y en `finalizeJob`:

```ts
      variant: { ...input.variant, qualityVersion: effectiveQualityVersion },
```

- [ ] **Step 5: Let the caller pass the effective version**

En `netlify/functions/_shared/planBuilderRunConfig.ts`:

```ts
export function resolveEffectivePlanBuilderConfig(
  env: NodeJS.ProcessEnv,
  qualityVersion: 1 | 2 = PRODUCTIVE_QUALITY_VERSION,
): PlanBuilderVariantDescriptor {
```

y usar `qualityVersion` en el objeto devuelto. El caller de `generate-plan-background.ts` no cambia: el default preserva el comportamiento, y el loop corrige la etiqueta del job con la versión efectiva.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/services/planBuilder/__tests__/asyncGenerationLoopQualityVersion.test.ts src/services/planBuilder/__tests__/asyncGenerationLoopJobTelemetry.test.ts src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit (owner)**

```bash
git add src/services/planBuilder/asyncGenerationLoop.ts netlify/functions/_shared/planBuilderRunConfig.ts src/services/planBuilder/__tests__/asyncGenerationLoopQualityVersion.test.ts
git commit -m "feat(plan-builder): stamp and consume the effective quality version"
```

---

### Task 8: Flip a v2

**Files:**
- Modify: `src/services/planBuilder/qualityReview.ts:687`
- Test: `src/services/planBuilder/__tests__/productiveQualityVersion.test.ts` (ya existe)

- [ ] **Step 1: Confirm the contract test guards the flip**

Run: `npx vitest run src/services/planBuilder/__tests__/productiveQualityVersion.test.ts`
Expected: PASS con la constante todavía en 1. Leer el archivo y confirmar qué ancla exactamente antes de moverla.

- [ ] **Step 2: Flip the constant**

```ts
export const PRODUCTIVE_QUALITY_VERSION: 1 | 2 = 2
```

Actualizar el comentario: ya no dice "Hoy vale 1"; pasa a citar la calibración congelada y el control que la respalda.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: verde. Un plan nuevo ahora puntúa v2 de punta a punta; un plan mixto con semanas históricas sigue en v1 y su job lo reporta así.

- [ ] **Step 4: Commit (owner)**

```bash
git add src/services/planBuilder/qualityReview.ts
git commit -m "feat(plan-builder): activate quality v2 with the frozen calibration"
```

---

### Task 9: Verificación completa y documentación

**Files:**
- Modify: `CLAUDE.md`, `PROJECT_REVIEW_AND_ROADMAP.md`

- [ ] **Step 1: Full verification**

Run: `npm run lint && npm test && npm run build`
Expected: los tres en verde. Registrar el conteo final.

- [ ] **Step 2: Confirm no v1 score moved**

Run: `npx vitest run src/services/planBuilder/__tests__ --reporter=verbose 2>&1 | grep -i "quality"`
Expected: ningún test v1 actualizado en este plan. Si alguno cambió de valor esperado, revertir y entender por qué antes de seguir.

- [ ] **Step 3: Update docs**

En `CLAUDE.md`, actualizar el conteo de suite y cerrar el bloque de medición: `quality_version = 2` pasa de opt-in a productiva, con la calibración congelada citando el control `6c45885a`.

En `PROJECT_REVIEW_AND_ROADMAP.md`, agregar la entrada de Entrega 2 y marcar la Fase 0 de medición como cerrada, dejando anotado lo que queda: desplegar el bundle y smokear `plan_generation_jobs`.

- [ ] **Step 4: Commit (owner)**

```bash
git add CLAUDE.md PROJECT_REVIEW_AND_ROADMAP.md
git commit -m "docs: record quality v2 activation"
```

---

## Cobertura del spec

| Requisito | Task |
|---|---|
| §3.8 tres contratos congelados | 2, 3, 4 |
| §3.8 registro de procedencia con fingerprint sin `qualityVersion` | 1, 2 |
| §3.9 guard: ruta, SHA-256, fingerprint con `provider`, conteos, `gitDirty` | 2 |
| §3.9 falla si v2 está activa sin registro | 2 |
| §3.10 `resolveEffectiveRunQualityVersion` antes del descriptor | 5, 7 |
| §3.10 targets efectivos espejan el skip del loop | 5 |
| §3.10 precondición acotada a semanas puntuables y targets pendientes | 6 |
| §3.10 escritura de `generationMeta.qualityVersion` | 7 |
| §3.10 attempts/fallback/plan final consumen la versión efectiva | 7 |
| §3.10 telemetría reporta la versión efectiva, no la constante | 7 |
| §3.3 contrato de semana solo-hidratada | 3 |
| v1 intacto | 3, 9 |
| flip | 8 |

## Riesgos

1. **El flip cambia scores en producción.** Un plan nuevo pasa a puntuar con la penalización calibrada; los grades visibles al atleta pueden bajar. Es el efecto buscado, pero conviene desplegarlo sabiendo que `needs_review` va a aparecer más seguido que antes.
2. **Los planes mixtos quedan en v1 hasta una regeneración completa.** Es deliberado (§5.6), pero significa que durante un tiempo van a convivir planes puntuados con dos versiones. La telemetría lo distingue por `quality_version`; los análisis no deben mezclarlos.
3. **El guard depende de un archivo versionado.** Si alguien mueve o reescribe `docs/superpowers/calibrations/plan-builder-v2-control-2026-07-25.json`, el test falla — que es exactamente lo que debe pasar.
