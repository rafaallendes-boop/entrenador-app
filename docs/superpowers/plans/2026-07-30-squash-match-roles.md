# Roles de partido de squash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar la categoría `match` de squash en dos roles derivados del contenido —`standalone` y `finisher`— para que el repair deje de destruir los finishers propuestos por el modelo.

**Architecture:** Un módulo puro nuevo (`squashMatchRole.ts`) resuelve el rol desde `SquashDetails` por IDs estables. Todo el resto del cambio consume ese módulo: el predicado de exposición, la idempotencia de la normalización, la rotación, la unicidad de firmas y tres contadores observacionales. Sin migraciones, sin cambios en las reglas de autoría del prompt.

**Tech Stack:** TypeScript, Vitest, Dexie (sin tocar), Vite.

**Spec:** `docs/superpowers/specs/2026-07-30-squash-match-roles-design.md`

## Global Constraints

- **IDs de contenido competitivo, exactamente estos tres:** `practice_match_five_games` (standalone), `practice_match_best_of_3` y `match_sim_points_short_sets` (finisher). `pre_match_activation_timing` **NO** es contenido competitivo.
- **`isCompetitionSquashMatch` (`src/utils/squash.ts:94`) no se modifica.** Tiene 31 call sites en 13 archivos (nutrición, protocolos, carga, prompts).
- **`isSquashMatchDrill` no decide rol.** Devuelve `true` para todo `category === 'match'`, incluida la activación.
- El repair **no compone** finishers: solo los habilita y preserva.
- Los tres contadores nuevos son **observacionales**: no incrementan `repairedSessionCount` ni la taxonomía, y no entran en `countRepairsV2`.
- Comandos de verificación: `npm run lint`, `npm test`, `npm run build`.
- **Ya aplicado, no rehacer:** la exención de sesiones de partido en
  `quality.squash.low_drill_depth` (`src/services/planBuilder/qualityReview.ts`,
  helper `isSquashMatchSession`) y su test
  `__tests__/qualityReviewMatchDrillDepth.test.ts` están en el árbol sin
  commitear desde el smoke de rotación. Spec §7 los da por hechos. Si el árbol
  está limpio y no existen, escribirlos antes de la Task 5.
- **No ejecutar `git commit` ni `git add`.** Regla del proyecto: los commits los hace el owner. Donde este plan dice "Commit", **detenerse y avisar** al owner qué archivos están listos.
- **No correr `npm run loadtest:plan-builder`.** Es una corrida pagada (~US$0,90) y el saldo es ~US$0,60.
- Terminología: en textos de squash, "la T" (femenino).

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/services/training/squashMatchRole.ts` | **Nuevo.** Resuelve `SquashMatchRole` desde `SquashDetails`. Única fuente de los IDs de rol. Puro, sin dependencias del plan builder. |
| `src/services/training/__tests__/squashMatchRole.test.ts` | **Nuevo.** Contrato del módulo. |
| `src/services/training/drillLibrary.ts` | Eliminar `practice_match_short_points_attack` y su alias. |
| `src/utils/squash.ts` | `hasSquashCompetitiveExposure` + `finisherCount` en el resumen. |
| `src/services/ai/promptModules/squashPrompt.ts` | Línea factual de exposición incluye finishers. |
| `src/services/planBuilder/repairWeek.ts` | Idempotencia, exposición, taper tardío, mínimo de drills, rotación, unicidad, contadores. |
| `src/services/weekCreator/validateWeekCreatorResponse.ts` | Standalone fuera de `duplicate_squash_content`. |
| `src/types/planBuilder.ts` | Tres campos opcionales en `PlanGenerationMeta`. |
| `scripts/loadtest-plan-builder/artifact.mjs` | Allowlist de los tres contadores. |
| `src/services/planBuilder/__tests__/squashMatchRoles.test.ts` | **Nuevo.** Tests 1-8 del spec §9. |

---

## Task 1: Módulo de rol

**Files:**
- Create: `src/services/training/squashMatchRole.ts`
- Test: `src/services/training/__tests__/squashMatchRole.test.ts`

**Interfaces:**
- Consumes: `findSquashDrillByName` de `./drillLibrary`; tipos `SquashDetails`, `SquashDrill`, `SquashSessionBlock` de `../../types`.
- Produces:
  - `type SquashMatchRole = 'standalone' | 'finisher' | 'none'`
  - `const SQUASH_STANDALONE_MATCH_ID: 'practice_match_five_games'`
  - `const SQUASH_FINISHER_MATCH_IDS: readonly ['practice_match_best_of_3', 'match_sim_points_short_sets']`
  - `function isCompetitiveMatchDrill(drill: Pick<SquashDrill, 'name'>): boolean`
  - `function resolveSquashMatchRole(details: SquashDetails | undefined): SquashMatchRole`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/training/__tests__/squashMatchRole.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { SquashDetails } from '../../../types'
import {
  isCompetitiveMatchDrill,
  resolveSquashMatchRole,
  SQUASH_FINISHER_MATCH_IDS,
  SQUASH_STANDALONE_MATCH_ID,
} from '../squashMatchRole'

const FIVE_GAMES = 'Partido de entrenamiento al mejor de 5 juegos'
const BEST_OF_3 = 'Partido de entrenamiento al mejor de 3 juegos'
const GAME_TO_11 = 'Game a 11 con marcador real'
const ACTIVATION = 'Activación pre-partido de manos y pies'
const TECHNICAL = 'Tiros paralelos profundos'

function details(over: Partial<SquashDetails>): SquashDetails {
  return { trainingFocus: 'technical', drills: [], ...over }
}

function finisherDetails(finisherName: string): SquashDetails {
  return details({
    drills: [{ name: TECHNICAL }, { name: finisherName }],
    blocks: [
      { kind: 'technical', drills: [{ name: TECHNICAL }] },
      { kind: 'match', drills: [{ name: finisherName }] },
    ],
  })
}

describe('resolveSquashMatchRole', () => {
  it('reconoce standalone por contenido total, sin necesidad de bloques', () => {
    expect(resolveSquashMatchRole(details({ drills: [{ name: FIVE_GAMES }] }))).toBe('standalone')
  })

  it('reconoce finisher con bloque previo no-match', () => {
    for (const name of [BEST_OF_3, GAME_TO_11]) {
      expect(resolveSquashMatchRole(finisherDetails(name))).toBe('finisher')
    }
  })

  it('no es finisher sin bloques, porque no se puede demostrar que sea el último', () => {
    expect(resolveSquashMatchRole(details({
      drills: [{ name: TECHNICAL }, { name: BEST_OF_3 }],
    }))).toBe('none')
  })

  it('no es finisher si el bloque de partido no es el último', () => {
    expect(resolveSquashMatchRole(details({
      drills: [{ name: BEST_OF_3 }, { name: TECHNICAL }],
      blocks: [
        { kind: 'match', drills: [{ name: BEST_OF_3 }] },
        { kind: 'technical', drills: [{ name: TECHNICAL }] },
      ],
    }))).toBe('none')
  })

  it('no es finisher sin ningún bloque previo no-match', () => {
    expect(resolveSquashMatchRole(details({
      drills: [{ name: BEST_OF_3 }],
      blocks: [{ kind: 'match', drills: [{ name: BEST_OF_3 }] }],
    }))).toBe('none')
  })

  it('no es finisher si hay otro drill competitivo en la sesión', () => {
    expect(resolveSquashMatchRole(details({
      drills: [{ name: TECHNICAL }, { name: FIVE_GAMES }, { name: BEST_OF_3 }],
      blocks: [
        { kind: 'technical', drills: [{ name: TECHNICAL }] },
        { kind: 'match', drills: [{ name: FIVE_GAMES }] },
        { kind: 'match', drills: [{ name: BEST_OF_3 }] },
      ],
    }))).toBe('none')
  })

  it('no es canónico si blocks y drills divergen', () => {
    expect(resolveSquashMatchRole(details({
      drills: [{ name: TECHNICAL }, { name: BEST_OF_3 }],
      blocks: [{ kind: 'match', drills: [{ name: BEST_OF_3 }] }],
    }))).toBe('none')
  })

  it('la activación aislada no es contenido competitivo', () => {
    expect(isCompetitiveMatchDrill({ name: ACTIVATION })).toBe(false)
    expect(resolveSquashMatchRole(details({ drills: [{ name: ACTIVATION }] }))).toBe('none')
  })

  it('los tres IDs de rol son contenido competitivo', () => {
    for (const name of [FIVE_GAMES, BEST_OF_3, GAME_TO_11]) {
      expect(isCompetitiveMatchDrill({ name })).toBe(true)
    }
    expect(SQUASH_STANDALONE_MATCH_ID).toBe('practice_match_five_games')
    expect([...SQUASH_FINISHER_MATCH_IDS]).toEqual([
      'practice_match_best_of_3',
      'match_sim_points_short_sets',
    ])
  })

  it('devuelve none sin details', () => {
    expect(resolveSquashMatchRole(undefined)).toBe('none')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/squashMatchRole.test.ts`
