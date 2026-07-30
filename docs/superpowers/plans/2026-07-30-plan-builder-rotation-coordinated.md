# Plan Builder — rotación determinista (fuerza + squash) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar la repetición sistemática de contenido en los planes generados
—`quality.strength.repeated_template` en 10/12 planes y
`quality.squash.low_drill_variety` en 6/8 planes de squash bajo configuración
productiva— mediante rotación determinista que no dependa de la semana previa.

**Architecture:** Dos implementaciones independientes que comparten dos piezas,
construidas primero: un resolvedor de identidad e índice de bloque y el patrón de
normalización única con dos razones (política determinista vs corrección
observada). La política se cuenta aparte de `countRepairsV2`; la corrección sigue
siendo `corrective`. **La política no lee otras semanas** —bajo concurrencia 3 no
existen todavía—; la razón correctiva **sí** consume una `previousWeek` con
`status === 'ready'` cuando está disponible, que es su definición.

**Tech Stack:** TypeScript, Vitest, Vite. Sin dependencias nuevas. Sin migraciones
Dexie (sigue en v18) ni Supabase, ni bump de backup.

## Specs congelados

- Fuerza: `docs/superpowers/specs/2026-07-27-plan-builder-strength-accessory-rotation-design.md`
- Squash: `docs/superpowers/specs/2026-07-30-plan-builder-squash-drill-rotation-design.md`

Ante cualquier duda, **el spec manda**. Este plan no reinterpreta contratos: los
implementa.

## Global Constraints

- **Los commits los hace el owner.** Los bloques `git commit` de este plan son
  **redacción sugerida**, no autorización. No ejecutar `git add` ni `git commit`
  salvo pedido explícito. Nunca usar `git add -A`: rutas explícitas siempre.
- **Antes de dar por terminada cualquier tarea:** `npm run lint && npm test && npm run build`.
- `npm test` es `vitest run`. Para un archivo: `npm test -- <ruta>`.
- **Determinismo estricto** en toda selección: sin `Math.random`, sin `Date`, sin
  depender del orden de iteración de un `Map`/`Set` no ordenado explícitamente.
  Mismo input ⇒ mismo output byte a byte.
- **`null` ≠ `0`** en toda telemetría. `null` es "no aplica"; `0` es "se midió y
  dio cero".
- **Nunca el literal `'default'`** fuera de `activeAthlete.ts` (hay guard test).
- **No tocar** `src/services/ai/promptBuilder.ts`.
- **No cambiar** la concurrencia (3) ni ninguna directiva de request: la Fase 2
  cerró con `high` productiva.
- **No agregar** una cuarta categoría a `RepairTaxonomyV2`.
- La allowlist de `scripts/loadtest-plan-builder/artifact.mjs` es **explícita**:
  agregar campos uno por uno, nunca copiar objetos enteros. `sessions` y
  `exercises` jamás entran.

## Fixtures de test — no escribir constructores nuevos

Ya existen y hay que reusarlos. Escribir builders propios duplica contratos que
después divergen:

| Helper | Archivo |
|---|---|
| `buildPlanForTest(overrides?)` | `src/services/planBuilder/__tests__/helpers/qualityTestFixtures.ts:13` |
| `buildWeekForTest(overrides?)` | `.../qualityTestFixtures.ts:74` |
| `buildRepairContextForTest(options?)` | `.../helpers/repairTestFixtures.ts:18` |
| `buildSkeletonSessionForTest(...)` | `.../helpers/repairTestFixtures.ts:122` |
| `makeRunInputForTest(options)` | `.../helpers/asyncLoopTestFixtures.ts:196` |

`buildRepairContextForTest` deberá aceptar `planWeekDescriptors` tras la Task 2;
extenderlo ahí, no en cada test.

**Los cuerpos de test enumerados en las Tasks 6, 8, 9, 10 y 11 son contratos, no
esqueletos:** cada ítem numerado es un `it(...)` que debe construir su escenario
con estos helpers, ejecutar, y afirmar. Ninguno puede quedar como comentario.

## File Structure

**Piezas compartidas (Hito 0):**

| Archivo | Responsabilidad |
|---|---|
| `src/services/planBuilder/blockIdentity.ts` (nuevo) | Identidad e índice de bloque, tres ramas. Única fuente para review y repair. |

**Fuerza (Hito 1):**

| Archivo | Responsabilidad |
|---|---|
| `src/services/planBuilder/strengthRoleContract.ts` (nuevo) | Resolución de rol por sesión, cinco reglas. Puro. |
| `src/services/planBuilder/qualityReview.ts` | Check sensible a roles; consume `blockIdentity`. |
| `src/services/training/strengthSelector.ts` | API de reemplazo completo. |
| `src/services/planBuilder/repairWeek.ts` | Normalización única de fuerza, dos razones. |

**Squash (Hito 2):**

| Archivo | Responsabilidad |
|---|---|
| `src/services/training/drillSelector.ts` | API de rotación sin válvula + niveles de relajación. |
| `src/services/planBuilder/repairWeek.ts` | Normalización única de contenido de squash. |
| `src/services/planBuilder/asyncGenerationLoop.ts` | `errorClass` no-fallback-eligible; descriptores de semana; `previousWeekContextSource` por semana. |

**Telemetría (ambos hitos):**

| Archivo | Responsabilidad |
|---|---|
| `scripts/loadtest-plan-builder/artifact.mjs` | Allowlist de `toWeekRow`. |
| `scripts/loadtest-plan-builder.mjs` | `buildWeekRows()` — derivadas al cerrar el plan. |

---

## Algoritmo canónico de asignación (compartido por Tasks 6 y 9)

**El problema.** Una normalización que arranca excluyendo "todo lo que hay ahora"
**no tiene punto fijo**: al correrla de nuevo, el contenido actual está en el
conjunto excluido y la fuerza a elegir otro sustituto. Eso rompe la idempotencia
que los dos specs exigen, y no se arregla con parches locales.

**La solución: asignación canónica conjunta.** El contenido objetivo de cada slot
es una **función pura del eje preservado del slot y de su coordenada**, calculada
para **todos** los slots de la semana a la vez:

```
1. Enumerar los slots contables de la semana en orden determinista:
   (ordinal de sesión, posición dentro de la sesión).
2. RESERVA PREVIA: recorrer TODOS los slots inmutables (los que no van a
   cambiar) y meter sus claves en `assignedKeys` ANTES de asignar nada.
3. Para cada slot mutable, derivar su EJE del contenido actual:
     fuerza  -> movement
     squash  -> (category, resolveSquashDrillKind)
4. Recorrer los slots mutables en orden y asignar a cada uno el primer candidato
   de su pool —ordenado de forma total y estable— que no esté en `assignedKeys`
   ni en la EXCLUSIÓN UNIFORME DE SEMANA. El índice de arranque es
   `rotationIndex` (§ coordenada).
5. Aplicar. Contar como acción SOLO los slots donde el asignado ≠ el actual.
```

**Paso 2 no es un detalle de orden.** Si los slots inmutables se reservaran a
medida que aparecen, un slot mutable anterior podría quedarse con el nombre de un
slot protegido posterior, y la asignación dejaría de ser función pura del conjunto
de ejes: dependería del orden de recorrido respecto de los protegidos.

**Exclusión uniforme de semana.** Las claves de `previousWeek` se excluyen
**siempre** que exista una `previousWeek` con `status === 'ready'` del mismo
bloque — **para las dos razones, no solo para la correctiva**.

Esto es lo que salva el punto fijo, y sin ello se pierde: en la primera pasada un
slot que colisiona es `corrective` y excluye `previousKeys`; una vez corregido, la
colisión desaparece y en la segunda pasada ese mismo slot pasa a `policy`. Si
`policy` no excluyera `previousKeys`, su pool sería **distinto**, el canónico sería
otro, y el slot volvería a rotar. La razón determina **si** un slot puede cambiar y
**cómo se cuenta**; nunca el pool.

**Punto fijo bajo relajación de eje (solo squash).** La correctiva de squash puede
relajar `category`/kind, y entonces el slot queda con un eje A' distinto del
original. En la segunda pasada la política estricta busca dentro de A', y no hay
garantía de que el valor actual sea su canónico.

Se resuelve **filtrando la enumeración correctiva**: en los niveles relajados solo
son elegibles los candidatos X que **ya son el canónico estricto de su propio eje**
en esa coordenada, es decir

```
X es elegible  ⟺  X == canonicalStrict(eje(X), coordenada, exclusiones)
```

Así, lo que la correctiva deja en el slot es siempre un punto fijo de la
proyección estricta y la segunda pasada no lo mueve. El costo es un espacio de
búsqueda menor y, por lo tanto, **más incidencia de fail-closed** — que es
exactamente lo que `squashSignatureUniquenessFailureAttemptCount` existe para
medir.

En fuerza este filtro no hace falta: `movement` se preserva en todos los casos, así
que el eje nunca cambia.

**Un slot se toca una sola vez por pasada.** La razón se decide **antes** de
asignar, sobre la entrada original:

```
razón(slot) = 'corrective'  si el slot colisiona con previousWeek ready del mismo bloque
            | 'policy'      si no colisiona y aplica política (indexInBlock > 0)
            | ninguna       en otro caso  -> el slot conserva su contenido
```

Nunca se aplica política y después correctiva sobre el mismo slot: eso lo
modificaría dos veces y violaría el desempate congelado a favor de `corrective`.

**Conteo.** `actionCount` = slots efectivamente cambiados por esa razón.
`sessionsAffected` = sesiones únicas con al menos un slot cambiado por esa razón.
Un slot cuyo canónico coincide con lo que ya había **no cuenta**.

---

# HITO 0 — Piezas compartidas

## Task 1: Resolvedor de identidad e índice de bloque

**Files:**
- Create: `src/services/planBuilder/blockIdentity.ts`
- Test: `src/services/planBuilder/__tests__/blockIdentity.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  ```ts
  export interface PlanWeekDescriptor { weekIndex: number; phase: string }
  export interface PlanPhaseDescriptor { phase: string; startWeekIndex: number; endWeekIndex: number }
  export interface BlockPosition { blockId: string; indexInBlock: number }
  export function resolveBlockPositions(
    phases: readonly PlanPhaseDescriptor[],
    weeks: readonly PlanWeekDescriptor[],
  ): Map<number, BlockPosition>
  ```

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/blockIdentity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveBlockPositions } from '../blockIdentity'

describe('resolveBlockPositions', () => {
  it('usa el rango declarado cuando la semana cae dentro de una fase', () => {
    const positions = resolveBlockPositions(
      [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 3 }],
      [0, 1, 2, 3].map((weekIndex) => ({ weekIndex, phase: 'build' })),
    )

    expect(positions.get(0)).toEqual({ blockId: 'build:0:3', indexInBlock: 0 })
    expect(positions.get(2)).toEqual({ blockId: 'build:0:3', indexInBlock: 2 })
  })

  it('da índices ordinales crecientes en planes legacy sin fases', () => {
    const positions = resolveBlockPositions(
      [],
      [
        { weekIndex: 5, phase: 'build' },
        { weekIndex: 2, phase: 'build' },
        { weekIndex: 9, phase: 'taper' },
      ],
    )

    // Ordinal por orden de weekIndex dentro del grupo, no por posición en el array.
    expect(positions.get(2)).toEqual({ blockId: 'build:legacy', indexInBlock: 0 })
    expect(positions.get(5)).toEqual({ blockId: 'build:legacy', indexInBlock: 1 })
    expect(positions.get(9)).toEqual({ blockId: 'taper:legacy', indexInBlock: 0 })
  })

  it('agrupa fases legacy no contiguas con el mismo nombre', () => {
    const positions = resolveBlockPositions(
      [],
      [
        { weekIndex: 0, phase: 'build' },
        { weekIndex: 1, phase: 'taper' },
        { weekIndex: 2, phase: 'build' },
      ],
    )

    expect(positions.get(0)?.blockId).toBe('build:legacy')
    expect(positions.get(2)?.blockId).toBe('build:legacy')
    expect(positions.get(2)?.indexInBlock).toBe(1)
  })

  it('da grupo unitario e índice 0 a semanas fuera de los rangos declarados', () => {
    const positions = resolveBlockPositions(
      [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1 }],
      [
        { weekIndex: 0, phase: 'build' },
        { weekIndex: 7, phase: 'peak' },
      ],
    )

    expect(positions.get(7)).toEqual({ blockId: 'peak:7:7', indexInBlock: 0 })
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/services/planBuilder/__tests__/blockIdentity.test.ts`
Expected: FAIL — `Failed to resolve import "../blockIdentity"`.

