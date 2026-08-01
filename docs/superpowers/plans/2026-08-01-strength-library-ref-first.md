# Fuerza — `libraryRef`-first Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la identidad de un ejercicio de fuerza se lea de `libraryRef` cuando existe, y del nombre solo en contenido legacy o libre.

**Architecture:** Un tier `ref` arriba de la escalera de resolución existente en `exerciseLibrary.ts`. Tres productores deterministas estampan el `id` que ya conocen. Seis conversiones a `CoachExerciseProposal` se consolidan en un convertidor canónico para que ninguna ruta quede name-only. Seis consumidores que ya reciben el objeto entero pasan a resolver por ref.

**Tech Stack:** TypeScript, React, Vite, Vitest. Sin migraciones Dexie ni Supabase.

**Spec:** `docs/superpowers/specs/2026-08-01-strength-library-ref-first-design.md`

**Base:** `3d480b3`

## Global Constraints

- **Sin migraciones.** Ni Dexie ni Supabase. Todos los campos nuevos son opcionales dentro de blobs JSON que ya existen.
- **`promptBuilder.ts` no se toca.** Tampoco el schema de la herramienta de la IA: mover eso cambia `variant_id` y la telemetría del plan builder.
- **El nombre visible nunca se reescribe.** El ref manda para prescripción y clasificación; el texto sale siempre del campo guardado.
- **Los commits los hace el owner.** No ejecutar `git commit` ni `git add` sin pedido explícito. Los pasos "Commit" de este plan describen el commit que corresponde; el agente para ahí y se lo ofrece al owner.
- **Verificación completa antes de declarar terminado:** `npx tsc -b`, `npm run lint`, `npm test`, `npm run build`, `git diff --check`.
- **Comando de test dirigido:** `npx vitest run <ruta>` — `--silent` rompe cuando se le pasan rutas, no usarlo.
- **Criterio de aceptación global:** cero cambios de prescripción. La única diferencia esperada es la presencia del metadata `libraryRef` en contenido nuevo.

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `src/services/training/exerciseLibrary.ts` | tier `ref`, tipos renombrados, registro de ids retirados | 1, 2 |
| `src/services/training/strengthSessionStructure.ts` | `ref` autoritativo, productores `makeCoreExercise` y footwork, consumidores de bloque | 3, 4 |
| `src/types/index.ts` | `libraryRef` en `CoachExerciseProposal` | 4 |
| `src/services/training/strengthSelector.ts` | `libraryRef` en `StrengthSelectionExercise`, estampado, consumidores de historial/progresión/reemplazo | 4, 7 |
| `src/services/training/strengthExerciseProposal.ts` **(nuevo)** | convertidor canónico + identidad compartida | 5, 6 |
| `src/services/ai/promptModules/strengthPrompt.ts` | envoltorio model-facing | 5 |
| `src/services/ai/actionPostProcessor.ts` | 3 conversiones inline, `completeStrengthLoads` | 5, 6, 8 |
| `src/services/planBuilder/repairWeek.ts` | 2 conversiones, identidad | 5, 6 |
| `src/services/planBuilder/strengthRoleContract.ts` | roles por ref | 8 |
| `src/services/planBuilder/qualityReview.ts` | cobertura 1RM por ref | 8 |
| `src/services/ai/responseNormalizer.ts` | frontera del modelo (no gana la línea) | 9 |
| `src/services/dataExport.ts` | frontera de import de propuestas | 9 |

---

### Task 1: Tier `ref` en el resolver

**Files:**
- Modify: `src/services/training/exerciseLibrary.ts:39-58` (tipos), `:1369-1424` (resolver)
- Modify: `src/services/training/strengthSessionStructure.ts:2-8` (import de tipos renombrados)
- Test: `src/services/training/__tests__/strengthNameResolution.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `resolveStrengthExercise(exercise: { name: string; libraryRef?: ExerciseLibraryRef }): StrengthExerciseResolution | undefined`; tipos `StrengthExerciseResolution` y `StrengthExerciseMatchKind` (con `'ref'`); `resolveStrengthExerciseName(name: string)` como wrapper.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `src/services/training/__tests__/strengthNameResolution.test.ts`, dentro del `describe` existente:

```ts
describe('tier libraryRef', () => {
  const refTo = (id: string) => ({ source: 'strength_exercise' as const, id })

  it('un ref vivo gana sobre cualquier resolución por nombre', () => {
    const resolution = resolveStrengthExercise({
      name: 'Press banca',
      libraryRef: refTo('back_squat'),
    })

    expect(resolution?.matchKind).toBe('ref')
    expect(resolution?.definition?.id).toBe('back_squat')
  })

  it('un ref muerto cae a la escalera por nombre', () => {
    const resolution = resolveStrengthExercise({
      name: 'Press banca',
      libraryRef: refTo('ejercicio_retirado_hace_años'),
    })

    expect(resolution?.matchKind).toBe('exact')
    expect(resolution?.definition?.id).toBe('bench_press')
  })

  it('un ref de otra librería se ignora', () => {
    const resolution = resolveStrengthExercise({
      name: 'Press banca',
      libraryRef: { source: 'squash_drill', id: 'back_squat' },
    })

    expect(resolution?.matchKind).toBe('exact')
    expect(resolution?.definition?.id).toBe('bench_press')
  })

  it('sin ref se comporta igual que resolver por nombre', () => {
    expect(resolveStrengthExercise({ name: 'Press banca' })?.matchKind).toBe('exact')
    // Ojo: un fragmento que empata entre varios NO devuelve `undefined`, devuelve
    // una resolución `ambiguous` sin `definition`. `undefined` se reserva para
    // el texto que no se parece a nada del catálogo.
    expect(resolveStrengthExercise({ name: 'press' })?.matchKind).toBe('ambiguous')
    expect(resolveStrengthExercise({ name: 'press' })?.definition).toBeUndefined()
    expect(resolveStrengthExercise({ name: 'Circuito experimental alfa' })).toBeUndefined()
  })

  it('el wrapper por nombre delega en el resolver general', () => {
    expect(resolveStrengthExerciseName('Press banca')?.definition?.id).toBe('bench_press')
  })
})
```

Agregar `resolveStrengthExercise` al `import` del encabezado del archivo.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthNameResolution.test.ts`
Expected: FAIL — `resolveStrengthExercise is not a function`.

- [ ] **Step 3: Renombrar los tipos**

En `src/services/training/exerciseLibrary.ts`, reemplazar el bloque de tipos actual por:

```ts
export type StrengthExerciseMatchKind = 'ref' | 'exact' | 'alias' | 'substring' | 'ambiguous'

/**
 * Procedencia de una resolución.
 *
 * `ambiguous` no entrega `definition`: prescribir carga sobre un fragmento que
 * empata entre varios ejercicios es adivinar. Sí entrega `candidates`, porque
 * clasificar el bloque de la sesión no es fail-closed y descartarlos mandaba
 * nombres perfectamente reconocibles a `other`.
 */
export type StrengthExerciseResolution =
  | {
    definition: ExerciseDefinition
    matchKind: Exclude<StrengthExerciseMatchKind, 'ambiguous'>
    candidates: ExerciseDefinition[]
  }
  | {
    definition?: undefined
    matchKind: 'ambiguous'
    candidates: ExerciseDefinition[]
  }
```

En `src/services/training/strengthSessionStructure.ts`, cambiar el import de `type StrengthExerciseNameResolution` a `type StrengthExerciseResolution` y reemplazar las 8 apariciones del tipo en firmas de función.

- [ ] **Step 4: Implementar el tier**

En `exerciseLibrary.ts`, agregar el import al tope del archivo:

```ts
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'
```

Renombrar la función existente `resolveStrengthExerciseName` a `resolveByNameLadder` y marcarla `function` privada (quitar `export`). Su cuerpo no cambia. Debajo, agregar:

```ts
/**
 * Identidad del ejercicio. El `libraryRef` gana sobre el texto: el nombre es
 * copy y el `id` es identidad. Un ref muerto o de otra librería no vale nada y
 * la resolución sigue por nombre — un ref viejo no puede dejar peor al
 * ejercicio que no tener ninguno.
 */
export function resolveStrengthExercise(
  exercise: { name: string; libraryRef?: ExerciseLibraryRef },
): StrengthExerciseResolution | undefined {
  const fromRef = resolveFromLibraryRef(exercise.libraryRef)
  if (fromRef) return { definition: fromRef, matchKind: 'ref', candidates: [fromRef] }
  return resolveByNameLadder(exercise.name)
}

function resolveFromLibraryRef(ref: ExerciseLibraryRef | undefined): ExerciseDefinition | undefined {
  if (!ref || ref.source !== 'strength_exercise') return undefined
  return STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.id === ref.id)
}

/** Wrapper de compatibilidad para las APIs que solo tienen texto. */
export function resolveStrengthExerciseName(name: string): StrengthExerciseResolution | undefined {
  return resolveStrengthExercise({ name })
}

export function findStrengthExerciseByName(name: string): ExerciseDefinition | undefined {
  return resolveStrengthExerciseName(name)?.definition
}
```