Expected: FAIL — `Failed to resolve import "../squashMatchRole"`.

- [ ] **Step 3: Implementar el módulo**

Crear `src/services/training/squashMatchRole.ts`:

```ts
import type { SquashDetails, SquashDrill } from '../../types'
import { findSquashDrillByName } from './drillLibrary'

/**
 * Rol de una sesión de squash derivado de su CONTENIDO, nunca de `sessionMode`.
 *
 * `isSquashMatchDrill` no sirve para esto: devuelve true para todo
 * `category === 'match'`, y eso incluye `pre_match_activation_timing`, que es una
 * activación de taper de intensidad baja. Tratarla como partido proyectaría una
 * activación aislada a un best-of-5 completo, justo lo contrario de lo que esa
 * sesión debe ser a 48 h de competir. Por eso el contenido competitivo se define
 * por enumeración.
 */
export type SquashMatchRole = 'standalone' | 'finisher' | 'none'

export const SQUASH_STANDALONE_MATCH_ID = 'practice_match_five_games'

export const SQUASH_FINISHER_MATCH_IDS = [
  'practice_match_best_of_3',
  'match_sim_points_short_sets',
] as const

const COMPETITIVE_MATCH_IDS: ReadonlySet<string> = new Set([
  SQUASH_STANDALONE_MATCH_ID,
  ...SQUASH_FINISHER_MATCH_IDS,
])

function resolveDrillId(drill: Pick<SquashDrill, 'name'>): string | undefined {
  return findSquashDrillByName(drill.name)?.id
}

export function isCompetitiveMatchDrill(drill: Pick<SquashDrill, 'name'>): boolean {
  const id = resolveDrillId(drill)
  return id != null && COMPETITIVE_MATCH_IDS.has(id)
}

/** Si hay bloques, su flatten por ID y orden debe coincidir exactamente con `drills[]`. */
function blocksMatchDrills(details: SquashDetails): boolean {
  const blocks = details.blocks ?? []
  const flattened = blocks.flatMap((block) => block.drills ?? [])
  const drills = details.drills ?? []
  if (flattened.length !== drills.length) return false
  return flattened.every((drill, index) => {
    const left = resolveDrillId(drill) ?? drill.name.trim().toLowerCase()
    const right = resolveDrillId(drills[index]!) ?? drills[index]!.name.trim().toLowerCase()
    return left === right
  })
}

export function resolveSquashMatchRole(details: SquashDetails | undefined): SquashMatchRole {
  if (!details) return 'none'

  const drills = details.drills ?? []
  const blocks = details.blocks ?? []
  if (blocks.length > 0 && !blocksMatchDrills(details)) return 'none'

  const competitive = drills.filter(isCompetitiveMatchDrill)
  if (competitive.length === 0) return 'none'

  if (drills.length === 1 && resolveDrillId(drills[0]!) === SQUASH_STANDALONE_MATCH_ID) {
    return 'standalone'
  }

  // Un finisher no puede ser canónico sin bloques: sin ellos no hay forma de
  // demostrar que el partido es el último ni que existe un bloque previo no-match.
  if (blocks.length < 2) return 'none'
  if (competitive.length !== 1) return 'none'

  const lastBlock = blocks[blocks.length - 1]!
  if (lastBlock.kind !== 'match') return 'none'
  if ((lastBlock.drills ?? []).length !== 1) return 'none'

  const finisherId = resolveDrillId(lastBlock.drills[0]!)
  if (finisherId == null) return 'none'
  if (!SQUASH_FINISHER_MATCH_IDS.includes(finisherId as typeof SQUASH_FINISHER_MATCH_IDS[number])) return 'none'

  const hasNonMatchBefore = blocks
    .slice(0, -1)
    .some((block) => block.kind !== 'match')
  if (!hasNonMatchBefore) return 'none'

  return 'finisher'
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/squashMatchRole.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Avisar al owner**

Archivos listos: `src/services/training/squashMatchRole.ts`, `src/services/training/__tests__/squashMatchRole.test.ts`.
Mensaje sugerido: `feat: add squash match role module`.

---

## Task 2: Eliminar `practice_match_short_points_attack`

**Files:**
- Modify: `src/services/training/drillLibrary.ts:573` (definición), `:703` (alias)
- Test: `src/services/planBuilder/__tests__/squashMatchRoles.test.ts` (nuevo, test 7 del spec)

**Interfaces:**
- Consumes: nada de Task 1.
- Produces: la ausencia del ID. Ninguna tarea posterior puede referenciarlo.

- [ ] **Step 1: Confirmar el alcance real de las referencias**

Run: `grep -rn "practice_match_short_points_attack\|Partido con ataque temprano" src scripts docs`
Expected: exactamente 2 líneas en `src/services/training/drillLibrary.ts` (definición ~573, alias ~703). Si aparece alguna más, eliminarla también en el Step 3.

- [ ] **Step 2: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/squashMatchRoles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { CoachSessionProposal, SquashDrill } from '../../../types'
import { findSquashDrillByName } from '../../training/drillLibrary'
import { repairGeneratedWeek } from '../repairWeek'
import { buildRepairContextForTest, buildSkeletonSessionForTest } from './helpers/repairTestFixtures'

const ATTACK = 'Partido con ataque temprano'
const TECHNICAL = 'Tiros paralelos profundos'

function squashSession(date: string, drills: SquashDrill[]): CoachSessionProposal {
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    title: 'Squash',
    objective: 'Trabajo de cancha.',
    durationMin: 60,
    rpe: 6,
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'technical',
      drills,
    },
  })
}

describe('drill eliminado: ataque temprano', () => {
  it('ya no existe en el catálogo', () => {
    expect(findSquashDrillByName(ATTACK)?.id).not.toBe('practice_match_short_points_attack')
  })

  it('un plan legado que lo referencia solo termina resuelto y sin failure', () => {
    const result = repairGeneratedWeek(
      [squashSession('2026-08-03', [{ name: ATTACK, durationMin: 60 }])],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }),
    )
    expect(result.failure).toBeUndefined()
    const drills = result.sessions[0]?.squashDetails?.drills ?? []
    expect(drills.length).toBeGreaterThan(0)
    for (const drill of drills) {
      expect(findSquashDrillByName(drill.name)).toBeDefined()
    }
  })

  it('un plan legado que lo referencia dentro de una sesión mixta conserva el resto', () => {
    const result = repairGeneratedWeek(
      [squashSession('2026-08-03', [{ name: TECHNICAL, durationMin: 30 }, { name: ATTACK, durationMin: 30 }])],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }),
    )
    expect(result.failure).toBeUndefined()
    const names = (result.sessions[0]?.squashDetails?.drills ?? []).map((drill) => drill.name)
    expect(names).toContain(TECHNICAL)
    for (const name of names) {
      expect(findSquashDrillByName(name)).toBeDefined()
    }
  })
})
```