- [ ] **Step 3: Implementar**

Crear `src/services/planBuilder/blockIdentity.ts`:

```ts
/**
 * Identidad e índice de bloque, única fuente para el review de calidad y para
 * las normalizaciones de reparación. Si las dos capas divergen, la rotación se
 * reinicia en un punto distinto del que el check compara y el bug es silencioso.
 *
 * Replica exactamente las tres ramas de `getPlanPhaseForWeek` en qualityReview,
 * y corrige la única discrepancia real: en planes legacy el índice deja de ser
 * 0 para todas las semanas y pasa a ser la posición ordinal dentro del grupo.
 */

export interface PlanWeekDescriptor {
  weekIndex: number
  phase: string
}

export interface PlanPhaseDescriptor {
  phase: string
  startWeekIndex: number
  endWeekIndex: number
}

export interface BlockPosition {
  blockId: string
  indexInBlock: number
}

export function resolveBlockPositions(
  phases: readonly PlanPhaseDescriptor[],
  weeks: readonly PlanWeekDescriptor[],
): Map<number, BlockPosition> {
  const positions = new Map<number, BlockPosition>()
  // Orden explícito: el ordinal legacy no puede depender del orden de entrada.
  const ordered = [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)

  if (phases.length === 0) {
    const seenPerBlock = new Map<string, number>()
    for (const week of ordered) {
      const blockId = `${week.phase}:legacy`
      const indexInBlock = seenPerBlock.get(blockId) ?? 0
      seenPerBlock.set(blockId, indexInBlock + 1)
      positions.set(week.weekIndex, { blockId, indexInBlock })
    }
    return positions
  }

  for (const week of ordered) {
    const containing = phases.find(
      (phase) => week.weekIndex >= phase.startWeekIndex && week.weekIndex <= phase.endWeekIndex,
    )

    if (!containing) {
      // Grupo unitario: sin semana anterior, el check no puede disparar y la
      // rotación no debe aplicarse. Índice 0 es la respuesta correcta.
      positions.set(week.weekIndex, {
        blockId: `${week.phase}:${week.weekIndex}:${week.weekIndex}`,
        indexInBlock: 0,
      })
      continue
    }

    positions.set(week.weekIndex, {
      blockId: `${containing.phase}:${containing.startWeekIndex}:${containing.endWeekIndex}`,
      indexInBlock: week.weekIndex - containing.startWeekIndex,
    })
  }

  return positions
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/services/planBuilder/__tests__/blockIdentity.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit (redacción sugerida — la ejecuta el owner)**

```bash
git add src/services/planBuilder/blockIdentity.ts src/services/planBuilder/__tests__/blockIdentity.test.ts
git commit -m "feat(plan-builder): add shared block identity resolver"
```

---

## Task 2: Consumir el resolvedor en el review y propagar descriptores al repair

**Files:**
- Modify: `src/services/planBuilder/qualityReview.ts:467-473` (`getPlanPhaseForWeek`)
- Modify: `src/services/planBuilder/repairWeek.ts:47-53` (`RepairContext`)
- Modify: `src/services/planBuilder/repairWeek.ts:2687` (`computeWeekIndexInBlock`)
- Modify: `src/services/planBuilder/generateWeekCore.ts:179` (`validateGeneratedWeekAction`) **y** `GenerateWeekCoreInput`
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts` (todas las llamadas a generación)
- Modify: `src/services/planBuilder/fallbackWeek.ts` (si construye `RepairContext`)
- Test: `src/services/planBuilder/__tests__/blockIdentityEquivalence.test.ts`

> **El loop NO construye `RepairContext`.** Lo hace `validateGeneratedWeekAction`
> (`generateWeekCore.ts:179`), que hoy ya recibe `previousWeek` como sexto
> parámetro. Los descriptores tienen que viajar por el mismo camino: entrar a
> `GenerateWeekCoreInput`, atravesar **reintentos**, **generación legacy**,
> **fallback** y **Week Creator**, y recién ahí llegar al contexto. Enumerar todos
> los constructores antes de tocar nada:
>
> ```bash
> grep -rn "validateGeneratedWeekAction\|: RepairContext" src/ --include=*.ts | grep -v __tests__
> ```

**Interfaces:**
- Consumes: `resolveBlockPositions`, `PlanWeekDescriptor` (Task 1).
- Produces: `RepairContext.planWeekDescriptors: readonly PlanWeekDescriptor[]`.
  Toda normalización posterior lee el índice de bloque desde acá, nunca desde
  `computeWeekIndexInBlock`.

- [ ] **Step 1: Escribir el test de equivalencia que falla**

Crear `src/services/planBuilder/__tests__/blockIdentityEquivalence.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveBlockPositions } from '../blockIdentity'
import { getPlanPhaseForWeekForTest } from '../qualityReview'

describe('equivalencia review ↔ resolvedor de bloque', () => {
  const cases = [
    {
      name: 'plan con fases',
      phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 2 }],
      weeks: [0, 1, 2].map((weekIndex) => ({ weekIndex, phase: 'build' })),
    },
    {
      name: 'plan sin fases',
      phases: [],
      weeks: [0, 1, 2].map((weekIndex) => ({ weekIndex, phase: 'build' })),
    },
    {
      name: 'semana fuera de rango',
      phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1 }],
      weeks: [
        { weekIndex: 0, phase: 'build' },
        { weekIndex: 4, phase: 'peak' },
      ],
    },
  ]

  for (const testCase of cases) {
    it(`produce el mismo blockId que el review: ${testCase.name}`, () => {
      const positions = resolveBlockPositions(testCase.phases, testCase.weeks)

      for (const week of testCase.weeks) {
        expect(positions.get(week.weekIndex)?.blockId).toBe(
          getPlanPhaseForWeekForTest({ phases: testCase.phases }, week),
        )
      }
    })
  }

  // Comparar blockId NO detecta el bug que este resolvedor existe para cerrar:
  // `computeWeekIndexInBlock` devolvía 0 para TODAS las semanas legacy y su
  // blockId ya era correcto. El índice es la parte que estaba rota.
  it('da índices ordinales distintos a semanas legacy del mismo grupo', () => {
    const positions = resolveBlockPositions(
      [],
      [0, 1, 2].map((weekIndex) => ({ weekIndex, phase: 'build' })),
    )

    expect([0, 1, 2].map((index) => positions.get(index)?.indexInBlock)).toEqual([0, 1, 2])
  })
})
```

**Y un test de COMPORTAMIENTO, que es el que realmente cierra el bug.** Los de
arriba prueban el resolvedor; ninguno atraviesa el consumidor del repair, así que
una propagación incompleta pasaría igual. Agregar a la suite de repair:

```ts
describe('plan legacy sin phases: la política respeta el ordinal', () => {
  it('no rota en la semana ordinal 0 y sí rota en la ordinal 1', () => {
    // Plan SIN `phases`, dos semanas con la misma `phase: 'build'`, cada una con
    // una sesión de fuerza idéntica.
    //
    // Construir el RepairContext con buildRepairContextForTest, pasando
    // planWeekDescriptors = [{weekIndex:0,phase:'build'},{weekIndex:1,phase:'build'}].
    //
    // Ejecutar la normalización sobre la semana 0:
    //   -> strengthAccessoryRotationActionCount === 0  (ordinal 0, política off)
    // Ejecutar la normalización sobre la semana 1:
    //   -> strengthAccessoryRotationActionCount > 0    (ordinal 1, política on)
    //
    // Y confirmar que el review agrupa AMBAS en 'build:legacy', o el escenario
    // no está probando lo que dice probar.
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/services/planBuilder/__tests__/blockIdentityEquivalence.test.ts`
Expected: FAIL — `getPlanPhaseForWeekForTest` no está exportado.

- [ ] **Step 3: Reescribir `getPlanPhaseForWeek` sobre el resolvedor**

En `src/services/planBuilder/qualityReview.ts`, reemplazar la función privada por
un consumidor del resolvedor compartido y exponer un alias de test:

```ts
import { resolveBlockPositions, type PlanWeekDescriptor } from './blockIdentity'

function getPlanPhaseForWeek(plan: TrainingPlan, week: TrainingPlanWeek): string {
  const positions = resolveBlockPositions(plan.phases, [{ weekIndex: week.weekIndex, phase: week.phase }])
  return positions.get(week.weekIndex)?.blockId ?? `${week.phase}:legacy`
}

/** Solo para tests de equivalencia: no consumir en producción. */
export function getPlanPhaseForWeekForTest(
  plan: { phases: TrainingPlan['phases'] },
  week: PlanWeekDescriptor,
): string {
  const positions = resolveBlockPositions(plan.phases, [week])
  return positions.get(week.weekIndex)?.blockId ?? `${week.phase}:legacy`
}
```

> **Ojo:** el agrupamiento del review sigue usándose sobre **todas** las semanas
> del plan. Donde `getRepeatedStrengthTemplateIssues` y
> `getSquashDrillVarietyIssues` agrupan `byBlock`, pasar la lista completa de
> descriptores a `resolveBlockPositions` **una sola vez** y reusar el `Map`, en
> lugar de llamar por semana. Eso además hace correcto el ordinal legacy.

- [ ] **Step 4: Propagar descriptores hasta `RepairContext`**

En `src/services/planBuilder/repairWeek.ts`, extender la interfaz:

```ts
export interface RepairContext {
  plan: TrainingPlan
  week: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  previousWeek?: TrainingPlanWeek
  /**
   * Descriptores ordenados de TODAS las semanas del plan. Necesarios porque el
   * ordinal legacy no se puede calcular con `plan` y `week` solos.
   */
  planWeekDescriptors: readonly PlanWeekDescriptor[]
}
```

Y reemplazar `getWeekIndexInBlock(context)` por:

```ts
function getWeekIndexInBlock(context: RepairContext): number {
  const positions = resolveBlockPositions(context.plan.phases, context.planWeekDescriptors)
  return positions.get(context.week.weekIndex)?.indexInBlock ?? 0
}
```

`computeWeekIndexInBlock` queda **deprecada**: marcarla como tal y no usarla en
rutas nuevas.

- [ ] **Step 5: Poblar los descriptores en el loop**

En `src/services/planBuilder/asyncGenerationLoop.ts`, donde se arma el contexto de
reparación (alrededor de la línea 1006), agregar:

```ts
planWeekDescriptors: weeks.map((week) => ({ weekIndex: week.weekIndex, phase: week.phase })),
```

Hacer lo mismo en cualquier otro constructor de `RepairContext`. Buscarlos con:

```bash
grep -rn "previousWeek:" src/ --include=*.ts | grep -v __tests__
```

- [ ] **Step 6: Correr los tests**

Run: `npm test -- src/services/planBuilder/__tests__/blockIdentityEquivalence.test.ts`
Expected: PASS, 3 tests.

Run: `npm test -- src/services/planBuilder`
Expected: PASS. Si falla por `planWeekDescriptors` faltante en fixtures, agregarlo
a los helpers de test; **no** hacerlo opcional en el tipo.

- [ ] **Step 7: Commit (redacción sugerida)**

```bash
git add src/services/planBuilder/qualityReview.ts src/services/planBuilder/repairWeek.ts \
        src/services/planBuilder/generateWeekCore.ts \
        src/services/planBuilder/asyncGenerationLoop.ts \
        src/services/planBuilder/fallbackWeek.ts \
        src/services/planBuilder/__tests__/blockIdentityEquivalence.test.ts \
        src/services/planBuilder/__tests__/helpers/repairTestFixtures.ts
git commit -m "refactor(plan-builder): share block identity between review and repair"
```

> Agregar también los archivos de **generación legacy** y de **Week Creator** que
> el `grep` del encabezado haya revelado. El commit debe cubrir **toda** la
> propagación: si un constructor de `RepairContext` queda sin `planWeekDescriptors`,
> TypeScript lo marca, pero un constructor en un archivo no commiteado deja el
> árbol inconsistente.

---

# HITO 1 — Fuerza

## Task 3: Contrato de rol de fuerza

**Files:**
- Create: `src/services/planBuilder/strengthRoleContract.ts`
- Test: `src/services/planBuilder/__tests__/strengthRoleContract.test.ts`

**Interfaces:**
- Consumes: `findStrengthExerciseByName` de `src/services/training/exerciseLibrary.ts`.
- Produces:
  ```ts
  export type StrengthContractRole = 'main_lift' | 'accessory' | 'trunk' | 'power' | 'unknown'
  export function resolveSessionStrengthRoles(
    exercises: ReadonlyArray<{ name: string }>,
  ): StrengthContractRole[]
  export function isCountableRole(role: StrengthContractRole): boolean
  export function collectCountableKeys(
    sessions: ReadonlyArray<{ sessionType?: string; exercises?: ReadonlyArray<{ name: string }> }>,
  ): Set<string>
  export function collectAllStrengthKeys(
    sessions: ReadonlyArray<{ sessionType?: string; exercises?: ReadonlyArray<{ name: string }> }>,
  ): Set<string>
  ```

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/strengthRoleContract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveSessionStrengthRoles } from '../strengthRoleContract'
import { STRENGTH_EXERCISE_LIBRARY } from '../../training/exerciseLibrary'

const byCategory = (category: string) =>
  STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.category === category)!.name
const byIntensity = (intensityType: string) =>
  STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.intensityType === intensityType)!.name
const plainLift = () =>
  STRENGTH_EXERCISE_LIBRARY.find(
    (exercise) => exercise.category !== 'core' && exercise.intensityType !== 'power',
  )!.name

