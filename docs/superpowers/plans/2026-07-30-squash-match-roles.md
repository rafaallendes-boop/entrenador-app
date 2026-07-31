# Roles de partido de squash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar la categoría `match` de squash en dos roles derivados del contenido —`standalone` y `finisher`— para que el repair deje de destruir los finishers propuestos por el modelo.

**Architecture:** Un módulo puro nuevo (`squashMatchRole.ts`) resuelve el rol desde `SquashDetails` por IDs estables y expone el único predicado de exposición. El rol interviene **al calcular** la semántica y la densificación, no como parche posterior. Sin migraciones, sin cambios en las reglas de autoría del prompt.

**Tech Stack:** TypeScript, Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-07-30-squash-match-roles-design.md`

## Global Constraints

- **IDs de contenido competitivo, exactamente estos tres:** `practice_match_five_games` (standalone), `practice_match_best_of_3` y `match_sim_points_short_sets` (finisher). `pre_match_activation_timing` **NO** es contenido competitivo.
- **`isCompetitionSquashMatch` (`src/utils/squash.ts:94`) no se modifica.** 31 call sites en 13 archivos (nutrición, protocolos, carga, prompts).
- **`isSquashMatchDrill` no decide rol.** Devuelve `true` para todo `category === 'match'`, incluida la activación.
- **Un solo predicado de exposición**, definido sobre `SquashDetails` en `squashMatchRole.ts`. `utils/squash.ts` y `repairWeek.ts` lo envuelven, no lo reimplementan.
- **Invariante duro del rol:** `drills[]` debe ser **exactamente** el flatten de `blocks` por ID y orden. Cualquier paso que toque drills o bloques debe dejarlos coherentes o el rol colapsa a `none`.
- El repair **no compone** finishers: solo los habilita y preserva.
- Los tres contadores nuevos son **observacionales**: no incrementan `repairedSessionCount` ni la taxonomía, y no entran en `countRepairsV2`.
- **Valores de contrato reales para fixtures — nunca castear:**
  - `SquashTrainingFocus = 'technical' | 'tactical' | 'physical' | 'conditioned_games'` (**no existe `'match'`**)
  - `SquashSubtype = 'control' | 'training' | 'match' | 'competitive' | 'light'` (**no existe `'technical'`**)
  - Finisher → `trainingFocus: 'technical'`, `subtype: 'training'`. Standalone → `trainingFocus: 'tactical'`, `subtype: 'match'`.
- Comandos de verificación: `npm run lint`, `npm test`, `npm run build`.
- **Ya aplicado, no rehacer:** la exención de sesiones de partido en `quality.squash.low_drill_depth` (`qualityReview.ts`, helper `isSquashMatchSession`) y su test `__tests__/qualityReviewMatchDrillDepth.test.ts` están en el árbol sin commitear. Spec §7 los da por hechos.
- **No ejecutar `git commit` ni `git add`.** Donde el plan dice "Avisar al owner", detenerse y reportar qué archivos quedaron listos.
- **No correr `npm run loadtest:plan-builder`.** Corrida pagada (~US$0,90), saldo ~US$0,60.
- Terminología: en textos de squash, "la T" (femenino).

---

## Orden y por qué

El repair aplica sus pasos en orden fijo. La **densificación** (paso 6,
`completeSportDetails`) corre **antes** de la **normalización semántica** (paso 13).
Por eso Task 3 va antes que Task 4: sin densificación role-aware, ningún finisher
llega vivo al paso 13 y los tests de Task 4 fallarían por una causa que no es la
que están probando.

| # | Tarea | Cierra |
|---|---|---|
| 1 | Módulo de rol + predicado compartido | spec §2, §2.0, §3 |
| 2 | Eliminar ataque temprano | §7, §8 |
| 3 | Densificación role-aware | invariante `drills[]`/`blocks` |
| 4 | Semántica role-aware + limpieza de `none` | §2.1, idempotencia §7 |
| 5 | Mínimo de drills standalone | §7 |
| 6 | Exposición y taper tardío | §3, §3.1 |
| 7 | Standalone fuera de unicidad | §5.1 |
| 8 | Rotación y corrección role-aware | §5 |
| 9 | Contadores observacionales | §6 |
| 10 | Punto fijo y verificación | §9, §11 |

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/services/training/squashMatchRole.ts` | **Nuevo.** Rol, IDs, predicado de exposición sobre `SquashDetails`. Puro. |
| `src/services/training/__tests__/squashMatchRole.test.ts` | **Nuevo.** Contrato del módulo. |
| `src/services/training/drillLibrary.ts` | Eliminar `practice_match_short_points_attack` y su alias. |
| `src/services/training/drillSelector.ts` | `selectSquashDrillReplacement` acepta allowlist de IDs. |
| `src/utils/squash.ts` | `hasSquashCompetitiveExposure` (envoltorio) + `finisherCount`. |
| `src/services/ai/promptModules/squashPrompt.ts` | Línea factual de exposición. |
| `src/services/planBuilder/repairWeek.ts` | Densificación, semántica, exposición, unicidad, rotación, contadores. |
| `src/services/weekCreator/validateWeekCreatorResponse.ts` | Standalone fuera de `duplicate_squash_content`. |
| `src/types/planBuilder.ts` | Tres campos opcionales. |
| `scripts/loadtest-plan-builder/artifact.mjs` | Allowlist. |
| `src/services/planBuilder/__tests__/squashMatchRoles.test.ts` | **Nuevo.** Tests §9 del spec. |
| `src/services/planBuilder/__tests__/helpers/squashRoleFixtures.ts` | **Nuevo.** Fixtures compartidos con valores de contrato reales. |

---

## Task 1: Módulo de rol y predicado de exposición

**Files:**
- Create: `src/services/training/squashMatchRole.ts`
- Test: `src/services/training/__tests__/squashMatchRole.test.ts`

**Interfaces:**
- Consumes: `findSquashDrillByName` de `./drillLibrary`; `SquashDetails`, `SquashDrill` de `../../types`.
- Produces:
  - `type SquashMatchRole = 'standalone' | 'finisher' | 'none'`
  - `const SQUASH_STANDALONE_MATCH_ID: 'practice_match_five_games'`
  - `const SQUASH_FINISHER_MATCH_IDS: readonly ['practice_match_best_of_3', 'match_sim_points_short_sets']`
  - `function isCompetitiveMatchDrill(drill: Pick<SquashDrill, 'name'>): boolean`
  - `function resolveSquashMatchRole(details: SquashDetails | undefined): SquashMatchRole`
  - `function hasSquashCompetitiveExposureContent(details: SquashDetails | undefined): boolean`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/training/__tests__/squashMatchRole.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { SquashDetails } from '../../../types'