- [ ] **Step 3: Correr el test y verificar que el primer caso falla**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts`
Expected: FAIL en "ya no existe en el catálogo" — el ID todavía resuelve.

- [ ] **Step 4: Eliminar la definición y el alias**

En `src/services/training/drillLibrary.ts`, borrar el objeto completo cuyo `id` es `'practice_match_short_points_attack'` (empieza en `{` antes de `id: 'practice_match_short_points_attack',` y termina en la `},` que cierra ese objeto), y borrar la línea del alias:

```ts
  partido_con_foco_de_ataque_en_puntos_cortos: 'practice_match_short_points_attack',
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Correr la suite de training y plan builder**

Run: `npx vitest run src/services/training src/services/planBuilder`
Expected: PASS. Si algún test fijaba ese drill por nombre o ID, actualizarlo — el drill se eliminó a propósito.

- [ ] **Step 7: Avisar al owner**

Mensaje sugerido: `feat: remove early-attack conditioned match drill`.

---

## Task 3: Predicado de exposición y resumen histórico

**Files:**
- Modify: `src/utils/squash.ts:9-14` (`SquashCompetitiveExposureSummary`), `:101-129` (`getRecentSquashCompetitiveExposure`)
- Modify: `src/services/ai/promptModules/squashPrompt.ts:273`
- Test: `src/utils/__tests__/squashExposure.test.ts` (nuevo)

**Interfaces:**
- Consumes: `resolveSquashMatchRole` de Task 1.
- Produces:
  - `function hasSquashCompetitiveExposure(session: Pick<Session, 'type' | 'subtype' | 'squashDetails'>): boolean`
  - `SquashCompetitiveExposureSummary` gana `finisherCount: number`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/utils/__tests__/squashExposure.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Session } from '../../types'
import { getRecentSquashCompetitiveExposure, hasSquashCompetitiveExposure } from '../squash'

const FIVE_GAMES = 'Partido de entrenamiento al mejor de 5 juegos'
const BEST_OF_3 = 'Partido de entrenamiento al mejor de 3 juegos'
const TECHNICAL = 'Tiros paralelos profundos'

function standalone(date: string): Session {
  return {
    id: `s-${date}`, date, timeBlock: 'AM', type: 'squash', subtype: 'match',
    title: 'Partido', durationMin: 60, status: 'completed',
    squashDetails: {
      trainingFocus: 'match', sessionMode: 'practice_match', sessionKind: 'match',
      drills: [{ name: FIVE_GAMES }],
    },
  } as unknown as Session
}

function finisher(date: string): Session {
  return {
    id: `f-${date}`, date, timeBlock: 'AM', type: 'squash', subtype: 'technical',
    title: 'Drills + partido', durationMin: 75, status: 'completed',
    squashDetails: {
      trainingFocus: 'technical', sessionMode: 'drill_session', sessionKind: 'mixed',
      drills: [{ name: TECHNICAL }, { name: BEST_OF_3 }],
      blocks: [
        { kind: 'technical', drills: [{ name: TECHNICAL }] },
        { kind: 'match', drills: [{ name: BEST_OF_3 }] },
      ],
    },
  } as unknown as Session
}

describe('hasSquashCompetitiveExposure', () => {
  it('cuenta un standalone canónico', () => {
    expect(hasSquashCompetitiveExposure(standalone('2026-08-03'))).toBe(true)
  })

  it('cuenta un finisher canónico', () => {
    expect(hasSquashCompetitiveExposure(finisher('2026-08-04'))).toBe(true)
  })

  it('no cuenta una sesión de drills sin partido', () => {
    const session = finisher('2026-08-05')
    session.squashDetails = {
      trainingFocus: 'technical', sessionMode: 'drill_session', sessionKind: 'technical',
      drills: [{ name: TECHNICAL }],
      blocks: [{ kind: 'technical', drills: [{ name: TECHNICAL }] }],
    }
    expect(hasSquashCompetitiveExposure(session)).toBe(false)
  })
})