describe('resolveSessionStrengthRoles', () => {
  it('exime al primer ejercicio reconocido que no sea core ni power', () => {
    const roles = resolveSessionStrengthRoles([{ name: plainLift() }, { name: plainLift() }])
    expect(roles[0]).toBe('main_lift')
    expect(roles[1]).toBe('accessory')
  })

  it('core al principio no consume el cupo de main_lift', () => {
    const roles = resolveSessionStrengthRoles([{ name: byCategory('core') }, { name: plainLift() }])
    expect(roles[0]).toBe('trunk')
    expect(roles[1]).toBe('main_lift')
  })

  it('power al principio no consume el cupo de main_lift', () => {
    const roles = resolveSessionStrengthRoles([{ name: byIntensity('power') }, { name: plainLift() }])
    expect(roles[0]).toBe('power')
    expect(roles[1]).toBe('main_lift')
  })

  it('una sesión solo de core/power no tiene ninguna exención', () => {
    const roles = resolveSessionStrengthRoles([
      { name: byCategory('core') },
      { name: byIntensity('power') },
    ])
    expect(roles).not.toContain('main_lift')
  })

  it('un ejercicio desconocido nunca obtiene la exención', () => {
    const roles = resolveSessionStrengthRoles([
      { name: 'Ejercicio Inventado Que No Existe' },
      { name: plainLift() },
    ])
    expect(roles[0]).toBe('unknown')
    expect(roles[1]).toBe('main_lift')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- src/services/planBuilder/__tests__/strengthRoleContract.test.ts`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Implementar**

Crear `src/services/planBuilder/strengthRoleContract.ts`:

```ts
import {
  findStrengthExerciseByName,
  normalizeStrengthExerciseKey,
} from '../training/exerciseLibrary'

/**
 * Contrato de rol para el check de repetición y para la rotación de accesorios.
 * NO reemplaza `getStrengthExerciseRole` de exerciseLibrary, que es posicional y
 * la consume `strengthSelector`. Las dos coexisten a propósito, con dueños
 * distintos: unificarlas arrastraría al selector a un cambio de scoring.
 *
 * Reglas, en orden, por sesión:
 *   1. core            -> trunk    (contable)
 *   2. power           -> power    (contable)
 *   3. primer restante reconocido por catálogo -> main_lift (EXENTO)
 *   4. siguientes      -> accessory (contable)
 *   5. desconocido     -> unknown  (contable; nunca exento)
 */
export type StrengthContractRole = 'main_lift' | 'accessory' | 'trunk' | 'power' | 'unknown'

export function isCountableRole(role: StrengthContractRole): boolean {
  return role !== 'main_lift'
}

export function resolveSessionStrengthRoles(
  exercises: ReadonlyArray<{ name: string }>,
): StrengthContractRole[] {
  let mainLiftTaken = false

  return exercises.map((exercise) => {
    const definition = findStrengthExerciseByName(exercise.name)
    if (!definition) return 'unknown'
    if (definition.category === 'core') return 'trunk'
    if (definition.intensityType === 'power') return 'power'
    if (!mainLiftTaken) {
      mainLiftTaken = true
      return 'main_lift'
    }
    return 'accessory'
  })
}

type StrengthSessionLike = {
  sessionType?: string
  exercises?: ReadonlyArray<{ name: string }>
}

/** Nombres que aparecen AL MENOS UNA VEZ en posición no principal. */
export function collectCountableKeys(sessions: ReadonlyArray<StrengthSessionLike>): Set<string> {
  const keys = new Set<string>()
  for (const session of sessions) {
    if (session.sessionType !== 'strength') continue
    const exercises = session.exercises ?? []
    const roles = resolveSessionStrengthRoles(exercises)
    exercises.forEach((exercise, index) => {
      if (!isCountableRole(roles[index]!)) return
      const key = normalizeStrengthExerciseKey(exercise.name)
      if (key) keys.add(key)
    })
  }
  return keys
}

/** Todos los nombres de fuerza, sin distinción de rol. */
export function collectAllStrengthKeys(sessions: ReadonlyArray<StrengthSessionLike>): Set<string> {
  const keys = new Set<string>()
  for (const session of sessions) {
    if (session.sessionType !== 'strength') continue
    for (const exercise of session.exercises ?? []) {
      const key = normalizeStrengthExerciseKey(exercise.name)
      if (key) keys.add(key)
    }
  }
  return keys
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- src/services/planBuilder/__tests__/strengthRoleContract.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit (redacción sugerida)**

```bash
git add src/services/planBuilder/strengthRoleContract.ts src/services/planBuilder/__tests__/strengthRoleContract.test.ts
git commit -m "feat(plan-builder): add shared strength role contract"
```

---

## Task 4: Check de fuerza sensible a roles

**Files:**
- Modify: `src/services/planBuilder/qualityReview.ts:475-530`
- Test: `src/services/planBuilder/__tests__/repeatedTemplateRoleAware.test.ts`

**Interfaces:**
- Consumes: `collectCountableKeys`, `collectAllStrengthKeys` (Task 3);
  `resolveBlockPositions` (Task 1).
- Produces: `getRepeatedStrengthTemplateIssues` con la comparación de §3.2 del
  spec de fuerza. Umbral **≥3 sin cambios**.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/repeatedTemplateRoleAware.test.ts`. Usar
los helpers de fixture existentes de `src/services/planBuilder/__tests__/helpers`
para armar plan y semanas; el test debe cubrir:

```ts
import { describe, expect, it } from 'vitest'
import { reviewPlanQuality } from '../qualityReview'
import { buildPlanForTest, buildWeekForTest } from './helpers/qualityTestFixtures'
import { buildSkeletonSessionForTest } from './helpers/repairTestFixtures'
import { STRENGTH_EXERCISE_LIBRARY } from '../../training/exerciseLibrary'

// Lifts "planos": ni core ni power, así que el primero de la lista es main_lift.
const plainLifts = STRENGTH_EXERCISE_LIBRARY
  .filter((exercise) => exercise.category !== 'core' && exercise.intensityType !== 'power')
  .map((exercise) => exercise.name)

const [MAIN_A, MAIN_B, ACC_1, ACC_2, ACC_3, ACC_4, ACC_5, ACC_6] = plainLifts

// Fechas explícitas por (semana, sesión): la interpolación aritmética producía
// `2026-08-010` para weekIndex=1, que no es una fecha ISO válida.
const SESSION_DATES: Record<number, string[]> = {
  0: ['2026-08-03', '2026-08-05'],
  1: ['2026-08-10', '2026-08-12'],
}

function strengthWeek(weekIndex: number, exerciseNames: string[][]) {
  return buildWeekForTest({
    weekIndex,
    phase: 'base',
    sessions: exerciseNames.map((names, index) =>
      buildSkeletonSessionForTest({
        date: SESSION_DATES[weekIndex]![index]!,
        sessionType: 'strength',
        fullyHydrated: true,
        exercises: names.map((name) => ({ name, sets: 3, reps: '8' })),
      }),
    ),
  })
}

function codesFor(weeks: ReturnType<typeof strengthWeek>[]): string[] {
  const plan = buildPlanForTest({
    totalWeeks: weeks.length,
    phases: [{ phase: 'base', startWeekIndex: 0, endWeekIndex: weeks.length - 1 }],
  })
  const review = reviewPlanQuality(plan, weeks, { qualityVersion: 2 })
  return review.weeks.flatMap((week) => week.issues.map((issue) => issue.code))
}

describe('quality.strength.repeated_template sensible a roles', () => {
  it('no marca cuando el único solape es el main lift de cada sesión', () => {
    const codes = codesFor([
      strengthWeek(0, [[MAIN_A, ACC_1, ACC_2, ACC_3]]),
      strengthWeek(1, [[MAIN_A, ACC_4, ACC_5, ACC_6]]),
    ])
    expect(codes).not.toContain('quality.strength.repeated_template')
  })

  it('marca con 3 accesorios compartidos aunque el main lift difiera', () => {
    const codes = codesFor([
      strengthWeek(0, [[MAIN_A, ACC_1, ACC_2, ACC_3]]),
      strengthWeek(1, [[MAIN_B, ACC_1, ACC_2, ACC_3]]),
    ])
    expect(codes).toContain('quality.strength.repeated_template')
  })

  it('cuenta un principal de la semana anterior que baja a accesorio en la posterior', () => {
    // MAIN_A es main_lift en la semana 0 y accesorio (posición 3) en la 1.
    // Con ACC_1 y ACC_2 compartidos, el solape contable llega a 3.
    const codes = codesFor([
      strengthWeek(0, [[MAIN_A, ACC_1, ACC_2, ACC_4]]),
      strengthWeek(1, [[MAIN_B, ACC_1, ACC_2, MAIN_A]]),
    ])
    expect(codes).toContain('quality.strength.repeated_template')
  })

  it('cuenta una sola vez un ejercicio principal y accesorio en la misma semana', () => {
    // En la semana 1, MAIN_A es main_lift en la sesión A y accesorio en la B.
    // Aporta 1 al solape, no 2: con solo ACC_1 más, quedan 2 < 3 y NO marca.
    const codes = codesFor([
      strengthWeek(0, [[MAIN_A, ACC_1, ACC_4]]),
      strengthWeek(1, [[MAIN_A, ACC_1, ACC_5], [MAIN_B, MAIN_A, ACC_6]]),
    ])
    expect(codes).not.toContain('quality.strength.repeated_template')
  })
})
```

> Verificar la firma real de `reviewPlanQuality` y de `buildSkeletonSessionForTest`
> antes de correr: si `exercises` no es una opción del skeleton, extender el helper
> **una vez** en lugar de construir sesiones a mano en cada test.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- src/services/planBuilder/__tests__/repeatedTemplateRoleAware.test.ts`
Expected: FAIL — hoy el check cuenta nombres planos y marca el caso 1.

- [ ] **Step 3: Reimplementar el check**

Reemplazar `getStrengthExerciseKeys` y el cuerpo de
`getRepeatedStrengthTemplateIssues`:

```ts
import { collectAllStrengthKeys, collectCountableKeys } from './strengthRoleContract'

function getRepeatedStrengthTemplateIssues(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const generated = weeks
    .filter((week) => week.sessions.length > 0)
    .sort((a, b) => a.weekIndex - b.weekIndex)

  const positions = resolveBlockPositions(
    plan.phases,
    generated.map((week) => ({ weekIndex: week.weekIndex, phase: week.phase })),
  )

  const byBlock = new Map<string, TrainingPlanWeek[]>()
  for (const week of generated) {
    const blockId = positions.get(week.weekIndex)?.blockId ?? `${week.phase}:legacy`
    byBlock.set(blockId, [...(byBlock.get(blockId) ?? []), week])
  }

  for (const blockWeeks of byBlock.values()) {
    const perWeek = blockWeeks.map((week) => ({
      week,
      countable: collectCountableKeys(week.sessions),
      all: collectAllStrengthKeys(week.sessions),
    }))

    for (let j = 1; j < perWeek.length; j++) {
      const current = perWeek[j]!
      if (current.countable.size === 0) continue

      let worstOverlap = 0
      let worstWeek: TrainingPlanWeek | undefined
      for (let i = 0; i < j; i++) {
        const earlier = perWeek[i]!
        if (earlier.all.size === 0) continue
        const overlap = [...current.countable].filter((key) => earlier.all.has(key)).length
        if (overlap > worstOverlap) {
          worstOverlap = overlap
          worstWeek = earlier.week
        }
      }

      if (worstOverlap < 3 || !worstWeek) continue

      issues.push(issue({
        severity: 'warning',
        code: 'quality.strength.repeated_template',
        message: `Semanas ${worstWeek.weekIndex + 1} y ${current.week.weekIndex + 1} del bloque ${current.week.phase} comparten ${worstOverlap} accesorios de fuerza.`,
        weekIndex: current.week.weekIndex,
      }))
    }
  }

  return issues
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- src/services/planBuilder/__tests__/repeatedTemplateRoleAware.test.ts`
Expected: PASS, 4 tests.

Run: `npm test -- src/services/planBuilder/__tests__/crossWeekStrengthDuplicates.test.ts`
Expected: PASS. Si falla, revisar si el caso esperaba el conteo por nombre plano;
actualizar la expectativa **solo** si contradice el contrato congelado de §3.2.

- [ ] **Step 5: Commit (redacción sugerida)**

```bash
git add src/services/planBuilder/qualityReview.ts src/services/planBuilder/__tests__/repeatedTemplateRoleAware.test.ts
git commit -m "feat(plan-builder): make repeated_template check role-aware"
```

---

## Task 5: API de reemplazo completo en el selector de fuerza

**Files:**
- Modify: `src/services/training/strengthSelector.ts`
- Test: `src/services/training/__tests__/strengthReplacementApi.test.ts`

**Interfaces:**
- Consumes: `STRENGTH_EXERCISE_LIBRARY`, filtros y prescripción existentes del selector.
- Produces:
  ```ts
  export interface StrengthReplacementRequest {
    originalName: string
    context: StrengthContext
    excludedKeys: ReadonlySet<string>
    rotationIndex: number
    /**
     * Posición del ejercicio dentro de la sesión. La prescripción del selector
     * depende de ella (el primer slot no se prescribe igual que un accesorio
     * tardío), y sin este dato el reemplazo no es construible.
     */
    exerciseIndex: number
  }
  export function selectStrengthReplacement(
    request: StrengthReplacementRequest,
  ): StrengthSelectionExercise | undefined
  ```
  **El tipo de retorno es `StrengthSelectionExercise`** (`strengthSelector.ts:49`),
  no `SessionExercise`: es el tipo con el que trabaja el selector y el que trae
  `sets`, `reps`, `intensity`, `group`, `targetPercent1RM` y `targetRpe`. La
  conversión a la forma de sesión, si hace falta, es responsabilidad del llamador
  y debe reusar la que ya exista en `repairWeek`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/training/__tests__/strengthReplacementApi.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectStrengthReplacement } from '../strengthSelector'
import { findStrengthExerciseByName, normalizeStrengthExerciseKey } from '../exerciseLibrary'
// Reusar el constructor de StrengthContext que ya usan los tests del selector.

describe('selectStrengthReplacement', () => {
  it('preserva el movement del ejercicio original', () => {
    // Elegir un original con movement conocido; afirmar que el reemplazo
    // tiene el mismo `movement`.
  })

  it('no devuelve un ejercicio del conjunto excluido', () => {
    // excludedKeys con todos los candidatos menos uno => devuelve ese uno.
  })

  it('devuelve undefined cuando no queda candidato', () => {
    // excludedKeys con TODOS los candidatos del movement => undefined.
  })

  it('no hereda targetPercent1RM de un original con referencia de 1RM', () => {
    // Original con has1RMReference; reemplazo sin ella.
    // El resultado no puede traer targetPercent1RM.
  })

  it('es determinista: mismo rotationIndex da el mismo resultado', () => {
    // Dos llamadas idénticas => mismo `name`.
  })
})
```

> Completar los cuerpos con el constructor de `StrengthContext` que ya existe en
> los tests del selector (`strengthSelectorPhase2.test.ts` tiene uno).

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- src/services/training/__tests__/strengthReplacementApi.test.ts`
Expected: FAIL — `selectStrengthReplacement` no exportada.

- [ ] **Step 3: Implementar**

En `src/services/training/strengthSelector.ts`, agregar:

```ts
/**
 * Reemplazo enfocado para la rotación de accesorios. Construye el ejercicio
 * COMPLETO con los filtros y la prescripción normales del selector: no parchea
 * `name` sobre la prescripción anterior, que dejaría notas de otro movimiento o
 * un `targetPercent1RM` sin referencia de 1RM.
 *
 * Determinista: el orden del pool es total y estable, con `id` como desempate.
 */
export interface StrengthReplacementRequest {
  originalName: string
  context: StrengthContext
  excludedKeys: ReadonlySet<string>
  rotationIndex: number
  /** La prescripción depende de la posición dentro de la sesión. */
  exerciseIndex: number
}

export function selectStrengthReplacement(
  request: StrengthReplacementRequest,
): StrengthSelectionExercise | undefined {
  const original = findStrengthExerciseByName(request.originalName)
  if (!original) return undefined

  const candidates = STRENGTH_EXERCISE_LIBRARY
    .filter((candidate) => candidate.movement === original.movement)
    .filter((candidate) => !request.excludedKeys.has(normalizeStrengthExerciseKey(candidate.name)))
    .filter((candidate) => isCandidateAllowedInContext(candidate, request.context))
    .sort((a, b) => a.id.localeCompare(b.id))

  if (candidates.length === 0) return undefined

  const picked = candidates[request.rotationIndex % candidates.length]!
  return buildPrescribedExercise(picked, request.context, request.exerciseIndex)
}
```

Donde `isCandidateAllowedInContext` y `buildPrescribedExercise` **no existen hoy
como funciones**: hay que extraerlas de `selectBlockStrengthSession`
(`strengthSelector.ts:132+`), donde la elegibilidad y la prescripción están
entrelazadas con el armado de la plantilla de bloque.

**Extraer sin characterization tests es la forma más fácil de romper el selector
en silencio.** Por eso este paso se hace en dos tiempos:

- [ ] **Step 3a: Characterization tests ANTES de extraer**

Crear `src/services/training/__tests__/strengthSelectorCharacterization.test.ts`
que fije el comportamiento **actual** de `selectStrengthSession` sobre una matriz
de contextos —fase × fatiga × equipamiento × `weekIndexInBlock`— comparando la
salida completa (nombres, `sets`, `reps`, `intensity`, `group`,
`targetPercent1RM`, `targetRpe`) contra snapshots inline.

Run: `npm test -- src/services/training/__tests__/strengthSelectorCharacterization.test.ts`
Expected: PASS. **Son la red de seguridad: si fallan después de la extracción, la
extracción cambió comportamiento y hay que revertirla, no actualizar el snapshot.**

- [ ] **Step 3b: Extraer y verificar**

Extraer las dos funciones **sin cambiar lógica**, y volver a correr los
characterization tests.

Run: `npm test -- src/services/training/__tests__/strengthSelectorCharacterization.test.ts`
Expected: PASS, idénticos.

> Si la prescripción resulta inseparable del armado de plantilla, **detenerse y
> reportar**: la alternativa es que `selectStrengthReplacement` arme una sesión de
> un solo slot con la plantilla del bloque y tome el ejercicio en `exerciseIndex`,
> lo cual es más caro pero no requiere extracción. Esa decisión es del owner, no
> del implementador.

- [ ] **Step 4: Correr los tests**

Run: `npm test -- src/services/training/__tests__/strengthReplacementApi.test.ts`
Expected: PASS, 5 tests.

Run: `npm test -- src/services/training/__tests__/strengthSelectorPhase2.test.ts`
Expected: PASS — la extracción no debe cambiar el comportamiento existente.

- [ ] **Step 5: Commit (redacción sugerida)**

```bash
git add src/services/training/strengthSelector.ts \
        src/services/training/__tests__/strengthReplacementApi.test.ts \
        src/services/training/__tests__/strengthSelectorCharacterization.test.ts
git commit -m "feat(training): add focused strength replacement API"
```

> El characterization test del Step 3a **entra en este commit**: es la evidencia
> de que la extracción no cambió comportamiento, y sin él en el árbol la próxima
> persona no sabe que existe esa red.

---

## Task 6: Normalización única de fuerza, dos razones

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts` — reemplaza
  `repairDuplicateStrengthExercises` (1378+) y `rotateRepeatedStrengthExercises` (1408+)
- Test: `src/services/planBuilder/__tests__/strengthNormalization.test.ts`

**Interfaces:**
- Consumes: `resolveSessionStrengthRoles`, `collectAllStrengthKeys` (Task 3);
  `selectStrengthReplacement` (Task 5); `getWeekIndexInBlock` (Task 2).
- Produces: `meta.strengthAccessoryRotationActionCount` y
  `meta.strengthAccessoryRotationSessionsAffected` en `RepairMeta`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/planBuilder/__tests__/strengthNormalization.test.ts` cubriendo,
cada uno con su construcción real de sesiones y contexto:

1. **El main lift no se toca en ninguna razón** — ni con `previousWeek` `ready` y
   colisión observada.
2. **La sesión no se reconstruye entera** — el conteo de ejercicios no cambia.
3. **Semana 0 del bloque, sin colisión** — drills intactos, contadores de política
   en `null`.
4. **Semana 0 del bloque, con colisión observada** — sí corrige, suma `corrective`
   y `repairedSessionCount`, **sin** contadores de política.
5. **Colisión contra otro bloque no cuenta** — `previousWeek` de bloque distinto ⇒
   sin razón correctiva.
6. **`previousWeek` en shell no cuenta** — sin sesiones ⇒ sin razón correctiva.
7. **Desempate** — cuando colisión y política eligen el mismo cambio, se cuenta
   **una vez** y como `corrective`.
8. **Medición sobre la entrada original** — aplicar política antes no cambia el
   desempate.
9. **Unidades** — `correctiveActionCount` y `repairedSessionCount` una vez por
   sesión aunque cambien 3 ejercicios; `strengthAccessoryRotationActionCount` por
   ejercicio.
10. **Idempotencia** — segunda ejecución: mismo resultado y
    `strengthAccessoryRotationActionCount = 0`.
11. **Taxonomía** — semana con solo política conserva `countRepairsV2` idéntico y
    no crea `quality.generation.high_repair_count`.
12. **No hereda metadata** — accesorio sin referencia de 1RM que reemplaza a uno
    con `targetPercent1RM` no queda con ese campo.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- src/services/planBuilder/__tests__/strengthNormalization.test.ts`
Expected: FAIL en todos.

- [ ] **Step 3: Implementar la normalización única**

Reemplazar las dos funciones actuales por **una**:

```ts
type StrengthSubstitutionReason = 'policy' | 'corrective'

/**
 * Normalización única de ejercicios de fuerza. Reemplaza a
 * `repairDuplicateStrengthExercises` + `rotateRepeatedStrengthExercises`, que
 * eran dos pasos independientes mutando los mismos ejercicios: se deshacían
 * mutuamente y rompían la idempotencia.
 *
 * Dos razones, una sola pasada:
 *  - policy     -> dispersión determinista (semanas 1+ del bloque)
 *  - corrective -> colisión REAL contra previousWeek, medida sobre la entrada
 *                  original
 *
 * El main lift del contrato (strengthRoleContract) queda fuera de alcance en
 * las dos razones.
 */
function normalizeStrengthSessions(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): void {
  const weekIndexInBlock = getWeekIndexInBlock(context)
  const strengthSessions = sessions.filter((session) => session.sessionType === 'strength')
  if (strengthSessions.length === 0) return

  // --- 1. Exclusión externa: solo si previousWeek es READY y del MISMO bloque ---
  // `status === 'ready'` es obligatorio: "tiene sesiones" no alcanza, porque un
  // shell parcialmente poblado pasaría ese chequeo.
  const previous = context.previousWeek
  const previousUsable =
    previous != null
    && previous.status === 'ready'
    && isPreviousWeekInSameBlock(context)
  const previousKeys = previousUsable
    ? collectAllStrengthKeys(previous.sessions)
    : new Set<string>()

  // --- 2. Razón por slot, decidida sobre la ENTRADA ORIGINAL, una sola vez ---
  const originalCountable = collectCountableKeys(sessions)
  const hasObservedCollision =
    [...originalCountable].filter((key) => previousKeys.has(key)).length >= 3
  const applyPolicy = weekIndexInBlock > 0

  interface Slot {
    session: CoachSessionProposal
    sessionOrdinal: number
    position: number
    currentName: string
    reason: StrengthSubstitutionReason | undefined
  }

  const slots: Slot[] = []
  strengthSessions.forEach((session, sessionOrdinal) => {
    const exercises = session.exercises ?? []
    const roles = resolveSessionStrengthRoles(exercises)
    exercises.forEach((exercise, position) => {
      if (!isCountableRole(roles[position]!)) return
      const key = normalizeStrengthExerciseKey(exercise.name)
      const collides = hasObservedCollision && previousKeys.has(key)
      slots.push({
        session,
        sessionOrdinal,
        position,
        currentName: exercise.name,
        // Desempate congelado: corrective gana. Un slot se toca UNA sola vez.
        reason: collides ? 'corrective' : applyPolicy ? 'policy' : undefined,
      })
    })
  })

  // --- 3. Asignación canónica conjunta (ver "Algoritmo canónico") ---
  const assignedKeys = new Set<string>()

  // 3a. RESERVA PREVIA de TODOS los inmutables, antes de asignar nada. Reservarlos
  // sobre la marcha permitiría que un slot mutable anterior se quedara con el
  // nombre de un protegido posterior.
  for (const slot of slots) {
    if (slot.reason) continue
    assignedKeys.add(normalizeStrengthExerciseKey(slot.currentName))
  }
  // Los main lifts y los ejercicios de sesiones no-fuerza tampoco son asignables.
  for (const key of collectMainLiftKeys(sessions)) assignedKeys.add(key)

  // 3b. Exclusión UNIFORME de semana: las claves de previousWeek se excluyen para
  // LAS DOS razones. Si solo las excluyera la correctiva, un slot corregido
  // volvería a rotar en la segunda pasada al reclasificarse como policy.
  const assignments = new Map<Slot, StrengthSelectionExercise | undefined>()

  for (const slot of slots) {
    if (!slot.reason) continue

    const excludedKeys = new Set<string>([...assignedKeys, ...previousKeys])

    const replacement = selectStrengthReplacement({
      originalName: slot.currentName,
      context: buildStrengthSelectionContext(slot.session, context, []),
      excludedKeys,
      rotationIndex: weekIndexInBlock * 31 + slot.sessionOrdinal * 7 + slot.position,
      exerciseIndex: slot.position,
    })

    assignments.set(slot, replacement)
    assignedKeys.add(normalizeStrengthExerciseKey(replacement?.name ?? slot.currentName))
  }

  // --- 4. Aplicar y contar SOLO los cambios reales ---
  let rotationActions = 0
  const rotationSessions = new Set<string>()
  const correctiveSessions = new Set<string>()

  for (const slot of slots) {
    const replacement = assignments.get(slot)
    if (!replacement) continue
    if (normalizeStrengthExerciseKey(replacement.name)
        === normalizeStrengthExerciseKey(slot.currentName)) {
      // Ya contenía su canónico: no es una acción. Esto es lo que hace que la
      // segunda corrida reporte 0.
      continue
    }

    const exercises = slot.session.exercises ?? []
    exercises[slot.position] = toSessionExercise(replacement)

    if (slot.reason === 'corrective') {
      correctiveSessions.add(sessionKeyOf(slot.session))
    } else {
      rotationActions++
      rotationSessions.add(sessionKeyOf(slot.session))
    }
  }

  // Unidades congeladas: corrective una vez por sesión; política por ejercicio.
  for (const sessionKey of correctiveSessions) {
    recordRepair(meta, 'corrective', sessionKey)
  }
  meta.strengthAccessoryRotationActionCount =
    (meta.strengthAccessoryRotationActionCount ?? 0) + rotationActions
  meta.strengthAccessoryRotationSessionsAffected =
    (meta.strengthAccessoryRotationSessionsAffected ?? 0) + rotationSessions.size
}

function isPreviousWeekInSameBlock(context: RepairContext): boolean {
  if (!context.previousWeek) return false
  const positions = resolveBlockPositions(context.plan.phases, context.planWeekDescriptors)
  const current = positions.get(context.week.weekIndex)?.blockId
  const previous = positions.get(context.previousWeek.weekIndex)?.blockId
  return current != null && current === previous
}
```

`toSessionExercise` convierte `StrengthSelectionExercise` a la forma que usan las
sesiones. **Reusar la conversión que ya exista en `repairWeek`**; si no existe,
escribirla una vez y no en línea.

Agregar los dos contadores a `RepairMeta` con tipo `number | undefined`, y
llamar a `normalizeStrengthSessions` **en el lugar donde hoy se llama a
`repairDuplicateStrengthExercises`**, eliminando las dos funciones viejas.

- [ ] **Step 4: Correr los tests**

Run: `npm test -- src/services/planBuilder/__tests__/strengthNormalization.test.ts`
Expected: PASS, 12 tests.

Run: `npm test -- src/services/planBuilder`
Expected: PASS.

- [ ] **Step 5: Commit (redacción sugerida)**

```bash
git add src/services/planBuilder/repairWeek.ts src/services/planBuilder/__tests__/strengthNormalization.test.ts
git commit -m "feat(plan-builder): single strength normalization with policy and corrective reasons"
```

---

## Task 7: Telemetría de fuerza

**Files:**
- Modify: `src/types/planBuilder.ts:36` (`PlanGenerationMeta`) — **no** `src/types/index.ts`
- Modify: `src/services/planBuilder/generateWeekCore.ts` (`WeekActionEvaluation`, `GenerateWeekResult.meta`)
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts:318` (`makeResolvedWeek`) y `:369` (`makeFallbackResolvedWeek`)
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts:1000-1005` (`previousWeekContextSource` por semana)
- Modify: `scripts/loadtest-plan-builder/runtime.mjs` (exponer los helpers TS)
- Modify: `scripts/loadtest-plan-builder/artifact.mjs:83` (allowlist)
- Modify: `scripts/loadtest-plan-builder.mjs:168` (`buildWeekRows`, recibe `plan`)
- Test: `scripts/loadtest-plan-builder.test.js`
- Test: `src/services/planBuilder/__tests__/telemetryTransport.test.ts`

**Interfaces:**
- Consumes: contadores de Task 6; `resolveBlockPositions` (Task 1).
- Produces: **la cadena de transporte completa**, que Task 11 reusa tal cual:
  `RepairMeta` → `WeekActionEvaluation` → `GenerateWeekResult.meta` →
  `PlanGenerationMeta` de la semana → `makeResolvedWeek` /
  `makeFallbackResolvedWeek` → `toWeekRow`.

> **La cadena se construye ACÁ, no en Task 11.** Postergarla dejaría el Hito 1
> sin poder cerrar como promete: sus cuatro campos la necesitan entera. Task 11
> solo agrega campos nuevos sobre una cadena que ya funciona.
>
> Un contador que `repairWeek` calcula no llega solo al artefacto. Si falta un
> eslabón el campo sale `null` para siempre y el smoke no mide nada — por eso el
> test extremo a extremo de abajo es obligatorio y no opcional.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `scripts/loadtest-plan-builder.test.js`:

```js
test('buildWeekRows deriva el solape contable máximo del bloque', () => {
  // Plan con 2 semanas del mismo bloque; la segunda comparte 2 contables.
  // Esperado: strengthCountableOverlapMax === 2 en la semana 1.
})

test('overlap es 0 cuando hay contables pero no hay semana anterior comparable', () => {
  // Esperado: 0, no null.
})

test('overlap es null cuando la semana no tiene contables de fuerza', () => {
  // Esperado: null, no 0.
})
```

Y el test **extremo a extremo de transporte**, en
`src/services/planBuilder/__tests__/telemetryTransport.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateGeneratedWeekAction } from '../generateWeekCore'
import { toWeekRow } from '../../../../scripts/loadtest-plan-builder/artifact.mjs'
import { buildRepairContextForTest } from './helpers/repairTestFixtures'

describe('transporte de telemetría de rotación', () => {
  it('un contador calculado en el repair llega hasta toWeekRow', () => {
    // 1. Construir una semana (ordinal >= 1 del bloque) cuya normalización de
    //    fuerza rote al menos un accesorio.
    // 2. Correr `validateGeneratedWeekAction` y afirmar que la evaluación trae
    //    strengthAccessoryRotationActionCount > 0.
    // 3. Construir la semana resuelta y afirmar que el contador sobrevive en
    //    `week.generationMeta`.
    // 4. Pasar esa semana por `toWeekRow` y afirmar que el campo sale con el
    //    MISMO valor, no `null`.
    //
    // Este test es el que detecta un eslabón faltante. Sin él, la cadena puede
    // romperse en cualquier punto y solo se descubriría leyendo un artefacto de
    // la corrida pagada, que cuesta ~US$0,90.
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- scripts/loadtest-plan-builder.test.js`
Expected: FAIL.

- [ ] **Step 3: Estampar `previousWeekContextSource` por semana**

En `asyncGenerationLoop.ts`, donde hoy solo se agrega a nivel job (líneas
1000-1005), estampar además en la semana generada:

```ts
generatingWeek.generationMeta = {
  ...generatingWeek.generationMeta,
  previousWeekContextSource: source,
}
```

- [ ] **Step 4: Pasar el plan a `buildWeekRows` y derivar el solape**

En `scripts/loadtest-plan-builder.mjs`, en la llamada a `buildWeekRows` agregar
`plan: state.plan`, y dentro derivar:

```js
// Solape contable máximo contra cualquier semana anterior del MISMO bloque.
// null = la semana no tiene contables de fuerza (no aplica).
// 0    = tiene contables pero no hay anterior comparable, o no hubo solape.
```

Implementar reusando `resolveBlockPositions`, `collectCountableKeys` y
`collectAllStrengthKeys` vía el runtime de Vite que el loadtest ya usa para cargar
módulos TS (`runtime.mjs`).

- [ ] **Step 5: Extender la allowlist**

En `scripts/loadtest-plan-builder/artifact.mjs`, dentro de `toWeekRow`, agregar
**uno por uno**:

```js
    previousWeekContextSource: meta.previousWeekContextSource ?? null,
    strengthAccessoryRotationActionCount: meta.strengthAccessoryRotationActionCount ?? null,
    strengthAccessoryRotationSessionsAffected: meta.strengthAccessoryRotationSessionsAffected ?? null,
    strengthCountableOverlapMax: context.strengthCountableOverlapMax ?? null,
```

- [ ] **Step 6: Correr los tests**

Run: `npm test -- scripts/loadtest-plan-builder.test.js`
Expected: PASS.

Run: `npm run lint && npm test && npm run build`
Expected: todo verde. **Hito 1 cerrado.**

- [ ] **Step 7: Commit (redacción sugerida)**

```bash
git add src/types/planBuilder.ts src/services/planBuilder/generateWeekCore.ts \
        src/services/planBuilder/asyncGenerationLoop.ts \
        src/services/planBuilder/__tests__/telemetryTransport.test.ts \
        scripts/loadtest-plan-builder.mjs scripts/loadtest-plan-builder/artifact.mjs \
        scripts/loadtest-plan-builder/runtime.mjs scripts/loadtest-plan-builder.test.js
git commit -m "feat(plan-builder): add strength rotation telemetry transport"
```

---

# HITO 2 — Squash

## Task 8: API de rotación de drills sin válvula

**Files:**
- Modify: `src/services/training/drillSelector.ts`
- Test: `src/services/training/__tests__/squashDrillReplacementApi.test.ts`

**Interfaces:**
- Consumes: `SQUASH_DRILL_LIBRARY`, `resolveSquashDrillKind`, `filterByFatigue`,
  `filterByPhase`, `filterByExecutionMode`.
- Produces:
  ```ts
  export type SquashRelaxationLevel = 'strict' | 'same_kind' | 'same_category' | 'any'
  export interface SquashDrillReplacementRequest {
    originalName: string
    context: SquashSelectionContext
    excludedKeys: ReadonlySet<string>
    rotationIndex: number
    relaxation: SquashRelaxationLevel
  }
  export function selectSquashDrillReplacement(
    request: SquashDrillReplacementRequest,
  ): SquashDrillDefinition | undefined
  ```

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/training/__tests__/squashDrillReplacementApi.test.ts` cubriendo:

1. `strict` preserva `category` **y** `resolveSquashDrillKind()`.
2. Un contexto `solo` **nunca** devuelve un drill con `partnerRequired` ni de match.
3. Taper **nunca** devuelve un candidato que `filterByPhase` había excluido
   (`rsa`, `multiball`, `match_play`, `intensity: 'high'`).
4. **Sin válvula:** con `excludedKeys` conteniendo todos los candidatos válidos,
   devuelve `undefined` — nunca un drill repetido.
5. `same_kind` relaja `category` pero conserva kind; `same_category` al revés.
6. Determinismo: mismo `rotationIndex` ⇒ mismo resultado.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- src/services/training/__tests__/squashDrillReplacementApi.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

En `drillSelector.ts`:

```ts
/**
 * Reemplazo enfocado para la rotación de drills. A diferencia de
 * `selectSquashDrills`, NO tiene válvula de escape: si no hay candidato válido
 * devuelve `undefined` en vez de readmitir un drill reciente. Reusar la ruta con
 * válvula haría que la telemetría reportara "roté" habiendo devuelto un repetido.
 *
 * Los hard constraints (fatiga, fase, partner) NUNCA se relajan: los niveles de
 * relajación solo aflojan `category` y kind.
 */
export type SquashRelaxationLevel = 'strict' | 'same_kind' | 'same_category' | 'any'

export interface SquashDrillReplacementRequest {
  originalName: string
  context: SquashSelectionContext
  excludedKeys: ReadonlySet<string>
  rotationIndex: number
  relaxation: SquashRelaxationLevel
}

export function selectSquashDrillReplacement(
  request: SquashDrillReplacementRequest,
): SquashDrillDefinition | undefined {
  const original = findSquashDrillByName(request.originalName)
  if (!original) return undefined

  const originalKind = resolveSquashDrillKind(original)

  // Hard constraints: siempre, en todos los niveles.
  const byFatigue = filterByFatigue(SQUASH_DRILL_LIBRARY, request.context)
  const byPhase = filterByPhase(byFatigue, request.context)
  const allowed = filterByExecutionMode(byPhase, request.context.partnerAvailability)

  const matchesAxis = (candidate: SquashDrillDefinition): boolean => {
    const sameCategory = candidate.category === original.category
    const sameKind = resolveSquashDrillKind(candidate) === originalKind
    switch (request.relaxation) {
      case 'strict': return sameCategory && sameKind
      case 'same_kind': return sameKind
      case 'same_category': return sameCategory
      case 'any': return true
    }
  }

  const candidates = allowed
    .filter(matchesAxis)
    .filter((candidate) => !request.excludedKeys.has(normalizeSquashDrillKey(candidate.id)))
    // Orden total y estable: sin esto el índice no es determinista.
    .sort((a, b) => scoreByFocusOverlap(b, original) - scoreByFocusOverlap(a, original)
      || a.id.localeCompare(b.id))

  if (candidates.length === 0) return undefined
  return candidates[request.rotationIndex % candidates.length]
}

/** `focus` es preferencia de scoring, NO filtro: filtrarlo colapsa el pool. */
function scoreByFocusOverlap(
  candidate: SquashDrillDefinition,
  original: SquashDrillDefinition,
): number {
  return candidate.focus.filter((value) => original.focus.includes(value)).length
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -- src/services/training/__tests__/squashDrillReplacementApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (redacción sugerida)**

```bash
git add src/services/training/drillSelector.ts src/services/training/__tests__/squashDrillReplacementApi.test.ts
git commit -m "feat(training): add valveless squash drill replacement API"
```

---

## Task 9: Normalización única de contenido de squash

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:194-200` (pipeline),
  `1269` (`diversifyDuplicateSquashSessions`), `1511` (`enforceSquashSignatureUniqueness`)
- Test: `src/services/planBuilder/__tests__/squashNormalization.test.ts`

**Interfaces:**
- Consumes: `selectSquashDrillReplacement` (Task 8); `getWeekIndexInBlock` (Task 2).
- Produces: `meta.squashDrillRotationActionCount`,
  `meta.squashDrillRotationSessionsAffected`, `meta.squashDrillRotationOmittedCount`;
  y el `errorClass` `quality.squash.signature_uniqueness_unresolved`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/planBuilder/__tests__/squashNormalization.test.ts` cubriendo:

1. **Semana 0 sin duplicados:** drills intactos, contadores de política en `null`.
2. **Semana 0 con firmas duplicadas:** sí corrige, suma `corrective` y
   `repairedSessionCount`, **sin** contadores de política.
3. **Coordenada de 3 componentes:** dos sesiones de la misma semana, y dos drills
   de la misma `category` en una sesión, producen **resultados distintos** con pool
   suficiente.
4. **Exclusión:** ningún nombre introducido existe ya en el resultado final de la
   semana.
5. **Postcondición estructural (solo política):** se conserva el multiconjunto de
   `resolveSquashDrillKind()` por slot; sesión `mixed` conserva todas sus partes.
6. **Reemplazo:** `durationMin` preservado; `notes` y `executionMode` no heredados;
   conteo de drills sin cambios.
7. **`blocks` reconstruido** y consistente con `drills`.
8. **Omisión:** pool vacío ⇒ deja el original y suma
   `squashDrillRotationOmittedCount`.
9. **Jerarquía:** dos sesiones de match en la misma semana ⇒ el nivel `any`
   reconstruye la segunda como no-match.
10. **Exposición competitiva sobre la semana final:** el nivel `any` no puede
    dejar la semana sin la exposición mínima.
11. **Fail-closed:** jerarquía agotada ⇒ `quality.squash.signature_uniqueness_unresolved`,
    firma duplicada **nunca** sobrevive, y **no** incrementa el contador de omisiones.
12. **Idempotencia:** segunda ejecución, mismo resultado y
    `squashDrillRotationActionCount = 0`.
13. **Taxonomía:** semana con solo política conserva `countRepairsV2` idéntico.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- src/services/planBuilder/__tests__/squashNormalization.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar la normalización única**

Crear `normalizeSquashSessionContent(sessions, context, meta)`.

**Ubicación.** Corre **después** de `normalizeSquashSemanticMetadata`,
`normalizeLateTaperSquashMatchPlay` y `ensureSquashCompetitionMatchExposure`, que
**no se integran** y conservan su comportamiento. **Absorbe**
`diversifyDuplicateSquashSessions` y `enforceSquashSignatureUniqueness`: eliminar
ambas.

**La firma es propiedad de SESIÓN, no de slot.** Por eso el desempate correctivo
se decide **a nivel sesión**: una sesión marcada como correctiva queda **entera**
fuera de la política. Decidirlo por slot permitiría que política y correctiva
tocaran la misma sesión y se pisaran.

```
normalizeSquashSessionContent(sessions, context, meta):

  weekIndexInBlock := getWeekIndexInBlock(context)
  squashSessions   := sessions donde sessionType == 'squash'   # orden estable
  si vacío: return

  # --- FASE 0: clasificar sobre la ENTRADA ORIGINAL ---
  originalSignatures := [buildSquashDrillSignature(s) para s en squashSessions]
  correctiveSessions := sesiones cuya firma original aparece >1 vez
                        (todas menos la PRIMERA aparición de cada firma)
  policySessions     := (weekIndexInBlock > 0)
                        ? squashSessions \ correctiveSessions
                        : {}                      # semana 0: política apagada

  # --- FASE 1: política, asignación canónica conjunta ---
  assignedKeys := {} ; omitted := 0 ; actions := 0 ; touched := {}

  # Reservar primero las claves de TODO lo que no va a cambiar, para que la
  # asignación no las reintroduzca.
  para cada sesión NO en policySessions: assignedKeys += claves de sus drills

  para cada (sesión, sessionOrdinal) en policySessions:
    para cada (drill, drillOrdinal) en sesión.squashDetails.drills:
      replacement := selectSquashDrillReplacement(
        originalName = drill.name,
        context      = buildSquashSelectionContext(sesión, context),
        excludedKeys = assignedKeys,
        rotationIndex = weekIndexInBlock*131 + sessionOrdinal*17 + drillOrdinal,
        relaxation   = 'strict')

      si replacement == undefined:
        omitted += 1
        assignedKeys += clave(drill.name)     # conserva el original
        continue

      assignedKeys += clave(replacement.id)
      si clave(replacement) != clave(drill):   # solo los cambios REALES cuentan
        aplicarReemplazo(sesión, drillOrdinal, drill, replacement)
        actions += 1 ; touched += sesión

  # --- FASE 2: correctiva, por sesión, con jerarquía y enumeración real ---
  seen := firmas de todas las sesiones ya finalizadas (las no correctivas)

  para cada sesión en correctiveSessions:
    resuelta := false
    para nivel en ['strict', 'same_kind', 'same_category', 'any']:

      # Enumeración de ASIGNACIONES DE SESIÓN, no de un offset compartido.
      # Incrementar el mismo offset para todos los drills recorre solo la
      # diagonal del espacio y puede declarar fail-closed teniendo solución.
      #
      # Por slot s de la sesión, sea C[s] la lista ordenada de candidatos
      # ELEGIBLES del nivel. "Elegible" incluye, en los niveles relajados, el
      # filtro de punto fijo estricto:
      #     X elegible  <=>  X == canonicalStrict(eje(X), coordenada(s), exclusiones)
      # Sin ese filtro la salida correctiva no es punto fijo de la política y la
      # segunda pasada volvería a mover el slot.
      #
      # Recorrer el producto C[0] x C[1] x ... como un ODÓMETRO determinista
      # (último slot varía más rápido), arrancando en la tupla canónica.
      # Cota dura: MAX_CORRECTIVE_ASSIGNMENTS (p. ej. 512) para no explotar;
      # agotar la cota cuenta como nivel agotado, no como éxito.

      para cada tupla en odometro(C, MAX_CORRECTIVE_ASSIGNMENTS):
        candidata := copiaProfunda(sesión) con los drills de `tupla` aplicados
        reconstruir candidata.squashDetails.blocks
        si buildSquashDrillSignature(candidata) en seen: continue

        # Validación TRANSACCIONAL sobre la semana final: recién acá se sabe si
        # el cambio rompe la exposición competitiva.
        semanaTentativa := sessions con `sesión` sustituida por `candidata`
        si NOT cumpleExposicionCompetitiva(semanaTentativa, context): continue

        commit candidata ; seen += su firma
        recordRepair(meta, 'corrective', sessionKeyOf(sesión))
        resuelta := true ; break
      si resuelta: break

    si NOT resuelta:
      # Fail-closed SIN excepción: devolver el fallo tipado y CORTAR.
      # Lanzar haría que el retry loop lo convirtiera en `server_error`
      # (ver Task 10). NO incrementa el contador de omisiones de política.
      return {
        failure: {
          errorClass: 'quality.squash.signature_uniqueness_unresolved',
          message: `No se pudo diferenciar la firma de la sesión de squash del ${sesión.date}.`,
        },
      }

  # --- FASE 3: postcondición y contadores ---
  assert: todas las firmas de squashSessions son distintas
  meta.squashDrillRotationActionCount     += actions
  meta.squashDrillRotationSessionsAffected += |touched|
  meta.squashDrillRotationOmittedCount    += omitted
```

**Idempotencia.** En una segunda corrida no hay firmas duplicadas ⇒
`correctiveSessions` es vacío ⇒ solo corre la política, cuya asignación canónica
es la misma (los ejes `category`/kind sobreviven a la sustitución) ⇒ cada slot ya
contiene su canónico ⇒ `actions == 0`. Para que esto valga también donde la
correctiva relajó el eje, **la correctiva usa la misma función canónica** que la
política, solo con otro pool.

**Reemplazo por drill** (`aplicarReemplazo`):

```ts
// name se reemplaza; durationMin se preserva (es forma de la sesión, no del
// drill); notes y executionMode NO se heredan porque describen el drill anterior.
drills[position] = {
  name: replacement.name,
  durationMin: original.durationMin,
  executionMode: resolveDrillExecutionMode(replacement),
}
```

Tras **toda** sustitución de una sesión, reconstruir
`details.blocks = buildSquashBlocksFromDrills(details.drills)`.

- [ ] **Step 4: Correr los tests**

Run: `npm test -- src/services/planBuilder/__tests__/squashNormalization.test.ts`
Expected: PASS, 13 tests.

Run: `npm test -- src/services/planBuilder`
Expected: PASS.

- [ ] **Step 5: Commit (redacción sugerida)**

```bash
git add src/services/planBuilder/repairWeek.ts src/services/planBuilder/__tests__/squashNormalization.test.ts
git commit -m "feat(plan-builder): single squash content normalization with fail-closed signature uniqueness"
```

---

## Task 10: `errorClass` no-fallback-eligible

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts` (tipo de retorno del repair)
- Modify: `src/services/planBuilder/generateWeekCore.ts:344-346` (colapso a `validation`)
- Modify: `src/services/planBuilder/generateWeekCore.ts` (`WeekActionEvaluation`, `GenerateWeekResult.meta`)
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts:1111-1120` (rama de fallback)
- Test: `src/services/planBuilder/__tests__/squashSignatureFailClosed.test.ts`

**Interfaces:**
- Consumes: `quality.squash.signature_uniqueness_unresolved` (Task 9).
- Produces: el `errorClass` tipado extremo a extremo, desde el repair hasta la
  semana persistida y el intento.

> **Hoy no existe ruta de transporte para este código.** Dos cortes lo borran:
>
> 1. `generateWeekCore.ts:344-346` colapsa **cualquier** error de evaluación:
>    ```ts
>    errorClass: evaluation.error ? (wasTruncated ? 'truncated' : 'validation') : normalized.meta?.errorClass
>    ```
> 2. Si la normalización **lanza**, el retry loop la convierte en `server_error`.
>
> Y el campo real es **`result.meta.errorClass`**, anidado — no `result.errorClass`
> como decía la versión anterior de este plan.
>
> Por eso esta tarea es de **tipado extremo a extremo**, no un `if` en el loop.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/planBuilder/__tests__/squashSignatureFailClosed.test.ts`:

1. El `errorClass` se propaga **exacto**, sin colapsar a `validation`.
2. **Consume** reintentos (no falla al primer intento sin reintentar).
3. **No** invoca `buildLocalFallbackWeek`.
4. Tras agotar reintentos, la semana termina en **error**.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- src/services/planBuilder/__tests__/squashSignatureFailClosed.test.ts`
Expected: FAIL — hoy `if (result.sessions.length === 0)` dispara el fallback local.

- [ ] **Step 3: Implementar**

Cuatro cortes en orden, cada uno con su verificación:

**3a. Ruta única de fallo, sin excepciones.** El contrato es un campo tipado en el
resultado del repair — **la misma forma que devuelve la Fase 2 de Task 9**:

```ts
// src/services/planBuilder/repairWeek.ts
export interface RepairFailure {
  errorClass: 'quality.squash.signature_uniqueness_unresolved'
  message: string
}

export interface RepairResult {
  // ... campos existentes
  failure?: RepairFailure
}
```

`repairGeneratedWeek` **devuelve inmediatamente** al recibir `failure` de la
normalización: no sigue con el resto del pipeline.

**3b. `validateGeneratedWeekAction` traduce el fallo a un rechazo real.** Es el
paso que impide que la semana sobreviva con sesiones y sea aceptada:

```ts
if (repairResult.failure) {
  return {
    sessions: [],                               // ← sin sesiones: no es aceptable
    error: repairResult.failure.message,        // ← consume el intento
    errorClass: repairResult.failure.errorClass,// ← sobrevive al colapso de 3c
    ...EMPTY_REPAIR_TAXONOMY,
    repairTaxonomyVersion: 2,
  }
}
```

`WeekActionEvaluation` gana el campo `errorClass?: string` para poder transportarlo.

**3c. `generateWeekCore.ts:344-346` deja de aplanar este caso:**

```ts
errorClass: evaluation.errorClass
  ?? (evaluation.error
    ? (wasTruncated ? 'truncated' : 'validation')
    : normalized.meta?.errorClass),
```

El orden importa: el caso específico se evalúa **antes** que el genérico, o
`validation` se lo come.

**3d. El loop respeta la no-elegibilidad**, leyendo el campo **anidado**:

```ts
const NON_FALLBACK_ELIGIBLE_ERROR_CLASSES = new Set([
  'quality.squash.signature_uniqueness_unresolved',
])

// El fallback local convertiría un rechazo fail-closed en una semana silenciosa.
const fallbackEligible =
  !NON_FALLBACK_ELIGIBLE_ERROR_CLASSES.has(result.meta?.errorClass ?? '')

let fallback: ReturnType<typeof buildLocalFallbackWeek> | undefined
if (result.sessions.length === 0 && fallbackEligible) {
  // ... rama existente sin cambios
}
```

Verificar además que el `errorClass` sobrevive en `makeErroredWeekFromResult` y en
la fila de intento, o el contador de Task 11 medirá siempre cero.

- [ ] **Step 4: Correr los tests**

Run: `npm test -- src/services/planBuilder/__tests__/squashSignatureFailClosed.test.ts`
Expected: PASS, 4 tests.

Run: `npm test -- src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (redacción sugerida)**

```bash
git add src/services/planBuilder/asyncGenerationLoop.ts src/services/planBuilder/__tests__/squashSignatureFailClosed.test.ts
git commit -m "feat(plan-builder): make signature uniqueness failure non-fallback-eligible"
```

---

## Task 11: Telemetría de squash

**Files:**
- Modify: `src/types/planBuilder.ts:36` — `PlanGenerationMeta`, campos nuevos de squash
- Modify: `src/services/planBuilder/generateWeekCore.ts` — `WeekActionEvaluation` y `GenerateWeekResult.meta`
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts` — `makeResolvedWeek` / `makeFallbackResolvedWeek`
- Modify: `scripts/loadtest-plan-builder/artifact.mjs:83` — allowlist
- Modify: `scripts/loadtest-plan-builder.mjs:168` — `buildWeekRows`, recibe `plan`
- Modify: `scripts/loadtest-plan-builder/report.mjs` — agregación del reporte
- Test: `scripts/loadtest-plan-builder.test.js`

**Interfaces:**
- Consumes: contadores de Task 9; `errorClass` de Task 10.
- Produces: seis métricas de bloque + tres contadores de rotación +
  `squashSignatureUniquenessFailureAttemptCount`.

> **La cadena de transporte es el trabajo real de esta tarea, no la allowlist.**
> Un contador que `repairWeek` calcula no llega solo al artefacto: tiene que
> atravesar `WeekActionEvaluation` → `GenerateWeekResult.meta` →
> `PlanGenerationMeta` de la semana → `makeResolvedWeek` → `toWeekRow`. Si falta
> un eslabón, el campo sale `null` para siempre y el smoke no mide nada. Recorrer
> la cadena completa **antes** de escribir la allowlist.
>
> Lo mismo aplica a la Task 7: sus cuatro campos usan exactamente esta cadena.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `scripts/loadtest-plan-builder.test.js`:

1. Las seis métricas de bloque se registran en la **última semana del bloque**;
   `null` en las demás.
2. Bloque de squash con **cero** sesiones ⇒ `squashSessionCount = 0`, **no** `null`.
3. Denominador cero ⇒ conteos en `0`, **ratios en `null`**.
4. Plan no squash ⇒ todas las métricas de squash en `null`.
5. `squashSignatureUniquenessFailureAttemptCount` cuenta **todos** los intentos con
   ese `errorClass`, incluido un **fallo recuperado por retry** (primer intento
   falla, segundo funciona).
6. `0` (medido, sin incidencia) se distingue de `null` (telemetría de intentos
   ausente).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- scripts/loadtest-plan-builder.test.js`
Expected: FAIL.

- [ ] **Step 3: Derivar las métricas en `buildWeekRows`**

Las seis de bloque se calculan sobre las sesiones de squash del bloque completo y
se estampan en la última semana:

```js
// squashSessionCount, squashDrillUseCount, squashUniqueDrillCount,
// squashDrillVarietyRatio, squashTopDrillUseCount, squashTopSessionRatio
//
// Fórmulas EXACTAS del check (qualityReview.ts:549-558), para que las dos
// condiciones y las dos compuertas sean recomputables desde el artefacto:
//   varietyRatio   = uniqueCount / drillUseCount
//   topSessionRatio = topDrillUseCount / squashSessionCount   // usos/sesiones
// Ratios en null si su denominador es 0.
```

Y el contador de fallo, desde los intentos que `buildWeekRows` ya agrega:

```js
const failureAttempts = attempts.filter(
  (attempt) => attempt.errorClass === 'quality.squash.signature_uniqueness_unresolved',
)
const squashSignatureUniquenessFailureAttemptCount =
  attempts.length === 0 ? null : failureAttempts.length
```

- [ ] **Step 4: Extender la allowlist**

En `toWeekRow`, agregar **uno por uno** los diez campos nuevos, todos con
`?? null`.

- [ ] **Step 5: Agregar al reporte**

En el reporte de `--report`, agregar la incidencia del fallo **por intentos,
semanas y planes** — los tres, para distinguir retries repetidos sobre una misma
semana de incidencia extendida.

- [ ] **Step 6: Correr todo**

Run: `npm run lint && npm test && npm run build`
Expected: todo verde. **Hito 2 cerrado.**

- [ ] **Step 7: Commit (redacción sugerida)**

```bash
git add src/types/planBuilder.ts src/services/planBuilder/generateWeekCore.ts \
        src/services/planBuilder/asyncGenerationLoop.ts \
        scripts/loadtest-plan-builder.mjs scripts/loadtest-plan-builder/artifact.mjs \
        scripts/loadtest-plan-builder/report.mjs scripts/loadtest-plan-builder.test.js
git commit -m "feat(plan-builder): add squash rotation and fail-closed telemetry"
```

---

# HITO 3 — Corrida compartida

## Task 12: Smoke conjunto `high`

**Files:** ninguno versionado hasta el final. Salida en `loadtest-results/`.

**Prerrequisito absoluto:** `git status --short` **vacío**. El árbol sucio hace que
`mergeGitState` rechace la corrida.

- [ ] **Step 1: Preflight**

```bash
git rev-parse HEAD && git status --short
echo "LOADTEST_PLAN_BUILDER=${LOADTEST_PLAN_BUILDER:-(sin definir)}"
echo "CLAUDE_API_KEY=${CLAUDE_API_KEY:+(definida)}"
```
Expected: un SHA, **ninguna** línea de estado, `1` y `(definida)`.

> `CLAUDE_API_KEY` vive en `.env.local` y el script **no** carga dotenv. Exportar
> con `set -a && . ./.env.local && set +a`. Confirmar que `CLAUDE_MODEL` sea
> `claude-sonnet-4-6`: si apunta a otro modelo, la allowlist de
> `PLAN_BUILDER_EFFORT` aborta la corrida.

- [ ] **Step 2: Ejecutar la corrida**

```bash
PLAN_BUILDER_EFFORT=high PLAN_BUILDER_THINKING=disabled npm run loadtest:plan-builder
mv "loadtest-results/$(ls -t loadtest-results | grep '^plan-builder-2026-' | head -1)" \
   loadtest-results/rotation-post.json
```
Expected: 12 casos, exit 0. Del orden de 8-10 min.

- [ ] **Step 3: Verificar elegibilidad y variante**

```bash
npm run loadtest:plan-builder -- --phase2-check loadtest-results/rotation-post.json high
```
Expected: `RESULTADO: ELEGIBLE`.

- [ ] **Step 4: Leer el smoke**

```bash
node -e "
const a=require('./loadtest-results/rotation-post.json');
const codes={};
for(const p of a.plans) for(const i of (p.issueCodes||[])) codes[i]=(codes[i]||0)+1;
console.log('issue codes:', JSON.stringify(codes,null,1));
const sum=(f)=>a.plans.flatMap(p=>p.weeks).reduce((s,w)=>s+(w[f]??0),0);
for (const f of ['strengthAccessoryRotationActionCount','squashDrillRotationActionCount','squashDrillRotationOmittedCount','squashSignatureUniquenessFailureAttemptCount']) {
  console.log(f+':', sum(f));
}
"
```

Contrastar, **como descripción y no como gate**:

| Métrica | Referencia | Lectura |
|---|---|---|
| `repeated_template` | 10/12 en C/A/B | La definición **cambió**: una caída no prueba la rotación por sí sola. |
| `low_drill_variety` | 6/8 planes de squash | La definición **no** cambió: **sí** es comparable descriptivamente. |
| Seis métricas de bloque | — | Revelan por fin **cuál** de las dos condiciones ataba. |
| Omisiones de squash | — | Deciden si hace falta el follow-up de ampliar `category`. |
| `signature_uniqueness_unresolved` | — | **Riesgo operativo:** hoy la unicidad no se verifica, así que este código es una invariante nueva. Si sale alto, la decisión tolerar-vs-rechazar vuelve a la mesa. |
| `countRepairsV2` / `high_repair_count` | 2/12 | Sin inflación atribuible a la política. |
| Score y latencia | — | **Deltas descriptivos**, no regresión: el score de fuerza cambia mecánicamente y una corrida no estima latencia. |

- [ ] **Step 5: Versionar el artefacto y escribir el veredicto**

```bash
mkdir -p docs/superpowers/experiments/plan-builder-rotation
cp loadtest-results/rotation-post.json docs/superpowers/experiments/plan-builder-rotation/
shasum -a 256 docs/superpowers/experiments/plan-builder-rotation/rotation-post.json
```

Escribir `docs/superpowers/experiments/plan-builder-rotation/README.md` con: SHA de
git, `variant_id`, SHA-256 del artefacto, la tabla del Step 4 con valores reales, y
—si aplica— el follow-up de ampliar `category` con su evidencia.

- [ ] **Step 6: Actualizar el estado del producto**

Actualizar `CLAUDE.md`, `PROJECT_REVIEW_AND_ROADMAP.md` (nueva sección §18 y el
backlog 3/4) y `OPTIMIZATION_AND_COSTS.md` si el costo por semana se movió.

- [ ] **Step 7: Commit del veredicto (redacción sugerida)**

```bash
git add docs/superpowers/experiments/plan-builder-rotation CLAUDE.md PROJECT_REVIEW_AND_ROADMAP.md
git commit -m "docs: record the rotation smoke run and its verdict"
```

- [ ] **Step 8: GATE MANUAL — deploy a Netlify**

> **PARAR. Este paso NO se ejecuta sin autorización explícita del owner**, aunque
> todos los anteriores estén verdes. No es un paso automático del plan.

La corrida del Step 2 es **local**: writer en memoria, sin Dexie ni Supabase, y
**no requiere deploy**. El deploy corresponde recién acá, con el veredicto ya
escrito, y sirve para dos cosas distintas:

1. Publicar las mejoras a producción.
2. Verificar el `variant_id` **real** en `plan_generation_jobs` con una corrida
   productiva — la única forma de confirmar que el bundle desplegado es el que se
   midió.

Si el veredicto del smoke es negativo, **no se despliega**: se corrige primero.