Borrar la definición vieja de `findStrengthExerciseByName` si quedó duplicada.

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/strengthNameResolution.test.ts`
Expected: PASS, todos los tests del archivo incluidos los preexistentes.

- [ ] **Step 6: Verificar que nada más se rompió**

Run: `npx tsc -b && npx vitest run src/services/`
Expected: tsc sin salida; suite en verde.

- [ ] **Step 7: Commit (ofrecer al owner)**

```bash
git add src/services/training/exerciseLibrary.ts src/services/training/strengthSessionStructure.ts src/services/training/__tests__/strengthNameResolution.test.ts
git commit -m "feat(strength): resolve exercises by libraryRef before name"
```

---

### Task 2: Invariante de permanencia de los `id` del catálogo

**Files:**
- Modify: `src/services/training/exerciseLibrary.ts` (agregar `RETIRED_STRENGTH_EXERCISE_IDS`)
- Test: `src/services/training/__tests__/strengthCatalogIdPermanence.test.ts` (crear)

**Interfaces:**
- Consumes: `STRENGTH_EXERCISE_LIBRARY` de Task 1.
- Produces: `RETIRED_STRENGTH_EXERCISE_IDS: readonly string[]`.

**Por qué:** el ref solo es más confiable que el texto si el `id` significa siempre lo mismo. Un `id` retirado que reaparece apuntando a otro ejercicio haría que los refs muertos —que sobreviven en las filas— vuelvan a resolver, sobre la definición equivocada y con autoridad máxima.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/training/__tests__/strengthCatalogIdPermanence.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { RETIRED_STRENGTH_EXERCISE_IDS, STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'

/**
 * Los `id` del catálogo son permanentes: un ref guardado en una sesión de hace
 * seis meses tiene que significar hoy lo mismo que significaba entonces.
 *
 * Este archivo es un GATE, no una prueba de identidad. La lista congelada
 * detecta altas y bajas y obliga a editarla a propósito; ese momento es cuando
 * hay que decidir si el `id` sigue significando lo mismo. Lo que NO detecta es
 * un renombre semántico dentro de un `id` que ya estaba — eso queda a criterio
 * de quien edita el catálogo, y el gate existe para que no sea silencioso.
 */
/**
 * Lista APPEND-ONLY de todo `id` que existió alguna vez. Congelar solo los
 * activos no alcanza: bastaba borrar un `id` del catálogo y de la lista para
 * dejar los tests en verde, que es exactamente el movimiento que hay que
 * atrapar. Acá un `id` solo se agrega; para retirarlo se lo mueve a
 * `RETIRED_STRENGTH_EXERCISE_IDS` y sigue figurando en esta lista.
 */
const FROZEN_KNOWN_IDS = [
  'air_treadmill_20_20',
  'alternating_step_up_jump',
  'assault_bike_30_30',
  'assisted_pull_up',
  'back_squat',
  'band_row',
  'barbell_jump_squat',
  'barbell_single_leg_inverted_row',
  'bb_reverse_lunge',
  'bb_side_lunge',
  'bench_press',
  'bent_over_row',
  'bird_dog_renegade_row',
  'bodyweight_squat',
  'box_jump',
  'broad_jump',
  'bulgarian_split_squat',
  'cable_chop',
  'chest_supported_row',
  'clean',
  'clean_high_pull',
  'close_grip_bench_press',
  'copenhagen_side_plank',
  'dead_bug',
  'deadlift',
  'depth_jump',
  'drop_jump',
  'farmer_carry',
  'front_squat',
  'glute_bridge',
  'goblet_squat',
  'half_kneeling_diagonal_plate_chop',
  'half_kneeling_lateral_jump',
  'half_kneeling_row',
  'hip_thrust',
  'incline_bench_press',
  'incline_dumbbell_press',
  'inverted_row',
  'jump_squat',
  'kettlebell_swing',
  'ladder_bipodal_front_1',
  'ladder_bipodal_front_2',
  'ladder_bipodal_front_3',
  'ladder_bipodal_lateral_1',
  'ladder_bipodal_lateral_3',
  'ladder_coordinativo_front_2',
  'ladder_coordinativo_front_4',
  'landmine_press',
  'lat_pulldown',
  'lateral_band_walk',
  'lateral_skater_jumps',
  'med_ball_rotational_throw',
  'med_ball_slam',
  'mixed_grip_pull_up',
  'overhead_press',
  'pallof_press',
  'plank',
  'pogo_jumps',
  'pull_up',
  'push_press',
  'push_up',
  'romanian_deadlift',
  'rotational_med_ball_throw',
  'side_plank',
  'side_plank_plate_press',
  'single_leg_broad_jump',
  'single_leg_hip_thrust',
  'split_jerk',
  'split_squat',
  'stability_ball_front_plank',
  'step_up',
  'sumo_deadlift',
  'trap_bar_deadlift',
  'trx_inverted_row',
  'walking_lunge',
  'weighted_pull_up',
  'z_press',
]

describe('permanencia de los id del catálogo de fuerza', () => {
  const active = STRENGTH_EXERCISE_LIBRARY.map((exercise) => exercise.id)

  it('activos y retirados son conjuntos disjuntos', () => {
    const activeSet = new Set(active)
    expect(RETIRED_STRENGTH_EXERCISE_IDS.filter((id) => activeSet.has(id))).toEqual([])
  })

  it('la unión de activos y retirados es exactamente la lista conocida', () => {
    // Esta es la aserción que hace el gate append-only: sacar un `id` del
    // catálogo sin moverlo a retirados rompe acá, porque desaparece de la unión
    // pero sigue en `FROZEN_KNOWN_IDS`.
    expect([...active, ...RETIRED_STRENGTH_EXERCISE_IDS].sort()).toEqual(FROZEN_KNOWN_IDS)
  })

  it('no hay ids duplicados entre los activos', () => {
    expect(new Set(active).size).toBe(active.length)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthCatalogIdPermanence.test.ts`
Expected: FAIL — `RETIRED_STRENGTH_EXERCISE_IDS` no existe.

- [ ] **Step 3: Agregar el registro**

En `src/services/training/exerciseLibrary.ts`, junto a la declaración de `STRENGTH_EXERCISE_LIBRARY`:

```ts
/**
 * `id` que existieron y se retiraron del catálogo. Nunca se reutilizan para
 * otro ejercicio: un `libraryRef` guardado apunta a este `id` para siempre, y
 * reasignarlo haría que un ref muerto vuelva a resolver sobre la definición
 * equivocada, con la autoridad máxima del tier `ref`.
 *
 * Al retirar un ejercicio, mover su `id` acá en el mismo cambio.
 */
export const RETIRED_STRENGTH_EXERCISE_IDS: readonly string[] = []
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/strengthCatalogIdPermanence.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit (ofrecer al owner)**

```bash
git add src/services/training/exerciseLibrary.ts src/services/training/__tests__/strengthCatalogIdPermanence.test.ts
git commit -m "test(strength): freeze catalog ids and forbid reuse of retired ones"
```

---

### Task 3: `ref` es autoritativo y arrastra las cuatro salvaguardas

**Files:**
- Modify: `src/services/training/strengthSessionStructure.ts:253-257` (`isAuthoritativeResolution`), `:70-73` (`resolveStrengthExerciseBlock`), `:39-52`, `:75-81`, `:195`, `:227`
- Test: `src/services/__tests__/strengthSessionStructure.test.ts`

**Interfaces:**
- Consumes: `resolveStrengthExercise`, `StrengthExerciseResolution` de Task 1.
- Produces: `resolveStrengthExerciseBlock(exercise: Pick<StrengthExerciseLike, 'name' | 'group'> & { libraryRef?: ExerciseLibraryRef }): ExerciseGroup`.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final del `describe` de `src/services/__tests__/strengthSessionStructure.test.ts`:

```ts
describe('libraryRef como resolución autoritativa', () => {
  const refTo = (id: string) => ({ source: 'strength_exercise' as const, id })

  it('un ref hereda las salvaguardas de un match exacto', () => {
    // Nombre libre que por texto sería ambiguo; el ref lo identifica.
    const result = enhanceStrengthSessionExercises([
      { name: 'Sentadilla bulgara con mancuernas', sets: 3, reps: 8, libraryRef: refTo('bulgarian_split_squat') },
    ], { durationMin: 30, strengthProfile: { squat1RM: 100 } })!

    // squat 100 × factor 0.35 × 72.5% = 25.4 → redondeado; unilateral ⇒ sin %1RM.
    expect(result[0]?.weight).toBe(25)
    expect(result[0]?.targetPercent1RM).toBeUndefined()
  })

  it('un ref a una plancha usa prescriptionUnit y no el regex del nombre', () => {
    const result = enhanceStrengthSessionExercises([
      { name: 'Isométrico de tronco', sets: 3, reps: 45, libraryRef: refTo('plank') },
    ], { durationMin: 30 })!

    expect(result[0]?.reps).toBe('45s')
    expect(result[0]?.group).toBe('core')
  })

  it('un ref vivo gana el filtro de protocolo aunque el nombre lo dispare', () => {
    // `ref` es autoritativo: si el ejercicio está identificado, el regex de
    // protocolo —escrito para nombres libres— no corre. Es la consecuencia
    // directa de "el ref manda sobre el nombre", y va congelada acá.
    const result = enhanceStrengthSessionExercises([
      { name: 'Press banca', sets: 3, reps: 5 },
      { name: 'Estiramiento de sentadilla', sets: 4, reps: 5, libraryRef: refTo('back_squat') },
    ], { durationMin: 30, strengthProfile: { benchPress1RM: 100, squat1RM: 100 } })!

    expect(result.map((exercise) => exercise.name)).toContain('Estiramiento de sentadilla')
  })

  it('sin ref, el regex de protocolo sigue filtrando', () => {
    const result = enhanceStrengthSessionExercises([
      { name: 'Press banca', sets: 3, reps: 5 },
      { name: 'Estiramiento de isquiotibiales', sets: 1, reps: 30 },
    ], { durationMin: 30, strengthProfile: { benchPress1RM: 100 } })!

    expect(result.map((exercise) => exercise.name)).toEqual(['Press banca'])
  })

  it('un ref a un ejercicio de potencia usa intensityType, no el regex del nombre', () => {
    // `box_jump` es `intensityType: 'power'`. Sin carga ni porcentaje
    // declarados no es load-bearing, así que no recibe %1RM.
    const result = enhanceStrengthSessionExercises([
      { name: 'Trabajo reactivo de tren inferior', sets: 3, reps: 3, libraryRef: refTo('box_jump') },
    ], { durationMin: 30, strengthProfile: { squat1RM: 100 } })!

    expect(result[0]?.targetPercent1RM).toBeUndefined()
    expect(result[0]?.weight).toBeUndefined()
  })

  it('resolveStrengthExerciseBlock usa el ref cuando está', () => {
    expect(resolveStrengthExerciseBlock({
      name: 'Movimiento sin nombre reconocible',
      group: undefined,
      libraryRef: refTo('bench_press'),
    })).toBe('push')
  })
})
```

Agregar `resolveStrengthExerciseBlock` al import del archivo si no está.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/__tests__/strengthSessionStructure.test.ts`
Expected: FAIL — los 4 casos nuevos; el ref se ignora porque nada lo lee todavía.