describe('getRecentSquashCompetitiveExposure', () => {
  it('suma finishers en finisherCount, totalMatchCount y exposureScore', () => {
    const summary = getRecentSquashCompetitiveExposure([standalone('2026-08-03'), finisher('2026-08-04')], 6)
    expect(summary.finisherCount).toBe(1)
    expect(summary.totalMatchCount).toBe(
      summary.practiceMatchCount + summary.competitionMatchCount + summary.finisherCount,
    )
    expect(summary.exposureScore).toBe(summary.totalMatchCount)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/utils/__tests__/squashExposure.test.ts`
Expected: FAIL — `hasSquashCompetitiveExposure is not a function`.

- [ ] **Step 3: Implementar en `src/utils/squash.ts`**

Agregar el import al bloque existente:

```ts
import { resolveSquashMatchRole } from '../services/training/squashMatchRole'
```

Ampliar la interfaz (línea 9):

```ts
export interface SquashCompetitiveExposureSummary {
  practiceMatchCount: number
  competitionMatchCount: number
  /** Sesiones de drills cerradas con un partido corto. Cuentan como exposición. */
  finisherCount: number
  totalMatchCount: number
  exposureScore: number
}
```

Agregar el predicado, después de `isCompetitionSquashMatch`:

```ts
/**
 * Exposición competitiva por CONTENIDO: un partido standalone canónico o una
 * sesión de drills cerrada con un finisher canónico.
 *
 * Deliberadamente separado de `isCompetitionSquashMatch`, que tiene 31 call
 * sites que lo interpretan como "la sesión entera es un partido real" y
 * alimentan nutrición, protocolos y carga. Ampliar aquel cambiaría todo eso en
 * silencio.
 */
export function hasSquashCompetitiveExposure(
  session: Pick<Session, 'type' | 'subtype' | 'squashDetails'>,
): boolean {
  if (session.type !== 'squash') return false
  return resolveSquashMatchRole(session.squashDetails) !== 'none'
}
```

Reemplazar el cuerpo del bucle de `getRecentSquashCompetitiveExposure` (líneas 105-128) por:

```ts
  let practiceMatchCount = 0
  let competitionMatchCount = 0
  let finisherCount = 0

  const recentSessions = [...sessions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
    .slice(0, limit)

  for (const session of recentSessions) {
    if (isPracticeSquashMatch(session)) {
      practiceMatchCount += 1
      continue
    }

    if (isCompetitionSquashMatch(session)) {
      competitionMatchCount += 1
      continue
    }

    if (resolveSquashMatchRole(session.squashDetails) === 'finisher') {
      finisherCount += 1
    }
  }

  const total = practiceMatchCount + competitionMatchCount + finisherCount
  return {
    practiceMatchCount,
    competitionMatchCount,
    finisherCount,
    totalMatchCount: total,
    exposureScore: total,
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/utils/__tests__/squashExposure.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Actualizar la línea factual del prompt**

En `src/services/ai/promptModules/squashPrompt.ts`, reemplazar la línea 273:

```ts
  lines.push(`Exposicion reciente: ${recentExposure.practiceMatchCount} practice match / ${recentExposure.competitionMatchCount} competencia real / ${recentExposure.finisherCount} cierre competitivo en sesion de drills.`)
```

Esto es una actualización **factual** del resumen, no una regla de autoría nueva: sin ella el modelo recibe una historia incompleta y vuelve a pedir exposición que el atleta ya tuvo.

- [ ] **Step 6: Correr la suite de utils y prompts**

Run: `npx vitest run src/utils src/services/ai`
Expected: PASS. Si un test fijaba el texto exacto de la línea de exposición, actualizarlo.

- [ ] **Step 7: Avisar al owner**

Mensaje sugerido: `feat: count squash finishers as competitive exposure`.

---

## Task 4: Idempotencia de la normalización

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:1126` (`hasCanonicalFiveGameMatch`), `:834-847` (guarda de reescritura)
- Test: `src/services/planBuilder/__tests__/squashMatchRoles.test.ts` (agregar)

**Interfaces:**
- Consumes: `resolveSquashMatchRole`, `isCompetitiveMatchDrill` de Task 1.
- Produces: `function isCanonicalMatchContent(session: CoachSessionProposal): boolean` (privada del módulo).

- [ ] **Step 1: Escribir los tests que fallan (tests 1 y 8 del spec)**

Agregar a `src/services/planBuilder/__tests__/squashMatchRoles.test.ts`:

```ts
const BEST_OF_3 = 'Partido de entrenamiento al mejor de 3 juegos'
const GAME_TO_11 = 'Game a 11 con marcador real'
const ACTIVATION = 'Activación pre-partido de manos y pies'

function finisherSession(date: string, finisherName: string): CoachSessionProposal {
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    title: 'Squash técnico con cierre competitivo',
    objective: 'Trabajo de largo y cierre con marcador.',
    durationMin: 75,
    rpe: 7,
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'mixed',
      drills: [{ name: TECHNICAL, durationMin: 45 }, { name: finisherName, durationMin: 30 }],
      blocks: [
        { kind: 'technical', drills: [{ name: TECHNICAL, durationMin: 45 }] },
        { kind: 'match', drills: [{ name: finisherName, durationMin: 30 }] },
      ],
    },
  })
}

describe('finisher sobrevive la normalización', () => {
  // Semana 0 de bloque: la política de rotación no corre, así que el invariante
  // exigible es el ID exacto. Con política activa el invariante es el rol (Task 8).
  it('conserva ID y bloques a través de dos pasadas de repair', () => {
    for (const name of [BEST_OF_3, GAME_TO_11]) {
      const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 })
      const first = repairGeneratedWeek([finisherSession('2026-08-03', name)], context)
      const second = repairGeneratedWeek(first.sessions, context)

      const details = second.sessions[0]?.squashDetails
      expect(details?.drills.map((drill) => drill.name)).toEqual([TECHNICAL, name])
      expect(details?.blocks?.map((block) => block.kind)).toEqual(['technical', 'match'])
      expect(details?.sessionMode).toBe('drill_session')
      expect(details?.sessionKind).toBe('mixed')
    }
  })

  it('una activación aislada no se proyecta a standalone', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', phase: 'taper', sessionsPerWeek: 1 })
    const result = repairGeneratedWeek([squashSession('2026-08-03', [{ name: ACTIVATION, durationMin: 40 }])], context)
    const names = (result.sessions[0]?.squashDetails?.drills ?? []).map((drill) => drill.name)
    expect(names).not.toContain('Partido de entrenamiento al mejor de 5 juegos')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "finisher sobrevive"`
Expected: FAIL — el finisher fue reescrito a `[Partido de entrenamiento al mejor de 5 juegos]`.

- [ ] **Step 3: Reemplazar `hasCanonicalFiveGameMatch` por `isCanonicalMatchContent`**

En `src/services/planBuilder/repairWeek.ts`, agregar al bloque de imports:

```ts
import { isCompetitiveMatchDrill, resolveSquashMatchRole } from '../training/squashMatchRole'
```

Reemplazar la función completa en la línea 1126:

```ts
/**
 * Chequeo de idempotencia de la normalización semántica. Generaliza al rol: sin
 * esto una sesión con finisher se reescribiría a standalone y, como el repair
 * corre DOS veces en el contrato skeleton, las dos pasadas se pelearían.
 */
function isCanonicalMatchContent(session: CoachSessionProposal): boolean {
  return resolveSquashMatchRole(session.squashDetails) !== 'none'
}
```

Reemplazar su uso en la guarda de la línea ~837:

```ts
    if (
      dedicatedMatchContent &&
      (details.sessionMode === 'practice_match' || details.sessionMode === 'competition_match') &&
      !isCanonicalMatchContent(session)
    ) {
```

- [ ] **Step 4: Excluir la activación del disparo de proyección**

En la misma función, la variable `dedicatedMatchContent` (línea ~815) debe mirar **contenido competitivo**, no `kind === 'match'`. Reemplazarla por:

```ts
    const hasCompetitiveContent = (details.drills ?? []).some(isCompetitiveMatchDrill)
    const dedicatedMatchContent = hasCompetitiveContent
      && (contentSaysMatch || (hasBlocks ? blockKinds.length === 1 && hasMatchBlock : inferredKind === 'match'))
```

Sin esto, una sesión con solo `pre_match_activation_timing` —que es `category: 'match'`— se proyectaría a un best-of-5 completo a 48 h del evento.

- [ ] **Step 5: Normalizar la sesión finisher a `drill_session` / `mixed`**

Inmediatamente después del bloque `if (dedicatedMatchContent && ...)` de la línea ~837, agregar:

```ts
    // El carácter competitivo de un finisher pertenece al contenido, no al modo
    // global de la sesión.
    if (resolveSquashMatchRole(session.squashDetails) === 'finisher') {
      details.sessionMode = 'drill_session'
      details.sessionKind = 'mixed'
    }
```

- [ ] **Step 6: Fijar que una sesión mixta no canónica conserva su parte no-match**

Spec §2.1: una sesión mixta con contenido competitivo **no canónico** conserva la
parte no-match. No hay código nuevo — lo garantiza la guarda de
`dedicatedMatchContent`, que exige `blockKinds.length === 1 && hasMatchBlock` en el
camino con bloques. Este test lo fija para que un cambio futuro no lo rompa en
silencio:

```ts
it('una sesión mixta con contenido competitivo no canónico conserva su parte no-match', () => {
  const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 })
  // Dos drills competitivos: no es finisher canónico (§2 condición 4).
  const session = squashSession('2026-08-03', [
    { name: TECHNICAL, durationMin: 25 },
    { name: FIVE_GAMES, durationMin: 25 },
    { name: BEST_OF_3, durationMin: 25 },
  ])
  const result = repairGeneratedWeek([session], context)

  expect(result.failure).toBeUndefined()
  const names = (result.sessions[0]?.squashDetails?.drills ?? []).map((drill) => drill.name)
  expect(names).toContain(TECHNICAL)
  // No se proyectó al standalone canónico, que borraría el trabajo técnico.
  expect(names).not.toEqual([FIVE_GAMES])
})
```

La mitad "se elimina o reemplaza" de §2.1 ya la cubre la reparación contextual
existente (`repairUnresolvedSquashDrills`) cuando el drill no resuelve en
catálogo. Un drill competitivo que **sí** resuelve pero deja la sesión no canónica
simplemente queda como está: rol `none`, sin trato especial, sin contar como
exposición. Es benigno y deliberado.

- [ ] **Step 7: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts`
Expected: PASS.

- [ ] **Step 8: Correr la suite del plan builder**

Run: `npx vitest run src/services/planBuilder src/services/weekCreator`
Expected: PASS. Los tests que fijaban "todo partido se colapsa a best-of-5" ahora fijan comportamiento obsoleto: actualizarlos al contrato de rol.

- [ ] **Step 9: Avisar al owner**

Mensaje sugerido: `feat: preserve canonical squash finishers through normalization`.

---

## Task 5: Mínimo de drills por contenido standalone

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:637-642` (`getMinimumSquashDrillCount`)
- Test: `src/services/planBuilder/__tests__/squashMatchRoles.test.ts` (agregar)

**Interfaces:**
- Consumes: `resolveSquashMatchRole` de Task 1.
- Produces: ningún símbolo nuevo.

- [ ] **Step 1: Escribir el test que falla**

```ts
describe('mínimo de drills', () => {
  it('un standalone de 60 min no se densifica', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 })
    const session = squashSession('2026-08-03', [{ name: FIVE_GAMES, durationMin: 60 }])
    session.subtype = 'match'
    session.squashDetails!.sessionMode = 'practice_match'
    session.squashDetails!.sessionKind = 'match'

    const result = repairGeneratedWeek([session], context)
    expect(result.sessions[0]?.squashDetails?.drills).toHaveLength(1)
  })
})
```

Agregar `const FIVE_GAMES = 'Partido de entrenamiento al mejor de 5 juegos'` al encabezado del archivo si no está.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "no se densifica"`
Expected: FAIL — recibe 4 drills.