import {
  hasSquashCompetitiveExposureContent,
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

  it('no es finisher sin bloques: no se puede demostrar que sea el último', () => {
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

  it('no es finisher si hay otro drill competitivo', () => {
    expect(resolveSquashMatchRole(details({
      drills: [{ name: TECHNICAL }, { name: FIVE_GAMES }, { name: BEST_OF_3 }],
      blocks: [
        { kind: 'technical', drills: [{ name: TECHNICAL }] },
        { kind: 'match', drills: [{ name: FIVE_GAMES }, { name: BEST_OF_3 }] },
      ],
    }))).toBe('none')
  })

  it('no es canónico si blocks y drills divergen en orden', () => {
    expect(resolveSquashMatchRole(details({
      drills: [{ name: TECHNICAL }, { name: BEST_OF_3 }],
      blocks: [
        { kind: 'match', drills: [{ name: BEST_OF_3 }] },
        { kind: 'technical', drills: [{ name: TECHNICAL }] },
      ],
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

describe('hasSquashCompetitiveExposureContent', () => {
  it('es true para standalone y finisher, false para el resto', () => {
    expect(hasSquashCompetitiveExposureContent(details({ drills: [{ name: FIVE_GAMES }] }))).toBe(true)
    expect(hasSquashCompetitiveExposureContent(finisherDetails(BEST_OF_3))).toBe(true)
    expect(hasSquashCompetitiveExposureContent(details({ drills: [{ name: TECHNICAL }] }))).toBe(false)
    expect(hasSquashCompetitiveExposureContent(details({ drills: [{ name: ACTIVATION }] }))).toBe(false)
    expect(hasSquashCompetitiveExposureContent(undefined)).toBe(false)
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

export type SquashFinisherMatchId = typeof SQUASH_FINISHER_MATCH_IDS[number]

const COMPETITIVE_MATCH_IDS: ReadonlySet<string> = new Set([
  SQUASH_STANDALONE_MATCH_ID,
  ...SQUASH_FINISHER_MATCH_IDS,
])

export function resolveSquashDrillIdentity(drill: Pick<SquashDrill, 'name'>): string {
  return findSquashDrillByName(drill.name)?.id ?? drill.name.trim().toLowerCase()
}

export function isCompetitiveMatchDrill(drill: Pick<SquashDrill, 'name'>): boolean {
  return COMPETITIVE_MATCH_IDS.has(findSquashDrillByName(drill.name)?.id ?? '')
}

export function isFinisherMatchDrill(drill: Pick<SquashDrill, 'name'>): boolean {
  const id = findSquashDrillByName(drill.name)?.id
  return id != null && (SQUASH_FINISHER_MATCH_IDS as readonly string[]).includes(id)
}

/** Invariante duro: `drills[]` es exactamente el flatten de `blocks` por ID y orden. */
export function blocksMatchDrills(details: SquashDetails): boolean {
  const flattened = (details.blocks ?? []).flatMap((block) => block.drills ?? [])
  const drills = details.drills ?? []
  if (flattened.length !== drills.length) return false
  return flattened.every((drill, index) =>
    resolveSquashDrillIdentity(drill) === resolveSquashDrillIdentity(drills[index]!))
}

export function resolveSquashMatchRole(details: SquashDetails | undefined): SquashMatchRole {
  if (!details) return 'none'

  const drills = details.drills ?? []
  const blocks = details.blocks ?? []
  if (blocks.length > 0 && !blocksMatchDrills(details)) return 'none'

  const competitive = drills.filter(isCompetitiveMatchDrill)
  if (competitive.length === 0) return 'none'

  if (
    drills.length === 1
    && findSquashDrillByName(drills[0]!.name)?.id === SQUASH_STANDALONE_MATCH_ID
  ) {
    return 'standalone'
  }

  // Sin bloques no hay forma de demostrar que el partido es el último ni que
  // existe un bloque previo no-match.
  if (blocks.length < 2) return 'none'
  if (competitive.length !== 1) return 'none'

  const lastBlock = blocks[blocks.length - 1]!
  if (lastBlock.kind !== 'match') return 'none'
  if ((lastBlock.drills ?? []).length !== 1) return 'none'
  if (!isFinisherMatchDrill(lastBlock.drills[0]!)) return 'none'
  if (!blocks.slice(0, -1).some((block) => block.kind !== 'match')) return 'none'

  return 'finisher'
}

/**
 * Único predicado de exposición competitiva del proyecto, definido sobre
 * contenido. `utils/squash.ts` y `repairWeek.ts` lo envuelven; no lo
 * reimplementan.
 */
export function hasSquashCompetitiveExposureContent(
  details: SquashDetails | undefined,
): boolean {
  return resolveSquashMatchRole(details) !== 'none'
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/squashMatchRole.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Avisar al owner** — `feat: add squash match role module`

---

## Task 2: Eliminar `practice_match_short_points_attack`

**Files:**
- Modify: `src/services/training/drillLibrary.ts` (definición ~573, alias ~703)
- Create: `src/services/planBuilder/__tests__/helpers/squashRoleFixtures.ts`
- Test: `src/services/planBuilder/__tests__/squashMatchRoles.test.ts`

**Interfaces:**
- Produces (fixtures, consumidos por Tasks 3-10):
  - `const SQUASH_NAMES: { FIVE_GAMES; BEST_OF_3; GAME_TO_11; ACTIVATION; TECHNICAL; CONTROL }`
  - `function drillSessionFixture(date: string, names: string[], durationMin?: number): CoachSessionProposal`
  - `function standaloneSessionFixture(date: string, durationMin?: number): CoachSessionProposal`
  - `function finisherSessionFixture(date: string, finisherName: string, leadNames?: string[], durationMin?: number): CoachSessionProposal`

- [ ] **Step 1: Confirmar el alcance real**

Run: `grep -rn "practice_match_short_points_attack\|Partido con ataque temprano" src scripts docs`
Expected: 2 líneas en `drillLibrary.ts`, más las apariciones en `docs/superpowers/specs/` y `plans/` (registro histórico, se conservan).

- [ ] **Step 2: Crear los fixtures compartidos con valores de contrato reales**

Crear `src/services/planBuilder/__tests__/helpers/squashRoleFixtures.ts`:

```ts
import type { CoachSessionProposal, SquashDrill } from '../../../../types'
import { buildSkeletonSessionForTest } from './repairTestFixtures'

export const SQUASH_NAMES = {
  FIVE_GAMES: 'Partido de entrenamiento al mejor de 5 juegos',
  BEST_OF_3: 'Partido de entrenamiento al mejor de 3 juegos',
  GAME_TO_11: 'Game a 11 con marcador real',
  ACTIVATION: 'Activación pre-partido de manos y pies',
  TECHNICAL: 'Tiros paralelos profundos',
  CONTROL: 'Tiros cruzados profundos',
} as const

/** Cuatro drills: ya densa para 60-75 min, así los tests no dependen del paso 6. */
export function drillSessionFixture(
  date: string,
  names: string[] = [SQUASH_NAMES.TECHNICAL, SQUASH_NAMES.CONTROL],
  durationMin = 60,
): CoachSessionProposal {
  const drills: SquashDrill[] = names.map((name) => ({
    name,
    durationMin: Math.round(durationMin / names.length),
  }))
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    subtype: 'training',
    title: 'Squash técnico',
    objective: 'Construir largo y control con ejecución limpia.',
    durationMin,
    rpe: 6,
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'technical',
      drills,
    },
  })
}

export function standaloneSessionFixture(date: string, durationMin = 60): CoachSessionProposal {
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    subtype: 'match',
    title: 'Partido de entrenamiento',
    objective: 'Competir puntos con estructura de partido.',
    durationMin,
    rpe: 8,
    squashDetails: {
      trainingFocus: 'tactical',
      sessionMode: 'practice_match',
      sessionKind: 'match',
      drills: [{ name: SQUASH_NAMES.FIVE_GAMES, durationMin }],
      blocks: [{ kind: 'match', drills: [{ name: SQUASH_NAMES.FIVE_GAMES, durationMin }] }],
    },
  })
}

/**
 * Sesión ya densa (3 lead + 1 finisher) para que el test no dependa de la
 * densificación del paso 6. `drills[]` es exactamente el flatten de `blocks`.
 */
export function finisherSessionFixture(
  date: string,
  finisherName: string = SQUASH_NAMES.BEST_OF_3,
  leadNames: string[] = [SQUASH_NAMES.TECHNICAL, SQUASH_NAMES.CONTROL, '100 drops en solitario (50 por lado)'],
  durationMin = 75,
): CoachSessionProposal {
  const lead: SquashDrill[] = leadNames.map((name) => ({ name, durationMin: 15 }))
  const finisher: SquashDrill = { name: finisherName, durationMin: 30 }
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    subtype: 'training',
    title: 'Squash con cierre competitivo',
    objective: 'Trabajo de largo y cierre con marcador.',
    durationMin,
    rpe: 7,
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'mixed',
      drills: [...lead, finisher],
      blocks: [
        { kind: 'technical', drills: lead },
        { kind: 'match', drills: [finisher] },
      ],
    },
  })
}
```

> Si `resolveSquashDrillKind` clasifica alguno de los `leadNames` fuera de
> `technical`, el bloque `technical` del fixture no coincidirá con lo que
> `buildSquashBlocksFromDrills` produciría. Verificarlo en el Step 4 y ajustar
> `leadNames` a drills que sí compartan kind.

- [ ] **Step 3: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/squashMatchRoles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { findSquashDrillByName } from '../../training/drillLibrary'
import { repairGeneratedWeek } from '../repairWeek'
import { buildRepairContextForTest } from './helpers/repairTestFixtures'
import { drillSessionFixture, SQUASH_NAMES } from './helpers/squashRoleFixtures'

const ATTACK = 'Partido con ataque temprano'

describe('drill eliminado: ataque temprano', () => {
  it('ya no existe en el catálogo', () => {
    expect(findSquashDrillByName(ATTACK)?.id).not.toBe('practice_match_short_points_attack')
  })

  it('un plan legado que lo referencia solo termina resuelto y sin failure', () => {
    const result = repairGeneratedWeek(
      [drillSessionFixture('2026-08-03', [ATTACK])],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }),
    )
    expect(result.failure).toBeUndefined()
    const drills = result.sessions[0]?.squashDetails?.drills ?? []
    expect(drills.length).toBeGreaterThan(0)
    for (const drill of drills) expect(findSquashDrillByName(drill.name)).toBeDefined()
  })

  it('dentro de una sesión mixta conserva el resto', () => {
    const result = repairGeneratedWeek(
      [drillSessionFixture('2026-08-03', [SQUASH_NAMES.TECHNICAL, ATTACK])],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }),
    )
    expect(result.failure).toBeUndefined()
    const names = (result.sessions[0]?.squashDetails?.drills ?? []).map((d) => d.name)
    expect(names).toContain(SQUASH_NAMES.TECHNICAL)
    for (const name of names) expect(findSquashDrillByName(name)).toBeDefined()
  })
})
```

- [ ] **Step 4: Correr y verificar que el primer caso falla**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts`
Expected: FAIL en "ya no existe en el catálogo".

- [ ] **Step 5: Eliminar definición y alias**

En `src/services/training/drillLibrary.ts`, borrar el objeto completo cuyo `id` es `'practice_match_short_points_attack'` y la línea:

```ts
  partido_con_foco_de_ataque_en_puntos_cortos: 'practice_match_short_points_attack',
```

- [ ] **Step 6: Correr y verificar que pasa**

Run: `npx vitest run src/services/planBuilder src/services/training`
Expected: PASS. Actualizar cualquier test que fijara ese drill.

- [ ] **Step 7: Avisar al owner** — `feat: remove early-attack conditioned match drill`

---

## Task 3: Densificación role-aware

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:614-635` (`densifySparseSquashDetails`), `:661-678` (`completeSquashDrillSet`)
- Test: `src/services/planBuilder/__tests__/squashMatchRoles.test.ts`

**Interfaces:**
- Consumes: `resolveSquashMatchRole`, `isCompetitiveMatchDrill` de Task 1.
- Produces: ningún símbolo público nuevo.

**Por qué:** `completeSquashDrillSet` hace `next.push(candidate)`, así que los
drills nuevos quedan **después** del finisher. `buildSquashBlocksFromDrills`
reagrupa por kind y `orderSquashBlocksForSession` manda el bloque `match` al
final, de modo que el flatten queda `[lead…, nuevos…, finisher]` mientras
`drills[]` quedó `[lead…, finisher, nuevos…]`. Divergen, y el rol colapsa a
`none` **antes** de que la normalización del paso 13 llegue a verlo.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { finisherSessionFixture } from './helpers/squashRoleFixtures'
import { resolveSquashMatchRole } from '../../training/squashMatchRole'

describe('densificación role-aware', () => {
  it('un finisher escaso se densifica sin perder el rol', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 })
    // Solo 2 drills a 75 min: el mínimo es 4, así que el paso 6 densifica.
    const sparse = finisherSessionFixture('2026-08-03', SQUASH_NAMES.BEST_OF_3, [SQUASH_NAMES.TECHNICAL], 75)

    const result = repairGeneratedWeek([sparse], context)
    const details = result.sessions[0]?.squashDetails

    expect(resolveSquashMatchRole(details)).toBe('finisher')
    // El finisher sigue siendo el último drill y el único competitivo.
    expect(details?.drills[details.drills.length - 1]?.name).toBe(SQUASH_NAMES.BEST_OF_3)
    expect(details?.drills.filter((d) => d.name === SQUASH_NAMES.BEST_OF_3)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "densificación"`
Expected: FAIL — el rol resuelve `none` porque `drills[]` y `blocks` divergen.

- [ ] **Step 3: Implementar densificación role-aware**

Reemplazar `densifySparseSquashDetails` (línea 614):

```ts
function densifySparseSquashDetails(
  session: CoachSessionProposal,
  context: RepairContext,
  recentDrills: string[],
): boolean {
  const details = session.squashDetails
  if (!details?.drills) return false

  const targetCount = getMinimumSquashDrillCount(session)
  if (details.drills.length >= targetCount) return false

  const role = resolveSquashMatchRole(details)
  const selection = selectContextualSquashCompletion(session, context, [
    ...recentDrills,
    ...details.drills.map((drill) => drill.name),
  ])

  // Nunca agregar contenido competitivo al densificar: convertiría un finisher
  // en no canónico (condición 4 del rol) o crearía un partido que nadie pidió.
  const candidates = selection.drills.filter((drill) => !isCompetitiveMatchDrill(drill))

  if (role === 'finisher') {
    const finisher = details.drills[details.drills.length - 1]!
    const lead = details.drills.slice(0, -1)
    const nextLead = completeSquashDrillSet(lead, candidates, targetCount - 1)
    if (nextLead.length === lead.length) return false
    // El finisher siempre queda último para conservar el rol.
    const nextDrills = [...nextLead, finisher]
    details.drills = nextDrills
    details.blocks = buildSquashBlocksFromDrills(nextDrills)
    // `buildSquashBlocksFromDrills` reagrupa por kind: realinear `drills[]` con
    // el flatten resultante es lo que mantiene vivo el invariante del rol.
    details.drills = details.blocks.flatMap((block) => block.drills)
    return true
  }

  const nextDrills = completeSquashDrillSet(details.drills, candidates, targetCount)
  if (nextDrills.length === details.drills.length) return false
  details.blocks = buildSquashBlocksFromDrills(nextDrills)
  details.drills = details.blocks.flatMap((block) => block.drills)
  return true
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "densificación"`
Expected: PASS.

- [ ] **Step 5: Correr la suite del plan builder**

Run: `npx vitest run src/services/planBuilder src/services/weekCreator`
Expected: PASS. Si un test fijaba el orden previo de `drills[]` tras densificar, actualizarlo: el orden ahora sigue a `blocks`.

- [ ] **Step 6: Avisar al owner** — `fix: role-aware squash densification keeps blocks and drills aligned`

---

## Task 4: Semántica role-aware y limpieza de `none`

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:805-870` (`normalizeSquashSemanticMetadata`), `:1126` (`hasCanonicalFiveGameMatch`)
- Test: `src/services/planBuilder/__tests__/squashMatchRoles.test.ts`

**Interfaces:**
- Consumes: Task 1 completo.
- Produces: `function isCanonicalMatchContent(session: CoachSessionProposal): boolean` (privada).

**Por qué el rol interviene al calcular, no después:** la línea 852 hace
`details.sessionKind = inferredKind` con un `inferredKind` calculado en la línea
~810. Parchear el kind después de esa asignación se deshace solo en la siguiente
pasada, porque `SQUASH_MATCH_TEXT_PATTERN` puede dar `match` por palabras del
título como "partido" o "marcador".

- [ ] **Step 1: Escribir los tests que fallan (spec §9 tests 1, 8 y §2.1)**

```ts
describe('semántica role-aware', () => {
  it('un finisher conserva ID, bloques y metadata a través de dos pasadas', () => {
    for (const name of [SQUASH_NAMES.BEST_OF_3, SQUASH_NAMES.GAME_TO_11]) {
      const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 })
      const first = repairGeneratedWeek([finisherSessionFixture('2026-08-03', name)], context)
      const second = repairGeneratedWeek(first.sessions, context)
      const details = second.sessions[0]?.squashDetails

      expect(resolveSquashMatchRole(details)).toBe('finisher')
      expect(details?.drills[details.drills.length - 1]?.name).toBe(name)
      expect(details?.sessionMode).toBe('drill_session')
      expect(details?.sessionKind).toBe('mixed')
    }
  })

  it('una activación aislada no se proyecta a standalone', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', phase: 'taper', sessionsPerWeek: 1 })
    const result = repairGeneratedWeek(
      [drillSessionFixture('2026-08-03', [SQUASH_NAMES.ACTIVATION], 40)],
      context,
    )
    const names = (result.sessions[0]?.squashDetails?.drills ?? []).map((d) => d.name)
    expect(names).not.toContain(SQUASH_NAMES.FIVE_GAMES)
  })

  it('una sesión mixta no canónica pierde el contenido competitivo y conserva el resto', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 })
    // Dos drills competitivos: no es finisher canónico (condición 4).
    const session = drillSessionFixture('2026-08-03', [
      SQUASH_NAMES.TECHNICAL,
      SQUASH_NAMES.FIVE_GAMES,
      SQUASH_NAMES.BEST_OF_3,
    ])
    const result = repairGeneratedWeek([session], context)
    const names = (result.sessions[0]?.squashDetails?.drills ?? []).map((d) => d.name)

    expect(result.failure).toBeUndefined()
    expect(names).toContain(SQUASH_NAMES.TECHNICAL)
    expect(names).not.toContain(SQUASH_NAMES.FIVE_GAMES)
    expect(names).not.toContain(SQUASH_NAMES.BEST_OF_3)
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "semántica"`
Expected: FAIL — el finisher fue reescrito a `[FIVE_GAMES]`; la sesión mixta conserva contenido competitivo.

- [ ] **Step 3: Agregar el import y reemplazar `hasCanonicalFiveGameMatch`**

En `src/services/planBuilder/repairWeek.ts`:

```ts
import {
  hasSquashCompetitiveExposureContent,
  isCompetitiveMatchDrill,
  isFinisherMatchDrill,
  resolveSquashMatchRole,
  SQUASH_FINISHER_MATCH_IDS,
} from '../training/squashMatchRole'
```

Reemplazar la función de la línea 1126:

```ts
/**
 * Chequeo de idempotencia de la normalización semántica, generalizado al rol.
 * Sin esto una sesión con finisher se reescribiría a standalone y, como el
 * repair corre DOS veces en el contrato skeleton, las pasadas se pelearían.
 */
function isCanonicalMatchContent(session: CoachSessionProposal): boolean {
  return resolveSquashMatchRole(session.squashDetails) !== 'none'
}
```

- [ ] **Step 4: Hacer que el rol gobierne la semántica**

Dentro de `normalizeSquashSemanticMetadata`, **antes** de calcular `contentSaysMatch` (línea ~808), insertar:

```ts
    const role = resolveSquashMatchRole(details)
```

Reemplazar el cálculo de `inferredKind` y `dedicatedMatchContent` (líneas ~808-816):

```ts
    const hasCompetitiveContent = (details.drills ?? []).some(isCompetitiveMatchDrill)
    const contentSaysMatch = role === 'standalone'
      || (role !== 'finisher'
        && hasCompetitiveContent
        && isSquashMatchIntent(session)
        && !(context?.wizardConfig.partnerAvailability === 'solo' && !hasMatchBlock))

    const inferredKind = role === 'finisher'
      ? 'mixed'
      : contentSaysMatch
        ? 'match'
        : hasBlocks
          ? blockKinds.length > 1 ? 'mixed' : blockKinds[0]
          : inferSquashKindFromProposalDetails(session)

    // Un finisher NUNCA es contenido dedicado de partido, y una sesión mixta no
    // canónica tampoco puede volverse dedicada solo por su título u objetivo.
    const dedicatedMatchContent = role === 'finisher'
      ? false
      : role === 'standalone'
        ? true
        : hasCompetitiveContent
          && (contentSaysMatch || (hasBlocks ? blockKinds.length === 1 && hasMatchBlock : inferredKind === 'match'))
```

Reemplazar la guarda de reescritura (línea ~837):

```ts
    if (
      dedicatedMatchContent &&
      (details.sessionMode === 'practice_match' || details.sessionMode === 'competition_match') &&
      !isCanonicalMatchContent(session)
    ) {
```

Y ajustar el alineado de modo (línea ~862) para que un finisher quede en `drill_session`:

```ts
    if (details.sessionMode !== 'drill_session' && !dedicatedMatchContent) {
      details.sessionMode = 'drill_session'
      recordRepair(meta, 'corrective', sessionKeyOf(session))
      meta.warnings.push({
        code: 'squash_mode_aligned',
        message: 'Se cambió match-play por sesión de drills porque los bloques no son un partido dedicado.',
        sessionDate: session.date,
      })
    }
```

Como `inferredKind` ya vale `'mixed'` para un finisher, la asignación existente de
la línea 852 (`details.sessionKind = inferredKind`) deja el kind correcto sin
parche posterior.

- [ ] **Step 5: Limpiar el contenido competitivo de una sesión mixta `none`**

Inmediatamente después del bloque de reescritura de la línea ~837, agregar:

```ts
    // Spec §2.1: una sesión mixta con contenido competitivo NO canónico conserva
    // su parte no-match y pierde el competitivo. Dejarlo produciría sobrecarga:
    // no cuenta como exposición, así que `ensureSquashCompetitionMatchExposure`
    // agregaría además otro partido.
    if (role === 'none' && !dedicatedMatchContent && hasCompetitiveContent) {
      const kept = (details.drills ?? []).filter((drill) => !isCompetitiveMatchDrill(drill))
      if (kept.length > 0) {
        details.drills = kept
        details.blocks = buildSquashBlocksFromDrills(kept)
        details.drills = details.blocks.flatMap((block) => block.drills)
        recordRepair(meta, 'corrective', sessionKeyOf(session))
        meta.warnings.push({
          code: 'squash_non_canonical_match_removed',
          message: `Se retiró contenido de partido no canónico de "${session.title}"; la sesión queda como trabajo de drills.`,
          sessionDate: session.date,
        })
      }
    }
```

La densificación del paso 6 ya corrió, así que la sesión puede quedar por debajo
del mínimo de drills. Es aceptable: `low_drill_depth` lo reporta como warning y
la alternativa —redensificar acá— duplicaría la lógica del paso 6.

- [ ] **Step 6: Correr y verificar que pasan**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts`
Expected: PASS.

- [ ] **Step 7: Correr la suite completa de plan builder y week creator**

Run: `npx vitest run src/services/planBuilder src/services/weekCreator`
Expected: PASS. Los tests que fijaban "todo partido se colapsa a best-of-5" fijan comportamiento obsoleto: actualizarlos al contrato de rol.

- [ ] **Step 8: Avisar al owner** — `feat: role-aware squash semantic normalization`

---

## Task 5: Mínimo de drills por contenido standalone

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:637-642`
- Test: `src/services/planBuilder/__tests__/squashMatchRoles.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
describe('mínimo de drills', () => {
  it('un standalone de 60 min no se densifica', () => {
    const result = repairGeneratedWeek(
      [standaloneSessionFixture('2026-08-03', 60)],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }),
    )
    expect(result.sessions[0]?.squashDetails?.drills).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "no se densifica"`
Expected: FAIL — recibe 4 drills.

- [ ] **Step 3: Implementar**

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

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts`
Expected: PASS.

- [ ] **Step 5: Avisar al owner** — `fix: stop densifying standalone squash matches`

---

## Task 6: Exposición competitiva y taper tardío

**Files:**
- Modify: `src/utils/squash.ts` (envoltorio + `finisherCount`), `src/services/ai/promptModules/squashPrompt.ts:273`
- Modify: `src/services/planBuilder/repairWeek.ts:896-951`, `:996-1021`, `:1727`
- Test: `src/utils/__tests__/squashExposure.test.ts` (nuevo), `squashMatchRoles.test.ts`

**Interfaces:**
- Consumes: `hasSquashCompetitiveExposureContent`, `resolveSquashMatchRole` de Task 1.
- Produces: `function hasSquashCompetitiveExposure(session: Pick<Session, 'type' | 'squashDetails'>): boolean` en `utils/squash.ts`.

- [ ] **Step 1: Escribir el test de utils que falla**

Crear `src/utils/__tests__/squashExposure.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Session } from '../../types'
import { getRecentSquashCompetitiveExposure, hasSquashCompetitiveExposure } from '../squash'

const FIVE_GAMES = 'Partido de entrenamiento al mejor de 5 juegos'
const BEST_OF_3 = 'Partido de entrenamiento al mejor de 3 juegos'
const TECHNICAL = 'Tiros paralelos profundos'

function session(over: Partial<Session>): Session {
  return {
    id: 'x', date: '2026-08-03', timeBlock: 'AM', type: 'squash',
    title: 'Squash', durationMin: 60, status: 'completed', ...over,
  } as Session
}

const standalone = session({
  subtype: 'match',
  squashDetails: {
    trainingFocus: 'tactical', sessionMode: 'practice_match', sessionKind: 'match',
    drills: [{ name: FIVE_GAMES }],
  },
})

const finisher = session({
  date: '2026-08-04', subtype: 'training',
  squashDetails: {
    trainingFocus: 'technical', sessionMode: 'drill_session', sessionKind: 'mixed',
    drills: [{ name: TECHNICAL }, { name: BEST_OF_3 }],
    blocks: [
      { kind: 'technical', drills: [{ name: TECHNICAL }] },
      { kind: 'match', drills: [{ name: BEST_OF_3 }] },
    ],
  },
})

describe('hasSquashCompetitiveExposure', () => {
  it('cuenta standalone y finisher, no una sesión de drills', () => {
    expect(hasSquashCompetitiveExposure(standalone)).toBe(true)
    expect(hasSquashCompetitiveExposure(finisher)).toBe(true)
    expect(hasSquashCompetitiveExposure(session({
      subtype: 'training',
      squashDetails: {
        trainingFocus: 'technical', sessionMode: 'drill_session', sessionKind: 'technical',
        drills: [{ name: TECHNICAL }],
      },
    }))).toBe(false)
  })
})

describe('getRecentSquashCompetitiveExposure', () => {
  it('suma finishers en finisherCount, totalMatchCount y exposureScore', () => {
    const summary = getRecentSquashCompetitiveExposure([standalone, finisher], 6)
    expect(summary.finisherCount).toBe(1)
    expect(summary.totalMatchCount).toBe(
      summary.practiceMatchCount + summary.competitionMatchCount + summary.finisherCount,
    )
    expect(summary.exposureScore).toBe(summary.totalMatchCount)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/utils/__tests__/squashExposure.test.ts`
Expected: FAIL — `hasSquashCompetitiveExposure is not a function`.

- [ ] **Step 3: Implementar en `src/utils/squash.ts`**

Agregar import:

```ts
import { hasSquashCompetitiveExposureContent, resolveSquashMatchRole } from '../services/training/squashMatchRole'
```

Ampliar la interfaz (línea 9) agregando `finisherCount: number` después de `competitionMatchCount`.

Agregar el envoltorio después de `isCompetitionSquashMatch`:

```ts
/**
 * Envoltorio del único predicado de exposición, que vive en `squashMatchRole`.
 * Deliberadamente separado de `isCompetitionSquashMatch`, cuyos 31 call sites lo
 * interpretan como "la sesión entera es un partido real" y alimentan nutrición,
 * protocolos y carga.
 */
export function hasSquashCompetitiveExposure(
  session: Pick<Session, 'type' | 'squashDetails'>,
): boolean {
  return session.type === 'squash' && hasSquashCompetitiveExposureContent(session.squashDetails)
}
```

Reemplazar el cuerpo de `getRecentSquashCompetitiveExposure` desde `let practiceMatchCount` hasta el `return` final:

```ts
  let practiceMatchCount = 0
  let competitionMatchCount = 0
  let finisherCount = 0

  const recentSessions = [...sessions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
    .slice(0, limit)

  for (const session of recentSessions) {
    if (isPracticeSquashMatch(session)) { practiceMatchCount += 1; continue }
    if (isCompetitionSquashMatch(session)) { competitionMatchCount += 1; continue }
    if (resolveSquashMatchRole(session.squashDetails) === 'finisher') finisherCount += 1
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

- [ ] **Step 4: Actualizar la línea factual del prompt**

`src/services/ai/promptModules/squashPrompt.ts`, línea 273:

```ts
  lines.push(`Exposicion reciente: ${recentExposure.practiceMatchCount} practice match / ${recentExposure.competitionMatchCount} competencia real / ${recentExposure.finisherCount} cierre competitivo en sesion de drills.`)
```

- [ ] **Step 5: Escribir los tests de repair (spec §9 tests 2 y 3)**

```ts
describe('exposición competitiva en el repair', () => {
  it('no agrega ni convierte otra sesión si ya hay un finisher en fecha segura', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', phase: 'peak', sessionsPerWeek: 3 })
    const result = repairGeneratedWeek([
      finisherSessionFixture('2026-08-03'),
      drillSessionFixture('2026-08-05'),
      drillSessionFixture('2026-08-07'),
    ], context)

    const modes = result.sessions
      .filter((s) => s.sessionType === 'squash')
      .map((s) => s.squashDetails?.sessionMode)
    expect(modes).not.toContain('competition_match')
    expect(result.meta.warnings.map((w) => w.code)).not.toContain('squash_competition_match_added')
  })

  it('retira solo el bloque final de un finisher a menos de 48 h del evento', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', phase: 'taper', sessionsPerWeek: 2 })
    const eventDate = context.plan.macroSnapshot.goalEventDate
    const dayBefore = new Date(new Date(`${eventDate}T00:00:00Z`).getTime() - 86_400_000)
      .toISOString().slice(0, 10)
    context.week = { ...context.week, weekStartDate: dayBefore }

    const result = repairGeneratedWeek([finisherSessionFixture(dayBefore)], context)
    const names = (result.sessions[0]?.squashDetails?.drills ?? []).map((d) => d.name)
    expect(names).toContain(SQUASH_NAMES.TECHNICAL)
    expect(names).not.toContain(SQUASH_NAMES.BEST_OF_3)
  })
})
```

- [ ] **Step 6: Implementar el envoltorio local y sus tres consumidores**

En `repairWeek.ts`, junto a las helpers de squash:

```ts
/** Envoltorio del predicado único (Task 1) para proposals del repair. */
function hasCompetitiveExposureContent(session: CoachSessionProposal): boolean {
  return session.sessionType === 'squash'
    && hasSquashCompetitiveExposureContent(session.squashDetails)
}
```

`ensureSquashCompetitionMatchExposure`, línea 904:

```ts
  if (squashSessions.some((session) =>
    hasCompetitiveExposureContent(session) && isSafeSquashCompetitionExposureDate(session.date, context)
  )) return sessions
```

`preservesCompetitiveExposure`, línea ~1731:

```ts
  return sessions.some((session) => {
    const evaluated = session === original ? candidate : session
    return hasCompetitiveExposureContent(evaluated)
      && isSafeSquashCompetitionExposureDate(evaluated.date, context)
  })
```

`normalizeLateTaperSquashMatchPlay`, reemplazar el cuerpo del bucle (líneas ~1005-1020):

```ts
  for (const session of sessions) {
    if (session.sessionType !== 'squash') continue
    if (session.date === eventDate) continue
    if (daysBetween(session.date, eventDate) > 2) continue

    const role = resolveSquashMatchRole(session.squashDetails)

    if (role === 'finisher') {
      // Se retira SOLO el bloque final: destruir la sesión entera perdería una
      // sesión mixta válida.
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

- [ ] **Step 7: Correr las suites**

Run: `npx vitest run src/utils src/services/ai src/services/planBuilder`
Expected: PASS. Si un test fijaba el texto exacto de la línea de exposición, actualizarlo.

- [ ] **Step 8: Avisar al owner** — `feat: single competitive exposure predicate across repair and prompt`

---

## Task 7: Standalone fuera de la unicidad de firmas

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts` (`normalizeSquashSessionContent`), `src/services/weekCreator/validateWeekCreatorResponse.ts:253`
- Test: `squashMatchRoles.test.ts`

- [ ] **Step 1: Escribir el test que falla (spec §9 test 5)**

El test cubre **las dos** exenciones prometidas, no solo la del repair:

```ts
import { validateWeekCreatorResponse } from '../../weekCreator/validateWeekCreatorResponse'

describe('dos standalone conviven', () => {
  it('el repair no falla', () => {
    const result = repairGeneratedWeek(
      [standaloneSessionFixture('2026-08-03'), standaloneSessionFixture('2026-08-05')],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 2 }),
    )
    expect(result.failure).toBeUndefined()
    const squash = result.sessions.filter((s) => s.sessionType === 'squash')
    expect(squash).toHaveLength(2)
    for (const session of squash) {
      expect(session.squashDetails?.drills.map((d) => d.name)).toEqual([SQUASH_NAMES.FIVE_GAMES])
    }
  })

  it('el validador del Week Creator no los marca como duplicados', () => {
    const sessions = [standaloneSessionFixture('2026-08-03'), standaloneSessionFixture('2026-08-05')]
    const outcome = validateWeekCreatorResponse({
      action: { type: 'create_week', reason: 'semana', targetDate: '2026-08-03', sessions },
      config: {
        trainingDays: ['monday', 'tuesday', 'wednesday'],
        doubleSessionDays: [],
        sessionsPerWeek: 2,
        maxSessionsPerWeek: 2,
        sessionDurationMins: 60,
        allowDoubleSession: false,
        allowedSports: ['squash'],
        primarySport: 'squash',
        currentFitnessLevel: 'fit',
        currentFatigue: 'normal',
        fromWizard: true,
        configSource: 'wizard',
      },
      targetWeekStart: '2026-08-03',
    } as never)

    expect(outcome.code).not.toBe('duplicate_squash_content')
  })
})
```

> La firma exacta de `validateWeekCreatorResponse` está en
> `src/services/weekCreator/validateWeekCreatorResponse.ts`. Ajustar el objeto de
> entrada a esa firma; lo que el test debe afirmar es que **no** falla con
> `duplicate_squash_content`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "dos standalone"`
Expected: FAIL — `signature_uniqueness_unresolved` y `duplicate_squash_content`.

- [ ] **Step 3: Excluir standalone en `normalizeSquashSessionContent`**

Reemplazar la línea que arma `squashSessions`:

```ts
  const allSquashSessions = sessions.filter((session) => session.sessionType === 'squash')
  // Dos partidos comparten formato, y eso no es repetir una prescripción de
  // drills. Con un solo standalone canónico, incluirlos haría irresoluble
  // cualquier semana con dos partidos. Spec §5.1.
  const squashSessions = allSquashSessions.filter(
    (session) => resolveSquashMatchRole(session.squashDetails) !== 'standalone',
  )
  if (squashSessions.length === 0) return {}
```

- [ ] **Step 4: Excluir standalone en el validador**

En `validateWeekCreatorResponse.ts`, agregar el import:

```ts
import { resolveSquashMatchRole } from '../training/squashMatchRole'
```

Y en `validateDuplicateSquashSessions`, después de `if (session.sessionType !== 'squash') continue`:

```ts
    // Dos partidos al mejor de 5 no son una prescripción de drills repetida.
    if (resolveSquashMatchRole(session.squashDetails) === 'standalone') continue
```

- [ ] **Step 5: Correr y verificar que pasan**

Run: `npx vitest run src/services/planBuilder src/services/weekCreator`
Expected: PASS.

- [ ] **Step 6: Avisar al owner** — `feat: exclude standalone matches from squash signature uniqueness`

---

## Task 8: Rotación y corrección role-aware

**Files:**
- Modify: `src/services/training/drillSelector.ts` (`SquashDrillReplacementRequest`, `selectSquashDrillReplacement`)
- Modify: `src/services/planBuilder/repairWeek.ts` (loop de política, `findUniqueSquashSessionCandidate`)
- Test: `squashMatchRoles.test.ts`

**Interfaces:**
- Consumes: `SQUASH_FINISHER_MATCH_IDS`, `resolveSquashMatchRole`, `isFinisherMatchDrill` de Task 1.
- Produces: `SquashDrillReplacementRequest` gana `allowedIds?: ReadonlySet<string>`.

**Por qué por el selector y no a mano:** elegir el finisher manualmente saltearía
`filterByFatigue`, `filterByPhase` y `filterByExecutionMode`. El contrato del spec
§5 dice que sin candidato elegible **por fase, fatiga o partner** se conserva el
original y se suma omisión — eso solo se cumple si los hard constraints siguen
aplicándose.

- [ ] **Step 1: Escribir los tests que fallan (spec §9 test 4)**

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
    const result = repairGeneratedWeek([finisherSessionFixture('2026-08-10')], blockContext(1))
    expect(resolveSquashMatchRole(result.sessions[0]?.squashDetails)).toBe('finisher')
  })

  it('con política activa, un standalone no rota', () => {
    const result = repairGeneratedWeek([standaloneSessionFixture('2026-08-10')], blockContext(1))
    expect(result.sessions[0]?.squashDetails?.drills.map((d) => d.name)).toEqual([SQUASH_NAMES.FIVE_GAMES])
  })

  it('dos finishers duplicados se diferencian conservando el rol', () => {
    const context = blockContext(0)
    const result = repairGeneratedWeek([
      finisherSessionFixture('2026-08-10', SQUASH_NAMES.BEST_OF_3),
      finisherSessionFixture('2026-08-12', SQUASH_NAMES.BEST_OF_3),
    ], context)

    expect(result.failure).toBeUndefined()
    for (const session of result.sessions.filter((s) => s.sessionType === 'squash')) {
      expect(resolveSquashMatchRole(session.squashDetails)).toBe('finisher')
    }
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "rotación respeta"`
Expected: FAIL — el finisher rotó a un drill técnico, o el candidato correctivo destruyó el rol.

- [ ] **Step 3: Agregar la allowlist al selector**

En `src/services/training/drillSelector.ts`, ampliar la interfaz:

```ts
export interface SquashDrillReplacementRequest {
  originalName: string
  context: SquashSelectionContext
  excludedKeys: ReadonlySet<string>
  rotationIndex: number
  relaxation: SquashRelaxationLevel
  /**
   * Restringe el pool a estos IDs SIN saltear los hard constraints. Un finisher
   * solo puede rotar entre finishers, pero sigue sujeto a fatiga, fase y partner.
   */
  allowedIds?: ReadonlySet<string>
}
```

Y en `selectSquashDrillReplacement`, agregar el filtro después de `.filter(matchesAxis)`:

```ts
  const candidates = allowed
    .filter(matchesAxis)
    .filter((candidate) => request.allowedIds == null || request.allowedIds.has(candidate.id))
    .filter((candidate) => !request.excludedKeys.has(normalizeSquashDrillKey(candidate.id)))
    .sort((a, b) => scoreByFocusOverlap(b, original) - scoreByFocusOverlap(a, original)
      || a.id.localeCompare(b.id))
```

- [ ] **Step 4: Usar la allowlist en el loop de política**

Dentro del loop de política de `normalizeSquashSessionContent`, antes del `for (const [drillOrdinal, drill] ...)`:

```ts
    const sessionRole = resolveSquashMatchRole(session.squashDetails)
```

Y reemplazar la construcción del `replacement`:

```ts
      const isFinisherSlot = sessionRole === 'finisher' && isFinisherMatchDrill(drill)
      const replacement = selectSquashDrillReplacement({
        originalName: drill.name,
        context: buildSquashRotationSelectionContext(session, context),
        excludedKeys: new Set([...assignedKeys, ...previousKeys]),
        rotationIndex: weekIndexInBlock * 131 + sessionOrdinal * 17 + drillOrdinal,
        relaxation: 'strict',
        // Un finisher solo rota entre finishers. Sin candidato elegible por
        // fase/fatiga/partner, el `if (!replacement)` de abajo conserva el
        // original y suma omisión, que es exactamente el contrato del spec §5.
        allowedIds: isFinisherSlot
          ? new Set<string>(SQUASH_FINISHER_MATCH_IDS)
          : undefined,
      })
```

El resto del cuerpo del loop (`if (!replacement) { omitted++; … }`) no cambia. Los
standalone ya no llegan acá: Task 7 los sacó de `squashSessions`.

- [ ] **Step 5: Exigir conservación de rol en la rama correctiva**

En `findUniqueSquashSessionCandidate`, dentro del bucle del odómetro, reemplazar la condición de aceptación:

```ts
      if (new Set(keys).size === keys.length) {
        const candidate = cloneSquashSessionWithReplacements(original, replacementDefinitions)
        const signature = buildSquashDrillSignature(candidate)
        const rolePreserved = resolveSquashMatchRole(candidate.squashDetails)
          === resolveSquashMatchRole(original.squashDetails)
        if (
          rolePreserved
          && signature
          && !seenSignatures.has(signature)
          && preservesCompetitiveExposure(sessions, original, candidate, context)
        ) {
          return candidate
        }
      }
```

`preservesCompetitiveExposure` mira la exposición **global** de la semana, así que
por sí solo permitiría destruir el rol de esta sesión mientras otra conserve
exposición. `rolePreserved` es el invariante por sesión que faltaba.

- [ ] **Step 6: Restringir también los candidatos por slot en la rama correctiva**

En `getSquashCandidatesForSlot`, agregar el parámetro y pasarlo:

```ts
function getSquashCandidatesForSlot(input: {
  drill: SquashDrill
  session: CoachSessionProposal
  context: RepairContext
  sessionOrdinal: number
  drillOrdinal: number
  excludedKeys: ReadonlySet<string>
  relaxation: SquashRelaxationLevel
}): NonNullable<ReturnType<typeof findSquashDrillByName>>[] {
  const values: NonNullable<ReturnType<typeof findSquashDrillByName>>[] = []
  const seen = new Set<string>()
  const rotationIndex = getWeekIndexInBlock(input.context) * 131 + input.sessionOrdinal * 17 + input.drillOrdinal
  const selectionContext = buildSquashRotationSelectionContext(input.session, input.context)
  const finisherSlot = resolveSquashMatchRole(input.session.squashDetails) === 'finisher'
    && isFinisherMatchDrill(input.drill)

  for (let offset = 0; offset < 128; offset++) {
    const candidate = selectSquashDrillReplacement({
      originalName: input.drill.name,
      context: selectionContext,
      excludedKeys: input.excludedKeys,
      rotationIndex: rotationIndex + offset,
      relaxation: input.relaxation,
      allowedIds: finisherSlot ? new Set<string>(SQUASH_FINISHER_MATCH_IDS) : undefined,
    })
    if (!candidate || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    values.push(candidate)
  }
  return values
}
```

- [ ] **Step 7: Correr y verificar que pasan**

Run: `npx vitest run src/services/planBuilder src/services/training`
Expected: PASS.

- [ ] **Step 8: Avisar al owner** — `feat: role-aware squash rotation and duplicate correction`

---

## Task 9: Contadores observacionales

**Files:**
- Modify: `repairWeek.ts` (`RepairMeta`, `repairGeneratedWeek`), `src/types/planBuilder.ts`, `generateWeek.ts`, `generateWeekCore.ts`, `generatePlan.ts`, `asyncGenerationLoop.ts`, `scripts/loadtest-plan-builder/artifact.mjs`
- Test: `squashMatchRoles.test.ts`

**Interfaces:**
- Produces en `RepairMeta` y `PlanGenerationMeta`: `squashFinisherProposedCount?: number`, `squashFinisherPreservedCount?: number`, `squashStandaloneMatchCount?: number`.

- [ ] **Step 1: Escribir el test que falla**

```ts
describe('contadores observacionales', () => {
  it('cuenta finishers propuestos, preservados y standalone finales', () => {
    const result = repairGeneratedWeek(
      [standaloneSessionFixture('2026-08-03'), finisherSessionFixture('2026-08-05')],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 2 }),
    )

    expect(result.meta.squashFinisherProposedCount).toBe(1)
    expect(result.meta.squashFinisherPreservedCount).toBe(1)
    expect(result.meta.squashStandaloneMatchCount).toBe(1)
    expect(result.meta.repairedSessionCount).toBe(0)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/squashMatchRoles.test.ts -t "contadores"`
Expected: FAIL — `expected undefined to be 1`.

- [ ] **Step 3: Agregar los campos a `RepairMeta`**

```ts
  /** Observacionales: NO entran en countRepairsV2 ni en la taxonomía. */
  squashFinisherProposedCount?: number
  squashFinisherPreservedCount?: number
  squashStandaloneMatchCount?: number
```

- [ ] **Step 4: Medir en la entrada y en la salida**

En `repairGeneratedWeek`, la medición de entrada va **como primera instrucción
después de crear `meta`**, antes de cualquier paso de reparación: el punto de
observación es la entrada del repair, después del `responseNormalizer`.

```ts
  meta.squashFinisherProposedCount = sessions.filter(
    (session) => session.sessionType === 'squash'
      && resolveSquashMatchRole(session.squashDetails) === 'finisher',
  ).length
```

E inmediatamente antes del `return` final:

```ts
  // Cuenta ROL, no ID: la política puede rotar best-of-3 ↔ Game a 11 y eso no
  // es una pérdida.
  meta.squashFinisherPreservedCount = sessions.filter(
    (session) => session.sessionType === 'squash'
      && resolveSquashMatchRole(session.squashDetails) === 'finisher',
  ).length
  meta.squashStandaloneMatchCount = sessions.filter(
    (session) => session.sessionType === 'squash'
      && resolveSquashMatchRole(session.squashDetails) === 'standalone',
  ).length
```

- [ ] **Step 5: Correr y verificar que pasa**

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

Copiar los tres campos **exactamente donde ya se copia `squashDrillRotationOmittedCount`**, con este patrón:

```ts
      squashFinisherProposedCount: <fuente>.squashFinisherProposedCount,
      squashFinisherPreservedCount: <fuente>.squashFinisherPreservedCount,
      squashStandaloneMatchCount: <fuente>.squashStandaloneMatchCount,
```

Ubicaciones:
- `generateWeek.ts` — `GenerateWeekResult['meta']`, `WeekActionEvaluation`, los dos `return` de `validateGeneratedWeekAction`.
- `generateWeekCore.ts` — las mismas cuatro, más el `return` de `generateWeekCore`.
- `generatePlan.ts` — `BatchWeekExtraction`, `ResolvedWeekInput`, `makeResolvedWeek`, `makeDeterministicResolvedWeek`, `makeLocalFallbackResolvedWeek`, `generateSingleWeekWithRetry`, `generateWeekPair`, y las dos ramas de `generatePlanWeeks`.
- `asyncGenerationLoop.ts` — `makeResolvedWeek` y `makeFallbackResolvedWeek`.

Verificación por archivo: `grep -c "squashDrillRotationOmittedCount" <archivo>` y `grep -c "squashStandaloneMatchCount" <archivo>` deben coincidir.

- [ ] **Step 8: Allowlist del loadtest**

En `scripts/loadtest-plan-builder/artifact.mjs`, en `toWeekRow`, después de `squashDrillRotationOmittedCount`:

```js
    squashFinisherProposedCount: meta.squashFinisherProposedCount ?? null,
    squashFinisherPreservedCount: meta.squashFinisherPreservedCount ?? null,
    squashStandaloneMatchCount: meta.squashStandaloneMatchCount ?? null,
```

- [ ] **Step 9: Correr las suites**

Run: `npx vitest run src/services/planBuilder scripts/loadtest-plan-builder.test.js`
Expected: PASS. Si el guard de drift falla, actualizar la lista de claves esperadas del test.

- [ ] **Step 10: Avisar al owner** — `feat: observational squash match role counters`

---

## Task 10: Punto fijo y verificación final

**Files:**
- Test: `squashMatchRoles.test.ts`

- [ ] **Step 1: Escribir el test de punto fijo (spec §9 test 6)**

```ts
describe('punto fijo', () => {
  it('la segunda ejecución completa es igualdad exacta', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', phase: 'peak', sessionsPerWeek: 3 })
    const first = repairGeneratedWeek([
      finisherSessionFixture('2026-08-03'),
      drillSessionFixture('2026-08-05'),
      standaloneSessionFixture('2026-08-07'),
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
Expected: PASS. Si falla, la diferencia entre `first` y `second` señala el paso no idempotente — arreglarlo, no relajar el test.

- [ ] **Step 3: Verificación completa**

Run: `npm run lint` → sin salida.
Run: `npm test` → todos pasan. Base: 320 archivos / 2386 tests antes de este plan.
Run: `npm run build` → `✓ built in …`.

- [ ] **Step 4: Confirmar el barrido del drill eliminado**

Run: `grep -rn "practice_match_short_points_attack\|Partido con ataque temprano" src scripts docs`
Expected: solo `docs/superpowers/specs/` y `docs/superpowers/plans/`, como registro histórico.

- [ ] **Step 5: Avisar al owner**

Reportar: tareas completadas, resultado de lint/test/build, y que la medición de §6 del spec queda pendiente de la próxima corrida pagada del loadtest.

---

## Notas de cierre

**Lo que este plan NO hace, a propósito:**

- No compone finishers. Si `squashFinisherProposedCount` sale cerca de cero en la próxima corrida, la respuesta es prompt o selector, no autoría en el repair (spec §4).
- No impone tope de partidos por semana. Riesgo residual aceptado en spec §10.1; `squashStandaloneMatchCount` lo hace medible.
- No redensifica una sesión que quedó corta tras retirarle contenido competitivo no canónico (Task 4, Step 5). `low_drill_depth` lo reporta como warning.
- No corre el loadtest. Saldo insuficiente (spec §11).

**Actualizar después del merge:** `PROJECT_REVIEW_AND_ROADMAP.md` (sección de calidad deportiva) y `CLAUDE.md` (bloque reciente + conteo de la suite).