- [ ] **Step 3: Aceptar `ref` como autoritativo**

Reemplazar `isAuthoritativeResolution`:

```ts
/**
 * Solo un `libraryRef` vivo, un id, un nombre canónico o un alias declarado
 * identifican al ejercicio con certeza. `substring` y `ambiguous` son
 * coincidencias de texto: conservan los regex estructurales, que fueron
 * escritos justamente para nombres libres.
 */
function isAuthoritativeResolution(
  resolution: StrengthExerciseResolution | undefined,
): resolution is StrengthExerciseResolution & { definition: ExerciseDefinition; matchKind: 'ref' | 'exact' | 'alias' } {
  return resolution?.matchKind === 'ref'
    || resolution?.matchKind === 'exact'
    || resolution?.matchKind === 'alias'
}
```

- [ ] **Step 4: Pasar el ejercicio entero al resolver**

En `strengthSessionStructure.ts`, reemplazar las 5 llamadas a `resolveStrengthExerciseName(exercise.name)` por `resolveStrengthExercise(exercise)`, en:
`removeProtocolExercisesWhenStrengthWorkExists` (línea ~42), `normalizeStrengthExerciseGroup` (~76), `completeStrengthLoadAndEffort` (~195), el default de `isLoadBearingStrengthExercise` (~227), y `resolveStrengthExerciseBlock` (~71).

Actualizar el import: `resolveStrengthExercise` en vez de `resolveStrengthExerciseName`.

Ensanchar la firma pública:

```ts
export function resolveStrengthExerciseBlock(
  exercise: Pick<StrengthExerciseLike, 'name' | 'group'> & { libraryRef?: ExerciseLibraryRef },
): ExerciseGroup {
  return resolveBlockFromResolution(exercise, resolveStrengthExercise(exercise))
}
```

Agregar el import de tipo:

```ts
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/__tests__/strengthSessionStructure.test.ts`
Expected: PASS. Si el peso esperado del primer test no da 25, correr el caso e imprimir el valor real antes de ajustar el número — no cambiar el test sin entender por qué.

- [ ] **Step 6: Verificar la suite**

Run: `npx tsc -b && npx vitest run src/services/`
Expected: todo en verde.

- [ ] **Step 7: Commit (ofrecer al owner)**

```bash
git add src/services/training/strengthSessionStructure.ts src/services/__tests__/strengthSessionStructure.test.ts
git commit -m "feat(strength): treat a live libraryRef as an authoritative resolution"
```

---

### Task 4: Transporte y los tres productores deterministas

**Files:**
- Modify: `src/types/index.ts:966-977` (`CoachExerciseProposal`)
- Modify: `src/services/training/strengthSelector.ts:49-58` (`StrengthSelectionExercise`), `:1196-1204` (`buildSelectionExercise`)
- Modify: `src/services/training/strengthSessionStructure.ts:112-144` (footwork), `:410-418` (`makeCoreExercise`)
- Test: `src/services/training/__tests__/strengthLibraryRefStamping.test.ts` (crear)

**Interfaces:**
- Consumes: `resolveStrengthExercise` de Task 1.
- Produces: `CoachExerciseProposal.libraryRef?: ExerciseLibraryRef`, `StrengthSelectionExercise.libraryRef?: ExerciseLibraryRef`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/training/__tests__/strengthLibraryRefStamping.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { CoachExerciseProposal, StrengthProfile } from '../../../types'
import { normalizeStrengthSessionExercises } from '../strengthSessionStructure'
import { selectStrengthSession } from '../strengthSelector'

const PROFILE: StrengthProfile = { squat1RM: 100, deadlift1RM: 120, benchPress1RM: 80, overheadPress1RM: 50 }