- [ ] **Step 3: Implementar**

Reemplazar `getMinimumSquashDrillCount` (línea 637):

```ts
function getMinimumSquashDrillCount(session: CoachSessionProposal): number {
  // Un partido standalone es UNA actividad. El peloteo y la entrada en calor
  // viven en `warmup`, que protocolEngine arma aparte para toda sesión de squash.
  if (resolveSquashMatchRole(session.squashDetails) === 'standalone') return 1
  if (session.durationMin >= 60) return 4
  if (session.durationMin >= 45) return session.squashDetails?.sessionKind === 'match' ? 2 : 3
  if (session.durationMin >= 30) return 2
  return 1
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts`
Expected: PASS.

- [ ] **Step 5: Avisar al owner**

Mensaje sugerido: `fix: stop densifying standalone squash matches`.

---

## Task 6: Exposición competitiva en el repair

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:896-951` (`ensureSquashCompetitionMatchExposure`), `:996-1021` (`normalizeLateTaperSquashMatchPlay`), `:1727` (`preservesCompetitiveExposure`)
- Test: `src/services/planBuilder/__tests__/squashMatchRoles.test.ts` (agregar)

**Interfaces:**
- Consumes: `resolveSquashMatchRole` de Task 1.
- Produces: `function hasCompetitiveExposureContent(session: CoachSessionProposal): boolean` (privada).

- [ ] **Step 1: Escribir los tests que fallan (tests 2 y 3 del spec)**

```ts
describe('exposición competitiva', () => {
  it('no agrega ni convierte otra sesión si ya hay un finisher en fecha segura', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', phase: 'peak', sessionsPerWeek: 3 })
    const result = repairGeneratedWeek([
      finisherSession('2026-08-03', BEST_OF_3),
      squashSession('2026-08-05', [{ name: TECHNICAL, durationMin: 60 }]),
      squashSession('2026-08-07', [{ name: TECHNICAL, durationMin: 60 }]),
    ], context)

    const modes = result.sessions
      .filter((session) => session.sessionType === 'squash')
      .map((session) => session.squashDetails?.sessionMode)
    expect(modes).not.toContain('competition_match')
    expect(result.meta.warnings.map((warning) => warning.code))
      .not.toContain('squash_competition_match_added')
  })

  it('retira solo el bloque final de un finisher a menos de 48 h del evento', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', phase: 'taper', sessionsPerWeek: 2 })
    const eventDate = context.plan.macroSnapshot.goalEventDate
    const dayBefore = new Date(new Date(`${eventDate}T00:00:00Z`).getTime() - 86_400_000)
      .toISOString().slice(0, 10)

    const result = repairGeneratedWeek([finisherSession(dayBefore, BEST_OF_3)], context)
    const details = result.sessions[0]?.squashDetails
    const names = (details?.drills ?? []).map((drill) => drill.name)
    expect(names).toContain(TECHNICAL)
    expect(names).not.toContain(BEST_OF_3)
  })
})
```

Si `goalEventDate` del fixture no cae dentro de la semana del test, ajustar `context.plan.macroSnapshot.goalEventDate` y `context.week.weekStartDate` para que `dayBefore` quede dentro de la semana.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "exposición competitiva"`
Expected: FAIL — el primero agrega un `competition_match`; el segundo destruye la sesión entera.

- [ ] **Step 3: Agregar el predicado local**

En `src/services/planBuilder/repairWeek.ts`, junto a las otras helpers de squash:

```ts
/** Predicado único de exposición para todo el repair. Ver spec §3. */
function hasCompetitiveExposureContent(session: CoachSessionProposal): boolean {
  return session.sessionType === 'squash'
    && resolveSquashMatchRole(session.squashDetails) !== 'none'
}
```

- [ ] **Step 4: Usarlo en `ensureSquashCompetitionMatchExposure`**

Reemplazar la guarda de la línea 904:

```ts
  if (squashSessions.some((session) =>
    hasCompetitiveExposureContent(session) && isSafeSquashCompetitionExposureDate(session.date, context)
  )) return sessions
```

- [ ] **Step 5: Usarlo en `preservesCompetitiveExposure`**

Reemplazar el cuerpo del `sessions.some(...)` (línea ~1731):

```ts
  return sessions.some((session) => {
    const evaluated = session === original ? candidate : session
    return hasCompetitiveExposureContent(evaluated)
      && isSafeSquashCompetitionExposureDate(evaluated.date, context)
  })
```

- [ ] **Step 6: Diferenciar por rol en `normalizeLateTaperSquashMatchPlay`**

Reemplazar el cuerpo del bucle (líneas ~1005-1020):

```ts
  for (const session of sessions) {
    if (session.sessionType !== 'squash') continue
    if (session.date === eventDate) continue
    if (daysBetween(session.date, eventDate) > 2) continue

    const role = resolveSquashMatchRole(session.squashDetails)
    if (role === 'finisher') {
      // Se retira SOLO el bloque final: destruir la sesión entera para sacarle
      // el cierre competitivo perdería una sesión mixta válida.
      const details = session.squashDetails!
      const blocks = (details.blocks ?? []).slice(0, -1)
      const drills = blocks.flatMap((block) => block.drills ?? [])
      if (drills.length === 0) continue
      details.blocks = blocks
      details.drills = drills
      details.sessionKind = blocks.length > 1 ? 'mixed' : blocks[0]!.kind
      session.durationMin = Math.min(session.durationMin, 35)
      session.rpe = Math.min(session.rpe ?? 4, 4)
      recordRepair(meta, 'corrective', sessionKeyOf(session))
      meta.warnings.push({
        code: 'late_taper_match_controlled',
        message: `Se retiró el cierre competitivo de "${session.title}": está demasiado cerca del evento.`,
        sessionDate: session.date,
      })
      continue
    }

    if (role !== 'standalone'
      && !isSquashMatchIntent(session)
      && session.squashDetails?.sessionMode !== 'competition_match') continue

    const previousTitle = session.title
    applyPreEventSquashActivationDetails(session, context)
    recordRepair(meta, 'corrective', sessionKeyOf(session))
    meta.warnings.push({
      code: 'late_taper_match_controlled',
      message: `Se cambió "${previousTitle}" a activación/control: está demasiado cerca del evento para match-play.`,
      sessionDate: session.date,
    })
  }
```

- [ ] **Step 7: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts`
Expected: PASS.

- [ ] **Step 8: Avisar al owner**

Mensaje sugerido: `feat: single competitive exposure predicate across repair`.

---

## Task 7: Standalone fuera de la unicidad de firmas

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:1470+` (`normalizeSquashSessionContent`)
- Modify: `src/services/weekCreator/validateWeekCreatorResponse.ts:253-268`
- Test: `src/services/planBuilder/__tests__/squashMatchRoles.test.ts` (agregar)

**Interfaces:**
- Consumes: `resolveSquashMatchRole` de Task 1.
- Produces: ningún símbolo nuevo.

- [ ] **Step 1: Escribir el test que falla (test 5 del spec)**

```ts
describe('dos standalone conviven', () => {
  it('ni el repair falla ni se los trata como duplicados', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 2 })
    const first = squashSession('2026-08-03', [{ name: FIVE_GAMES, durationMin: 60 }])
    const second = squashSession('2026-08-05', [{ name: FIVE_GAMES, durationMin: 60 }])
    for (const session of [first, second]) {
      session.subtype = 'match'
      session.squashDetails!.sessionMode = 'practice_match'
      session.squashDetails!.sessionKind = 'match'
    }

    const result = repairGeneratedWeek([first, second], context)
    expect(result.failure).toBeUndefined()
    const squash = result.sessions.filter((session) => session.sessionType === 'squash')
    expect(squash).toHaveLength(2)
    for (const session of squash) {
      expect(session.squashDetails?.drills.map((drill) => drill.name)).toEqual([FIVE_GAMES])
    }
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "dos standalone"`
Expected: FAIL — `result.failure` con `quality.squash.signature_uniqueness_unresolved`.

- [ ] **Step 3: Excluir standalone en `normalizeSquashSessionContent`**

En `src/services/planBuilder/repairWeek.ts`, dentro de `normalizeSquashSessionContent`, reemplazar la línea que arma `squashSessions`:

```ts
  const allSquashSessions = sessions.filter((session) => session.sessionType === 'squash')
  // Dos partidos comparten formato, y eso no es repetir una prescripción de
  // drills. Con un solo standalone canónico, incluirlos haría irresoluble
  // cualquier semana con dos partidos. Ver spec §5.1 y §10.1.
  const squashSessions = allSquashSessions.filter(
    (session) => resolveSquashMatchRole(session.squashDetails) !== 'standalone',
  )
  if (squashSessions.length === 0) return {}
```

El resto de la función no cambia: `squashSessions` ya es la lista sobre la que se calculan firmas, política y corrección.

- [ ] **Step 4: Excluir standalone en el validador del Week Creator**

En `src/services/weekCreator/validateWeekCreatorResponse.ts`, agregar el import:

```ts
import { resolveSquashMatchRole } from '../training/squashMatchRole'
```

Y en `validateDuplicateSquashSessions` (línea 253), después de `if (session.sessionType !== 'squash') continue`:

```ts
    // Dos partidos al mejor de 5 no son una prescripción de drills repetida.
    if (resolveSquashMatchRole(session.squashDetails) === 'standalone') continue
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/planBuilder src/services/weekCreator`
Expected: PASS.

- [ ] **Step 6: Avisar al owner**

Mensaje sugerido: `feat: exclude standalone matches from squash signature uniqueness`.

---