describe('estampado de libraryRef en los productores deterministas', () => {
  it('el selector estampa el id de cada definición elegida', () => {
    const selection = selectStrengthSession({
      phase: 'build',
      durationMin: 50,
      fatigueLevel: 4,
      experienceLevel: 'intermediate',
      availableEquipment: ['barbell', 'dumbbell', 'bodyweight'],
      primarySport: 'squash',
      strengthProfile: PROFILE,
    } as never)

    expect(selection.exercises.length).toBeGreaterThan(0)
    for (const exercise of selection.exercises) {
      expect(exercise.libraryRef?.source).toBe('strength_exercise')
      expect(exercise.libraryRef?.id).toBeTruthy()
    }
  })

  it('el core de fundación inyectado trae el ref de dead_bug', () => {
    const result = normalizeStrengthSessionExercises([
      { name: 'Press banca', sets: 3, reps: 5 } as CoachExerciseProposal,
    ], { durationMin: 50 })!

    const core = result.find((exercise) => exercise.name === 'Control de tronco dead bug')
    expect(core?.libraryRef).toEqual({ source: 'strength_exercise', id: 'dead_bug' })
  })

  it('la expansión de footwork reemplaza el ref del bloque genérico, no lo hereda', () => {
    const result = normalizeStrengthSessionExercises([
      {
        name: 'Escalera de agilidad',
        sets: 1,
        reps: '4 min',
        // Ref MUERTO: no identifica nada, así que el bloque sigue siendo
        // genérico y se expande. Un ref VIVO manda y evita la expansión — ese
        // caso lo cubre Task 8. Lo que se prueba acá es que este ref inservible
        // no se propaga a las tres escaleras.
        libraryRef: { source: 'strength_exercise', id: 'ejercicio_retirado_hace_años' },
      } as CoachExerciseProposal,
    ], { durationMin: 30 })!

    const ladders = result.filter((exercise) => exercise.name.startsWith('Escalera'))
    expect(ladders).toHaveLength(3)
    expect(ladders.map((exercise) => exercise.libraryRef?.id)).toEqual([
      'ladder_bipodal_lateral_1',
      'ladder_bipodal_front_2',
      'ladder_coordinativo_front_4',
    ])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthLibraryRefStamping.test.ts`
Expected: FAIL — `libraryRef` es `undefined` en los tres casos.

- [ ] **Step 3: Agregar el campo a los dos tipos**

En `src/types/index.ts`, dentro de `CoachExerciseProposal`, después de `warmupSets`:

```ts
  libraryRef?: ExerciseLibraryRef // origen opcional en las librerías curadas
```

En `src/services/training/strengthSelector.ts`, dentro de `StrengthSelectionExercise`, después de `targetRpe`:

```ts
  libraryRef?: ExerciseLibraryRef
```

Agregar el import de tipo en `strengthSelector.ts`:

```ts
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'
```

- [ ] **Step 4: Estampar en `buildSelectionExercise`**

En `strengthSelector.ts:1196`, agregar el campo al objeto retornado:

```ts
  return {
    name: exercise.name,
    sets: prescription.sets,
    reps: prescription.reps,
    intensity: prescription.intensity,
    notes: buildExerciseNotes(exercise, context, prescription.intensity, index),
    group: getExerciseGroupForDefinition(exercise),
    libraryRef: { source: 'strength_exercise', id: exercise.id },
  }
```

- [ ] **Step 5: Estampar en `makeCoreExercise`**

En `strengthSessionStructure.ts:410`, la firma gana el id:

```ts
function makeCoreExercise<T extends StrengthExerciseLike>(name: string, notes: string, id: string): T {
  return {
    name,
    sets: 3,
    reps: '8/lado',
    group: 'core',
    notes,
    libraryRef: { source: 'strength_exercise', id },
  } as T
}
```

Actualizar las tres llamadas (líneas ~180, ~187, ~199) agregando `'dead_bug'` como tercer argumento.

- [ ] **Step 6: Reemplazar —no heredar— el ref en la expansión de footwork**

En `buildFootworkSeriesFromGenericBlock` (`strengthSessionStructure.ts:112`), `base` propaga todos los campos del bloque genérico, incluido un `libraryRef` que apunta a otro ejercicio. Neutralizarlo en `base` y ponerlo explícito en cada entrada:

```ts
function buildFootworkSeriesFromGenericBlock<T extends StrengthExerciseLike>(exercise: T): T[] {
  const base = {
    ...exercise,
    group: 'cardio' as ExerciseGroup,
    weight: undefined,
    targetPercent1RM: undefined,
    targetRpe: undefined,
    warmupSets: undefined,
    // El ref del bloque genérico apunta a otro ejercicio: heredarlo haría que
    // el tier `ref` prescriba sobre la definición equivocada, con autoridad
    // máxima y sin ninguna señal. Cada escalera declara el suyo.
    libraryRef: undefined,
  }

  return [
    {
      ...base,
      name: 'Escalera lateral – dos pies por cuadro',
      libraryRef: { source: 'strength_exercise' as const, id: 'ladder_bipodal_lateral_1' },
      sets: 2,
      reps: '2 pasadas por lado',
      notes: appendExerciseNote(exercise.notes, 'E1 coordinación lateral: calidad de apoyo, cadera baja y regreso caminando.'),
    },
    {
      ...base,
      name: 'Escalera frontal – in-in-out-out',
      libraryRef: { source: 'strength_exercise' as const, id: 'ladder_bipodal_front_2' },
      sets: 2,
      reps: '2 pasadas',
      notes: appendExerciseNote(exercise.notes, 'E2 ritmo de pies: precisión antes que velocidad.'),
    },
    {
      ...base,
      name: 'Escalera frontal – Icky shuffle',
      libraryRef: { source: 'strength_exercise' as const, id: 'ladder_coordinativo_front_4' },
      sets: 2,
      reps: '2 pasadas',
      notes: appendExerciseNote(exercise.notes, 'E3 coordinación diagonal: pies activos sin convertirlo en cardio duro.'),
    },
  ] as T[]
}
```

- [ ] **Step 7: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/strengthLibraryRefStamping.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Verificar la suite**

Run: `npx tsc -b && npx vitest run src/services/`
Expected: verde.

- [ ] **Step 9: Commit (ofrecer al owner)**

```bash
git add src/types/index.ts src/services/training/strengthSelector.ts src/services/training/strengthSessionStructure.ts src/services/training/__tests__/strengthLibraryRefStamping.test.ts
git commit -m "feat(strength): stamp libraryRef in the three deterministic producers"
```

---

### Task 5: Convertidor canónico y las seis conversiones

**Files:**
- Create: `src/services/training/strengthExerciseProposal.ts`
- Modify: `src/services/ai/actionPostProcessor.ts:597`, `:828`, `:862`
- Modify: `src/services/planBuilder/repairWeek.ts:2230`, `:2333`
- Modify: `src/services/ai/promptModules/strengthPrompt.ts:113`
- Test: `src/services/training/__tests__/strengthExerciseProposal.test.ts` (crear)

**Interfaces:**
- Consumes: `StrengthSelectionExercise` (con `libraryRef`) de Task 4.
- Produces: `toStrengthProposal(exercise: StrengthSelectionExercise): CoachExerciseProposal`, `toStrengthProposalForEnhancement(exercise: StrengthSelectionExercise): CoachExerciseProposal` y `toModelFacingProposal(exercise: StrengthSelectionExercise): CoachExerciseProposal`.

**Por qué:** hay **seis** conversiones y solo dos son funciones con nombre. Las otras cuatro son literales inline, que es por qué un grep por `toCoachExerciseProposal` no las encuentra. Si queda una sin migrar, esa ruta produce ejercicios sin ref en silencio.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/training/__tests__/strengthExerciseProposal.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { StrengthSelectionExercise } from '../strengthSelector'
import { toModelFacingProposal, toStrengthProposal } from '../strengthExerciseProposal'

const SELECTION: StrengthSelectionExercise = {
  name: 'Sentadilla trasera con barra',
  sets: 4,
  reps: 5,
  intensity: 'heavy',
  notes: 'Tronco firme.',
  group: 'legs',
  targetPercent1RM: 80,
  targetRpe: 8,
  libraryRef: { source: 'strength_exercise', id: 'back_squat' },
}

describe('conversión canónica a CoachExerciseProposal', () => {
  it('lleva la unión completa de campos, incluido el ref', () => {
    expect(toStrengthProposal(SELECTION)).toEqual({
      name: 'Sentadilla trasera con barra',
      sets: 4,
      reps: 5,
      group: 'legs',
      notes: 'Tronco firme.',
      targetPercent1RM: 80,
      targetRpe: 8,
      libraryRef: { source: 'strength_exercise', id: 'back_squat' },
    })
  })

  it('el envoltorio model-facing expone exactamente los campos del prompt', () => {
    // Enumeración cerrada: si el convertidor canónico gana un campo, este test
    // falla y obliga a decidir si el modelo debe verlo.
    expect(Object.keys(toModelFacingProposal(SELECTION)).sort())
      .toEqual(['group', 'name', 'notes', 'reps', 'sets'])
  })

  it('el envoltorio model-facing no filtra ref, porcentaje ni RPE', () => {
    const proposal = toModelFacingProposal(SELECTION) as Record<string, unknown>
    expect(proposal.libraryRef).toBeUndefined()
    expect(proposal.targetPercent1RM).toBeUndefined()
    expect(proposal.targetRpe).toBeUndefined()
  })

  it('el envoltorio model-facing anota la intensidad en las notas', () => {
    expect(toModelFacingProposal(SELECTION).notes).toBe('Tronco firme. [heavy]')
    expect(toModelFacingProposal({ ...SELECTION, notes: undefined }).notes).toBe('[heavy]')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthExerciseProposal.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Crear el convertidor**

Crear `src/services/training/strengthExerciseProposal.ts`:

```ts
import type { CoachExerciseProposal } from '../../types'
import type { StrengthSelectionExercise } from './strengthSelector'

/**
 * Conversión canónica de una selección de fuerza a propuesta.
 *
 * Existía seis veces con cuatro formas distintas —cuatro de ellas literales
 * inline—, y cada copia decidía por su cuenta qué campos dejar caer. Acá va la
 * unión completa: quien necesite recortar, recorta explícitamente encima.
 */
export function toStrengthProposal(exercise: StrengthSelectionExercise): CoachExerciseProposal {
  return {
    name: exercise.name,
    sets: exercise.sets,
    reps: exercise.reps,
    group: exercise.group,
    notes: exercise.notes,
    targetPercent1RM: exercise.targetPercent1RM,
    targetRpe: exercise.targetRpe,
    libraryRef: exercise.libraryRef,
  }
}

/**
 * Las rutas de actionPostProcessor vuelven a enriquecer inmediatamente. Llevan
 * el ref, pero dejan que porcentaje y RPE se deriven como antes; transportarlos
 * acá cambia también peso y warmups.
 */
export function toStrengthProposalForEnhancement(
  exercise: StrengthSelectionExercise,
): CoachExerciseProposal {
  const proposal = toStrengthProposal(exercise)
  delete proposal.targetPercent1RM
  delete proposal.targetRpe
  return proposal
}

/**
 * Proyección para el prompt. Se construye por enumeración explícita, no
 * quitándole campos al canónico: cualquier campo que se agregue al convertidor
 * se filtraría solo al prompt si acá restáramos en vez de sumar.
 *
 * Excluye `libraryRef` porque el normalizador descarta cualquier ref que el
 * modelo devuelva —mostrárselo sería enseñarle un campo que le vamos a
 * rechazar—, y excluye `targetPercent1RM`/`targetRpe` porque el formato actual
 * del prompt nunca los expuso.
 */
export function toModelFacingProposal(exercise: StrengthSelectionExercise): CoachExerciseProposal {
  return {
    name: exercise.name,
    sets: exercise.sets,
    reps: exercise.reps,
    group: exercise.group,
    notes: exercise.notes ? `${exercise.notes} [${exercise.intensity}]` : `[${exercise.intensity}]`,
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/strengthExerciseProposal.test.ts`
Expected: PASS, 3 tests.

**Cuidado con el ciclo de imports.** `strengthExerciseProposal.ts` importa
`StrengthSelectionExercise` de `strengthSelector.ts`, y en Task 7
`strengthSelector.ts` va a importar `getStrengthExerciseKey` de vuelta. El
import del tipo tiene que ser `import type` —se borra al compilar— para que no
quede un ciclo en tiempo de ejecución. Si en algún momento hace falta importar
un **valor** desde el selector acá, ese valor va a un tercer módulo, no se
resuelve invirtiendo la dirección.

- [ ] **Step 5: Migrar las seis conversiones**

| # | Archivo:línea | Reemplazo |
|---|---|---|
| 1 | `actionPostProcessor.ts:597` | `action.exercises = selection.exercises.map(toStrengthProposalForEnhancement)` |
| 2 | `actionPostProcessor.ts:828` | `next.exercises = selection.exercises.map(toStrengthProposalForEnhancement)` |
| 3 | `actionPostProcessor.ts:862` | `const candidates = selectStrengthSession(selectionContext).exercises.map(toStrengthProposalForEnhancement).filter((exercise) => !existingKeys.has(getStrengthExerciseKey(exercise)))` |
| 4 | `repairWeek.ts:2230` | `session.exercises = result.exercises.map(toStrengthProposal)` |
| 5 | `repairWeek.ts:2333` | borrar la función local; usar `toStrengthProposal` en sus dos call sites (`:1618`, `:2305`) |
| 6 | `strengthPrompt.ts:113` | borrar `toCoachExerciseProposal`; reexportar `toModelFacingProposal` bajo ese nombre si hay imports externos, o actualizar el call site de `:131` |

Agregar en cada archivo:

```ts
import { toStrengthProposal } from '../training/strengthExerciseProposal'
```

(en `repairWeek.ts` la ruta es `'../training/strengthExerciseProposal'`; en `strengthPrompt.ts`, `'../../training/strengthExerciseProposal'`).

- [ ] **Step 6: Congelar que no quedan literales inline**

Agregar a `src/services/training/__tests__/strengthExerciseProposal.test.ts`:

```ts
import { readFileSync } from 'node:fs'

it('ninguna ruta convierte a propuesta con un literal inline', () => {
  const files = [
    'src/services/ai/actionPostProcessor.ts',
    'src/services/planBuilder/repairWeek.ts',
    'src/services/ai/promptModules/strengthPrompt.ts',
  ]

  for (const file of files) {
    const source = readFileSync(file, 'utf-8')
    // Un literal que copia `name:` y `sets:` desde una selección es la firma
    // de una conversión ad-hoc. Las seis conocidas ya migraron; una séptima
    // tiene que fallar acá antes de llegar a producción sin `libraryRef`.
    expect(source).not.toMatch(/exercises\s*\.?\s*map\s*\(\s*\(\s*\w+\s*\)\s*=>\s*\(\{\s*\n\s*name:/)
  }
})
```

- [ ] **Step 7: Verificar**

Run: `npx tsc -b && npx vitest run src/services/`
Expected: verde. Las conversiones 1–3 conservan su semántica histórica mediante
la proyección pre-enrichment; el barrido de Task 10 verifica que transportar el
ref no cambie porcentaje, RPE, peso ni warmups.

- [ ] **Step 8: Commit (ofrecer al owner)**

```bash
git add src/services/training/strengthExerciseProposal.ts src/services/training/__tests__/strengthExerciseProposal.test.ts src/services/ai/actionPostProcessor.ts src/services/planBuilder/repairWeek.ts src/services/ai/promptModules/strengthPrompt.ts
git commit -m "refactor(strength): consolidate six selection-to-proposal conversions"
```

---

### Task 6: Identidad única de rotación y deduplicación

**Files:**
- Modify: `src/services/training/strengthExerciseProposal.ts` (agregar la función)
- Modify: `src/services/ai/actionPostProcessor.ts:941-943` (borrar copia local)
- Modify: `src/services/planBuilder/repairWeek.ts:2357-2359` (borrar copia local)
- Test: `src/services/training/__tests__/strengthExerciseProposal.test.ts`

**Interfaces:**
- Consumes: `resolveStrengthExercise` de Task 1.
- Produces: `getStrengthExerciseKey(exercise: { name: string; libraryRef?: ExerciseLibraryRef }): string`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `src/services/training/__tests__/strengthExerciseProposal.test.ts`:

```ts
describe('identidad de rotación y deduplicación', () => {
  it('un ref vivo define la identidad', () => {
    expect(getStrengthExerciseKey({
      name: 'Nombre libre irreconocible',
      libraryRef: { source: 'strength_exercise', id: 'back_squat' },
    })).toBe('back_squat')
  })

  it('sin ref cae al id resuelto por nombre', () => {
    expect(getStrengthExerciseKey({ name: 'Press banca' })).toBe('bench_press')
  })

  it('un fragmento ambiguo cae al nombre normalizado', () => {
    expect(getStrengthExerciseKey({ name: 'press' })).toBe('press')
  })
})
```

Agregar `getStrengthExerciseKey` al import.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthExerciseProposal.test.ts`
Expected: FAIL — `getStrengthExerciseKey` no se exporta de ese módulo.

- [ ] **Step 3: Implementar**

En `src/services/training/strengthExerciseProposal.ts`:

```ts
import { normalizeStrengthExerciseKey, resolveStrengthExercise } from './exerciseLibrary'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'

/**
 * Identidad para rotación y deduplicación. Un fragmento `ambiguous` no tiene
 * definición, así que cae al nombre normalizado — mismo comportamiento que la
 * versión previa por nombre.
 */
export function getStrengthExerciseKey(
  exercise: { name: string; libraryRef?: ExerciseLibraryRef },
): string {
  return resolveStrengthExercise(exercise)?.definition?.id
    ?? normalizeStrengthExerciseKey(exercise.name)
}
```

- [ ] **Step 4: Borrar las dos copias locales**

Eliminar `getStrengthExerciseKey` de `actionPostProcessor.ts:941` y de `repairWeek.ts:2357`. En ambos archivos, importarla:

```ts
import { getStrengthExerciseKey } from '../training/strengthExerciseProposal'
```

Si queda un import de `findStrengthExerciseByName` o `normalizeStrengthExerciseKey` sin usar, borrarlo.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/training/__tests__/strengthExerciseProposal.test.ts && npx tsc -b`
Expected: PASS; tsc sin salida.

- [ ] **Step 6: Commit (ofrecer al owner)**

```bash
git add src/services/training/strengthExerciseProposal.ts src/services/training/__tests__/strengthExerciseProposal.test.ts src/services/ai/actionPostProcessor.ts src/services/planBuilder/repairWeek.ts
git commit -m "refactor(strength): single ref-aware identity for rotation and dedup"
```

---

### Task 7: Consumidores del selector

**Files:**
- Modify: `src/services/training/strengthSelector.ts:66-73` (`StrengthReplacementRequest`), `:356-372` (`selectStrengthReplacement`), `:432-448` (`extractRecentStrengthExercises`), `:1013-1050` (`deriveStrengthProgressionState`)
- Test: `src/services/training/__tests__/strengthSelectorLibraryRef.test.ts` (crear)

**Interfaces:**
- Consumes: `resolveStrengthExercise` (Task 1), `getStrengthExerciseKey` (Task 6).
- Produces: `StrengthReplacementRequest.originalRef?: ExerciseLibraryRef`.

**Por qué `deriveStrengthProgressionState` no está cubierto por `extractRecentStrengthExercises`:** el primero calcula frecuencia por patrón, `mainPattern`, `lastExerciseId` e intención de progresión; el segundo solo produce claves de recencia. Además hace `if (!definition) return`, así que un nombre no resuelto se salta en silencio y degrada la progresión.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/training/__tests__/strengthSelectorLibraryRef.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { Session } from '../../../types'
import {
  deriveStrengthProgressionState,
  extractRecentStrengthExercises,
  selectStrengthReplacement,
} from '../strengthSelector'

const refTo = (id: string) => ({ source: 'strength_exercise' as const, id })

function sessionWith(name: string, libraryRef?: { source: 'strength_exercise'; id: string }): Session {
  return {
    id: 's1',
    date: '2026-07-30',
    timeBlock: 'AM',
    type: 'strength',
    status: 'completed',
    title: 'Fuerza',
    durationMin: 60,
    exercises: [{ id: 'e1', name, sets: 4, reps: 5, completed: true, libraryRef }],
  } as unknown as Session
}

describe('consumidores del selector con libraryRef', () => {
  it('el historial reciente usa el ref cuando el nombre no resuelve', () => {
    const keys = extractRecentStrengthExercises([
      sessionWith('Nombre libre irreconocible', refTo('back_squat')),
    ])
    expect(keys).toContain('back_squat')
  })

  it('la progresión cuenta el patrón usando el ref', () => {
    const state = deriveStrengthProgressionState({
      phase: 'build',
      historicalSessions: [sessionWith('Nombre libre irreconocible', refTo('back_squat'))],
    } as never)

    expect(state.patterns.squat?.lastExerciseId).toBe('back_squat')
    expect(state.mainPattern).toBe('squat')
  })

  it('el reemplazo identifica el original por ref', () => {
    const replacement = selectStrengthReplacement({
      originalName: 'Nombre libre irreconocible',
      originalRef: refTo('back_squat'),
      context: { phase: 'build', availableEquipment: ['barbell'] } as never,
      excludedKeys: new Set<string>(),
      rotationIndex: 0,
      exerciseIndex: 1,
    })

    expect(replacement).toBeDefined()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorLibraryRef.test.ts`
Expected: FAIL — los tres casos; `originalRef` además no existe en el tipo.

- [ ] **Step 3: Migrar `extractRecentStrengthExercises`**

Reemplazar el `flatMap` final (`strengthSelector.ts:442-446`):

```ts
  return strengthSessions.flatMap((session) =>
    (session.exercises ?? []).map((exercise) => getStrengthExerciseKey(exercise)),
  )
```

Importar `getStrengthExerciseKey` desde `'./strengthExerciseProposal'`.

- [ ] **Step 4: Migrar `deriveStrengthProgressionState`**

En `strengthSelector.ts:1029`, reemplazar:

```ts
      const definition = findStrengthExerciseByName(exercise.name)
```

por:

```ts
      const definition = resolveStrengthExercise(exercise)?.definition
```

Importar `resolveStrengthExercise` desde `'./exerciseLibrary'`.

- [ ] **Step 5: Migrar `selectStrengthReplacement`**

Ensanchar el request (`strengthSelector.ts:66`):

```ts
export interface StrengthReplacementRequest {
  originalName: string
  /**
   * Identidad del ejercicio a reemplazar. `originalName` es texto y puede no
   * resolver; el llamador casi siempre tiene el ejercicio entero, así que el
   * ref viaja aparte en vez de envolver por nombre.
   */
  originalRef?: ExerciseLibraryRef
  context: StrengthContext
  excludedKeys: ReadonlySet<string>
  rotationIndex: number
  /** La prescripción depende de la posición dentro de la sesión. */
  exerciseIndex: number
}
```

Y en el cuerpo (`:359`):

```ts
  const original = resolveStrengthExercise({
    name: request.originalName,
    libraryRef: request.originalRef,
  })?.definition
  if (!original) return undefined
```

- [ ] **Step 6: Llevar el ref hasta el llamador real de la rotación**

El único llamador productivo es `repairWeek.ts`, y hoy **descarta la identidad
antes de llegar**: `StrengthRotationSlot` (`repairWeek.ts:1532`) guarda solo
`currentName: string`. Sin un campo nuevo, `originalRef` no tiene de dónde
salir y Task 7 queda decorativa.

Ensanchar el slot:

```ts
interface StrengthRotationSlot {
  session: CoachSessionProposal
  sessionOrdinal: number
  position: number
  currentName: string
  /** Identidad del ejercicio a rotar. `currentName` es copy y puede no resolver. */
  currentRef?: ExerciseLibraryRef
  reason?: StrengthSubstitutionReason
}
```

Poblarlo donde se construye el slot (buscar con `grep -n "currentName:" src/services/planBuilder/repairWeek.ts`), agregando `currentRef: exercise.libraryRef` junto a `currentName: exercise.name`.

Y pasarlo en la llamada (`repairWeek.ts:~1600`):

```ts
    const replacement = selectStrengthReplacement({
      originalName: slot.currentName,
      originalRef: slot.currentRef,
      // …resto sin cambios
    })
```

- [ ] **Step 7: Migrar las claves de rotación de `repairWeek`**

Cuatro sitios usan `normalizeStrengthExerciseKey(...)` directo sobre el nombre y
tienen que pasar a `getStrengthExerciseKey`, o van a comparar nombres
normalizados contra los ids ref-first que producen `strengthRoleContract` y
Task 6 — y una colisión que no se detecta es una semana que repite ejercicio sin
que nada falle:

| Línea | Hoy | Pasa a |
|---|---|---|
| `repairWeek.ts:1578` | `normalizeStrengthExerciseKey(exercise.name)` | `getStrengthExerciseKey(exercise)` |
| `repairWeek.ts:1607` | `normalizeStrengthExerciseKey(replacement?.name ?? slot.currentName)` | `getStrengthExerciseKey(replacement ?? { name: slot.currentName, libraryRef: slot.currentRef })` |
| `repairWeek.ts:1615` | compara `normalizeStrengthExerciseKey` de ambos lados | `getStrengthExerciseKey(replacement) === getStrengthExerciseKey({ name: slot.currentName, libraryRef: slot.currentRef })` |
| `repairWeek.ts:1653` | `.map((exercise) => normalizeStrengthExerciseKey(exercise.name))` | `.map(getStrengthExerciseKey)` |

Después de migrarlos, verificar que no quedó ningún uso suelto:

Run: `grep -n "normalizeStrengthExerciseKey" src/services/planBuilder/repairWeek.ts src/services/planBuilder/strengthRoleContract.ts`
Expected: sin resultados fuera de imports; si queda un import sin usar, borrarlo.

- [ ] **Step 8: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorLibraryRef.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 9: Verificar la suite**

Run: `npx tsc -b && npx vitest run src/services/`
Expected: verde. La rotación de fuerza tiene cobertura propia en
`src/services/planBuilder/__tests__/` — si algo ahí se pone rojo, es señal de
que una clave quedó a medio migrar, no de que el test esté mal.

- [ ] **Step 10: Commit (ofrecer al owner)**

```bash
git add src/services/training/strengthSelector.ts src/services/planBuilder/repairWeek.ts src/services/planBuilder/strengthRoleContract.ts src/services/training/__tests__/strengthSelectorLibraryRef.test.ts
git commit -m "feat(strength): carry libraryRef through rotation identity and replacement"
```

---

### Task 8: Consumidores de plan builder y coach

**Files:**
- Modify: `src/services/planBuilder/strengthRoleContract.ts:25-32`
- Modify: `src/services/planBuilder/qualityReview.ts:635`
- Modify: `src/services/ai/actionPostProcessor.ts:754`
- Modify: `src/services/training/strengthSessionStructure.ts:103` (`isGenericFootworkBlock`), `:420` (`isFoundationCore`)
- Test: `src/services/planBuilder/__tests__/strengthRoleContractLibraryRef.test.ts` (crear); `src/services/__tests__/qualityReview.test.ts`

**Interfaces:**
- Consumes: `resolveStrengthExercise` de Task 1.
- Produces: `resolveSessionStrengthRoles(exercises: ReadonlyArray<{ name: string; libraryRef?: ExerciseLibraryRef }>): StrengthContractRole[]`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/strengthRoleContractLibraryRef.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { resolveSessionStrengthRoles } from '../strengthRoleContract'

describe('roles de fuerza resueltos por libraryRef', () => {
  it('un nombre que no resuelve deja de ser unknown si trae ref', () => {
    const roles = resolveSessionStrengthRoles([
      { name: 'Nombre libre irreconocible', libraryRef: { source: 'strength_exercise', id: 'back_squat' } },
    ])

    expect(roles[0]).not.toBe('unknown')
  })

  it('sin ref y sin nombre resoluble sigue siendo unknown', () => {
    expect(resolveSessionStrengthRoles([{ name: 'Nombre libre irreconocible' }])[0]).toBe('unknown')
  })
})
```

Agregar a `src/services/__tests__/qualityReview.test.ts`, dentro de `describe('reviewPlanQuality')` y reutilizando los helpers `makePlan`, `makeWeek`, `strength`, `squash`, `running` y `completeStrengthProfile` que ya existen en ese archivo:

```ts
  it('cuenta la cobertura de 1RM cuando el ejercicio se identifica por libraryRef', () => {
    const plan = { ...makePlan(), totalWeeks: 4 }
    const week = makeWeek([
      squash('2026-05-04', 'Squash técnico'),
      squash('2026-05-05', 'Squash control'),
      squash('2026-05-06', 'Squash juego'),
      running('2026-05-07'),
      strength('2026-05-08', [
        {
          // El nombre no resuelve; el ref sí lo identifica como `back_squat`,
          // cuyo `loadReference` es squat ×1 y entra al rango de cobertura.
          name: 'Movimiento principal de tren inferior',
          sets: 4,
          reps: 5,
          group: 'legs',
          targetPercent1RM: 80,
          libraryRef: { source: 'strength_exercise', id: 'back_squat' },
        },
        { name: 'Dead bug', sets: 3, reps: 8, group: 'core' },
      ]),
    ])

    // Firma real: `reviewPlanQuality(plan, weeks, context)` con `context.profile`,
    // y devuelve un objeto `PlanQualityReview` — `.issues` es el array.
    const review = reviewPlanQuality(plan, [week], { profile: completeStrengthProfile })
    const coverage = review.issues.filter((issue) => issue.code === 'quality.strength.profile_1rm_underused')

    // La aserción no puede ser "no hay issue": el perfil tiene 4 lifts y esta
    // semana cubre uno solo, así que el issue existe igual. Lo que se prueba es
    // que `squat` **salió** de la lista de faltantes gracias al ref.
    expect(coverage).toHaveLength(1)
    expect(coverage[0]!.message).not.toContain('sentadilla')
  })
```

Antes de correrlo, confirmar el `code` exacto y la forma del mensaje mirando el test vecino `'flags underuse of a complete 1RM profile on multi-week plans'` (`qualityReview.test.ts:145`) y `NUMERIC_REFERENCE_LABELS` en `qualityReview.ts:593`. Si el código real difiere, usar el del vecino — no inventarlo.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthRoleContractLibraryRef.test.ts src/services/__tests__/qualityReview.test.ts`
Expected: FAIL — el ref se ignora.

- [ ] **Step 3: Migrar los cinco consumidores**

`strengthRoleContract.ts:45` — el tipo de entrada compartido gana el campo, si no las claves no pueden verlo:

```ts
  exercises?: ReadonlyArray<{ name: string; libraryRef?: ExerciseLibraryRef }>
```

`strengthRoleContract.ts:49` y `:63` — `collectCountableKeys` y `collectAllStrengthKeys` pasan a `getStrengthExerciseKey`:

```ts
      const key = getStrengthExerciseKey(exercise)
```

**Esto no es opcional.** Estas claves se comparan contra las de `repairWeek`. Si un lado produce `back_squat` (ref-first) y el otro `sentadilla_trasera_con_barra` (nombre normalizado), las colisiones y exclusiones de rotación dejan de detectarse y la semana repite ejercicios sin que nada falle.

`strengthRoleContract.ts:25`:

```ts
export function resolveSessionStrengthRoles(
  exercises: ReadonlyArray<{ name: string; libraryRef?: ExerciseLibraryRef }>,
): StrengthContractRole[] {
  let mainLiftTaken = false

  return exercises.map((exercise) => {
    const definition = resolveStrengthExercise(exercise)?.definition
    if (!definition) return 'unknown'
    // …resto sin cambios
```

`qualityReview.ts:635`:

```ts
      const reference = resolveStrengthExercise(exercise)?.definition?.loadReference
```

`actionPostProcessor.ts:754`:

```ts
      : action.newType === 'strength' || action.exercises.some((exercise) => resolveStrengthExercise(exercise)?.definition)
```

`strengthSessionStructure.ts:103` (`isGenericFootworkBlock`) — la firma ya recibe el ejercicio entero:

```ts
function isGenericFootworkBlock(exercise: StrengthExerciseLike): boolean {
  // Un ref vivo identifica el ejercicio: no es un bloque genérico y no se
  // expande. Un ref muerto o ajeno no identifica nada, así que el bloque sigue
  // siendo genérico y la expansión le da a cada escalera su propio ref.
  if (resolveStrengthExercise(exercise)?.definition) return false
```

Agregar el test de la otra mitad de esa política a `src/services/training/__tests__/strengthLibraryRefStamping.test.ts`:

```ts
  it('un ref vivo evita la expansión de footwork', () => {
    const result = normalizeStrengthSessionExercises([
      {
        name: 'Escalera de agilidad',
        sets: 1,
        reps: '4 min',
        libraryRef: { source: 'strength_exercise', id: 'ladder_bipodal_front_1' },
      } as CoachExerciseProposal,
    ], { durationMin: 30 })!

    expect(result.filter((exercise) => exercise.name === 'Escalera de agilidad')).toHaveLength(1)
    expect(result.some((exercise) => exercise.name.startsWith('Escalera frontal'))).toBe(false)
  })
```

`strengthSessionStructure.ts:420` (`isFoundationCore`):

```ts
function isFoundationCore(exercise: StrengthExerciseLike): boolean {
  const definition = resolveStrengthExercise(exercise)?.definition
```

Agregar el import de `resolveStrengthExercise` en los tres archivos que no lo tengan, y el de `ExerciseLibraryRef` en `strengthRoleContract.ts`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/planBuilder/ src/services/__tests__/qualityReview.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificar la suite**

Run: `npx tsc -b && npx vitest run src/services/`
Expected: verde.

- [ ] **Step 6: Commit (ofrecer al owner)**

```bash
git add src/services/planBuilder/strengthRoleContract.ts src/services/planBuilder/qualityReview.ts src/services/ai/actionPostProcessor.ts src/services/training/strengthSessionStructure.ts src/services/planBuilder/__tests__/strengthRoleContractLibraryRef.test.ts src/services/__tests__/qualityReview.test.ts
git commit -m "feat(strength): make roles, quality coverage and coach detection ref-aware"
```

---

### Task 9: Fronteras de import y normalizador

**Files:**
- Modify: `src/services/dataExport.ts:1466-1485` (`optionalCoachExercises`)
- Modify: `src/services/__tests__/dataExportLibraryRef.test.ts` — **ya existe** (2026-07-19, cubre sesiones). Agregarle casos, no reescribirlo
- Modify: `src/services/__tests__/responseNormalizer.test.ts`

**Interfaces:**
- Consumes: `sanitizeExerciseLibraryRef` de `src/types/exerciseLibraryRef.ts`.
- Produces: nada nuevo.

**Por qué el import de propuestas sí lo preserva:** una propuesta `pending` puede exportarse, importarse y aceptarse después. La aceptación usa directamente `action.exercises` y no puede reconstruir un ref eliminado durante el import.

**Por qué el normalizador no:** `validateExerciseProposal` es un allowlist campo por campo, así que un ref emitido por el modelo ya se cae solo. Eso hay que congelarlo, porque ahora que el campo existe en el tipo, agregarlo parece un olvido en vez de una decisión.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `src/services/__tests__/dataExportLibraryRef.test.ts`, **dentro del `describe` existente**. El archivo ya tiene `backupFixture` y `sessionRow`; reutilizar el envelope de ahí, que trae `app`, `version`, `exportedAt` como ISO string y `exportedFromAppVersion` — un fixture sin esos campos falla en `normalizeBackupEnvelope` antes de llegar al ejercicio:

```ts
  function backupWithProposalExercise(libraryRef: unknown) {
    const fixture = backupFixture([])
    return {
      ...fixture,
      tables: {
        ...fixture.tables,
        coachProposals: [{
          id: 'p1',
          message: 'm',
          status: 'pending',
          createdAt: 1,
          actions: [{
            type: 'add_session',
            reason: 'r',
            exercises: [{ name: 'Press banca', sets: 3, reps: 5, libraryRef }],
          }],
        }],
      },
    }
  }

  it('preserva un ref válido en el import de propuestas', () => {
    const parsed = parseAppDataExport(backupWithProposalExercise(validRef))
    expect(parsed.tables.coachProposals[0]!.actions[0]!.exercises![0]!.libraryRef).toEqual(validRef)
  })

  it('descarta un ref malformado de una propuesta sin invalidar el ejercicio', () => {
    const parsed = parseAppDataExport(backupWithProposalExercise({ source: 'inventado', id: 42 }))
    const exercise = parsed.tables.coachProposals[0]!.actions[0]!.exercises![0]!
    expect(exercise.libraryRef).toBeUndefined()
    expect(exercise.name).toBe('Press banca')
  })
```

Y en `src/services/__tests__/responseNormalizer.test.ts`, dentro del `describe` de nivel superior. La API real es `normalizeResponse(raw: AIRawResponse)` (`responseNormalizer.ts:152`) — **no** existe `normalizeCoachResponse`, y no recibe un string. Copiar la forma exacta de construcción de `AIRawResponse` del primer test del archivo que normalice `actions[].exercises`:

```ts
  it('descarta un libraryRef emitido por el modelo', () => {
    const raw = {
      message: 'Te propongo esto',
      actions: [{
        type: 'add_session',
        reason: 'fuerza',
        sessionType: 'strength',
        targetDate: '2026-05-08',
        durationMin: 50,
        exercises: [{
          name: 'Press banca',
          sets: 3,
          reps: 5,
          // El modelo no es fuente de identidad: solo el código determinista
          // estampa refs. Un ref inventado acá elegiría la definición sobre la
          // que se prescribe carga, con la autoridad máxima del tier `ref`.
          libraryRef: { source: 'strength_exercise', id: 'back_squat' },
        }],
      }],
    }

    const normalized = normalizeResponse({ ...baseRawResponse, ...raw } as AIRawResponse)
    const exercise = normalized.actions?.[0]?.exercises?.[0] as Record<string, unknown> | undefined
    expect(exercise?.name).toBe('Press banca')
    expect(exercise?.libraryRef).toBeUndefined()
  })
```

`baseRawResponse` es el objeto mínimo que ya usan los otros tests del archivo; si no existe con ese nombre, copiar literalmente el objeto que construye el test vecino.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/services/__tests__/dataExportLibraryRef.test.ts src/services/__tests__/responseNormalizer.test.ts`
Expected: FAIL en `'preserva un ref válido en el import de propuestas'` (`libraryRef` es `undefined`). Los otros dos **pasan ya**: el allowlist descarta el ref malformado y el del modelo por construcción. Eso es correcto — esos dos tests no son rojo-a-verde, son candado sobre una propiedad que hoy se cumple sola y que dejaría de cumplirse si alguien agrega la línea al normalizador.

- [ ] **Step 3: Agregar la línea al import de propuestas**

En `src/services/dataExport.ts:1466`, dentro del objeto que arma `optionalCoachExercises`:

```ts
      warmupSets: optionalWarmupSets(row.warmupSets, `${path}[${index}].warmupSets`),
      libraryRef: sanitizeExerciseLibraryRef(row.libraryRef),
```

`sanitizeExerciseLibraryRef` ya está importado en el archivo (línea 30).

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/__tests__/dataExportLibraryRef.test.ts src/services/__tests__/responseNormalizer.test.ts`
Expected: PASS en ambos archivos.

- [ ] **Step 5: Commit (ofrecer al owner)**

```bash
git add src/services/dataExport.ts src/services/__tests__/dataExportLibraryRef.test.ts src/services/__tests__/responseNormalizer.test.ts
git commit -m "feat(backup): preserve sanitized libraryRef on imported proposals"
```

---

### Task 10: Barrido pareado y cierre

**Files:**
- Create: scratchpad (no se commitea)
- Modify: `docs/superpowers/specs/2026-08-01-strength-library-ref-first-design.md` (solo si el barrido encuentra una diferencia)
- Modify: `CLAUDE.md`, `PROJECT_REVIEW_AND_ROADMAP.md` (conteo verificado y entrada del bloque)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: veredicto de aceptación.

- [ ] **Step 1: Preparar el worktree de base**

**No usar `git stash`.** Un `stash push` que falla —por ejemplo si se corre desde fuera del repo— deja un `stash pop` posterior aplicando un stash ajeno preexistente.

```bash
SP="$(mktemp -d)"
echo "scratch: $SP"   # anotarlo: hace falta en los pasos siguientes
git worktree add -q --detach "$SP/base" 3d480b3
ln -sfn "$(pwd)/node_modules" "$SP/base/node_modules"
```

- [ ] **Step 2: Escribir el barrido**

Crear `$SP/sweep.ts` (copiar también a `$SP/base/sweep.ts` y a `./.tmp-sweep.ts`):

```ts
import { STRENGTH_EXERCISE_LIBRARY } from './src/services/training/exerciseLibrary'
import { enhanceStrengthSessionExercises } from './src/services/training/strengthSessionStructure'

const profile = { squat1RM: 140, deadlift1RM: 180, benchPress1RM: 110, overheadPress1RM: 80, pullUpMaxReps: 12 } as never
const tpl = ['%s', '%s pesado', 'Serie de %s', '%s con barra', '%s con mancuernas',
             'Calentamiento con %s', 'Estiramiento de %s', '%s a una pierna',
             'Circuito: %s', '%s progresiva', '%s ligero']
const names = STRENGTH_EXERCISE_LIBRARY.flatMap((e) => tpl.map((t) => t.replace('%s', e.name.toLowerCase())))

for (const reps of [3, 8, 12] as const) {
  for (const name of names) {
    const out = enhanceStrengthSessionExercises(
      [{ name, sets: 3, reps } as never],
      { durationMin: 30, strengthProfile: profile },
    ) ?? []
    const hit = out.find((e) => e.name === name)
    // Solo campos de prescripción y clasificación. `libraryRef` va aparte:
    // su presencia es la única diferencia esperada y no cuenta como cambio.
    console.log(JSON.stringify([reps, name, hit
      ? { r: hit.reps, w: hit.weight ?? null, p: hit.targetPercent1RM ?? null,
          rpe: hit.targetRpe ?? null, g: hit.group, ws: hit.warmupSets?.length ?? 0 }
      : 'DROPPED']))
  }
}
```

- [ ] **Step 3: Cubrir las dos ramas del selector**

`selectStrengthSession` se bifurca en `strengthSelector.ts:107`. La rama normal usa `buildSelectionExercise`; `selectBlockStrengthSession` usa `buildPrescribedExercise`, que **sí** asigna `targetPercent1RM`/`targetRpe`, y se activa cuando hay `weekIndexInBlock`, `rpeAdjustment` o `available1RM` no vacío.

Un barrido que solo ejercite la rama normal **no vería** la diferencia que Task 5 pudo introducir. Crear `$SP/sweep-selector.ts` (copiar también a `$SP/base/sweep-selector.ts` y a `./.tmp-sweep-selector.ts`):

```ts
import { selectStrengthSession } from './src/services/training/strengthSelector'

const PROFILE = { squat1RM: 140, deadlift1RM: 180, benchPress1RM: 110, overheadPress1RM: 80 }

const BASE = {
  durationMin: 55,
  fatigueLevel: 4,
  experienceLevel: 'intermediate',
  availableEquipment: ['barbell', 'dumbbell', 'bodyweight', 'kettlebell'],
  primarySport: 'squash',
  strengthProfile: PROFILE,
}

// Rama normal vs rama de plantilla de bloque. `shouldUseBlockTemplateSelection`
// se activa con weekIndexInBlock, rpeAdjustment o available1RM no vacío.
const CASES = [
  ['plain', {}],
  ['block-1rm', { available1RM: ['squat', 'deadlift', 'benchPress', 'overheadPress'] }],
  ['block-week', { weekIndexInBlock: 1, available1RM: ['squat', 'deadlift'] }],
  ['block-rpe', { rpeAdjustment: -1, available1RM: ['squat'] }],
] as const

for (const phase of ['base', 'build', 'peak', 'taper'] as const) {
  for (const [label, extra] of CASES) {
    const selection = selectStrengthSession({ ...BASE, phase, ...extra } as never)
    for (const exercise of selection.exercises) {
      console.log(JSON.stringify([phase, label, {
        n: exercise.name,
        s: exercise.sets,
        r: exercise.reps,
        p: exercise.targetPercent1RM ?? null,
        rpe: exercise.targetRpe ?? null,
        g: exercise.group ?? null,
      }]))
    }
  }
}
```

Nota: el script **no** serializa `libraryRef`. En la base ese campo no existe, así que incluirlo haría que las 4 × 4 corridas difieran por el campo nuevo y taparía cualquier diferencia real de prescripción.

- [ ] **Step 3b: Barrido que cruza conversión + enriquecimiento**

El barrido del selector **no puede detectar** lo que cambia Task 5: la
conversión a `CoachExerciseProposal` ocurre *después* de `selectStrengthSession`.
Sin este tercer script, la excepción del Step 5 se aceptaría sin evidencia.

Los dos lados no corren el mismo código a propósito: el lado base reproduce el
literal inline de `actionPostProcessor` (el que descartaba porcentaje y RPE) y
el lado nuevo usa el convertidor canónico. Esa es exactamente la diferencia que
hay que medir.

`$SP/base/sweep-convert.ts` (lado base):

```ts
import { selectStrengthSession } from './src/services/training/strengthSelector'
import { enhanceStrengthSessionExercises } from './src/services/training/strengthSessionStructure'

const PROFILE = { squat1RM: 140, deadlift1RM: 180, benchPress1RM: 110, overheadPress1RM: 80 }
const BASE = {
  durationMin: 55, fatigueLevel: 4, experienceLevel: 'intermediate',
  availableEquipment: ['barbell', 'dumbbell', 'bodyweight', 'kettlebell'],
  primarySport: 'squash', strengthProfile: PROFILE,
}
const CASES = [
  ['plain', {}],
  ['block-1rm', { available1RM: ['squat', 'deadlift', 'benchPress', 'overheadPress'] }],
  ['block-week', { weekIndexInBlock: 1, available1RM: ['squat', 'deadlift'] }],
] as const

for (const phase of ['base', 'build', 'peak', 'taper'] as const) {
  for (const [label, extra] of CASES) {
    const selection = selectStrengthSession({ ...BASE, phase, ...extra } as never)
    // Literal inline de actionPostProcessor:597 — descarta percent y rpe.
    const proposals = selection.exercises.map((exercise) => ({
      name: exercise.name, sets: exercise.sets, reps: exercise.reps,
      group: exercise.group, notes: exercise.notes,
    }))
    const enhanced = enhanceStrengthSessionExercises(proposals as never, {
      durationMin: 55, strengthProfile: PROFILE as never,
    }) ?? []
    for (const e of enhanced) {
      console.log(JSON.stringify([phase, label, {
        n: e.name, s: e.sets, r: e.reps, w: e.weight ?? null,
        p: e.targetPercent1RM ?? null, rpe: e.targetRpe ?? null,
        g: e.group ?? null, ws: e.warmupSets?.length ?? 0,
      }]))
    }
  }
}
```

`./.tmp-sweep-convert.ts` (lado nuevo): **idéntico**, salvo que reemplaza el
literal inline por la proyección canónica pre-enrichment:

```ts
import { toStrengthProposalForEnhancement } from './src/services/training/strengthExerciseProposal'
// …
    const proposals = selection.exercises.map(toStrengthProposalForEnhancement)
```

- [ ] **Step 3c: Cohorte de entrada con `libraryRef`**

El spec pide verificar que el tier nuevo produce lo mismo que resolver por
nombre canónico. Eso **no** es un diff contra la base —el campo no existe allá—
sino una invariante dentro del árbol nuevo. Crear `./.tmp-sweep-refcohort.ts`:

```ts
import { STRENGTH_EXERCISE_LIBRARY } from './src/services/training/exerciseLibrary'
import { enhanceStrengthSessionExercises } from './src/services/training/strengthSessionStructure'

const profile = { squat1RM: 140, deadlift1RM: 180, benchPress1RM: 110, overheadPress1RM: 80 } as never
const shape = (e: Record<string, unknown> | undefined) => JSON.stringify(e && {
  r: e.reps, w: e.weight ?? null, p: e.targetPercent1RM ?? null,
  rpe: e.targetRpe ?? null, g: e.group, ws: (e.warmupSets as unknown[] | undefined)?.length ?? 0,
})

let mismatches = 0
for (const reps of [3, 8, 12] as const) {
  for (const definition of STRENGTH_EXERCISE_LIBRARY) {
    const byName = enhanceStrengthSessionExercises(
      [{ name: definition.name, sets: 3, reps } as never],
      { durationMin: 30, strengthProfile: profile },
    )?.find((e) => e.name === definition.name)

    const byRef = enhanceStrengthSessionExercises(
      [{ name: definition.name, sets: 3, reps,
         libraryRef: { source: 'strength_exercise', id: definition.id } } as never],
      { durationMin: 30, strengthProfile: profile },
    )?.find((e) => e.name === definition.name)

    if (shape(byName as never) !== shape(byRef as never)) {
      mismatches++
      console.log('MISMATCH', definition.id, reps, shape(byName as never), '->', shape(byRef as never))
    }
  }
}
console.log('mismatches:', mismatches)
```

Expected: `mismatches: 0`. Un mismatch significa que el tier `ref` y el tier
`exact` no coinciden sobre el mismo ejercicio, que es una contradicción del §3.

- [ ] **Step 4: Correr los tres barridos y comparar**

```bash
(cd "$SP/base" && npx vite-node sweep.ts) > "$SP/base.txt" 2>&1
npx vite-node ./.tmp-sweep.ts > "$SP/new.txt" 2>&1
diff "$SP/base.txt" "$SP/new.txt" | head -50
diff "$SP/base.txt" "$SP/new.txt" | grep -c '^<'
```

Repetir con `sweep-selector.ts` y con `sweep-convert.ts`. Correr además
`npx vite-node ./.tmp-sweep-refcohort.ts` y confirmar `mismatches: 0`.

Expected: **0 líneas de diferencia** en ambos. Si aparecen, clasificarlas por tipo (`load-lost`, `percent-gained`, `group:x->y`, `rpe-gained`) antes de tocar nada.

- [ ] **Step 5: Resolver el resultado**

- **Cero diferencias:** el criterio del §9 se cumple tal como está escrito. No tocar el spec.
- **Cualquier diferencia:** es una regresión. Clasificarla y arreglarla; la
  proyección pre-enrichment existe precisamente para mantener el gate en cero.

- [ ] **Step 6: Limpiar el worktree**

```bash
rm -f ./.tmp-sweep.ts ./.tmp-sweep-selector.ts ./.tmp-sweep-convert.ts ./.tmp-sweep-refcohort.ts
git worktree remove --force "$SP/base"
git worktree prune
rm -rf "$SP"
git status --short   # debe listar solo los archivos del bloque
```

- [ ] **Step 7: Verificación completa**

```bash
npx tsc -b && npm run lint && npm test && npm run build && git diff --check
```

Expected: tsc y `git diff --check` sin salida; lint limpio; suite en verde; build OK. Anotar el conteo de tests.

- [ ] **Step 8: Actualizar el estado del proyecto**

En `CLAUDE.md` (bloques recientes) y `PROJECT_REVIEW_AND_ROADMAP.md` (§ nueva), agregar la entrada del bloque: qué hace, que no tiene migraciones, el conteo de tests verificado, y **la limitación central** — el contenido creado antes de esta entrega queda sin ref, así que el renombre de la entrega de copy sigue dependiendo de `aliases`, igual que en squash.

- [ ] **Step 9: Commit (ofrecer al owner)**

```bash
git add CLAUDE.md PROJECT_REVIEW_AND_ROADMAP.md \
  docs/superpowers/specs/2026-08-01-strength-library-ref-first-design.md \
  docs/superpowers/plans/2026-08-01-strength-library-ref-first.md
git commit -m "docs(strength): record libraryRef-first delivery and its measured scope"
```

---

## Notas de ejecución

**Orden.** Task 1 antes que todo. Task 2 es independiente y puede ir en cualquier momento. Tasks 3–9 dependen de 1; 5 y 6 dependen de 4; 7 depende de 6. Task 10 va última.

**El punto donde el ref puede hacer daño.** Task 4, Step 6: si la expansión de footwork hereda el `libraryRef` del bloque genérico en vez de reemplazarlo, las tres escaleras quedan apuntando a otro ejercicio y el tier `ref` prescribe sobre la definición equivocada con autoridad máxima. Es el único lugar del diseño donde un ref hace algo peor que faltar.

**Lo que este bloque no resuelve.** El contenido ya guardado —historial, plantillas, planes vivos— no tiene ref y sigue resolviendo por nombre. `libraryRef`-first hace que la deuda deje de crecer; no cura la existente. La entrega de copy que viene después hereda la obligación de agregar cada nombre viejo a `aliases`.