## Task 8: Rotación que respeta el rol

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts` (loop de política dentro de `normalizeSquashSessionContent`)
- Test: `src/services/planBuilder/__tests__/squashMatchRoles.test.ts` (agregar)

**Interfaces:**
- Consumes: `resolveSquashMatchRole`, `SQUASH_FINISHER_MATCH_IDS` de Task 1; `findSquashDrillByName` de `drillLibrary`.
- Produces: ningún símbolo nuevo.

- [ ] **Step 1: Escribir el test que falla (test 4 del spec)**

```ts
describe('rotación respeta el rol', () => {
  function blockContext(weekIndex: number) {
    const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 })
    context.plan = {
      ...context.plan,
      totalWeeks: 2,
      phases: [{ phase: 'base', startWeekIndex: 0, endWeekIndex: 1, blockFocus: '', intentBySport: {} }],
    }
    context.week = { ...context.week, weekIndex, weekStartDate: '2026-08-10', phase: 'base' }
    context.planWeekDescriptors = [
      { weekIndex: 0, phase: 'base' },
      { weekIndex: 1, phase: 'base' },
    ]
    return context
  }

  it('con política activa, un finisher sigue siendo finisher', () => {
    const result = repairGeneratedWeek([finisherSession('2026-08-10', BEST_OF_3)], blockContext(1))
    const details = result.sessions[0]?.squashDetails
    const last = details?.drills[details.drills.length - 1]
    const lastId = findSquashDrillByName(last?.name ?? '')?.id ?? ''
    expect(['practice_match_best_of_3', 'match_sim_points_short_sets']).toContain(lastId)
  })

  it('con política activa, un standalone no rota', () => {
    const session = squashSession('2026-08-10', [{ name: FIVE_GAMES, durationMin: 60 }])
    session.subtype = 'match'
    session.squashDetails!.sessionMode = 'practice_match'
    session.squashDetails!.sessionKind = 'match'

    const result = repairGeneratedWeek([session], blockContext(1))
    expect(result.sessions[0]?.squashDetails?.drills.map((drill) => drill.name)).toEqual([FIVE_GAMES])
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "rotación respeta"`
Expected: FAIL — el finisher rotó a un drill técnico o a best-of-5.

- [ ] **Step 3: Restringir los candidatos del slot finisher**

Dentro del loop de política de `normalizeSquashSessionContent`, reemplazar el cuerpo del `for (const [drillOrdinal, drill] of drills.entries())` por:

```ts
    const sessionRole = resolveSquashMatchRole(session.squashDetails)
    for (const [drillOrdinal, drill] of drills.entries()) {
      const drillId = findSquashDrillByName(drill.name)?.id
      const isFinisherSlot = sessionRole === 'finisher'
        && drillId != null
        && SQUASH_FINISHER_MATCH_IDS.includes(drillId as typeof SQUASH_FINISHER_MATCH_IDS[number])

      if (isFinisherSlot) {
        // Un finisher solo puede rotar entre los dos IDs de finisher. Nunca se
        // relaja hacia best-of-5 ni hacia otro drill match.
        const alternatives = SQUASH_FINISHER_MATCH_IDS
          .filter((id) => id !== drillId)
          .map((id) => findSquashDrillByName(id))
          .filter((definition): definition is NonNullable<typeof definition> => definition != null)
          .filter((definition) => !assignedKeys.has(squashDrillKey(definition.id))
            && !previousKeys.has(squashDrillKey(definition.id)))

        const picked = alternatives[
          (weekIndexInBlock * 131 + sessionOrdinal * 17 + drillOrdinal) % Math.max(1, alternatives.length)
        ]
        if (!picked || alternatives.length === 0) {
          omitted++
          assignedKeys.add(squashDrillKey(drill.name))
          continue
        }
        assignedKeys.add(squashDrillKey(picked.id))
        replaceSquashDrill(session, drillOrdinal, picked)
        policyActions++
        policyTouched.add(sessionKeyOf(session))
        continue
      }

      const replacement = selectSquashDrillReplacement({
        originalName: drill.name,
        context: buildSquashRotationSelectionContext(session, context),
        excludedKeys: new Set([...assignedKeys, ...previousKeys]),
        rotationIndex: weekIndexInBlock * 131 + sessionOrdinal * 17 + drillOrdinal,
        relaxation: 'strict',
      })
      if (!replacement) {
        omitted++
        assignedKeys.add(squashDrillKey(drill.name))
        continue
      }
      assignedKeys.add(squashDrillKey(replacement.id))
      if (squashDrillKey(replacement.id) === squashDrillKey(drill.name)) continue
      replaceSquashDrill(session, drillOrdinal, replacement)
      policyActions++
      policyTouched.add(sessionKeyOf(session))
    }
```

Los standalone ya no llegan a este loop: Task 7 los sacó de `squashSessions`.

Agregar `SQUASH_FINISHER_MATCH_IDS` al import de `squashMatchRole` que Task 4 creó.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts`
Expected: PASS.

- [ ] **Step 5: Avisar al owner**

Mensaje sugerido: `feat: role-aware squash drill rotation`.

---

## Task 9: Contadores observacionales

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts` (`RepairMeta`, `normalizeSquashSessionContent`)
- Modify: `src/types/planBuilder.ts` (`PlanGenerationMeta`)
- Modify: `src/services/planBuilder/generateWeek.ts`, `generateWeekCore.ts`, `generatePlan.ts`, `asyncGenerationLoop.ts` (propagación)
- Modify: `scripts/loadtest-plan-builder/artifact.mjs` (allowlist)
- Test: `src/services/planBuilder/__tests__/squashMatchRoles.test.ts` (agregar)

**Interfaces:**
- Consumes: `resolveSquashMatchRole` de Task 1.
- Produces: en `RepairMeta` y `PlanGenerationMeta`, tres campos opcionales:
  `squashFinisherProposedCount?: number`, `squashFinisherPreservedCount?: number`, `squashStandaloneMatchCount?: number`.

- [ ] **Step 1: Escribir el test que falla**

```ts
describe('contadores observacionales', () => {
  it('cuenta finishers propuestos, preservados y standalone finales', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 2 })
    const standaloneA = squashSession('2026-08-03', [{ name: FIVE_GAMES, durationMin: 60 }])
    standaloneA.subtype = 'match'
    standaloneA.squashDetails!.sessionMode = 'practice_match'
    standaloneA.squashDetails!.sessionKind = 'match'

    const result = repairGeneratedWeek([standaloneA, finisherSession('2026-08-05', BEST_OF_3)], context)

    expect(result.meta.squashFinisherProposedCount).toBe(1)
    expect(result.meta.squashFinisherPreservedCount).toBe(1)
    expect(result.meta.squashStandaloneMatchCount).toBe(1)
    // Observacionales: no inflan la taxonomía.
    expect(result.meta.repairedSessionCount).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "contadores"`
Expected: FAIL — `expected undefined to be 1`.

- [ ] **Step 3: Agregar los campos a `RepairMeta`**

En `src/services/planBuilder/repairWeek.ts`, dentro de `interface RepairMeta`, junto a los campos de rotación:

```ts
  /** Observacionales: NO entran en countRepairsV2 ni en la taxonomía. */
  squashFinisherProposedCount?: number
  squashFinisherPreservedCount?: number
  squashStandaloneMatchCount?: number
```

- [ ] **Step 4: Medir en `repairGeneratedWeek`**

En `repairGeneratedWeek`, **antes** del paso 6 (`completeSportDetails`), medir la entrada:

```ts
  // Punto de observación: la entrada del repair, después del responseNormalizer.
  // La respuesta cruda del modelo no la ve este módulo.
  meta.squashFinisherProposedCount = sessions.filter(
    (session) => session.sessionType === 'squash'
      && resolveSquashMatchRole(session.squashDetails) === 'finisher',
  ).length
```

E inmediatamente **antes** del `return` final, medir la salida:

```ts
  meta.squashFinisherPreservedCount = sessions.filter(
    (session) => session.sessionType === 'squash'
      && resolveSquashMatchRole(session.squashDetails) === 'finisher',
  ).length
  meta.squashStandaloneMatchCount = sessions.filter(
    (session) => session.sessionType === 'squash'
      && resolveSquashMatchRole(session.squashDetails) === 'standalone',
  ).length
```

`PreservedCount` cuenta **rol**, no ID: la rotación de Task 8 puede cambiar best-of-3 por Game a 11 y eso no es una pérdida.

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "contadores"`
Expected: PASS.

- [ ] **Step 6: Propagar a `PlanGenerationMeta`**

En `src/types/planBuilder.ts`, junto a los campos de rotación de squash:

```ts
  /** Observacionales de rol de partido (no entran en countRepairsV2). */
  squashFinisherProposedCount?: number
  squashFinisherPreservedCount?: number
  squashStandaloneMatchCount?: number
```

- [ ] **Step 7: Propagar por la cadena**

En cada uno de estos archivos, copiar los tres campos **exactamente donde ya se copian** `squashDrillRotationOmittedCount`:

- `src/services/planBuilder/generateWeek.ts` — `GenerateWeekResult['meta']`, `WeekActionEvaluation`, y los dos `return` de `validateGeneratedWeekAction`.
- `src/services/planBuilder/generateWeekCore.ts` — las mismas cuatro ubicaciones, más el `return` de `generateWeekCore`.
- `src/services/planBuilder/generatePlan.ts` — `BatchWeekExtraction`, `ResolvedWeekInput`, `makeResolvedWeek`, `makeDeterministicResolvedWeek`, `makeLocalFallbackResolvedWeek`, `generateSingleWeekWithRetry`, `generateWeekPair` y la rama de pares de `generatePlanWeeks`.
- `src/services/planBuilder/asyncGenerationLoop.ts` — `makeResolvedWeek` y `makeFallbackResolvedWeek`.

Patrón, idéntico en todos:

```ts
      squashFinisherProposedCount: <fuente>.squashFinisherProposedCount,
      squashFinisherPreservedCount: <fuente>.squashFinisherPreservedCount,
      squashStandaloneMatchCount: <fuente>.squashStandaloneMatchCount,
```

Verificación: `grep -c "squashDrillRotationOmittedCount" <archivo>` y `grep -c "squashStandaloneMatchCount" <archivo>` deben dar el mismo número en cada archivo.

- [ ] **Step 8: Allowlist del loadtest**

En `scripts/loadtest-plan-builder/artifact.mjs`, dentro de `toWeekRow`, después de `squashDrillRotationOmittedCount`:

```js
    squashFinisherProposedCount: meta.squashFinisherProposedCount ?? null,
    squashFinisherPreservedCount: meta.squashFinisherPreservedCount ?? null,
    squashStandaloneMatchCount: meta.squashStandaloneMatchCount ?? null,
```

El guard de drift del artefacto exige que la allowlist y el row-mapper no diverjan: si `scripts/loadtest-plan-builder.test.js` falla, actualizar su lista esperada de claves.

- [ ] **Step 9: Correr las suites afectadas**

Run: `npx vitest run src/services/planBuilder scripts/loadtest-plan-builder.test.js`
Expected: PASS.

- [ ] **Step 10: Avisar al owner**

Mensaje sugerido: `feat: observational squash match role counters`.

---

## Task 10: Punto fijo y verificación final

**Files:**
- Test: `src/services/planBuilder/__tests__/squashMatchRoles.test.ts` (agregar)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Escribir el test de punto fijo (test 6 del spec)**

```ts
describe('punto fijo', () => {
  it('la segunda ejecución completa es igualdad exacta', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', phase: 'peak', sessionsPerWeek: 3 })
    const first = repairGeneratedWeek([
      finisherSession('2026-08-03', BEST_OF_3),
      squashSession('2026-08-05', [{ name: TECHNICAL, durationMin: 60 }]),
      squashSession('2026-08-07', [{ name: TECHNICAL, durationMin: 60 }]),
    ], context)

    const second = repairGeneratedWeek(
      first.sessions.map((session) => structuredClone(session)),
      context,
    )

    expect(JSON.stringify(second.sessions)).toBe(JSON.stringify(first.sessions))
    expect(second.meta.repairedSessionCount).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "punto fijo"`
Expected: PASS. Si falla, la diferencia entre `first` y `second` señala qué paso no es idempotente — arreglarlo antes de seguir, no relajar el test.

- [ ] **Step 3: Verificación completa**

Run: `npm run lint`
Expected: sin salida.

Run: `npm test`
Expected: todos los archivos pasan. Base de comparación: 320 archivos / 2386 tests antes de este plan; el número sube con los tests nuevos.

Run: `npm run build`
Expected: `✓ built in …`.

- [ ] **Step 4: Confirmar el barrido del drill eliminado**

Run: `grep -rn "practice_match_short_points_attack\|Partido con ataque temprano" src scripts docs`
Expected: sin resultados fuera de `docs/superpowers/specs/` y `docs/superpowers/plans/`, donde figura como registro histórico de la decisión.

- [ ] **Step 5: Avisar al owner**

Resumen para el owner: qué tareas quedaron, resultado de lint/test/build, y el recordatorio de que la medición de §6 del spec queda pendiente de la próxima corrida pagada del loadtest.

---

## Notas de cierre

**Lo que este plan NO hace, a propósito:**

- No compone finishers. Si tras la próxima corrida `squashFinisherProposedCount` sale cerca de cero, la respuesta es prompt o selector, no autoría en el repair (spec §4).
- No impone tope de partidos por semana. Riesgo residual aceptado y documentado en spec §10.1; `squashStandaloneMatchCount` lo hace medible.
- No corre el loadtest. Saldo insuficiente (spec §11).

**Actualizar después del merge:** `PROJECT_REVIEW_AND_ROADMAP.md` (nueva sección de calidad deportiva) y `CLAUDE.md` (bloque reciente + conteo de la suite).
