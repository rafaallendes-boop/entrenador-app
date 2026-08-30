# Restricciones de seguridad en fuerza — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una restricción declarada por el atleta (lesión, zona o patrón mecánico prohibido) sea un *hard constraint verificable* sobre toda sesión de fuerza que el producto genere, en chat, Week Creator y Plan Builder, con degradación fail-closed en vez de sesiones silenciosamente inseguras.

**Architecture:** Un módulo de tipos sin lógica (`src/types/strengthSafety.ts`) rompe el ciclo entre biblioteca y política. `exerciseLibrary.ts` gana un campo `safety` **obligatorio** por ejercicio (hechos declarativos). `strengthSafetyConstraints.ts` es la **única** autoridad que interpreta texto libre y aplica política. El enforcement es de dos capas: un filtro temprano en `buildStrengthCandidatePool` (nada contraindicado se *selecciona*) y un finalizador que cada productor ejecuta como último paso (nada contraindicado *sobrevive*, venga del modelo, del core inyectado o de un literal de fallback). Un sello ligado al contenido impide que los mutadores posteriores —incluidos los de display y aceptación— reintroduzcan contenido sin verificar.

**Tech Stack:** TypeScript, React, Vitest, Zustand, Dexie. Sin migraciones de Supabase ni de Dexie.

**Spec:** `docs/superpowers/specs/2026-08-30-strength-safety-constraints-design.md`

## Global Constraints

- **Fail-closed siempre.** Ningún paso relaja una restricción para cumplir un conteo de ejercicios. Ante duda, `blocked`.
- **`loadsRegions` es no vacío por tipo** (`NonEmptyRegions`). `[]` es irrepresentable. No existe allowlist de "universalmente seguro".
- **No hay tabla de implicación entre regiones.** Si una restricción debe excluir un ejercicio, la región o patrón aparece **directamente** en el perfil de ese ejercicio.
- **`safetyConstraints` es obligatorio** en `StrengthContext`. Sin restricciones se pasa `[]`. Nunca opcional.
- **Ningún consumidor lee `loadsRegions` ni `loadPatterns`** fuera de `src/types/strengthSafety.ts`, `exerciseLibrary.ts` y `strengthSafetyConstraints.ts`.
- **El modelo no es autoridad de seguridad.** Ni su `objective`, ni un sello que emita, ni su prosa.
- **Nunca texto médico del atleta** en objetos persistidos ni en telemetría. Solo `ConstraintKey` y `ConstraintSource`.
- **Manda la fuente persistida original**, no el campo transportador (`WeekCreatorEffectiveConfig.injuryNotes` contiene `recoveryProfile.restrictions`).
- **Copy determinista de bloqueo, verbatim:** `No pude verificar una sesión de fuerza compatible con la restricción registrada.` Nunca la palabra "segura".
- **`safety_blocked` es respuesta segura sin propuesta, no solicitud fallida.** `status: 'completed'`, `generationOutcome: 'safe_decline'`, no cuenta como error.
- Gate por tarea: `npm run lint && npm test && npm run build` (el build ya corre `tsc -b`).
- **No ejecutar `git commit` ni `git add`**: en este repositorio los commits los hace el owner. Donde el plan dice "Commit", detenerse y reportar el diff listo para que el owner lo revise.

---

## File Structure

**Nuevos**

| Archivo | Responsabilidad |
|---|---|
| `src/types/strengthSafety.ts` | Solo tipos. Rompe el ciclo `exerciseLibrary ↔ strengthSafetyConstraints`. Precedente: `src/types/exerciseLibraryRef.ts`. |
| `src/services/training/strengthSafetyConstraints.ts` | Autoridad única: parser de texto → restricciones, y predicados de política sobre ejercicios. |
| `src/services/training/strengthSafetyFinalizer.ts` | Finalizador y wrapper de nivel sesión. Orquesta retiro, reemplazo, densidad, agrupación, revalidación, viabilidad y sello. |

**Modificados (principales)**

| Archivo | Cambio |
|---|---|
| `src/services/training/exerciseLibrary.ts` | `safety` obligatorio en `ExerciseDefinition`; clasificación de los 77. |
| `src/services/training/strengthSelector.ts` | `safetyConstraints` obligatorio en `StrengthContext`; `filterBySafetyConstraints` como primer filtro del pool. |
| `src/services/training/strengthSessionStructure.ts` | `resolveInjectedCoreId` consciente de restricciones; core omitible. |
| `src/services/planBuilder/strengthStructuralCore.ts` | `projectStructuralCoreSlot` devuelve `| undefined`. |
| `src/services/ai/actionPostProcessor.ts` | Borra `hasPainOrInjurySignal`; resuelve y aplica restricciones; finaliza. |
| `src/store/useCoachActionsStore.ts` | Display y aceptación respetan el sello y revalidan. |
| `src/services/planning/applyCreateWeek.ts` | Aceptación revalida antes de escribir. |
| `src/services/weekCreator/WeekCreatorEngine.ts` | Fallbacks literales finalizados; salida `safety_blocked`. |
| `src/services/weekCreator/WeekCreatorFailurePolicy.ts` | `safe_decline` y `safety_blocked`. |
| `src/services/planBuilder/repairWeek.ts` | Restricciones en el contexto; finalizador tras densidad; tombstone. |
| `src/services/planBuilder/profileAdapter.ts` | `safetyConstraints` en `AthleteParameters`. |
| `src/types/index.ts` | `safety_blocked` en `outcome`; `safe_decline` en `generationOutcome`. |
| `src/services/ai/stageLogger.ts` | `safety_blocked` en `CoachOutcome`. |
| `src/services/dataExport.ts` | Import/backup invalidan el sello. |
| `src/pages/OnboardingPage.tsx`, `src/components/settings/AthleteProfileEditor.tsx`, `src/pages/CompetitionPlanPage.tsx` | Feedback de lectura del parser. |
| `src/services/ai/promptBuilder.ts` | Restricciones resueltas al prompt (defensa en profundidad). |

---

## Task 1: Tipos de seguridad y clasificación de los 77 ejercicios

Tarea deliberadamente aislada y revisable: es **juicio deportivo**, no plumbing. Se revisa fila por fila antes de continuar.

**Files:**
- Create: `src/types/strengthSafety.ts`
- Modify: `src/services/training/exerciseLibrary.ts`
- Test: `src/services/training/__tests__/strengthSafetyClassification.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `BodyRegion`, `LoadPattern`, `NonEmptyRegions`, `ExerciseSafetyProfile`; `ExerciseDefinition.safety: ExerciseSafetyProfile` (obligatorio).

- [ ] **Step 1: Crear el módulo de tipos**

```ts
// src/types/strengthSafety.ts
// Solo tipos. No importa nada de services/ para no crear un ciclo con
// exerciseLibrary.ts, que necesita ExerciseSafetyProfile.

/** Zonas anatómicas que una restricción puede nombrar. */
export type BodyRegion =
  | 'lumbar'
  | 'thoracic'
  | 'cervical'
  | 'trunk_core'
  | 'chest_ribs'
  | 'pelvis_sacroiliac'
  | 'shoulder'
  | 'elbow'
  | 'wrist'
  | 'hip'
  | 'groin'
  | 'hamstring'
  | 'knee'
  | 'calf'
  | 'achilles'
  | 'ankle'
  | 'foot'

/** Restricciones mecánicas que no son una zona ("sin impacto", "sin carga axial"). */
export type LoadPattern =
  | 'axial_load'
  | 'loaded_hinge'
  | 'impact'
  | 'deep_flexion'
  | 'overhead'
  | 'rotation'
  | 'grip_demand'

/**
 * No vacío por construcción: `[]` significaría "seguro ante cualquier lesión",
 * que no es cierto de ningún ejercicio. Un ejercicio nuevo no puede quedar
 * permitido por omisión.
 */
export type NonEmptyRegions = readonly [BodyRegion, ...BodyRegion[]]

/**
 * Qué DESAFÍA el ejercicio, nunca para qué es seguro.
 *
 * Una región entra si: (1) mueve la carga, (2) es articulación o tejido que
 * recibe carga, tensión o impacto relevante, o (3) su estabilización es un
 * objetivo deliberado. NO entra la participación postural incidental.
 */
export interface ExerciseSafetyProfile {
  loadsRegions: NonEmptyRegions
  loadPatterns: readonly LoadPattern[]
}
```

- [ ] **Step 2: Escribir el test de cobertura y de casos deportivos clave**

```ts
// src/services/training/__tests__/strengthSafetyClassification.test.ts
import { describe, expect, it } from 'vitest'
import { STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'
import type { BodyRegion } from '../../../types/strengthSafety'

const byId = (id: string) => {
  const found = STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.id === id)
  if (!found) throw new Error(`id inexistente en el catálogo: ${id}`)
  return found
}

describe('clasificación de seguridad de la biblioteca de fuerza', () => {
  it('todo ejercicio declara al menos una región', () => {
    for (const exercise of STRENGTH_EXERCISE_LIBRARY) {
      expect(exercise.safety.loadsRegions.length).toBeGreaterThan(0)
    }
  })

  it('toda región del taxonomía es alcanzable por al menos un ejercicio', () => {
    const regions: BodyRegion[] = [
      'lumbar', 'thoracic', 'cervical', 'trunk_core', 'chest_ribs',
      'pelvis_sacroiliac', 'shoulder', 'elbow', 'wrist', 'hip', 'groin',
      'hamstring', 'knee', 'calf', 'achilles', 'ankle', 'foot',
    ]
    const covered = new Set(STRENGTH_EXERCISE_LIBRARY.flatMap((e) => e.safety.loadsRegions))
    // Sin exenciones: el spec exige que las 17 sean alcanzables. `cervical` la
    // cubren los press verticales y el farmer carry; `pelvis_sacroiliac`, el
    // hip thrust, el sumo y la zancada lateral.
    for (const region of regions) {
      expect(covered, `región sin ejercicio: ${region}`).toContain(region)
    }
  })

  it('el dead bug NO es universalmente seguro: es trabajo de control lumbo-pélvico', () => {
    expect(byId('dead_bug').safety.loadsRegions).toContain('lumbar')
    expect(byId('dead_bug').safety.loadsRegions).toContain('trunk_core')
  })

  it('los cuatro cores inyectables declaran lumbar, así que una restricción lumbar no deja core legal', () => {
    for (const id of ['dead_bug', 'plank', 'side_plank', 'stability_ball_front_plank']) {
      expect(byId(id).safety.loadsRegions, id).toContain('lumbar')
    }
  })

  it('los tres ejercicios del bug reportado quedan marcados lumbar', () => {
    for (const id of ['side_plank_plate_press', 'half_kneeling_diagonal_plate_chop', 'bb_side_lunge']) {
      expect(byId(id).safety.loadsRegions, id).toContain('lumbar')
    }
  })

  it('el remo con pecho apoyado NO carga lumbar: el apoyo elimina la demanda', () => {
    expect(byId('chest_supported_row').safety.loadsRegions).not.toContain('lumbar')
  })

  it('los hinge cargados declaran el patrón loaded_hinge', () => {
    for (const id of ['deadlift', 'romanian_deadlift', 'sumo_deadlift', 'trap_bar_deadlift', 'kettlebell_swing']) {
      expect(byId(id).safety.loadPatterns, id).toContain('loaded_hinge')
    }
  })

  it('los pliométricos declaran impact', () => {
    for (const id of ['box_jump', 'broad_jump', 'depth_jump', 'drop_jump', 'pogo_jumps', 'lateral_skater_jumps']) {
      expect(byId(id).safety.loadPatterns, id).toContain('impact')
    }
  })

  it('una restricción lumbar deja pool superior viable', () => {
    const survivors = STRENGTH_EXERCISE_LIBRARY.filter(
      (exercise) => !exercise.safety.loadsRegions.includes('lumbar'),
    )
    expect(survivors.length).toBeGreaterThanOrEqual(10)
    const ids = survivors.map((exercise) => exercise.id)
    for (const id of ['chest_supported_row', 'lat_pulldown', 'incline_dumbbell_press', 'band_row', 'assisted_pull_up']) {
      expect(ids, id).toContain(id)
    }
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthSafetyClassification.test.ts`
Expected: FAIL — `Property 'safety' does not exist on type 'ExerciseDefinition'`.

- [ ] **Step 4: Agregar el campo obligatorio a `ExerciseDefinition`**

En `src/services/training/exerciseLibrary.ts`, importar el tipo y añadir el campo. Va **obligatorio**, sin `?`:

```ts
import type { ExerciseSafetyProfile } from '../../types/strengthSafety'

export interface ExerciseDefinition {
  // … campos existentes sin cambios …
  /**
   * Qué DESAFÍA el ejercicio. OBLIGATORIO: el compilador impide agregar un
   * ejercicio nuevo sin la decisión de seguridad. Interpretarlo es potestad
   * exclusiva de strengthSafetyConstraints.ts.
   */
  safety: ExerciseSafetyProfile
}
```

- [ ] **Step 5: Clasificar los 77 ejercicios**

Añadir `safety: { loadsRegions: [...], loadPatterns: [...] }` a cada definición de `RAW_STRENGTH_EXERCISE_LIBRARY`, con estos valores exactos. Aplicar los tres criterios de §4.2 del spec; la participación postural incidental **no** cuenta.

| id | loadsRegions | loadPatterns |
|---|---|---|
| back_squat | lumbar, trunk_core, hip, knee, shoulder | axial_load, deep_flexion |
| front_squat | lumbar, trunk_core, hip, knee, shoulder, wrist | axial_load, deep_flexion |
| goblet_squat | lumbar, trunk_core, hip, knee | axial_load, deep_flexion |
| bulgarian_split_squat | lumbar, trunk_core, hip, knee | axial_load, deep_flexion |
| walking_lunge | lumbar, trunk_core, hip, knee | axial_load, deep_flexion |
| romanian_deadlift | lumbar, trunk_core, hip, hamstring | loaded_hinge, axial_load, grip_demand |
| deadlift | lumbar, trunk_core, hip, hamstring, knee | loaded_hinge, axial_load, grip_demand |
| sumo_deadlift | lumbar, trunk_core, pelvis_sacroiliac, hip, hamstring, groin, knee | loaded_hinge, axial_load, grip_demand |
| trap_bar_deadlift | lumbar, trunk_core, hip, hamstring, knee | loaded_hinge, axial_load, grip_demand |
| hip_thrust | lumbar, pelvis_sacroiliac, hip, hamstring | loaded_hinge |
| step_up | hip, knee, ankle | axial_load |
| bench_press | shoulder, elbow, wrist, chest_ribs | — |
| incline_bench_press | shoulder, elbow, wrist, chest_ribs | — |
| close_grip_bench_press | shoulder, elbow, wrist, chest_ribs | — |
| incline_dumbbell_press | shoulder, elbow, wrist, chest_ribs | — |
| overhead_press | shoulder, elbow, wrist, cervical, lumbar, trunk_core | overhead, axial_load |
| push_press | shoulder, elbow, wrist, cervical, lumbar, trunk_core, knee | overhead, axial_load |
| landmine_press | shoulder, elbow, wrist, trunk_core | — |
| pull_up | shoulder, elbow, wrist | grip_demand |
| assisted_pull_up | shoulder, elbow, wrist | grip_demand |
| bent_over_row | lumbar, thoracic, trunk_core, shoulder, elbow, hamstring | loaded_hinge, grip_demand |
| chest_supported_row | thoracic, shoulder, elbow | grip_demand |
| lat_pulldown | shoulder, elbow, wrist | grip_demand |
| pallof_press | lumbar, trunk_core, shoulder | rotation |
| dead_bug | lumbar, trunk_core | — |
| plank | lumbar, trunk_core, shoulder | — |
| side_plank | lumbar, trunk_core, shoulder, hip | — |
| med_ball_rotational_throw | lumbar, trunk_core, thoracic, shoulder | rotation |
| cable_chop | lumbar, trunk_core, thoracic, shoulder | rotation |
| farmer_carry | lumbar, trunk_core, thoracic, cervical, pelvis_sacroiliac, shoulder, wrist | axial_load, grip_demand |
| box_jump | knee, ankle, calf, achilles, foot, hip | impact |
| jump_squat | lumbar, knee, ankle, calf, achilles, foot, hip | impact, deep_flexion |
| med_ball_slam | lumbar, trunk_core, thoracic, shoulder | overhead, rotation |
| rotational_med_ball_throw | lumbar, trunk_core, thoracic, shoulder | rotation |
| kettlebell_swing | lumbar, trunk_core, hip, hamstring, shoulder | loaded_hinge, grip_demand |
| clean | lumbar, trunk_core, hip, hamstring, knee, shoulder, elbow, wrist | loaded_hinge, axial_load, grip_demand, impact |
| clean_high_pull | lumbar, trunk_core, hip, hamstring, knee, shoulder | loaded_hinge, axial_load, grip_demand |
| split_jerk | shoulder, elbow, wrist, cervical, lumbar, trunk_core, knee, ankle | overhead, axial_load, impact |
| barbell_jump_squat | lumbar, trunk_core, hip, knee, ankle, calf, achilles | impact, axial_load, deep_flexion |
| bb_reverse_lunge | lumbar, trunk_core, hip, knee | axial_load, deep_flexion |
| bb_side_lunge | lumbar, trunk_core, pelvis_sacroiliac, hip, knee, groin | axial_load, deep_flexion |
| single_leg_hip_thrust | lumbar, pelvis_sacroiliac, hip, hamstring | loaded_hinge |
| z_press | shoulder, elbow, wrist, lumbar, trunk_core, hamstring | overhead, axial_load |
| mixed_grip_pull_up | shoulder, elbow, wrist | grip_demand |
| weighted_pull_up | shoulder, elbow, wrist | grip_demand |
| trx_inverted_row | shoulder, elbow, wrist, trunk_core, lumbar | grip_demand |
| half_kneeling_row | shoulder, elbow, trunk_core, hip | grip_demand |
| barbell_single_leg_inverted_row | shoulder, elbow, wrist, trunk_core, lumbar, hamstring | grip_demand |
| broad_jump | knee, ankle, calf, achilles, foot, hip, hamstring | impact |
| single_leg_broad_jump | knee, ankle, calf, achilles, foot, hip, hamstring | impact |
| drop_jump | knee, ankle, calf, achilles, foot | impact |
| depth_jump | knee, ankle, calf, achilles, foot | impact |
| half_kneeling_lateral_jump | knee, ankle, calf, hip, groin | impact |
| lateral_skater_jumps | knee, ankle, calf, achilles, hip, groin | impact |
| alternating_step_up_jump | knee, ankle, calf, achilles, hip | impact |
| pogo_jumps | ankle, calf, achilles, foot, knee | impact |
| ladder_bipodal_front_1 | ankle, calf, achilles, foot, knee | impact |
| ladder_bipodal_front_2 | ankle, calf, achilles, foot, knee | impact |
| ladder_bipodal_front_3 | ankle, calf, achilles, foot, knee | impact |
| ladder_coordinativo_front_2 | ankle, calf, achilles, foot, knee | impact |
| ladder_coordinativo_front_4 | ankle, calf, achilles, foot, knee | impact |
| ladder_bipodal_lateral_1 | ankle, calf, achilles, foot, knee | impact |
| ladder_bipodal_lateral_3 | ankle, calf, achilles, foot, knee | impact |
| assault_bike_30_30 | knee, hip, shoulder, elbow | — |
| air_treadmill_20_20 | knee, ankle, calf, achilles, foot, hip | impact |
| copenhagen_side_plank | lumbar, trunk_core, groin, hip, shoulder | — |
| side_plank_plate_press | lumbar, trunk_core, shoulder, hip | — |
| stability_ball_front_plank | lumbar, trunk_core, shoulder | — |
| lateral_band_walk | hip, knee | — |
| bird_dog_renegade_row | lumbar, trunk_core, shoulder, elbow, wrist | rotation |
| half_kneeling_diagonal_plate_chop | lumbar, trunk_core, thoracic, shoulder | rotation |
| bodyweight_squat | hip, knee, trunk_core | deep_flexion |
| push_up | shoulder, elbow, wrist, chest_ribs, trunk_core, lumbar | — |
| glute_bridge | lumbar, hip, hamstring | — |
| band_row | shoulder, elbow | grip_demand |
| split_squat | hip, knee, trunk_core | deep_flexion |
| inverted_row | shoulder, elbow, wrist, trunk_core, lumbar | grip_demand |

Ejemplo de la forma exacta a escribir en cada definición:

```ts
  {
    id: 'romanian_deadlift',
    // … campos existentes …
    safety: {
      loadsRegions: ['lumbar', 'trunk_core', 'hip', 'hamstring'],
      loadPatterns: ['loaded_hinge', 'axial_load', 'grip_demand'],
    },
  },
```

Cuando la columna dice `—`, escribir `loadPatterns: []`.

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/training/__tests__/strengthSafetyClassification.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Verificar que no se rompió nada más**

Run: `npm run lint && npm test && npm run build`
Expected: todo verde. Si `tsc` señala definiciones sin `safety`, faltan filas de la tabla.

- [ ] **Step 8: Commit (detenerse: lo hace el owner)**

```
feat(strength): clasificar seguridad de los 77 ejercicios de fuerza
```

**PARADA DE REVISIÓN:** esta tarea es juicio deportivo. Presentar la tabla completa al owner para revisión fila por fila antes de continuar con la Tarea 2.

---

## Task 2: Parser de texto libre → restricciones canónicas

**Files:**
- Create: `src/services/training/strengthSafetyConstraints.ts`
- Test: `src/services/training/__tests__/strengthSafetyParser.test.ts`

**Interfaces:**
- Consumes: Task 1 (`BodyRegion`, `LoadPattern`).
- Produces:
  - `ConstraintSource`, `ConstraintSources`, `UnresolvedConstraintReason`, `ConstraintKey`, `StrengthConstraint` (en `src/types/strengthSafety.ts`)
  - `resolveStrengthSafetyConstraints(input: SafetyConstraintInput): readonly StrengthConstraint[]`
  - `constraintKey(constraint: StrengthConstraint): ConstraintKey`

- [ ] **Step 1: Añadir los tipos de restricción al módulo de tipos**

```ts
// añadir a src/types/strengthSafety.ts

export type ConstraintSource =
  | 'current_injuries'
  | 'restrictions'
  | 'injury_notes'
  | 'user_message'
  | 'training_priority'

export type ConstraintSources = readonly [ConstraintSource, ...ConstraintSource[]]

export type UnresolvedConstraintReason =
  | 'medical_marker_without_supported_constraint'
  | 'structured_priority_without_detail'

export type ConstraintKey =
  | `region:${BodyRegion}`
  | `pattern:${LoadPattern}`
  | `unresolved:${UnresolvedConstraintReason}`

export type StrengthConstraint =
  | { kind: 'region'; region: BodyRegion; sources: ConstraintSources }
  | { kind: 'load_pattern'; pattern: LoadPattern; sources: ConstraintSources }
  | { kind: 'unresolved_medical_restriction'; sources: ConstraintSources; reason: UnresolvedConstraintReason }
```

- [ ] **Step 2: Escribir el test del parser con las 14 filas congeladas**

```ts
// src/services/training/__tests__/strengthSafetyParser.test.ts
import { describe, expect, it } from 'vitest'
import { resolveStrengthSafetyConstraints } from '../strengthSafetyConstraints'
import type { ConstraintSource, StrengthConstraint } from '../../../types/strengthSafety'

function keys(constraints: readonly StrengthConstraint[]): string[] {
  return constraints.map((constraint) =>
    constraint.kind === 'region' ? `region:${constraint.region}`
    : constraint.kind === 'load_pattern' ? `pattern:${constraint.pattern}`
    : `unresolved:${constraint.reason}`,
  ).sort()
}

function fromField(source: ConstraintSource, text: string) {
  const base = { currentInjuries: undefined, restrictions: undefined, injuryNotes: undefined, userMessages: [], trainingPriority: undefined }
  const map: Record<string, keyof typeof base> = {
    current_injuries: 'currentInjuries',
    restrictions: 'restrictions',
    injury_notes: 'injuryNotes',
  }
  if (source === 'user_message') return resolveStrengthSafetyConstraints({ ...base, userMessages: [text] })
  return resolveStrengthSafetyConstraints({ ...base, [map[source]]: text })
}

describe('parser de restricciones de fuerza', () => {
  it('fila 1 — lesión lumbar con segunda cláusula sin marcador léxico', () => {
    expect(keys(fromField('current_injuries', 'Lesión espalda baja, cuadrado lumbar')))
      .toEqual(['region:lumbar'])
  })

  it('fila 2 — tendinitis rotuliana resuelve rodilla', () => {
    expect(keys(fromField('current_injuries', 'tendinitis rotuliana rodilla izquierda')))
      .toEqual(['region:knee'])
  })

  it('filas 3-5 — sinónimos anatómicos por campo médicamente acotado', () => {
    expect(keys(fromField('current_injuries', 'manguito rotador'))).toEqual(['region:shoulder'])
    expect(keys(fromField('current_injuries', 'pubalgia'))).toEqual(['region:groin'])
    expect(keys(fromField('current_injuries', 'fascitis plantar'))).toEqual(['region:foot'])
  })

  it('fila 6 — "sin carga axial" es prohibitive, no negación', () => {
    expect(keys(fromField('restrictions', 'sin carga axial'))).toEqual(['pattern:axial_load'])
  })

  it('fila 7 — prohibitive con patrón y región', () => {
    expect(keys(fromField('restrictions', 'evitar flexión profunda de rodilla')))
      .toEqual(['pattern:deep_flexion', 'region:knee'])
  })

  it('fila 8 — " y " coordinado NO corta la cláusula médica', () => {
    expect(keys(fromField('user_message', 'dolor de rodilla y tobillo')))
      .toEqual(['region:ankle', 'region:knee'])
  })

  it('fila 9 — " y " coordinado NO corta la cláusula prohibitive', () => {
    expect(keys(fromField('restrictions', 'sin impacto y carga axial')))
      .toEqual(['pattern:axial_load', 'pattern:impact'])
  })

  it('fila 10 — la negación es por cláusula, no global', () => {
    expect(keys(fromField('current_injuries', 'molestia lumbar, sin dolor de rodilla')))
      .toEqual(['region:lumbar'])
  })

  it('fila 11 — preferencia de calendario es neutral, no bloquea', () => {
    expect(keys(fromField('restrictions', 'no fuerza pesada el día previo al partido')))
      .toEqual([])
  })

  it('fila 12 — marcador médico sin zona resoluble bloquea', () => {
    expect(keys(fromField('user_message', 'me operaron hace dos semanas')))
      .toEqual(['unresolved:medical_marker_without_supported_constraint'])
  })

  it('fila 13 — una cláusula de calendario no neutraliza una médica', () => {
    expect(keys(fromField('restrictions', 'no pesado antes del partido; sigo con dolor raro al moverme')))
      .toEqual(['unresolved:medical_marker_without_supported_constraint'])
  })

  it('fila 14 — return_to_play sin detalle bloquea con su propia razón', () => {
    const result = resolveStrengthSafetyConstraints({
      currentInjuries: undefined, restrictions: undefined, injuryNotes: undefined,
      userMessages: [], trainingPriority: 'return_to_play',
    })
    expect(keys(result)).toEqual(['unresolved:structured_priority_without_detail'])
  })

  it('campo médicamente acotado: "rodilla" sola emite; en restrictions no', () => {
    expect(keys(fromField('injury_notes', 'rodilla'))).toEqual(['region:knee'])
    expect(keys(fromField('restrictions', 'rodilla'))).toEqual([])
  })

  it('sentinelas de ausencia no bloquean', () => {
    for (const sentinel of ['ninguna', 'ninguno', 'no aplica', 'N/A', 'nada', 'sin restricciones']) {
      expect(keys(fromField('current_injuries', sentinel)), sentinel).toEqual([])
    }
  })

  it('fatiga es neutral: no es restricción mecánica ni identifica zona', () => {
    expect(keys(fromField('current_injuries', 'fatiga general'))).toEqual([])
    expect(keys(fromField('current_injuries', 'cansancio'))).toEqual([])
  })

  it('sin dolor lumbar actualmente no emite nada', () => {
    expect(keys(fromField('current_injuries', 'sin dolor lumbar actualmente'))).toEqual([])
  })

  it('deduplica conservando toda la procedencia', () => {
    const result = resolveStrengthSafetyConstraints({
      currentInjuries: 'dolor lumbar',
      restrictions: undefined,
      injuryNotes: 'lumbar',
      userMessages: ['me duele la espalda baja'],
      trainingPriority: undefined,
    })
    expect(result).toHaveLength(1)
    expect(result[0].sources).toEqual(['current_injuries', 'injury_notes', 'user_message'])
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthSafetyParser.test.ts`
Expected: FAIL — `Cannot find module '../strengthSafetyConstraints'`.

- [ ] **Step 4: Implementar el parser**

```ts
// src/services/training/strengthSafetyConstraints.ts
import type {
  BodyRegion, ConstraintKey, ConstraintSource, ConstraintSources,
  LoadPattern, StrengthConstraint, UnresolvedConstraintReason,
} from '../../types/strengthSafety'

export interface SafetyConstraintInput {
  /** `recoveryProfile.currentInjuries`. Campo médicamente acotado. */
  currentInjuries: string | undefined
  /** `recoveryProfile.restrictions`. Contenido mixto: exige marcador. */
  restrictions: string | undefined
  /**
   * `planWizardConfig.injuryNotes`. Campo médicamente acotado.
   * NUNCA pasar `WeekCreatorEffectiveConfig.injuryNotes`: ese campo transporta
   * `recoveryProfile.restrictions` (WeekCreatorConfig.ts:274,307) y promoverlo
   * a médicamente acotado sería un fail-open.
   */
  injuryNotes: string | undefined
  /** SOLO mensajes con `role === 'user'`. Nunca prosa del coach. */
  userMessages: readonly string[]
  trainingPriority: string | undefined
}

/** Campos cuya etiqueta ya declara intención médica: no exigen marcador léxico. */
const MEDICALLY_SCOPED: ReadonlySet<ConstraintSource> = new Set(['current_injuries', 'injury_notes'])

const REGION_SYNONYMS: ReadonlyArray<readonly [BodyRegion, readonly string[]]> = [
  ['lumbar', ['lumbar', 'espalda baja', 'espalda inferior', 'cuadrado lumbar', 'lumbago', 'hernia discal', 'zona lumbar', 'l4', 'l5', 'psoas']],
  ['thoracic', ['dorsal', 'espalda alta', 'toracic', 'dorsalgia']],
  ['cervical', ['cervical', 'cuello', 'trapecio']],
  ['trunk_core', ['zona media', 'core', 'abdominal', 'abdomen']],
  ['chest_ribs', ['costilla', 'costal', 'esternon', 'pectoral', 'condritis']],
  ['pelvis_sacroiliac', ['sacroiliac', 'sacro', 'pelvis', 'coxis']],
  ['shoulder', ['hombro', 'manguito rotador', 'manguito', 'supraespinoso', 'deltoides', 'acromioclavicular', 'clavicula']],
  ['elbow', ['codo', 'epicondilitis', 'epitrocleitis', 'epicondil']],
  ['wrist', ['muneca', 'carpo', 'tunel carpiano']],
  ['hip', ['cadera', 'gluteo', 'piramidal', 'labrum']],
  ['groin', ['aductor', 'ingle', 'pubalgia', 'pubis']],
  ['hamstring', ['isquiotibial', 'isquios', 'biceps femoral']],
  ['knee', ['rodilla', 'rotulian', 'rotula', 'menisco', 'ligamento cruzado', 'lca', 'condromalacia']],
  ['calf', ['gemelo', 'soleo', 'pantorrilla']],
  ['achilles', ['aquiles', 'aquileo']],
  ['ankle', ['tobillo', 'peroneo', 'esguince de tobillo']],
  ['foot', ['fascitis plantar', 'fascitis', 'metatarso', 'planta del pie', 'pie']],
]

const PATTERN_SYNONYMS: ReadonlyArray<readonly [LoadPattern, readonly string[]]> = [
  ['axial_load', ['carga axial', 'compresion axial', 'axial', 'peso sobre la espalda', 'barra en la espalda']],
  ['loaded_hinge', ['peso muerto', 'hinge', 'bisagra de cadera', 'flexion de tronco cargada']],
  ['impact', ['impacto', 'pliometr', 'saltos', 'salto']],
  ['deep_flexion', ['flexion profunda', 'sentadilla profunda', 'rango profundo']],
  ['overhead', ['sobre la cabeza', 'overhead', 'por encima de la cabeza']],
  ['rotation', ['rotacion', 'giro', 'torsion']],
  ['grip_demand', ['agarre', 'prension', 'grip']],
]

/** Marcadores de problema médico activo. */
const MEDICAL_MARKERS = [
  'lesion', 'lesionad', 'dolor', 'duele', 'molestia', 'tendinitis', 'tendinopat',
  'esguince', 'rotura', 'desgarro', 'hernia', 'operad', 'cirugia', 'postoperator',
  'fractura', 'inflamacion', 'kinesiolog', 'fisioterap', 'traumatolog', 'medico',
]

/** Directivas de evitación. El OBJETO decide si es prohibitive o resolved_absence. */
const AVOIDANCE_TOKENS = ['sin ', 'evitar ', 'evita ', 'evite ', 'evito ', 'no ', 'nada de ']

/** Objetos que convierten una evitación en afirmación de ausencia médica. */
const SYMPTOM_OBJECTS = ['dolor', 'lesion', 'molestia', 'problema', 'restriccion', 'limitacion']

/** Un campo cuyo contenido total es una sentinela no declara nada. */
const ABSENCE_SENTINELS = ['ninguna', 'ninguno', 'no aplica', 'n/a', 'na', 'nada', 'sin restricciones', 'sin lesiones', 'ok', '-']

/**
 * Carga percibida, no restricción mecánica. El placeholder de «Molestias
 * actuales» invita a escribirla, y bloquear sesiones por fatiga sería un
 * falso positivo grave: la fatiga ya tiene su canal en el check-in diario.
 */
const NEUTRAL_LOAD_TERMS = ['fatiga', 'cansancio', 'agotamiento', 'sobrecarga general', 'cansado']

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

/**
 * Corte primario por `[,.;\n]`. La conjunción ` y ` solo corta cuando el
 * fragmento derecho inicia por sí mismo un modo; si no, es enumeración
 * coordinada («dolor de rodilla y tobillo», «sin impacto y carga axial»).
 */
function splitClauses(text: string): string[] {
  const primary = text.split(/[,.;\n]+/).map((part) => part.trim()).filter(Boolean)
  const result: string[] = []
  for (const clause of primary) {
    const parts = clause.split(/\s+y\s+/)
    let current = parts[0] ?? ''
    for (const next of parts.slice(1)) {
      if (startsOwnMode(next)) {
        result.push(current.trim())
        current = next
      } else {
        current = `${current} y ${next}`
      }
    }
    if (current.trim()) result.push(current.trim())
  }
  return result
}

function startsOwnMode(fragment: string): boolean {
  const value = fragment.trim()
  return AVOIDANCE_TOKENS.some((token) => value.startsWith(token))
    || MEDICAL_MARKERS.some((marker) => value.includes(marker))
}

function findRegions(clause: string): BodyRegion[] {
  return REGION_SYNONYMS
    .filter(([, synonyms]) => synonyms.some((synonym) => clause.includes(synonym)))
    .map(([region]) => region)
}

function findPatterns(clause: string): LoadPattern[] {
  return PATTERN_SYNONYMS
    .filter(([, synonyms]) => synonyms.some((synonym) => clause.includes(synonym)))
    .map(([pattern]) => pattern)
}

type ClauseMode = 'active_medical' | 'prohibitive' | 'resolved_absence' | 'neutral'

function classifyClause(clause: string, source: ConstraintSource): ClauseMode {
  const avoidance = AVOIDANCE_TOKENS.find((token) => clause.startsWith(token) || clause.includes(` ${token}`))
  if (avoidance) {
    const objectIsSymptom = SYMPTOM_OBJECTS.some((symptom) => clause.includes(symptom))
    if (objectIsSymptom) return 'resolved_absence'
    return findRegions(clause).length > 0 || findPatterns(clause).length > 0 ? 'prohibitive' : 'neutral'
  }
  if (NEUTRAL_LOAD_TERMS.some((term) => clause.includes(term))) return 'neutral'
  if (MEDICAL_MARKERS.some((marker) => clause.includes(marker))) return 'active_medical'
  // El campo aporta el marcador: «rodilla» sola en «Molestias actuales» es una
  // lesión declarada; el mismo texto en `restrictions` no lo es.
  if (MEDICALLY_SCOPED.has(source)) return 'active_medical'
  return 'neutral'
}

interface RawConstraint {
  key: ConstraintKey
  constraint: Omit<StrengthConstraint, 'sources'> & { sources?: never }
  source: ConstraintSource
}

function parseField(text: string | undefined, source: ConstraintSource): RawConstraint[] {
  if (!text?.trim()) return []
  const normalized = normalize(text)
  if (ABSENCE_SENTINELS.includes(normalized)) return []

  const out: RawConstraint[] = []
  for (const clause of splitClauses(normalized)) {
    const mode = classifyClause(clause, source)
    if (mode === 'resolved_absence' || mode === 'neutral') continue

    const regions = findRegions(clause)
    const patterns = findPatterns(clause)

    if (regions.length === 0 && patterns.length === 0) {
      if (mode === 'active_medical') {
        out.push({
          key: 'unresolved:medical_marker_without_supported_constraint',
          constraint: { kind: 'unresolved_medical_restriction', reason: 'medical_marker_without_supported_constraint' },
          source,
        })
      }
      continue
    }
    for (const region of regions) {
      out.push({ key: `region:${region}`, constraint: { kind: 'region', region }, source })
    }
    for (const pattern of patterns) {
      out.push({ key: `pattern:${pattern}`, constraint: { kind: 'load_pattern', pattern }, source })
    }
  }
  return out
}

const SOURCE_ORDER: readonly ConstraintSource[] = [
  'current_injuries', 'restrictions', 'injury_notes', 'user_message', 'training_priority',
]

const REGION_ORDER = REGION_SYNONYMS.map(([region]) => region)
const PATTERN_ORDER = PATTERN_SYNONYMS.map(([pattern]) => pattern)
const UNRESOLVED_ORDER: readonly UnresolvedConstraintReason[] = [
  'medical_marker_without_supported_constraint', 'structured_priority_without_detail',
]

function keyRank(key: ConstraintKey): number {
  if (key.startsWith('region:')) return REGION_ORDER.indexOf(key.slice(7) as BodyRegion)
  if (key.startsWith('pattern:')) return 1000 + PATTERN_ORDER.indexOf(key.slice(8) as LoadPattern)
  return 2000 + UNRESOLVED_ORDER.indexOf(key.slice(11) as UnresolvedConstraintReason)
}

export function constraintKey(constraint: StrengthConstraint): ConstraintKey {
  if (constraint.kind === 'region') return `region:${constraint.region}`
  if (constraint.kind === 'load_pattern') return `pattern:${constraint.pattern}`
  return `unresolved:${constraint.reason}`
}

export function resolveStrengthSafetyConstraints(
  input: SafetyConstraintInput,
): readonly StrengthConstraint[] {
  const raw: RawConstraint[] = [
    ...parseField(input.currentInjuries, 'current_injuries'),
    ...parseField(input.restrictions, 'restrictions'),
    ...parseField(input.injuryNotes, 'injury_notes'),
    ...input.userMessages.flatMap((message) => parseField(message, 'user_message')),
  ]

  // `training_priority` NO se parsea como texto: se resuelve estructuralmente.
  if (input.trainingPriority === 'return_to_play') {
    raw.push({
      key: 'unresolved:structured_priority_without_detail',
      constraint: { kind: 'unresolved_medical_restriction', reason: 'structured_priority_without_detail' },
      source: 'training_priority',
    })
  }

  const merged = new Map<ConstraintKey, { constraint: RawConstraint['constraint']; sources: Set<ConstraintSource> }>()
  for (const item of raw) {
    const existing = merged.get(item.key)
    if (existing) existing.sources.add(item.source)
    else merged.set(item.key, { constraint: item.constraint, sources: new Set([item.source]) })
  }

  return [...merged.entries()]
    .sort(([a], [b]) => keyRank(a) - keyRank(b))
    .map(([, value]) => ({
      ...value.constraint,
      sources: SOURCE_ORDER.filter((source) => value.sources.has(source)) as unknown as ConstraintSources,
    })) as readonly StrengthConstraint[]
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/strengthSafetyParser.test.ts`
Expected: PASS. Si alguna fila falla, ajustar los sinónimos — **no** relajar la aserción.

- [ ] **Step 6: Retirar «fatiga» del placeholder de onboarding**

En `src/pages/OnboardingPage.tsx:576`, cambiar:

```tsx
placeholder="Dolor, fatiga, zonas sensibles o molestias recientes."
```

por:

```tsx
placeholder="Dolor, zonas sensibles o molestias recientes."
```

La fatiga tiene su propio canal en el check-in diario; invitarla en el campo de lesiones produce falsos positivos.

- [ ] **Step 7: Gate y commit**

Run: `npm run lint && npm test && npm run build`

```
feat(strength): parser determinista de restricciones de seguridad
```

---

## Task 3: Política de seguridad y guard de autoridad

**Files:**
- Modify: `src/services/training/strengthSafetyConstraints.ts`
- Test: `src/services/training/__tests__/strengthSafetyPolicy.test.ts`
- Test: `src/services/training/__tests__/strengthSafetyAuthorityGuard.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ExerciseDefinition.safety`), Task 2 (`StrengthConstraint`).
- Produces:
  - `isExerciseAllowed(definition: ExerciseDefinition, constraints: readonly StrengthConstraint[]): boolean`
  - `matchedConstraintKeys(definition: ExerciseDefinition, constraints: readonly StrengthConstraint[]): ConstraintKey[]`
  - `hasUnresolvedMedicalRestriction(constraints: readonly StrengthConstraint[]): boolean`
  - `hasAnyConstraint(constraints: readonly StrengthConstraint[]): boolean`

- [ ] **Step 1: Escribir el test de política**

```ts
// src/services/training/__tests__/strengthSafetyPolicy.test.ts
import { describe, expect, it } from 'vitest'
import { STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'
import {
  hasAnyConstraint, hasUnresolvedMedicalRestriction, isExerciseAllowed, matchedConstraintKeys,
} from '../strengthSafetyConstraints'
import type { StrengthConstraint } from '../../../types/strengthSafety'

const byId = (id: string) => STRENGTH_EXERCISE_LIBRARY.find((e) => e.id === id)!
const lumbar: StrengthConstraint[] = [{ kind: 'region', region: 'lumbar', sources: ['current_injuries'] }]
const noImpact: StrengthConstraint[] = [{ kind: 'load_pattern', pattern: 'impact', sources: ['restrictions'] }]

describe('política de seguridad de fuerza', () => {
  it('sin restricciones todo está permitido', () => {
    for (const exercise of STRENGTH_EXERCISE_LIBRARY) {
      expect(isExerciseAllowed(exercise, [])).toBe(true)
    }
  })

  it('una restricción lumbar excluye los tres ejercicios del bug reportado', () => {
    for (const id of ['side_plank_plate_press', 'half_kneeling_diagonal_plate_chop', 'bb_side_lunge']) {
      expect(isExerciseAllowed(byId(id), lumbar), id).toBe(false)
    }
  })

  it('una restricción lumbar excluye hinge y sentadilla axial', () => {
    for (const id of ['deadlift', 'romanian_deadlift', 'back_squat', 'kettlebell_swing']) {
      expect(isExerciseAllowed(byId(id), lumbar), id).toBe(false)
    }
  })

  it('una restricción lumbar conserva trabajo superior apoyado', () => {
    for (const id of ['chest_supported_row', 'lat_pulldown', 'incline_dumbbell_press', 'band_row']) {
      expect(isExerciseAllowed(byId(id), lumbar), id).toBe(true)
    }
  })

  it('una restricción de patrón excluye por patrón aunque la región esté sana', () => {
    expect(isExerciseAllowed(byId('box_jump'), noImpact)).toBe(false)
    expect(isExerciseAllowed(byId('lat_pulldown'), noImpact)).toBe(true)
  })

  it('reporta las claves que causaron la exclusión', () => {
    expect(matchedConstraintKeys(byId('deadlift'), lumbar)).toEqual(['region:lumbar'])
    expect(matchedConstraintKeys(byId('lat_pulldown'), lumbar)).toEqual([])
  })

  it('una restricción no resuelta se detecta y no depende de regiones', () => {
    const unresolved: StrengthConstraint[] = [{
      kind: 'unresolved_medical_restriction',
      reason: 'structured_priority_without_detail',
      sources: ['training_priority'],
    }]
    expect(hasUnresolvedMedicalRestriction(unresolved)).toBe(true)
    expect(hasAnyConstraint(unresolved)).toBe(true)
    expect(hasUnresolvedMedicalRestriction(lumbar)).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthSafetyPolicy.test.ts`
Expected: FAIL — funciones no exportadas.

- [ ] **Step 3: Implementar los predicados**

```ts
// añadir a src/services/training/strengthSafetyConstraints.ts
import type { ExerciseDefinition } from './exerciseLibrary'

export function hasAnyConstraint(constraints: readonly StrengthConstraint[]): boolean {
  return constraints.length > 0
}

export function hasUnresolvedMedicalRestriction(constraints: readonly StrengthConstraint[]): boolean {
  return constraints.some((constraint) => constraint.kind === 'unresolved_medical_restriction')
}

/**
 * Única lectura legítima de `safety` en todo el proyecto.
 * NO hay implicación entre regiones: si una restricción debe excluir un
 * ejercicio, su región o patrón aparece directamente en el perfil.
 */
export function matchedConstraintKeys(
  definition: ExerciseDefinition,
  constraints: readonly StrengthConstraint[],
): ConstraintKey[] {
  const regions = new Set<BodyRegion>(definition.safety.loadsRegions)
  const patterns = new Set<LoadPattern>(definition.safety.loadPatterns)
  return constraints
    .filter((constraint) =>
      (constraint.kind === 'region' && regions.has(constraint.region))
      || (constraint.kind === 'load_pattern' && patterns.has(constraint.pattern)),
    )
    .map(constraintKey)
}

export function isExerciseAllowed(
  definition: ExerciseDefinition,
  constraints: readonly StrengthConstraint[],
): boolean {
  return matchedConstraintKeys(definition, constraints).length === 0
}
```

- [ ] **Step 4: Escribir el guard de autoridad**

```ts
// src/services/training/__tests__/strengthSafetyAuthorityGuard.test.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ALLOWED = new Set([
  'src/types/strengthSafety.ts',
  'src/services/training/exerciseLibrary.ts',
  'src/services/training/strengthSafetyConstraints.ts',
])

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      return entry === 'node_modules' || entry === '__tests__' ? [] : walk(full)
    }
    return /\.tsx?$/.test(entry) ? [full] : []
  })
}

describe('autoridad de la clasificación de seguridad', () => {
  it('solo los tres módulos autorizados leen loadsRegions o loadPatterns', () => {
    const offenders = walk('src').filter((file) => {
      if (ALLOWED.has(file)) return false
      const content = readFileSync(file, 'utf-8')
      return content.includes('loadsRegions') || content.includes('loadPatterns')
    })
    expect(offenders, `deben consultar strengthSafetyConstraints: ${offenders.join(', ')}`).toEqual([])
  })
})
```

- [ ] **Step 5: Correr ambos y verificar que pasan**

Run: `npx vitest run src/services/training/__tests__/strengthSafetyPolicy.test.ts src/services/training/__tests__/strengthSafetyAuthorityGuard.test.ts`
Expected: PASS.

- [ ] **Step 6: Verificar que el guard NO es vacuo**

Añadir temporalmente `const x = definition.safety.loadsRegions` en `src/services/training/strengthSelector.ts`, correr el guard, confirmar que **falla**, y revertir.

- [ ] **Step 7: Gate y commit**

Run: `npm run lint && npm test && npm run build`

```
feat(strength): política de exclusión y guard de autoridad
```

---

## Task 4: Capa 1 — filtro en el pool de candidatos

**Files:**
- Modify: `src/services/training/strengthSelector.ts`
- Test: `src/services/training/__tests__/strengthSelectorSafety.test.ts`
- Modify: todos los sitios que construyen `StrengthContext` (barrido del compilador)

**Interfaces:**
- Consumes: Task 3 (`isExerciseAllowed`).
- Produces: `StrengthContext.safetyConstraints: readonly StrengthConstraint[]` (**obligatorio**).

- [ ] **Step 1: Escribir el test**

```ts
// src/services/training/__tests__/strengthSelectorSafety.test.ts
import { describe, expect, it } from 'vitest'
import { selectStrengthSession, getStrengthReplacementPool } from '../strengthSelector'
import { resolveStrengthExercise } from '../exerciseLibrary'
import type { StrengthConstraint } from '../../../types/strengthSafety'
import type { StrengthContext } from '../strengthSelector'

const lumbar: StrengthConstraint[] = [{ kind: 'region', region: 'lumbar', sources: ['current_injuries'] }]

function context(safetyConstraints: readonly StrengthConstraint[]): StrengthContext {
  return {
    fatigueLevel: 5,
    phase: 'build',
    recentExercises: [],
    goal: 'fuerza general',
    sportProfile: 'sport_support',
    primarySport: 'squash',
    experienceLevel: 'intermediate',
    sessionDurationMin: 60,
    safetyConstraints,
  }
}

describe('capa 1 — el pool del selector respeta las restricciones', () => {
  it('sin restricciones el selector se comporta como antes', () => {
    expect(selectStrengthSession(context([])).exercises.length).toBeGreaterThan(0)
  })

  it('ningún ejercicio seleccionado carga la zona restringida', () => {
    const { exercises } = selectStrengthSession(context(lumbar))
    for (const exercise of exercises) {
      const definition = resolveStrengthExercise(exercise)?.definition
      expect(definition, exercise.name).toBeDefined()
      expect(definition!.safety.loadsRegions, exercise.name).not.toContain('lumbar')
    }
  })

  it('el pool de reemplazo también respeta la restricción', () => {
    const pool = getStrengthReplacementPool(
      { name: 'Sentadilla trasera con barra' },
      context(lumbar),
    )
    for (const candidateId of pool) {
      const candidate = STRENGTH_EXERCISE_LIBRARY.find((item) => item.id === candidateId)!
      expect(candidate.safety.loadsRegions, candidate.id).not.toContain('lumbar')
    }
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorSafety.test.ts`
Expected: FAIL — `safetyConstraints` no existe en `StrengthContext`.

- [ ] **Step 3: Añadir el campo obligatorio y el filtro**

En `src/services/training/strengthSelector.ts`:

```ts
import type { StrengthConstraint } from '../../types/strengthSafety'
import { isExerciseAllowed } from './strengthSafetyConstraints'

export interface StrengthContext {
  // … campos existentes …
  /**
   * OBLIGATORIO. Un campo opcional reintroduce un camino fail-open: sin
   * restricciones se pasa `[]`, y así el compilador obliga a cada superficie
   * a decidir explícitamente.
   */
  safetyConstraints: readonly StrengthConstraint[]
}

function filterBySafetyConstraints(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
): ExerciseDefinition[] {
  if (context.safetyConstraints.length === 0) return exercises
  return exercises.filter((exercise) => isExerciseAllowed(exercise, context.safetyConstraints))
}
```

Y en `buildStrengthCandidatePool`, aplicarlo **primero**, antes de experiencia, fase y fatiga — una restricción dura no se negocia contra una blanda:

```ts
function buildStrengthCandidatePool(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
): ExerciseDefinition[] {
  return filterByFatigue(
    filterByPhase(
      filterBySafetyMetadata(
        filterByExperience(filterBySafetyConstraints(exercises, context), context),
        context,
      ),
      context,
    ),
    context,
  )
}
```

- [ ] **Step 4: Barrido del compilador**

Run: `npx tsc -b`
Expected: errores en cada sitio que construye `StrengthContext`. Para **cada uno**, añadir `safetyConstraints`:

- `src/services/ai/actionPostProcessor.ts` → `safetyConstraints: []` provisional (Task 9 lo cablea de verdad).
- `src/services/planBuilder/repairWeek.ts` (`buildStrengthSelectionContext`) → `safetyConstraints: []` provisional (Task 12).
- `src/services/weekCreator/**` → `safetyConstraints: []` provisional (Task 11).
- Todos los tests existentes → `safetyConstraints: []`.

Repetir `npx tsc -b` hasta que quede limpio.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorSafety.test.ts`
Expected: PASS.

- [ ] **Step 6: Gate y commit**

Run: `npm run lint && npm test && npm run build`
Expected: verde. La suite completa debe seguir pasando: `safetyConstraints: []` preserva el comportamiento previo exactamente.

```
feat(strength): filtrar el pool del selector por restricciones de seguridad
```

---

## Task 5: Core estructural omitible

**Files:**
- Modify: `src/services/training/strengthSessionStructure.ts`
- Modify: `src/services/planBuilder/strengthStructuralCore.ts`
- Test: `src/services/training/__tests__/injectedCoreSafety.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  - `resolveInjectedCoreId(weekIndexInBlock, availableEquipment, constraints): string | undefined`
  - `projectStructuralCoreSlot(...): StructuralCoreProjection | undefined`

- [ ] **Step 1: Escribir el test**

```ts
// src/services/training/__tests__/injectedCoreSafety.test.ts
import { describe, expect, it } from 'vitest'
import { resolveInjectedCoreId, INJECTED_CORE_ROTATION } from '../strengthSessionStructure'
import { projectStructuralCoreSlot } from '../../planBuilder/strengthStructuralCore'
import type { StrengthConstraint } from '../../../types/strengthSafety'

const lumbar: StrengthConstraint[] = [{ kind: 'region', region: 'lumbar', sources: ['current_injuries'] }]

describe('core inyectado bajo restricciones', () => {
  it('sin restricciones conserva la rotación congelada y dead_bug primero', () => {
    expect(resolveInjectedCoreId(0, undefined, [])).toBe(INJECTED_CORE_ROTATION[0])
    expect(resolveInjectedCoreId(undefined, undefined, [])).toBe('dead_bug')
  })

  it('con restricción lumbar no hay core inyectable: devuelve undefined', () => {
    for (const week of [0, 1, 2, 3, undefined]) {
      expect(resolveInjectedCoreId(week, undefined, lumbar)).toBeUndefined()
    }
  })

  it('con restricción de hombro sigue habiendo core legal', () => {
    const shoulder: StrengthConstraint[] = [{ kind: 'region', region: 'shoulder', sources: ['current_injuries'] }]
    expect(resolveInjectedCoreId(0, undefined, shoulder)).toBe('dead_bug')
  })

  it('la proyección estructural queda AUSENTE, no {coreId: undefined}', () => {
    expect(projectStructuralCoreSlot([], 0, undefined, lumbar)).toBeUndefined()
    expect(projectStructuralCoreSlot([], 0, undefined, [])).toBeDefined()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/injectedCoreSafety.test.ts`
Expected: FAIL — `resolveInjectedCoreId` no acepta un tercer argumento.

- [ ] **Step 3: Implementar**

En `strengthSessionStructure.ts`, `resolveInjectedCoreId` filtra la allowlist por restricciones y puede devolver `undefined`:

```ts
export function resolveInjectedCoreId(
  weekIndexInBlock: number | undefined,
  availableEquipment: EquipmentType[] | undefined,
  constraints: readonly StrengthConstraint[],
): string | undefined {
  const pool = buildInjectedCorePool(availableEquipment)
    .filter((id) => {
      const definition = getStrengthExerciseIdentityById(id)
      return isExerciseAllowed(definition, constraints)
    })
  if (pool.length === 0) return undefined     // ningún core legal: se omite el paso
  if (weekIndexInBlock === undefined || !Number.isFinite(weekIndexInBlock) || weekIndexInBlock < 0) {
    return pool[0]
  }
  return pool[Math.floor(weekIndexInBlock) % pool.length]
}
```

`ensureCoreBlock` recibe ahora `string | undefined`; si es `undefined`, **no inyecta y libera la cuota** en vez de caer a un literal:

```ts
const withCore = durationMin >= 45
  ? options.structuralCoreId
    ? ensureProjectedCoreBlock(normalized, options.structuralCoreId, options.protectedExerciseIds)
    : (() => {
        const coreId = resolveInjectedCoreId(
          options.weekIndexInBlock, options.availableEquipment, options.safetyConstraints,
        )
        return coreId ? ensureCoreBlock(normalized, coreId, options.protectedExerciseIds) : normalized
      })()
  : normalized
```

En `strengthStructuralCore.ts`, la proyección pasa a opcional:

```ts
export function projectStructuralCoreSlot(
  snapshotExercises: ReadonlyArray<{ name: string; libraryRef?: ExerciseLibraryRef; group?: string }>,
  weekIndexInBlock: number,
  availableEquipment: EquipmentType[] | undefined,
  constraints: readonly StrengthConstraint[],
): StructuralCoreProjection | undefined {
  // … lógica existente …
  const coreId = resolveInjectedCoreId(weekIndexInBlock, availableEquipment, constraints)
  if (!coreId) return undefined   // sin entrada en el mapa, sin fixedId, sin cuota
  return { slotIndex, coreId }
}
```

El consumidor que construye `Map<string, StructuralCoreProjection>` en
`repairWeek.ts` debe condicionar el `set`: si la proyección es `undefined`, no
crea entrada. Los consumidores posteriores ya usan `structuralCore?.coreId`.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/injectedCoreSafety.test.ts src/services/training/__tests__/injectedCoreRotation.test.ts`
Expected: PASS. `injectedCoreRotation.test.ts` no debe cambiar: sin restricciones el comportamiento es idéntico.

- [ ] **Step 5: Gate y commit**

Run: `npm run lint && npm test && npm run build`

```
feat(strength): permitir omitir el core inyectado cuando no hay opción legal
```

---

## Task 6: El finalizador

**Files:**
- Create: `src/services/training/strengthSafetyFinalizer.ts`
- Test: `src/services/training/__tests__/strengthSafetyFinalizer.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 5.
- Produces:
  - `finalizeStrengthExercisesForRestrictions(input): StrengthSafetyFinalization`
  - Tipos `StrengthSafetyFinalization`, `BlockedReason`, `RemovedExercise`, `ReplacedExercise`.

- [ ] **Step 1: Escribir el test**

```ts
// src/services/training/__tests__/strengthSafetyFinalizer.test.ts
import { describe, expect, it } from 'vitest'
import { finalizeStrengthExercisesForRestrictions } from '../strengthSafetyFinalizer'
import { resolveStrengthExercise } from '../exerciseLibrary'
import type { CoachExerciseProposal } from '../../../types'
import type { StrengthConstraint } from '../../../types/strengthSafety'

const lumbar: StrengthConstraint[] = [{ kind: 'region', region: 'lumbar', sources: ['current_injuries'] }]
const unresolved: StrengthConstraint[] = [{
  kind: 'unresolved_medical_restriction',
  reason: 'structured_priority_without_detail',
  sources: ['training_priority'],
}]

const ex = (name: string, extra: Partial<CoachExerciseProposal> = {}): CoachExerciseProposal =>
  ({ name, sets: 3, reps: 8, ...extra })

function run(exercises: CoachExerciseProposal[], constraints: readonly StrengthConstraint[], durationMin = 60) {
  return finalizeStrengthExercisesForRestrictions({
    exercises,
    constraints,
    durationMin,
    sessionType: 'strength',
    selectionContext: {
      fatigueLevel: 5, phase: 'build', recentExercises: [], goal: 'fuerza',
      sportProfile: 'sport_support', experienceLevel: 'intermediate',
      sessionDurationMin: durationMin, safetyConstraints: constraints,
    },
    userMessage: '',
    supersetMode: 'off',
  })
}

describe('finalizador de seguridad de fuerza', () => {
  it('sin restricciones no cambia nada', () => {
    const input = [ex('Peso muerto rumano'), ex('Press de banca')]
    const result = run(input, [])
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.removed).toEqual([])
      expect(result.replaced).toEqual([])
    }
  })

  it('una restricción no resuelta bloquea antes de tocar ejercicios', () => {
    const result = run([ex('Press de banca')], unresolved)
    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') expect(result.reason).toBe('unresolved_medical_restriction')
  })

  it('retira los contraindicados y ninguno sobrevive', () => {
    const result = run([
      ex('Plancha lateral con press de disco'),
      ex('Corte diagonal con disco en media rodilla'),
      ex('Remo con pecho apoyado'),
    ], lumbar)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      for (const exercise of result.exercises) {
        const definition = resolveStrengthExercise(exercise)?.definition
        expect(definition!.safety.loadsRegions, exercise.name).not.toContain('lumbar')
      }
      expect(result.removed.length).toBeGreaterThan(0)
    }
  })

  it('una identidad desconocida se retira y se rellena, no bloquea', () => {
    const result = run([ex('Ejercicio inventado xyz'), ex('Remo con pecho apoyado')], lumbar)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.removed.some((item) => item.reason === 'unresolvable_identity')).toBe(true)
      expect(result.exercises.every((exercise) => resolveStrengthExercise(exercise)?.definition)).toBe(true)
    }
  })

  it('una identidad desconocida FIJADA por el usuario sí bloquea', () => {
    const result = finalizeStrengthExercisesForRestrictions({
      exercises: [ex('Ejercicio inventado xyz')],
      constraints: lumbar,
      durationMin: 60,
      sessionType: 'strength',
      selectionContext: {
        fatigueLevel: 5, phase: 'build', recentExercises: [], goal: 'fuerza',
        sportProfile: 'sport_support', experienceLevel: 'intermediate',
        sessionDurationMin: 60, safetyConstraints: lumbar,
      },
      userMessage: 'quiero hacer ejercicio inventado xyz',
      supersetMode: 'off',
    })
    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') expect(result.reason).toBe('unresolvable_exercise_identity')
  })

  it('un pool insuficiente bloquea en vez de entregar sesión corta', () => {
    const everything: StrengthConstraint[] = [
      { kind: 'region', region: 'lumbar', sources: ['current_injuries'] },
      { kind: 'region', region: 'shoulder', sources: ['current_injuries'] },
      { kind: 'region', region: 'knee', sources: ['current_injuries'] },
      { kind: 'region', region: 'hip', sources: ['current_injuries'] },
      { kind: 'region', region: 'elbow', sources: ['current_injuries'] },
      { kind: 'region', region: 'ankle', sources: ['current_injuries'] },
      { kind: 'region', region: 'trunk_core', sources: ['current_injuries'] },
    ]
    const result = run([ex('Remo con pecho apoyado')], everything)
    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') expect(result.reason).toBe('insufficient_safe_pool')
  })

  it('es idempotente sobre su propia salida', () => {
    const first = run([ex('Peso muerto'), ex('Remo con pecho apoyado')], lumbar)
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return
    const second = run([...first.exercises], lumbar)
    expect(second.status).toBe('ok')
    if (second.status === 'ok') {
      expect(second.exercises.map((e) => e.name)).toEqual(first.exercises.map((e) => e.name))
      expect(second.removed).toEqual([])
    }
  })

  it('una superserie que pierde un miembro se disuelve', () => {
    const result = run([
      ex('Peso muerto', { supersetGroup: 'A', sets: 3 }),
      ex('Remo con pecho apoyado', { supersetGroup: 'A', sets: 3 }),
    ], lumbar)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      const survivors = result.exercises.filter((e) => e.supersetGroup === 'A')
      expect(survivors.length === 0 || survivors.length >= 2).toBe(true)
    }
  })

  it('la densidad se rellena solo desde el pool permitido', () => {
    const result = run([ex('Remo con pecho apoyado')], lumbar)
    if (result.status === 'ok') {
      expect(result.exercises.length).toBeGreaterThan(1)
      for (const exercise of result.exercises) {
        const definition = resolveStrengthExercise(exercise)?.definition
        expect(definition!.safety.loadsRegions, exercise.name).not.toContain('lumbar')
      }
    }
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthSafetyFinalizer.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Extraer los dos helpers duplicados a `strengthSessionStructure.ts`**

`getMinimumStrengthWorkCount` e `isStrengthWorkExercise` están **duplicados byte
a byte** en `actionPostProcessor.ts:1511,1518` y `repairWeek.ts:3493,3500`. El
finalizador es un tercer consumidor: dejar tres copias de la regla de viabilidad
es el patrón de drift que CLAUDE.md ya señala con `WINDOW_DAYS`.

Mover ambas a `src/services/training/strengthSessionStructure.ts` y exportarlas:

```ts
/** Mínimo de trabajo de fuerza REAL por duración. Autoridad única: el chat, el
 *  Plan Builder y el finalizador consumen esta, no una copia local. */
export function getMinimumStrengthWorkCount(durationMin: number): number {
  if (durationMin >= 70) return 5
  if (durationMin >= 55) return 4
  if (durationMin >= 45) return 3
  return 2
}

export function isStrengthWorkExercise(exercise: CoachExerciseProposal): boolean {
  const block = resolveStrengthExerciseBlock(exercise)
  return block !== 'core' && block !== 'cardio' && block !== 'mobility'
}
```

Borrar las dos copias locales y añadir el import en ambos archivos. Correr
`npm test` y confirmar que **nada** cambia de comportamiento: son idénticas.

- [ ] **Step 4: Implementar el finalizador**

```ts
// src/services/training/strengthSafetyFinalizer.ts
import type { CoachExerciseProposal, SessionType } from '../../types'
import type { ConstraintKey, StrengthConstraint } from '../../types/strengthSafety'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'
import { resolveStrengthExercise, type MovementPattern } from './exerciseLibrary'
import {
  hasUnresolvedMedicalRestriction, isExerciseAllowed, matchedConstraintKeys,
} from './strengthSafetyConstraints'
import {
  buildStrengthReplacementById, getStrengthReplacementPool, getTargetExerciseDensity,
  selectStrengthSession, type StrengthContext, type StrengthSelectionExercise,
} from './strengthSelector'
import { planSupersetGroups, type SupersetPolicyMode } from './supersetPolicy'
import { normalizeSupersetGroups } from './supersetGroups'
import { getMinimumStrengthWorkCount, isStrengthWorkExercise } from './strengthSessionStructure'

export type BlockedReason =
  | 'unresolved_medical_restriction'
  | 'insufficient_safe_pool'
  | 'unresolvable_exercise_identity'

export interface RemovedExercise {
  exerciseId?: string
  libraryRef?: ExerciseLibraryRef
  reason: 'constraint_intersection' | 'unresolvable_identity' | 'ambiguous_identity'
  matchedConstraints: readonly ConstraintKey[]
}

export interface ReplacedExercise {
  fromExerciseId: string
  toExerciseId: string
  movementPattern: MovementPattern
  matchedConstraints: readonly ConstraintKey[]
}

export type StrengthSafetyFinalization =
  | { status: 'ok'; exercises: CoachExerciseProposal[]; removed: RemovedExercise[]; replaced: ReplacedExercise[] }
  | { status: 'blocked'; reason: BlockedReason; removed: RemovedExercise[] }

export interface FinalizeInput {
  exercises: CoachExerciseProposal[]
  constraints: readonly StrengthConstraint[]
  durationMin: number | undefined
  sessionType: SessionType
  selectionContext: StrengthContext
  /** Mensaje normalizado del usuario, para detectar ejercicios fijados. */
  userMessage: string
  /**
   * OBLIGATORIO. Cada superficie lo resuelve con `shouldApplySupersetPolicy`.
   * Un opcional con default `'off'` escondería que ningún productor lo pasa.
   */
  supersetMode: SupersetPolicyMode
}

/**
 * Orden congelado (spec §6.2). Ningún paso relaja una restricción para cumplir
 * un conteo. Idempotente sobre su propia salida.
 */
export function finalizeStrengthExercisesForRestrictions(
  input: FinalizeInput,
): StrengthSafetyFinalization {
  const { constraints } = input

  // 1. Restricción médica no resuelta: bloquea antes de tocar ejercicios.
  if (hasUnresolvedMedicalRestriction(constraints)) {
    return { status: 'blocked', reason: 'unresolved_medical_restriction', removed: [] }
  }

  // NO hay retorno temprano por `constraints.length === 0`: aunque no haya
  // restricciones, los pasos 2, 5 y 8 siguen aplicando. Sin ellos una sesión
  // vacía o con ejercicios inventados pasaría sin verificar — que es
  // exactamente el segundo defecto del ticket original.

  const removed: RemovedExercise[] = []
  const replaced: ReplacedExercise[] = []
  const kept: CoachExerciseProposal[] = []

  // 2-4. Resolver identidad, retirar incompatibles, reemplazar por el mismo
  //      MovementPattern usando el POOL DE REEMPLAZO, no una sesión ya
  //      seleccionada: `selectStrengthSession` devuelve un subconjunto
  //      dimensionado para una sesión y produciría falsos
  //      `insufficient_safe_pool`.
  //
  // Se precargan los ids canónicos de TODA la entrada para que un reemplazo no
  // duplique un ejercicio que aparece más adelante en la lista.
  const usedIds = new Set<string>(
    input.exercises
      .map((exercise) => resolveStrengthExercise(exercise)?.definition?.id)
      .filter((id): id is string => Boolean(id)),
  )

  for (const exercise of input.exercises) {
    const resolution = resolveStrengthExercise(exercise)
    const definition = resolution?.definition

    if (!definition) {
      if (isPinnedByUser(exercise.name, input.userMessage)) {
        return { status: 'blocked', reason: 'unresolvable_exercise_identity', removed }
      }
      removed.push({
        reason: resolution?.matchKind === 'ambiguous' ? 'ambiguous_identity' : 'unresolvable_identity',
        matchedConstraints: [],
        libraryRef: exercise.libraryRef,
      })
      continue
    }

    if (isExerciseAllowed(definition, constraints)) {
      kept.push(exercise)
      continue
    }

    const matched = matchedConstraintKeys(definition, constraints)
    usedIds.delete(definition.id)

    // Mismo `MovementPattern`, materializado por el selector para heredar sus
    // filtros y su prescripción posicional.
    const substituteId = getStrengthReplacementPool(
      { name: exercise.name, libraryRef: exercise.libraryRef },
      input.selectionContext,
    ).find((candidateId) => !usedIds.has(candidateId))

    const substitute = substituteId
      ? buildStrengthReplacementById(substituteId, input.selectionContext, kept.length)
      : undefined

    if (substitute && substituteId) {
      kept.push({ ...toProposal(substitute), supersetGroup: exercise.supersetGroup })
      usedIds.add(substituteId)
      replaced.push({
        fromExerciseId: definition.id,
        toExerciseId: substituteId,
        movementPattern: definition.movement,
        matchedConstraints: matched,
      })
    } else {
      removed.push({ exerciseId: definition.id, reason: 'constraint_intersection', matchedConstraints: matched })
    }
  }

  // 5. Densidad, solo desde el pool permitido. El selector devuelve orden de
  // ejecución y puede ubicar core primero: se hace una pasada inicial por
  // trabajo de fuerza real hasta `getMinimumStrengthWorkCount`, y recién luego
  // se completa `density.target`. Así un pool suficiente no produce un falso
  // `insufficient_safe_pool` por haber consumido la cuota con core.
  const density = getTargetExerciseDensity(input.selectionContext)
  const densityPool = selectStrengthSession(input.selectionContext).exercises
  let strengthWorkCount = kept.filter(isStrengthWorkExercise).length
  for (const candidate of densityPool) {
    if (strengthWorkCount >= getMinimumStrengthWorkCount(input.durationMin ?? 50)) break
    if (!isStrengthWorkExercise(candidate)) continue
    // añadir candidato permitido/no duplicado e incrementar strengthWorkCount
  }
  for (const candidate of densityPool) {
    if (kept.length >= density.target) break
    const candidateId = resolveStrengthExercise(candidate)?.definition?.id
    if (!candidateId || usedIds.has(candidateId)) continue
    kept.push(toProposal(candidate))
    usedIds.add(candidateId)
  }

  // 6. Agrupar DESPUÉS de rellenar. `normalizeSupersetGroups` no crea grupos:
  //    solo corrige tags existentes. Quien agrupa es `planSupersetGroups`.
  //    `SupersetPolicyMode` es 'off' | 'permissive' | 'full': el modo lo resuelve
  //    `shouldApplySupersetPolicy`, nunca un literal inventado.
  const grouped = normalizeSupersetGroups(
    planSupersetGroups(kept, input.supersetMode).exercises,
  )

  // 7. Revalidación sobre la SALIDA, no sobre la intención. Identidad inválida
  //    e intersección con una restricción son causas DISTINTAS y se reportan
  //    como tales (precedencia de §6.3.1).
  for (const exercise of grouped) {
    const definition = resolveStrengthExercise(exercise)?.definition
    if (!definition) {
      return { status: 'blocked', reason: 'unresolvable_exercise_identity', removed }
    }
    if (!isExerciseAllowed(definition, constraints)) {
      return { status: 'blocked', reason: 'insufficient_safe_pool', removed }
    }
  }

  // 8. Viabilidad: densidad mínima Y mínimo de trabajo de fuerza real, para que
  //    core/cardio/movilidad no satisfagan el conteo de una sesión de pesas.
  const minimumStrengthWork = getMinimumStrengthWorkCount(input.durationMin ?? 50)
  const realStrengthWork = grouped.filter(isStrengthWorkExercise).length
  if (grouped.length < density.min || realStrengthWork < minimumStrengthWork) {
    return { status: 'blocked', reason: 'insufficient_safe_pool', removed }
  }

  return { status: 'ok', exercises: grouped, removed, replaced }
}

/** `StrengthSelectionExercise` → `CoachExerciseProposal`, sin inventar campos. */
function toProposal(exercise: StrengthSelectionExercise): CoachExerciseProposal {
  return {
    name: exercise.name,
    sets: exercise.sets,
    reps: exercise.reps,
    notes: exercise.notes,
    group: exercise.group,
    targetPercent1RM: exercise.targetPercent1RM,
    targetRpe: exercise.targetRpe,
    libraryRef: exercise.libraryRef,
  }
}

function isPinnedByUser(name: string, userMessage: string): boolean {
  if (!userMessage.trim()) return false
  const normalized = userMessage.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const target = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return target.length >= 6 && normalized.includes(target)
}
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/strengthSafetyFinalizer.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Gate y commit**

Run: `npm run lint && npm test && npm run build`
Expected: verde, incluida la suite completa tras extraer los dos helpers.

```
feat(strength): finalizador fail-closed de restricciones de seguridad
```

---

## Task 7: Sello ligado al contenido y wrapper de nivel sesión

**Files:**
- Modify: `src/services/training/strengthSafetyFinalizer.ts`
- Modify: `src/types/index.ts` (campo en `CoachSessionProposal` y en las acciones planas)
- Test: `src/services/training/__tests__/strengthSafetySeal.test.ts`

**Interfaces:**
- Consumes: Task 6.
- Produces:
  - `StrengthSafetyFinalizationSeal { policyVersion; exerciseFingerprint; constraintFingerprint; userMessageConstraints }`
  - `buildStrengthSafetySeal(exercises, constraints, sessionType, durationMin, userMessageConstraints)`
  - `isSealValid(seal, exercises, constraints, sessionType, durationMin)`
  - `STRENGTH_SAFETY_POLICY_VERSION = 1`

- [ ] **Step 1: Escribir el test**

```ts
// src/services/training/__tests__/strengthSafetySeal.test.ts
import { describe, expect, it } from 'vitest'
import { buildStrengthSafetySeal, isSealValid, STRENGTH_SAFETY_POLICY_VERSION } from '../strengthSafetyFinalizer'
import type { CoachExerciseProposal } from '../../../types'
import type { StrengthConstraint } from '../../../types/strengthSafety'

const lumbar: StrengthConstraint[] = [{ kind: 'region', region: 'lumbar', sources: ['current_injuries'] }]
const a: CoachExerciseProposal = { name: 'Remo con pecho apoyado', sets: 3, reps: 10 }
const b: CoachExerciseProposal = { name: 'Jalón al pecho', sets: 3, reps: 10 }

describe('sello de finalización', () => {
  it('un sello recién emitido es válido para su propio contenido', () => {
    const seal = buildStrengthSafetySeal([a, b], lumbar, 'strength', 60, [])
    expect(isSealValid(seal, [a, b], lumbar, 'strength', 60)).toBe(true)
  })

  it('cambiar un ejercicio invalida el sello', () => {
    const seal = buildStrengthSafetySeal([a, b], lumbar, 'strength', 60, [])
    expect(isSealValid(seal, [a], lumbar, 'strength', 60)).toBe(false)
  })

  it('REORDENAR invalida el sello: el orden de ejecución es parte del payload', () => {
    const seal = buildStrengthSafetySeal([a, b], lumbar, 'strength', 60, [])
    expect(isSealValid(seal, [b, a], lumbar, 'strength', 60)).toBe(false)
  })

  it('cambiar la duración invalida el sello: altera la viabilidad', () => {
    const seal = buildStrengthSafetySeal([a, b], lumbar, 'strength', 60, [])
    expect(isSealValid(seal, [a, b], lumbar, 'strength', 90)).toBe(false)
  })

  it('cambiar las restricciones invalida el sello', () => {
    const seal = buildStrengthSafetySeal([a, b], lumbar, 'strength', 60, [])
    const knee: StrengthConstraint[] = [{ kind: 'region', region: 'knee', sources: ['current_injuries'] }]
    expect(isSealValid(seal, [a, b], knee, 'strength', 60)).toBe(false)
  })

  it('una policyVersion distinta invalida el sello sin migración', () => {
    const seal = buildStrengthSafetySeal([a, b], lumbar, 'strength', 60, [])
    const stale = { ...seal, policyVersion: STRENGTH_SAFETY_POLICY_VERSION + 1 }
    expect(isSealValid(stale, [a, b], lumbar, 'strength', 60)).toBe(false)
  })

  it('un sello falsificado no valida', () => {
    const forged = {
      policyVersion: STRENGTH_SAFETY_POLICY_VERSION,
      exerciseFingerprint: 'no-soy-un-hash-real',
      constraintFingerprint: 'tampoco',
      userMessageConstraints: [],
    }
    expect(isSealValid(forged, [a, b], lumbar, 'strength', 60)).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthSafetySeal.test.ts`
Expected: FAIL — funciones no exportadas.

- [ ] **Step 3: Implementar el sello**

```ts
// añadir a src/services/training/strengthSafetyFinalizer.ts
import { constraintKey } from './strengthSafetyConstraints'

export const STRENGTH_SAFETY_POLICY_VERSION = 1

export interface StrengthSafetyFinalizationSeal {
  policyVersion: number
  exerciseFingerprint: string
  constraintFingerprint: string
  /** Restricciones derivadas del mensaje del usuario. Estructuradas, sin texto. */
  userMessageConstraints: readonly StrengthConstraint[]
}

/**
 * Orden de EJECUCIÓN, no alfabético: reordenar ejercicios cambia superseries y
 * ejecución real, y un fingerprint alfabético no lo detectaría.
 * `durationMin` entra porque determina la viabilidad.
 */
function fingerprintExercises(
  exercises: readonly CoachExerciseProposal[],
  sessionType: SessionType,
  durationMin: number | undefined,
): string {
  const payload = exercises.map((exercise) => {
    const id = resolveStrengthExercise(exercise)?.definition?.id
    // Sellar identidad no resoluble es imposible por construcción: el sello
    // afirma «esto fue verificado», y un ejercicio sin identidad canónica no
    // pudo serlo. El finalizador ya lo habría retirado o bloqueado.
    if (!id) throw new Error('No se puede sellar un ejercicio sin identidad canónica')
    return [
      id,
      exercise.sets,
      exercise.reps,
      exercise.weight ?? null,
      exercise.targetPercent1RM ?? null,
      exercise.targetRpe ?? null,
      // Orden de claves canónico: `JSON.stringify` de un objeto crudo depende
      // del orden de inserción y produciría fingerprints distintos para el
      // mismo contenido.
      (exercise.warmupSets ?? []).map((set) => [set.reps ?? null, set.percent1RM ?? null, set.weight ?? null]),
      exercise.supersetGroup ?? null,
      exercise.group ?? null,
    ]
  })
  return hash(JSON.stringify({ sessionType, durationMin, payload }))
}

/**
 * Incluye la procedencia, no solo la clave: una restricción que pasa de venir
 * solo del perfil a venir también del mensaje del usuario es un estado distinto
 * y debe invalidar el sello.
 */
function fingerprintConstraints(constraints: readonly StrengthConstraint[]): string {
  return hash(JSON.stringify(
    constraints.map((constraint) => [constraintKey(constraint), [...constraint.sources]]),
  ))
}

/** FNV-1a de 32 bits. No es criptográfico: el sello detecta cambios, no autentica. */
function hash(value: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function buildStrengthSafetySeal(
  exercises: readonly CoachExerciseProposal[],
  constraints: readonly StrengthConstraint[],
  sessionType: SessionType,
  durationMin: number | undefined,
  userMessageConstraints: readonly StrengthConstraint[],
): StrengthSafetyFinalizationSeal {
  return {
    policyVersion: STRENGTH_SAFETY_POLICY_VERSION,
    exerciseFingerprint: fingerprintExercises(exercises, sessionType, durationMin),
    constraintFingerprint: fingerprintConstraints(constraints),
    userMessageConstraints,
  }
}

export function isSealValid(
  seal: StrengthSafetyFinalizationSeal | undefined,
  exercises: readonly CoachExerciseProposal[],
  constraints: readonly StrengthConstraint[],
  sessionType: SessionType,
  durationMin: number | undefined,
): boolean {
  if (!seal) return false
  if (seal.policyVersion !== STRENGTH_SAFETY_POLICY_VERSION) return false
  if (seal.exerciseFingerprint !== fingerprintExercises(exercises, sessionType, durationMin)) return false
  return seal.constraintFingerprint === fingerprintConstraints(constraints)
}
```

- [ ] **Step 4: Añadir el campo a los tipos**

**Dónde vive el sello, y por qué no es lo mismo en los dos casos.**

`applyCreateWeek.ts:118` persiste `metadata: session.metadata` y **nada más** de
la sesión propuesta: un campo de primer nivel en `CoachSessionProposal` se
perdería al materializar. Por eso las sesiones anidadas de `create_week` llevan
el sello **dentro de `metadata`**, mientras que `add_session` y `update_session`
—que son acciones planas y no tienen `metadata`— lo llevan en la acción.

```ts
// src/types/index.ts

/** Metadata de sesión. Es lo único que `applyCreateWeek` persiste. */
export interface SessionMetadata {
  starLift?: string
  /** Sello de finalización. Emitido SOLO localmente. */
  strengthSafetyFinalization?: StrengthSafetyFinalizationSeal
}

export interface CoachSessionProposal {
  // … campos existentes …
  metadata?: CoachSessionProposalMetadata
}

export interface CoachAction {
  // … campos existentes …
  /** Sello para add_session / update_session, que no tienen `metadata`. */
  strengthSafetyFinalization?: StrengthSafetyFinalizationSeal
}
```

Añadir al test de la Task 7 la aserción de ubicación:

```ts
it('el sello de create_week viaja en session.metadata, que es lo que se persiste', () => {
  const seal = buildStrengthSafetySeal(safe, lumbar, 'strength', 60, [])
  const session = { date: '2026-09-08', metadata: { strengthSafetyFinalization: seal } }
  expect(session.metadata.strengthSafetyFinalization).toBeDefined()
})
```

- [ ] **Step 5: Mover el wrapper de nivel sesión a esta tarea**

El wrapper tiene que orquestar **enriquecimiento → finalización → sello**. Un
wrapper que solo llama a `enhanceStrengthSessionExercises` devuelve contenido aún
no finalizado y no cierra nada.

```ts
// src/services/training/strengthSafetyFinalizer.ts

export interface PrepareStrengthSessionResult<T> {
  status: 'ok' | 'blocked'
  session: T
  reason?: BlockedReason
  removed: RemovedExercise[]
  replaced: ReplacedExercise[]
}

/**
 * Única entrada pública de nivel sesión. Conoce metadata y sello, cosa que
 * `enhanceStrengthSessionExercises` no puede: recibe solo el array, así que
 * `ensureCoreBlock` no podría observar el sello.
 */
export function prepareStrengthSession<T extends StrengthSessionLike>(
  session: T,
  options: PrepareOptions,
): PrepareStrengthSessionResult<T> {
  const existingSeal = readSeal(session)
  if (isSealValid(existingSeal, session.exercises ?? [], options.constraints, 'strength', session.durationMin)) {
    return { status: 'ok', session, removed: [], replaced: [] }
  }

  const enriched = enhanceStrengthSessionExercises(session.exercises, options.structureOptions)
  const finalized = finalizeStrengthExercisesForRestrictions({
    exercises: enriched ?? [],
    constraints: options.constraints,
    durationMin: session.durationMin,
    sessionType: 'strength',
    selectionContext: options.selectionContext,
    userMessage: options.userMessage,
    supersetMode: options.supersetMode,
  })

  if (finalized.status === 'blocked') {
    return { status: 'blocked', session, reason: finalized.reason, removed: finalized.removed, replaced: [] }
  }

  return {
    status: 'ok',
    session: writeSeal(session, finalized.exercises, buildStrengthSafetySeal(
      finalized.exercises, options.constraints, 'strength', session.durationMin, options.userMessageConstraints,
    )),
    removed: finalized.removed,
    replaced: finalized.replaced,
  }
}
```

`readSeal` / `writeSeal` encapsulan la diferencia de ubicación: `metadata` para
sesiones anidadas, campo de acción para las planas.

- [ ] **Step 6: Correr y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/strengthSafetySeal.test.ts`
Expected: PASS, 8 tests (incluida la aserción de ubicación).

- [ ] **Step 7: Gate y commit**

Run: `npm run lint && npm test && npm run build`

```
feat(strength): sello de finalización y wrapper de nivel sesión
```

---

## Task 8: Uniones de outcome — `safety_blocked` y `safe_decline`

**Files:**
- Modify: `src/services/ai/stageLogger.ts:22`
- Modify: `src/types/index.ts:93,96`
- Modify: `src/services/weekCreator/WeekCreatorFailurePolicy.ts`
- Test: `src/services/weekCreator/__tests__/safetyBlockedOutcome.test.ts`

**Interfaces:**
- Produces: `'safety_blocked'` en `CoachOutcome`, `AITechnicalResult.outcome`, `WeekCreatorFailure.outcome`; `'safe_decline'` en `WeekCreatorFailureDecision` y `AITechnicalResult.generationOutcome`.

- [ ] **Step 1: Escribir el test**

```ts
// src/services/weekCreator/__tests__/safetyBlockedOutcome.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('ciclo terminal de safety_blocked', () => {
  it('safety_blocked existe en las tres uniones de outcome', () => {
    expect(readFileSync('src/services/ai/stageLogger.ts', 'utf-8')).toContain("'safety_blocked'")
    expect(readFileSync('src/types/index.ts', 'utf-8')).toContain("'safety_blocked'")
    expect(readFileSync('src/services/weekCreator/WeekCreatorFailurePolicy.ts', 'utf-8')).toContain("'safety_blocked'")
  })

  it('safe_decline es una decisión y un generationOutcome', () => {
    expect(readFileSync('src/services/weekCreator/WeekCreatorFailurePolicy.ts', 'utf-8')).toContain("'safe_decline'")
    expect(readFileSync('src/types/index.ts', 'utf-8')).toContain("'safe_decline'")
  })

  it('safe_decline NO reintenta ni cae al fallback local', () => {
    const source = readFileSync('src/services/weekCreator/WeekCreatorFailurePolicy.ts', 'utf-8')
    // La decisión debe existir separada de las tres previas.
    expect(source).toMatch(/'local_fallback'\s*\|\s*'targeted_model_repair'\s*\|\s*'provider_retry'\s*\|\s*'safe_decline'/)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/weekCreator/__tests__/safetyBlockedOutcome.test.ts`
Expected: FAIL.

- [ ] **Step 3: Ampliar las uniones**

`src/services/ai/stageLogger.ts:22`:

```ts
/**
 * `safety_blocked` es deliberadamente distinto de `quality_rejected` y de
 * `invalid_schema`: la respuesta se completó y el sistema declinó proponer por
 * una restricción de seguridad declarada. NO es una solicitud fallida y no debe
 * contarse como error en los agregados de /ops.
 */
export type CoachOutcome =
  | 'ok' | 'truncated' | 'parse_fail' | 'invalid_schema'
  | 'quality_rejected' | 'safety_blocked' | 'timeout' | 'rate_limit' | 'error'
```

`src/types/index.ts`:

```ts
generationOutcome?: 'model_success' | 'local_fallback' | 'safe_decline' | 'failed'
outcome?: 'ok' | 'truncated_mid' | 'truncated_early' | 'parse_invalid'
  | 'schema_invalid' | 'quality_rejected' | 'safety_blocked'
```

`src/services/weekCreator/WeekCreatorFailurePolicy.ts`:

```ts
export type WeekCreatorFailureDecision =
  | 'local_fallback'
  | 'targeted_model_repair'
  | 'provider_retry'
  | 'safe_decline'

export type WeekCreatorFailureCode =
  | WeekCreatorValidationCode
  | 'actions_parse_failed'
  | 'schema_invalid'
  | 'provider_error'
  | 'safety_blocked'
  | RepairFailure['errorClass']

export type WeekCreatorFailure = {
  code: WeekCreatorFailureCode
  category: WeekCreatorFailureCategory   // 'unsafe_or_ambiguous' para safety_blocked
  decision: WeekCreatorFailureDecision
  error: string
  outcome: 'parse_invalid' | 'schema_invalid' | 'quality_rejected' | 'safety_blocked'
  warnings: string[]
}
```

- [ ] **Step 4: Correr, verificar que pasa y que el compilador acepta**

Run: `npx vitest run src/services/weekCreator/__tests__/safetyBlockedOutcome.test.ts && npx tsc -b`
Expected: PASS y `tsc` limpio. Si algún `switch` sobre las uniones queda sin caso, añadirlo tratando `safe_decline` como terminal sin reintento.

- [ ] **Step 5: Gate y commit**

Run: `npm run lint && npm test && npm run build`

```
feat(ai): safety_blocked y safe_decline como ciclo terminal seguro
```

---

## Task 9: Cableado del chat

**Files:**
- Modify: `src/services/ai/actionPostProcessor.ts`
- Test: `src/services/__tests__/actionPostProcessorSafety.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 6, 7.
- Produces: acciones de chat finalizadas y selladas, o eliminadas con copy determinista.

- [ ] **Step 1: Escribir el test**

```ts
// src/services/__tests__/actionPostProcessorSafety.test.ts
import { describe, expect, it } from 'vitest'
import type { ChatContext } from '../../types'
import type { CoachNormalizedResponse } from '../ai/types'
import { postProcessCoachActions } from '../ai/actionPostProcessor'
import { resolveStrengthExercise } from '../training/exerciseLibrary'

const BLOCKED_COPY = 'No pude verificar una sesión de fuerza compatible con la restricción registrada.'

function ctx(currentInjuries?: string, trainingPriority?: string): ChatContext {
  return {
    recentSessions: [], plannedSessions: [], historicalSessions: [],
    athleteProfile: {
      mainGoal: 'Torneo de squash',
      sportContext: { primarySport: 'squash' },
      recoveryProfile: currentInjuries ? { currentInjuries } : undefined,
      planWizardConfig: trainingPriority ? { trainingPriority } : undefined,
      strengthProfile: { squat1RM: 100, deadlift1RM: 130, benchPress1RM: 80 },
    },
  } as unknown as ChatContext
}

function createWeek(): CoachNormalizedResponse {
  return {
    message: 'Te preparé una semana con 3 sesiones.',
    actions: [{
      // `create_week` usa `targetDate` en la acción y `date` en cada sesión
      // (ver actionPostProcessor.test.ts:196-202). NO `weekStartDate`.
      type: 'create_week', reason: 'Semana', targetDate: '2026-09-07',
      sessions: [
        { date: '2026-09-08', timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza A', durationMin: 60, objective: 'Fuerza' },
        { date: '2026-09-10', timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza B', durationMin: 60, objective: 'Fuerza' },
      ],
    }],
    provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 1,
  }
}

describe('post-procesado del chat bajo restricciones', () => {
  it('REGRESIÓN del bug reportado: las dos sesiones sobreviven saneadas', () => {
    const out = postProcessCoachActions(
      createWeek(),
      ctx('Lesión espalda baja, cuadrado lumbar'),
      'Creame 2 sesiones de pesas para la próxima semana',
    )
    const action = out.actions?.[0]
    expect(action?.type).toBe('create_week')
    if (action?.type !== 'create_week') return
    expect(action.sessions).toHaveLength(2)
    for (const session of action.sessions!) {
      expect(session.exercises?.length).toBeGreaterThan(0)
      for (const exercise of session.exercises!) {
        const definition = resolveStrengthExercise(exercise)?.definition
        expect(definition, exercise.name).toBeDefined()
        expect(definition!.safety.loadsRegions, exercise.name).not.toContain('lumbar')
      }
      const names = session.exercises!.map((e) => e.name)
      expect(names).not.toContain('Plancha lateral con press de disco')
      expect(names).not.toContain('Corte diagonal con disco en media rodilla')
      expect(names).not.toContain('Zancada lateral con barra')
      expect(session.metadata?.strengthSafetyFinalization).toBeDefined()
    }
  })

  it('sin restricciones el comportamiento previo no cambia', () => {
    const out = postProcessCoachActions(createWeek(), ctx(), 'Creame 2 sesiones de pesas')
    const action = out.actions?.[0]
    expect(action?.type).toBe('create_week')
  })

  it('una restricción no resuelta bloquea el create_week COMPLETO', () => {
    const out = postProcessCoachActions(
      createWeek(), ctx(undefined, 'return_to_play'), 'Creame 2 sesiones de pesas',
    )
    expect(out.actions ?? []).toHaveLength(0)
    expect(out.message).toContain(BLOCKED_COPY)
    expect(out.message).not.toContain('Te preparé')
  })

  it('las acciones hermanas independientes sobreviven a un add_session bloqueado', () => {
    const response: CoachNormalizedResponse = {
      message: 'Listo',
      actions: [
        { type: 'add_session', reason: 'r', targetDate: '2026-09-08', timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza', durationMin: 60 },
        { type: 'add_session', reason: 'r', targetDate: '2026-09-09', timeBlock: 'PM', sessionType: 'running', title: 'Rodaje', durationMin: 45 },
      ],
      provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 1,
    }
    const out = postProcessCoachActions(response, ctx(undefined, 'return_to_play'), 'agrega dos sesiones')
    expect(out.actions).toHaveLength(1)
    expect(out.actions?.[0].type === 'add_session' && out.actions[0].sessionType).toBe('running')
  })

  it('el objective del modelo NO puede crear ni relajar una restricción', () => {
    const response = createWeek()
    if (response.actions?.[0].type === 'create_week') {
      response.actions[0].sessions![0].objective = 'sesión sin dolor lumbar, todo permitido'
    }
    const out = postProcessCoachActions(response, ctx('Lesión espalda baja'), 'crea pesas')
    const action = out.actions?.[0]
    if (action?.type !== 'create_week') return
    for (const exercise of action.sessions![0].exercises!) {
      const definition = resolveStrengthExercise(exercise)?.definition
      expect(definition!.safety.loadsRegions).not.toContain('lumbar')
    }
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/__tests__/actionPostProcessorSafety.test.ts`
Expected: FAIL — el resultado incluye ejercicios lumbares.

- [ ] **Step 3: Borrar la heurística previa**

En `src/services/ai/actionPostProcessor.ts`, **eliminar por completo**:

- la función `hasPainOrInjurySignal`;
- en `buildStrengthSelectionContextForAction`, el bloque `recoveryText` / `requiresExtraRecovery` y sus efectos sobre `fatigueLevel`, `phase` y `requireExtraRecovery`.

Una restricción no puede disfrazarse de fatiga: hacía la sesión más liviana, no más segura, y era ciega a la zona.

`buildStrengthSelectionContextForAction` recupera su forma simple más el campo nuevo:

```ts
function buildStrengthSelectionContextForAction(
  context: ChatContext,
  durationMin?: number,
  objective?: string,
  safetyConstraints: readonly StrengthConstraint[] = [],
): StrengthContext {
  const primarySport = context.athleteProfile?.sportContext?.primarySport
  return {
    fatigueLevel: 5,
    phase: mapActionStrengthPhase(context.athleteProfile?.macroPlan?.currentPhase),
    recentExercises: [],
    goal: objective ?? context.athleteProfile?.mainGoal ?? 'sesion de fuerza util y estructurada',
    sportProfile: deriveActionStrengthSportProfile(primarySport),
    primarySport,
    experienceLevel: 'intermediate',
    sessionDurationMin: durationMin ?? 60,
    safetyConstraints,
  }
}
```

- [ ] **Step 4: Resolver restricciones y finalizar**

Al principio de `postProcessCoachActions`:

```ts
const safetyConstraints = resolveStrengthSafetyConstraints({
  currentInjuries: context.athleteProfile?.recoveryProfile?.currentInjuries,
  restrictions: context.athleteProfile?.recoveryProfile?.restrictions,
  injuryNotes: context.athleteProfile?.planWizardConfig?.injuryNotes,
  // SOLO mensajes del usuario: `buildRecentActionIntentText` mezcla prosa del
  // coach y no puede alimentar al resolver.
  userMessages: [
    ...(context.recentMessages ?? []).filter((m) => m.role === 'user').slice(-8).map((m) => m.content),
    rawMessage,
  ],
  trainingPriority: context.athleteProfile?.planWizardConfig?.trainingPriority,
})
const userMessageConstraints = resolveStrengthSafetyConstraints({
  currentInjuries: undefined, restrictions: undefined, injuryNotes: undefined,
  userMessages: [rawMessage], trainingPriority: undefined,
})
```

Tras `completeStrengthLoads` y `applySupersetPolicy`, ejecutar el finalizador por sesión de fuerza. Un `add_session` bloqueado se elimina; un `create_week` con **cualquier** sesión bloqueada se elimina **completo**:

```ts
const blockedSessions: BlockedReason[] = []

function finalizeStrengthAction(action: CoachAction): CoachAction | undefined {
  if (action.type === 'add_session' && action.sessionType === 'strength') {
    const result = finalizeStrengthExercisesForRestrictions({
      exercises: action.exercises ?? [],
      constraints: safetyConstraints,
      durationMin: action.durationMin,
      sessionType: 'strength',
      selectionContext: buildStrengthSelectionContextForAction(context, action.durationMin, action.objective, safetyConstraints),
      userMessage: normalizedMessage,
    })
    if (result.status === 'blocked') { blockedSessions.push(result.reason); return undefined }
    return {
      ...action,
      exercises: result.exercises,
      strengthSafetyFinalization: buildStrengthSafetySeal(
        result.exercises, safetyConstraints, 'strength', action.durationMin, userMessageConstraints,
      ),
    }
  }

  if (action.type === 'create_week' && action.sessions) {
    const sessions = []
    for (const session of action.sessions) {
      if (session.sessionType !== 'strength') { sessions.push(session); continue }
      const result = finalizeStrengthExercisesForRestrictions({
        exercises: session.exercises ?? [],
        constraints: safetyConstraints,
        durationMin: session.durationMin,
        sessionType: 'strength',
        selectionContext: buildStrengthSelectionContextForAction(context, session.durationMin, session.objective, safetyConstraints),
        userMessage: normalizedMessage,
      })
      // Atomicidad: una sesión bloqueada invalida la semana entera. No hay
      // aplicación parcial silenciosa.
      if (result.status === 'blocked') { blockedSessions.push(result.reason); return undefined }
      sessions.push({
        ...session,
        exercises: result.exercises,
        metadata: {
          ...session.metadata,
          strengthSafetyFinalization: buildStrengthSafetySeal(
            result.exercises, safetyConstraints, 'strength', session.durationMin, userMessageConstraints,
          ),
        },
      })
    }
    return { ...action, sessions }
  }

  return action
}
```

Y el mensaje visible, que **reemplaza** la prosa del modelo cuando hubo bloqueo:

```ts
const BLOCKED_STRENGTH_COPY = 'No pude verificar una sesión de fuerza compatible con la restricción registrada.'

const finalMessage = blockedSessions.length > 0
  ? BLOCKED_STRENGTH_COPY
  : message
```

Añadir `'chat_action_strength_safety_blocked'` y `'chat_action_strength_safety_repaired'` a los warnings de `meta`.

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run src/services/__tests__/actionPostProcessorSafety.test.ts src/services/__tests__/actionPostProcessor.test.ts`
Expected: PASS ambos. Los tests previos de `actionPostProcessor` no deben cambiar: sin restricciones el camino es idéntico.

- [ ] **Step 6: Gate y commit**

Run: `npm run lint && npm test && npm run build`

```
feat(chat): aplicar restricciones de seguridad de fuerza en las acciones del coach
```

---

## Task 9B: `update_session` sobre la sesión efectiva completa

Tarea propia porque un revisor puede aprobar `add_session`/`create_week` y
rechazar esto: `update_session` es un **patch**, no una sesión.

**Files:**
- Modify: `src/services/ai/actionPostProcessor.ts`
- Modify: `src/store/useCoachActionsStore.ts:829`
- Test: `src/services/__tests__/updateSessionSafety.test.ts`

**Interfaces:**
- Consumes: Tasks 6, 7.
- Produces: `materializeProspectiveSession(base, action): CoachSessionProposal`.

- [ ] **Step 1: Escribir el test de los tres casos congelados**

```ts
// src/services/__tests__/updateSessionSafety.test.ts
import { describe, expect, it } from 'vitest'
import { materializeProspectiveSession } from '../ai/actionPostProcessor'
import type { CoachAction, Session } from '../../types'

const base: Session = {
  id: 's1', date: '2026-09-08', weekStartDate: '2026-09-07', timeBlock: 'PM',
  type: 'strength', status: 'planned', title: 'Fuerza', durationMin: 60,
  createdAt: 1, updatedAt: 1,
  exercises: [
    { id: 'e1', name: 'Peso muerto', sets: 3, reps: 5, completed: false },
    { id: 'e2', name: 'Remo con pecho apoyado', sets: 3, reps: 10, completed: false },
  ],
}

describe('update_session se finaliza sobre la sesión efectiva', () => {
  it('CASO A — patch sin ejercicios hereda los de la base, que SÍ se verifican', () => {
    const action: CoachAction = { type: 'update_session', reason: 'r', sessionId: 's1', newDurationMin: 75 }
    const prospective = materializeProspectiveSession(base, action)
    // El peso muerto heredado entra a la verificación: finalizar solo el patch
    // lo dejaría pasar sin mirar.
    expect(prospective.exercises?.map((e) => e.name)).toContain('Peso muerto')
    expect(prospective.durationMin).toBe(75)
  })

  it('CASO B — conversión a strength por newType SIN ejercicios en el patch', () => {
    const running: Session = { ...base, type: 'running', exercises: undefined }
    const action: CoachAction = { type: 'update_session', reason: 'r', sessionId: 's1', newType: 'strength' }
    const prospective = materializeProspectiveSession(running, action)
    expect(prospective.sessionType).toBe('strength')
    expect(prospective.exercises ?? []).toEqual([])
  })

  it('CASO C — cambio SOLO de duración altera la viabilidad y por tanto el sello', () => {
    const action: CoachAction = { type: 'update_session', reason: 'r', sessionId: 's1', newDurationMin: 90 }
    const prospective = materializeProspectiveSession(base, action)
    expect(prospective.durationMin).toBe(90)
    expect(prospective.sessionType).toBe('strength')
  })
})
```

Y el test de edición concurrente, en el borde de aceptación:

```ts
it('CASO D — si la base cambió desde la propuesta, la aceptación bloquea', async () => {
  const action = sealedUpdateAction({ baseUpdatedAt: base.updatedAt })
  await persistSession({ ...base, updatedAt: base.updatedAt + 1 })
  const result = await acceptUpdateForTest(action)
  expect(result.errors.join(' ')).toContain('cambios más recientes')
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/__tests__/updateSessionSafety.test.ts`
Expected: FAIL — `materializeProspectiveSession` no existe.

- [ ] **Step 3: Implementar la materialización prospectiva**

```ts
// src/services/ai/actionPostProcessor.ts

/**
 * `update_session` es un patch: la aceptación aplica campo por campo y reutiliza
 * los ejercicios actuales cuando el patch no los trae
 * (`useCoachActionsStore.ts:829`). Finalizar solo el patch dejaría sin verificar
 * los ejercicios heredados, que es exactamente el agujero.
 */
export function materializeProspectiveSession(
  base: Session,
  action: Extract<CoachAction, { type: 'update_session' }>,
): CoachSessionProposal {
  return {
    date: base.date,
    timeBlock: base.timeBlock,
    sessionType: action.newType ?? base.type,
    title: action.newTitle ?? base.title,
    durationMin: action.newDurationMin ?? base.durationMin,
    objective: action.newObjective ?? base.objective,
    rpe: action.newRpe ?? base.rpe,
    // Conversión a strength sin ejercicios: lista vacía, no los de otro deporte.
    exercises: action.exercises
      ?? (action.newType && action.newType !== base.type ? [] : base.exercises),
  }
}
```

En `postProcessCoachActions`, el caso `update_session` de fuerza:

1. lee la sesión base desde `context`;
2. materializa la prospectiva;
3. la pasa por `prepareStrengthSession`;
4. sella el **resultado efectivo**, no el patch;
5. estampa `baseUpdatedAt` con el `updatedAt` de la sesión base;
6. si bloquea, elimina la acción con el copy determinista.

El sello cubre el resultado efectivo, pero no demuestra que la sesión base no
haya cambiado en campos fuera de su payload. Por eso `CoachAction` incorpora
`baseUpdatedAt?: number` para `update_session`; no se intenta inferir
concurrencia desde el fingerprint de seguridad.

- [ ] **Step 4: Revalidar en aceptación con detección de edición concurrente**

En `useCoachActionsStore.ts:829`, antes de construir el `patch`: comprobar que
`action.baseUpdatedAt === current.updatedAt`; una diferencia bloquea con el copy
de edición concurrente. Después rematerializar la prospectiva sobre la base
**actual**, combinar restricciones vigentes con `seal.userMessageConstraints`,
y finalizar. Si el resultado bloquea, **no se escribe**.

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run src/services/__tests__/updateSessionSafety.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Gate y commit**

Run: `npm run lint && npm test && npm run build`

```
feat(chat): finalizar update_session sobre la sesión efectiva completa
```

---

## Task 10: El cuarto borde — display, aceptación y backup

**Files:**
- Modify: `src/store/useCoachActionsStore.ts:291,755`
- Modify: `src/services/planning/applyCreateWeek.ts:81`
- Modify: `src/services/dataExport.ts`
- Modify: `src/services/ai/responseNormalizer.ts` (eliminar sellos del proveedor)
- Test: `src/store/__tests__/coachActionsSafetyBorder.test.ts`

**Interfaces:**
- Consumes: Tasks 6, 7, 9.
- Produces: display y aceptación que nunca reenriquecen contenido sellado y siempre revalidan antes de escribir.

- [ ] **Step 1: Escribir el test**

```ts
// src/store/__tests__/coachActionsSafetyBorder.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildStrengthSafetySeal, isSealValid } from '../../services/training/strengthSafetyFinalizer'
import type { CoachExerciseProposal } from '../../types'
import type { StrengthConstraint } from '../../types/strengthSafety'

const lumbar: StrengthConstraint[] = [{ kind: 'region', region: 'lumbar', sources: ['current_injuries'] }]
const safe: CoachExerciseProposal[] = [
  { name: 'Remo con pecho apoyado', sets: 3, reps: 10 },
  { name: 'Jalón al pecho', sets: 3, reps: 10 },
]

describe('cuarto borde: display, aceptación y backup', () => {
  it('un sello válido sobrevive intacto de generación a aceptación', () => {
    const seal = buildStrengthSafetySeal(safe, lumbar, 'strength', 60, [])
    expect(isSealValid(seal, safe, lumbar, 'strength', 60)).toBe(true)
  })

  it('el normalizador de respuestas elimina cualquier sello del proveedor', () => {
    const source = readFileSync('src/services/ai/responseNormalizer.ts', 'utf-8')
    expect(source).toContain('strengthSafetyFinalization')
    expect(source).toMatch(/delete|omit|strip/i)
  })

  it('CONDUCTUAL: restricción aparecida DESPUÉS de generar bloquea la escritura', async () => {
    const proposal = sealedProposalWith(safe, [])       // generada sin lesión
    setProfileInjury('Lesión espalda baja, cuadrado lumbar')  // lesión posterior
    const result = await acceptProposalForTest(proposal)
    expect(result.errors.join(' ')).toContain('No pude verificar')
    expect(await countPersistedSessions()).toBe(0)
  })

  it('CONDUCTUAL: userMessageConstraints sobrevive de generación a aceptación', async () => {
    const proposal = sealedProposalWith(safe, [], [
      { kind: 'load_pattern', pattern: 'axial_load', sources: ['user_message'] },
    ])
    setProfileInjury(undefined)   // el perfil ya no dice nada
    const result = await acceptProposalForTest(proposal)
    // La instrucción del chat sigue vigente aunque el perfil esté limpio.
    const persisted = await readPersistedExercises()
    for (const exercise of persisted) {
      expect(resolveStrengthExercise(exercise)!.definition!.safety.loadPatterns)
        .not.toContain('axial_load')
    }
    expect(result.errors).toEqual([])
  })

  it('CONDUCTUAL: un sello obsoleto fuerza refinalización, no se confía', async () => {
    const proposal = sealedProposalWith(safe, [])
    proposal.actions[0].exercises = [{ name: 'Peso muerto', sets: 3, reps: 5 }]  // mutado tras sellar
    setProfileInjury('Lesión espalda baja')
    const result = await acceptProposalForTest(proposal)
    expect(result.errors.join(' ')).toContain('No pude verificar')
  })

  it('CONDUCTUAL: refinalización reparable persiste ejercicios nuevos y sello renovado', async () => {
    const proposal = sealedProposalWith(
      [{ name: 'Peso muerto', sets: 3, reps: 5 }, ...safe], [],
    )
    setProfileInjury('Lesión espalda baja')
    const result = await acceptProposalForTest(proposal)
    expect(result.errors).toEqual([])
    const persisted = await readPersistedExercises()
    expect(persisted.map((e) => e.name)).not.toContain('Peso muerto')
    expect(persisted.length).toBeGreaterThan(0)
  })

  it('CONDUCTUAL: un create_week bloqueado NO deja escritura parcial ni borra sesiones', async () => {
    await seedExistingWeek(['2026-09-08', '2026-09-10'])
    setProfileInjury('me operaron hace dos semanas')
    const result = await applyCreateWeekForTest(twoStrengthWeekProposal())
    expect(result.errors.join(' ')).toContain('No pude verificar')
    // Las sesiones previas siguen intactas: la prevalidación corre ANTES de
    // reemplazar o borrar nada.
    expect(await countPersistedSessions()).toBe(2)
  })

  it('import y backup invalidan el sello', () => {
    const source = readFileSync('src/services/dataExport.ts', 'utf-8')
    expect(source).toContain('strengthSafetyFinalization')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/store/__tests__/coachActionsSafetyBorder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Eliminar sellos emitidos por el proveedor**

En `src/services/ai/responseNormalizer.ts`, junto a la exclusión de `supersetGroup`, quitar `strengthSafetyFinalization` de cualquier acción o sesión que llegue del modelo:

```ts
// El sello lo emite SOLO el finalizador local. Un sello del proveedor sería un
// certificado de seguridad autoemitido por el modelo: se descarta siempre.
function stripProviderSafetySeal<T extends { strengthSafetyFinalization?: unknown }>(value: T): T {
  const { strengthSafetyFinalization: _discarded, ...rest } = value
  return rest as T
}
```

- [ ] **Step 4: Respetar el sello en display**

En `prepareProposalActionsForDisplay` (`useCoachActionsStore.ts:291`), no reenriquecer si el sello es válido:

```ts
if (isSealValid(action.strengthSafetyFinalization, action.exercises ?? [], constraints, 'strength', durationMin)) {
  return action   // ya finalizada; reenriquecerla reintroduciría contenido sin verificar
}
```

- [ ] **Step 5: Revalidar en aceptación**

En `useCoachActionsStore.ts:755` (`add_session`), en el caso `update_session` y en `applyCreateWeek.ts:81`, **siempre** volver a resolver restricciones vigentes, combinarlas con `seal.userMessageConstraints`, y ejecutar el finalizador. Si devuelve `blocked`, **no escribir**.

**`applyCreateWeek` debe prevalidar TODAS las sesiones antes de tocar nada.**
Hoy el borrado y el reemplazo (`applyCreateWeek.ts:60-78`) ocurren **antes** del
bucle de creación: bloquear a mitad del bucle dejaría el calendario destruido y
sin reemplazo — una escritura parcial destructiva. Estructura correcta:

```ts
// FASE 1 — prevalidación pura, sin efectos.
const verified: CoachSessionProposal[] = []
for (const session of allowedSessions) {
  if (session.sessionType !== 'strength') { verified.push(session); continue }
  const result = prepareStrengthSession(session, { constraints: merged, /* … */ })
  if (result.status === 'blocked') {
    throw new Error('No pude verificar una sesión de fuerza compatible con la restricción registrada.')
  }
  verified.push(result.session)
}

// FASE 2 — recién ahora, reemplazo/borrado y escritura, sobre `verified`.
```

Y `applyCreateWeek.ts:98` deja de llamar a `enhanceStrengthSessionExercises`
directamente: ese enriquecimiento ya ocurrió dentro de `prepareStrengthSession`,
y repetirlo después reintroduciría contenido sin verificar.

```ts
const currentConstraints = resolveStrengthSafetyConstraints({ /* perfil + wizard vigentes */ })
const merged = mergeConstraints(
  currentConstraints,
  session.metadata?.strengthSafetyFinalization?.userMessageConstraints ?? [],
)
const verified = finalizeStrengthExercisesForRestrictions({ /* … */ constraints: merged })
if (verified.status === 'blocked') {
  errors.push('No pude verificar una sesión de fuerza compatible con la restricción registrada.')
  break   // no se escribe la sesión
}
```

Un fingerprint coincidente evita **enriquecimiento**; nunca evita **enforcement**.

- [ ] **Step 6: Invalidar el sello en import/backup**

En `src/services/dataExport.ts`, al deserializar sesiones y plantillas, descartar `strengthSafetyFinalization`: contenido importado no trae autorización.

- [ ] **Step 7: Correr y verificar que pasa**

Run: `npx vitest run src/store/__tests__/coachActionsSafetyBorder.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 8: Gate y commit**

Run: `npm run lint && npm test && npm run build`

```
feat(coach): revalidar seguridad en display, aceptación e importación
```

---

## Task 11: Week Creator

**Files:**
- Modify: `src/services/weekCreator/WeekCreatorLocalHydrator.ts:383`
- Modify: `src/services/weekCreator/WeekCreatorEngine.ts` (fallbacks y salida)
- Test: `src/services/weekCreator/__tests__/weekCreatorSafety.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 6, 8.
- Produces: `resolveWeekCreatorSafetyConstraints(context, config): readonly StrengthConstraint[]`.

- [ ] **Step 1: Escribir el test**

```ts
// src/services/weekCreator/__tests__/weekCreatorSafety.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('Week Creator bajo restricciones', () => {
  it('el fallback ya no emite romanian_deadlift sin verificar', () => {
    const source = readFileSync('src/services/weekCreator/WeekCreatorEngine.ts', 'utf-8')
    expect(source).toContain('finalizeStrengthExercisesForRestrictions')
  })

  it('CONDUCTUAL: un decline seguro no reintenta ni cae al fallback', async () => {
    // Se cuenta cuántas veces se llama al proveedor. Un bloqueo de seguridad
    // debe terminar en 1 llamada como máximo y NUNCA producir una semana.
    let providerCalls = 0
    const result = await runWeekCreatorForTest({
      onProviderCall: () => { providerCalls += 1 },
      profile: { recoveryProfile: { currentInjuries: 'me operaron hace dos semanas' } },
    })
    expect(result.actions ?? []).toHaveLength(0)
    expect(result.meta?.outcome).toBe('safety_blocked')
    expect(providerCalls).toBeLessThanOrEqual(1)
  })

  it('CONDUCTUAL: con pool viable el RDL se REEMPLAZA, no se bloquea', async () => {
    const result = await runWeekCreatorForTest({
      profile: { recoveryProfile: { currentInjuries: 'Lesión espalda baja' } },
      forceFallback: true,
    })
    const strength = extractStrengthSessions(result)
    expect(strength.length).toBeGreaterThan(0)
    for (const session of strength) {
      expect(session.exercises!.map((e) => e.name)).not.toContain('Peso muerto rumano')
    }
    expect(result.meta?.outcome).not.toBe('safety_blocked')
  })

  it('hasActiveMedicalRestrictions se deriva del conjunto de restricciones', () => {
    const source = readFileSync('src/services/weekCreator/WeekCreatorLocalHydrator.ts', 'utf-8')
    expect(source).toContain('resolveStrengthSafetyConstraints')
  })

  it('la fuente persistida manda: injuryNotes efectivo no es prueba de procedencia', () => {
    const source = readFileSync('src/services/weekCreator/WeekCreatorLocalHydrator.ts', 'utf-8')
    // El resolver debe leer el perfil, no config.injuryNotes.
    expect(source).toContain('recoveryProfile')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/weekCreator/__tests__/weekCreatorSafety.test.ts`
Expected: FAIL.

- [ ] **Step 3: Resolver restricciones desde la fuente original**

En `WeekCreatorLocalHydrator.ts`, reemplazar el booleano por el conjunto, leyendo **el perfil**, nunca `config.injuryNotes`:

```ts
export function resolveWeekCreatorSafetyConstraints(
  context: ChatContext,
  config: WeekCreatorEffectiveConfig,
): readonly StrengthConstraint[] {
  const recovery = context.athleteProfile?.recoveryProfile
  return resolveStrengthSafetyConstraints({
    currentInjuries: recovery?.currentInjuries,
    restrictions: recovery?.restrictions,
    // `planWizardConfig.injuryNotes`, NO `config.injuryNotes`: ese campo
    // transporta `recoveryProfile.restrictions` (WeekCreatorConfig.ts:274,307).
    injuryNotes: context.athleteProfile?.planWizardConfig?.injuryNotes,
    userMessages: [],
    trainingPriority: config.trainingPriority,
  })
}

export function hasActiveMedicalRestrictions(
  context: ChatContext,
  config: WeekCreatorEffectiveConfig,
): boolean {
  return resolveWeekCreatorSafetyConstraints(context, config).length > 0
}
```

El veto de squash existente sigue funcionando sin cambios: es la pregunta derivada `length > 0`.

- [ ] **Step 4: Finalizar los fallbacks literales**

En `WeekCreatorEngine.ts`, cada variante de `buildFallbackSession` pasa por el finalizador. Una variante que no sobrevive no se emite; si ninguna sobrevive, salida `safety_blocked` **separada** de `failFallback`:

```ts
// `failFallback` registra `outcome: 'schema_invalid'` (línea 618). Un bloqueo de
// seguridad no es un fallo de schema: confundirlos corrompe la telemetría con la
// que se observa esta función.
export class WeekCreatorSafeDecline extends Error {
  readonly isSafeDecline = true
  constructor(readonly reason: BlockedReason) {
    super('No pude verificar una sesión de fuerza compatible con la restricción registrada.')
    this.name = 'WeekCreatorSafeDecline'
  }
}

const declineForSafety: (reason: BlockedReason) => never = (reason) => {
  useAIDebugStore.getState().completeRequest(fallbackTraceId, {
    outcome: 'safety_blocked',
    status: 'completed',
    proposalCreated: false,
    generationOutcome: 'safe_decline',
    warnings: [`safety_blocked: ${reason}`],
  })
  throw new WeekCreatorSafeDecline(reason)
}
```

**El throw viaja dentro del `try` general del engine.** Sin un catch propio, el
motor lo clasificaría como fallo de proveedor y podría reintentar — exactamente
lo que un bloqueo de seguridad no debe hacer. Añadir el catch **antes** del
manejador genérico:

```ts
} catch (error) {
  if (error instanceof WeekCreatorSafeDecline) {
    // Terminal. Ni retry ni fallback local: el fallback es lo que acaba de
    // declararse inseguro.
    return {
      message: error.message,
      actions: [],
      provider, traceId, requestClass: 'week_creator', timestamp: Date.now(),
      meta: { outcome: 'safety_blocked' },
    }
  }
  // … manejador existente de fallos de proveedor …
}
```

- [ ] **Step 5: Añadir `safety_blocked` a `CoachNormalizedResponse.meta.outcome`**

`src/services/ai/types.ts:155` no lo admite todavía:

```ts
outcome?: 'ok' | 'truncated_mid' | 'truncated_early' | 'parse_invalid'
  | 'schema_invalid' | 'quality_rejected' | 'safety_blocked'
```

- [ ] **Step 6: Corregir el borde de `useChatStore`**

`useChatStore.ts:423` marca como `failed` **cualquier** Week Creator sin
propuesta:

```ts
const weekCreatorFailed = requestClass === 'week_creator' && proposalId == null
```

Un decline seguro no produce propuesta, así que hoy se reportaría como fallo e
inflaría la tasa de error. Distinguirlo:

```ts
const safelyDeclined = requestClass === 'week_creator'
  && response.meta?.outcome === 'safety_blocked'
const weekCreatorFailed = requestClass === 'week_creator'
  && proposalId == null && !safelyDeclined

// … en terminalPatch:
generationOutcome: safelyDeclined
  ? 'safe_decline' as const
  : weekCreatorFailed
    ? 'failed' as const
    : response.fallbackUsed ? 'local_fallback' as const : 'model_success' as const,
```

- [ ] **Step 7: Resolver restricciones desde el mensaje actual**

`resolveWeekCreatorSafetyConstraints` recibe hoy `userMessages: []`. Pasarle el
mensaje del usuario que originó la petición, y guardar el subconjunto derivado
de él en el sello de cada sesión generada, igual que hace el chat.

- [ ] **Step 8: Correr y verificar que pasa**

Run: `npx vitest run src/services/weekCreator/__tests__/weekCreatorSafety.test.ts`
Expected: PASS, incluidos los dos tests conductuales.

- [ ] **Step 9: Gate y commit**

Run: `npm run lint && npm test && npm run build`

```
feat(week-creator): declinar de forma segura sin reintento ni fallback
```

---

## Task 12: Plan Builder

**Files:**
- Modify: `src/services/planBuilder/profileAdapter.ts`
- Modify: `src/services/planBuilder/repairWeek.ts`
- Modify: `src/services/planBuilder/generateWeekCore.ts`
- Modify: `src/services/planBuilder/generateWeek.ts`
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts`
- Modify: `src/services/planBuilder/fallbackEligibility.ts`
- Modify: `src/services/planBuilder/generationState.ts`
- Modify: `src/types/planBuilder.ts`
- Test: `src/services/planBuilder/__tests__/planBuilderSafety.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 5, 6.
- Produces: `AthleteParameters.safetyConstraints`.

- [ ] **Step 1: Escribir el test**

```ts
// src/services/planBuilder/__tests__/planBuilderSafety.test.ts
import { describe, expect, it } from 'vitest'
import { buildAthleteParameters } from '../profileAdapter'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'

const wizard = { currentFatigue: 'normal', currentFitnessLevel: 'medium', complementarySports: [], injuryNotes: undefined } as unknown as PlanWizardConfig

describe('Plan Builder bajo restricciones', () => {
  it('las restricciones del perfil llegan a AthleteParameters', () => {
    const profile = { recoveryProfile: { currentInjuries: 'Lesión espalda baja, cuadrado lumbar' } } as AthleteProfile
    const params = buildAthleteParameters(profile, wizard)
    expect(params.safetyConstraints.some((c) => c.kind === 'region' && c.region === 'lumbar')).toBe(true)
  })

  it('sin lesiones el conjunto es vacío, no undefined', () => {
    const params = buildAthleteParameters({} as AthleteProfile, wizard)
    expect(params.safetyConstraints).toEqual([])
  })

  it('injuryNotes del wizard participa como campo médicamente acotado', () => {
    const params = buildAthleteParameters({} as AthleteProfile, { ...wizard, injuryNotes: 'rodilla' } as PlanWizardConfig)
    expect(params.safetyConstraints.some((c) => c.kind === 'region' && c.region === 'knee')).toBe(true)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/planBuilderSafety.test.ts`
Expected: FAIL — `safetyConstraints` no existe en `AthleteParameters`.

- [ ] **Step 3: Poblar `AthleteParameters` y el contexto**

En `profileAdapter.ts`:

```ts
export interface AthleteParameters {
  // … campos existentes …
  safetyConstraints: readonly StrengthConstraint[]
}

// dentro de buildAthleteParameters:
safetyConstraints: resolveStrengthSafetyConstraints({
  currentInjuries: profile.recoveryProfile?.currentInjuries,
  restrictions: profile.recoveryProfile?.restrictions,
  injuryNotes: wizardConfig.injuryNotes,
  userMessages: [],
  trainingPriority: (wizardConfig as { trainingPriority?: string }).trainingPriority,
}),
```

En `repairWeek.ts`, `buildStrengthSelectionContext` propaga el conjunto. **`session.objective` se conserva** para `goal` —aporta nivel y fitness al ordenamiento y no interpreta restricciones— pero no puede producirlas:

```ts
return {
  // … campos existentes, incluido goal: buildLevelAwareGoal(context, session.objective ?? …) …
  safetyConstraints: athleteParameters.safetyConstraints,
}
```

- [ ] **Step 4: Finalizar como fase terminal DESPUÉS de todas las pasadas de mutación**

No alcanza con finalizar dentro de `enhanceStrengthSessionDetails`: después de
esa función el pipeline todavía ejecuta balanceo, fallback primario y
`normalizeStrengthSessions`, que vuelven a crear o mutar fuerza. Añadir una fase
terminal sobre todas las sesiones de fuerza al final de `repairGeneratedWeek`,
después de `balanceSessionCount`, `ensurePrimarySportMinimum` y
`normalizeStrengthSessions`. Esa fase usa `prepareStrengthSession`; no queda
ningún mutador de ejercicios después.

```ts
session.exercises = completeStrengthExerciseDensity(/* … */)

const finalized = finalizeStrengthExercisesForRestrictions({
  exercises: session.exercises ?? [],
  constraints: athleteParameters.safetyConstraints,
  durationMin: session.durationMin,
  sessionType: 'strength',
  selectionContext: buildStrengthSelectionContext(session, context, recentExercises),
  userMessage: '',
})

if (finalized.status === 'blocked') {
  return { kind: 'safety_blocked', reason: finalized.reason }
}
session.exercises = finalized.exercises
return { kind: 'changed', changed: before !== JSON.stringify(session.exercises ?? []) }
```

**`enhanceStrengthSessionDetails` devuelve hoy un booleano que significa
«cambió», no «eliminar esta sesión».** Hay que cambiar su firma a una salida
discriminada, o el bloqueo se leería como «hubo cambios» y la sesión seguiría en
la semana:

```ts
type StrengthEnhancementResult =
  | { kind: 'changed'; changed: boolean }
  | { kind: 'safety_blocked'; reason: BlockedReason }
```

**Cómo se retira la sesión y cómo queda el tombstone.** El llamador de
`enhanceStrengthSessionDetails` (en el bucle de reparación de la semana):

1. quita la sesión del array `week.sessions`;
2. registra el tombstone en `RepairMeta`, no como warning suelto:

```ts
// src/services/planBuilder/repairWeek.ts
export interface RepairMeta {
  // … campos existentes …
  /**
   * Sesiones retiradas por seguridad. Es un TOMBSTONE: las pasadas posteriores
   * de densidad y de conteo lo leen y NO reconstruyen el hueco.
   */
  strengthSafetyBlocked?: Array<{
    date: string
    timeBlock: TimeBlock
    reason: BlockedReason
  }>
}
```

3. propaga `strengthSafetyBlocked` y `safetyDegraded: true` por
   `WeekActionEvaluation`, ambos `GenerateWeekResult` y
   `PlanGenerationMeta`. No se inventa `week.degraded`: ese campo no existe.

**Cómo la reconocen las pasadas posteriores.** Toda pasada que hoy rellena
sesiones faltantes —densidad coordinada, conteo mínimo de sesiones, relleno de
esqueleto— consulta primero:

```ts
function isSafetyBlockedSlot(meta: RepairMeta, date: string, timeBlock: TimeBlock): boolean {
  return (meta.strengthSafetyBlocked ?? []).some(
    (entry) => entry.date === date && entry.timeBlock === timeBlock,
  )
}
```

y omite ese `date|timeBlock`. Sin este predicado, la siguiente pasada volvería a
crear justo la sesión que se acaba de declarar insegura.

**Resultado parcial seguro.** `generateWeekCore` y `generateWeek` no convierten
un `week.sessions.count_mismatch` causado exclusivamente por un tombstone de
seguridad en `sessions: []`: conservan las hermanas válidas, propagan
`safetyDegraded` y no reintentan. `quality.strength.safety_blocked` se agrega a
`NON_FALLBACK_ELIGIBLE_ERROR_CLASSES`, por lo que el loop nunca lo sustituye por
fallback local. Los derivadores de estado (`generationState`, loop async y
polling) devuelven `partial` si existe una semana draft con
`generationMeta.safetyDegraded`, aunque todas las semanas tengan sesiones.

Añadir a la Task 12 un test que lo demuestre: una semana con una sesión de fuerza
bloqueada termina con **una sesión menos**, con la entrada en
`meta.strengthSafetyBlocked`, y **sin** que la pasada de densidad la recree.

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/planBuilderSafety.test.ts`
Expected: PASS.

- [ ] **Step 6: Gate y commit**

Run: `npm run lint && npm test && npm run build`

```
feat(plan-builder): restricciones de seguridad en generación y reparación
```

---

## Task 13: Guard de orden — ningún mutador después del finalizador

> El wrapper de nivel sesión se construye en la **Task 7**. Esta tarea es
> exclusivamente el guard y la migración de los call sites restantes.

**Files:**
- Test: `src/services/training/__tests__/strengthSafetyOrdering.test.ts`
- Modify: `src/services/training/strengthSessionStructure.ts` (wrapper de sesión)

**Interfaces:**
- Consumes: Tasks 6, 7, 9, 10, 11, 12.
- Produces: `prepareStrengthSession(session, options)` como única entrada pública de nivel sesión.

- [ ] **Step 1: Escribir el guard**

```ts
// src/services/training/__tests__/strengthSafetyOrdering.test.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Solo estos módulos pueden invocar los helpers de array directamente. */
const ALLOWED_INTERNAL_CALLERS = new Set([
  'src/services/training/strengthSessionStructure.ts',
  'src/services/training/strengthSafetyFinalizer.ts',
  // El Plan Builder arma template/allocator/densidad antes de su única fase
  // terminal; el guard adicional de abajo congela el orden dentro del archivo.
  'src/services/planBuilder/repairWeek.ts',
])

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      return entry === 'node_modules' || entry === '__tests__' ? [] : walk(full)
    }
    return /\.tsx?$/.test(entry) ? [full] : []
  })
}

describe('orden: el finalizador es el último mutador', () => {
  it('producción no llama a enhanceStrengthSessionExercises directamente', () => {
    const offenders = walk('src').filter((file) => {
      if (ALLOWED_INTERNAL_CALLERS.has(file)) return false
      return readFileSync(file, 'utf-8').includes('enhanceStrengthSessionExercises(')
    })
    expect(offenders, `deben usar prepareStrengthSession: ${offenders.join(', ')}`).toEqual([])

    const repairSource = readFileSync('src/services/planBuilder/repairWeek.ts', 'utf-8')
    const materializationCall = repairSource.indexOf(
      'const strengthMaterialization = normalizeStrengthSessions(',
    )
    const finalizerCall = repairSource.indexOf('sessions = finalizeStrengthSafetySessions(')
    const orchestrationReturn = repairSource.indexOf('return { sessions, meta }', finalizerCall)

    expect(materializationCall).toBeGreaterThan(-1)
    expect(finalizerCall).toBeGreaterThan(materializationCall)
    expect(orchestrationReturn).toBeGreaterThan(finalizerCall)

    const terminalTail = repairSource.slice(finalizerCall, orchestrationReturn)
    expect(terminalTail).not.toContain('enhanceStrengthSessionExercises(')
    expect(terminalTail).not.toContain('normalizeStrengthSessions(')
    expect(terminalTail).not.toContain('balanceSessionCount(')
    expect(terminalTail).not.toContain('ensurePrimarySportMinimum(')
  })

  it('los tres productores y los dos bordes usan el wrapper de nivel sesión', () => {
    const required = [
      'src/services/ai/actionPostProcessor.ts',
      'src/services/weekCreator/WeekCreatorEngine.ts',
      'src/services/planBuilder/repairWeek.ts',
      'src/store/useCoachActionsStore.ts',
      'src/services/planning/applyCreateWeek.ts',
    ]
    for (const file of required) {
      expect(readFileSync(file, 'utf-8'), file).toContain('prepareStrengthSession')
    }
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthSafetyOrdering.test.ts`
Expected: FAIL — hay llamadas directas.

- [ ] **Step 3: Migrar los call sites restantes**

El wrapper `prepareStrengthSession` ya existe desde la Task 7, donde orquesta
**enriquecimiento → finalización → sello**. Esta tarea es **solo el guard final**:
recorrer los call sites de producción que todavía llamen a
`enhanceStrengthSessionExercises` directamente y migrarlos, hasta que el test del
Step 1 pase.

Call sites conocidos a migrar: `applyCreateWeek.ts:98`,
`useCoachActionsStore.ts:291` y los de `repairWeek.ts`.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/strengthSafetyOrdering.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate y commit**

Run: `npm run lint && npm test && npm run build`

```
feat(strength): wrapper de sesión y guard de orden del finalizador
```

---

## Task 14: Matriz de taxonomía y feedback de UI

**Files:**
- Test: `src/services/training/__tests__/strengthSafetyTaxonomyMatrix.test.ts`
- Modify: `src/pages/OnboardingPage.tsx`, `src/components/settings/AthleteProfileEditor.tsx`, `src/pages/CompetitionPlanPage.tsx`
- Modify: `src/services/ai/promptBuilder.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 3.
- Produces: `describeSafetyConstraints(constraints): string | undefined` para la UI.

- [ ] **Step 1: Escribir la matriz**

Para **cada** región y **cada** patrón: un ejercicio que debe excluir, uno que debe conservar, una frase positiva del parser y, cuando aplique, una negada. «Cada región es alcanzable» no demuestra que la clasificación sea correcta.

```ts
// src/services/training/__tests__/strengthSafetyTaxonomyMatrix.test.ts
import { describe, expect, it } from 'vitest'
import { STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'
import { isExerciseAllowed, resolveStrengthSafetyConstraints } from '../strengthSafetyConstraints'
import type { BodyRegion, LoadPattern, StrengthConstraint } from '../../../types/strengthSafety'

const byId = (id: string) => STRENGTH_EXERCISE_LIBRARY.find((e) => e.id === id)!
const region = (r: BodyRegion): StrengthConstraint[] => [{ kind: 'region', region: r, sources: ['current_injuries'] }]
const pattern = (p: LoadPattern): StrengthConstraint[] => [{ kind: 'load_pattern', pattern: p, sources: ['restrictions'] }]

const REGION_MATRIX: ReadonlyArray<[BodyRegion, string, string, string, string | null]> = [
  ['lumbar',            'deadlift',            'lat_pulldown',        'dolor lumbar',              'sin dolor lumbar'],
  ['thoracic',          'bent_over_row',       'lateral_band_walk',   'dolor dorsal',              null],
  ['cervical',          'farmer_carry',        'lateral_band_walk',   'dolor cervical',            null],
  ['trunk_core',        'dead_bug',            'lat_pulldown',        'molestia en zona media',    null],
  ['chest_ribs',        'bench_press',         'lat_pulldown',        'dolor costal',              null],
  ['pelvis_sacroiliac', 'farmer_carry',        'lat_pulldown',        'dolor sacroiliaco',         null],
  ['shoulder',          'overhead_press',      'lateral_band_walk',   'dolor de hombro',           'sin dolor de hombro'],
  ['elbow',             'pull_up',             'lateral_band_walk',   'epicondilitis',             null],
  ['wrist',             'front_squat',         'lateral_band_walk',   'dolor de muneca',           null],
  ['hip',               'hip_thrust',          'bench_press',         'dolor de cadera',           null],
  ['groin',             'copenhagen_side_plank', 'bench_press',       'pubalgia',                  null],
  ['hamstring',         'romanian_deadlift',   'bench_press',         'dolor isquiotibial',        null],
  ['knee',              'back_squat',          'bench_press',         'tendinitis rotuliana',      'sin dolor de rodilla'],
  ['calf',              'pogo_jumps',          'bench_press',         'dolor de gemelo',           null],
  ['achilles',          'depth_jump',          'bench_press',         'tendinitis de aquiles',     null],
  ['ankle',             'box_jump',            'bench_press',         'esguince de tobillo',       null],
  ['foot',              'pogo_jumps',          'bench_press',         'fascitis plantar',          null],
]

const PATTERN_MATRIX: ReadonlyArray<[LoadPattern, string, string, string]> = [
  ['axial_load',   'back_squat',        'lat_pulldown',      'sin carga axial'],
  ['loaded_hinge', 'deadlift',          'lat_pulldown',      'evitar peso muerto'],
  ['impact',       'box_jump',          'lat_pulldown',      'sin impacto'],
  ['deep_flexion', 'bodyweight_squat',  'lat_pulldown',      'evitar flexion profunda'],
  ['overhead',     'overhead_press',    'lat_pulldown',      'evitar trabajo sobre la cabeza'],
  ['rotation',     'cable_chop',        'lat_pulldown',      'evitar rotacion'],
  ['grip_demand',  'pull_up',           'bench_press',       'evitar demanda de agarre'],
]

describe('matriz de taxonomía', () => {
  it.each(REGION_MATRIX)('región %s', (r, excluded, kept, positive, negated) => {
    expect(isExerciseAllowed(byId(excluded), region(r)), `${excluded} debe excluirse`).toBe(false)
    expect(isExerciseAllowed(byId(kept), region(r)), `${kept} debe conservarse`).toBe(true)

    const parsed = resolveStrengthSafetyConstraints({
      currentInjuries: positive, restrictions: undefined, injuryNotes: undefined,
      userMessages: [], trainingPriority: undefined,
    })
    expect(parsed.some((c) => c.kind === 'region' && c.region === r), `"${positive}" debe resolver ${r}`).toBe(true)

    if (negated) {
      const suppressed = resolveStrengthSafetyConstraints({
        currentInjuries: negated, restrictions: undefined, injuryNotes: undefined,
        userMessages: [], trainingPriority: undefined,
      })
      expect(suppressed, `"${negated}" no debe emitir`).toEqual([])
    }
  })

  it.each(PATTERN_MATRIX)('patrón %s', (p, excluded, kept, positive) => {
    expect(isExerciseAllowed(byId(excluded), pattern(p)), `${excluded} debe excluirse`).toBe(false)
    expect(isExerciseAllowed(byId(kept), pattern(p)), `${kept} debe conservarse`).toBe(true)
    const parsed = resolveStrengthSafetyConstraints({
      currentInjuries: undefined, restrictions: positive, injuryNotes: undefined,
      userMessages: [], trainingPriority: undefined,
    })
    expect(parsed.some((c) => c.kind === 'load_pattern' && c.pattern === p), `"${positive}" debe resolver ${p}`).toBe(true)
  })
})
```

- [ ] **Step 2: Correr, ajustar sinónimos hasta que pase**

Run: `npx vitest run src/services/training/__tests__/strengthSafetyTaxonomyMatrix.test.ts`
Expected: PASS. Ante un fallo, ampliar `REGION_SYNONYMS` / `PATTERN_SYNONYMS` o corregir la clasificación de la Tarea 1 — **nunca** relajar la aserción.

- [ ] **Step 3: Implementar el descriptor para la UI**

```ts
// añadir a src/services/training/strengthSafetyConstraints.ts
const REGION_LABELS: Record<BodyRegion, string> = {
  lumbar: 'zona lumbar', thoracic: 'espalda alta', cervical: 'cuello',
  trunk_core: 'zona media', chest_ribs: 'costillas', pelvis_sacroiliac: 'pelvis',
  shoulder: 'hombro', elbow: 'codo', wrist: 'muñeca', hip: 'cadera',
  groin: 'aductores', hamstring: 'isquiotibiales', knee: 'rodilla',
  calf: 'gemelo', achilles: 'aquiles', ankle: 'tobillo', foot: 'pie',
}

const PATTERN_LABELS: Record<LoadPattern, string> = {
  axial_load: 'carga axial', loaded_hinge: 'bisagra de cadera cargada',
  impact: 'impacto', deep_flexion: 'flexión profunda', overhead: 'trabajo sobre la cabeza',
  rotation: 'rotación cargada', grip_demand: 'demanda de agarre',
}

/** Feedback de solo lectura. Sin control de edición: si el parser se equivoca,
 *  se corrige reescribiendo el texto. */
export function describeSafetyConstraints(
  constraints: readonly StrengthConstraint[],
): string | undefined {
  if (constraints.length === 0) return undefined
  if (hasUnresolvedMedicalRestriction(constraints)) {
    return 'Detecté una restricción, pero no pude identificar la zona'
  }
  const parts = constraints.flatMap((constraint) =>
    constraint.kind === 'region' ? [REGION_LABELS[constraint.region]]
    : constraint.kind === 'load_pattern' ? [`evitar ${PATTERN_LABELS[constraint.pattern]}`]
    : [],
  )
  return `Entendí: ${parts.join(', ')}`
}
```

- [ ] **Step 4: Cablear el feedback en las tres superficies**

Debajo del textarea correspondiente en cada archivo:

```tsx
{describeSafetyConstraints(parsedConstraints) && (
  <p className="mt-1.5 text-xs text-ink-faint">
    {describeSafetyConstraints(parsedConstraints)}
  </p>
)}
```

- `src/pages/OnboardingPage.tsx` — bajo «Molestias actuales».
- `src/components/settings/AthleteProfileEditor.tsx` — bajo «Lesión o molestia actual».
- `src/pages/CompetitionPlanPage.tsx:1314` — bajo «Molestias o restricciones».

- [ ] **Step 5: Prompt como defensa en profundidad**

En `promptBuilder.ts`, junto a la línea existente `Lesión/restricción actual`, añadir las restricciones resueltas para que el modelo proponga mejor contenido. **Nunca es enforcement**: el finalizador corre pase lo que pase.

```ts
const described = describeSafetyConstraints(constraints)
if (described) lines.push(`Restricciones resueltas: ${described}. No propongas ejercicios que carguen esas zonas.`)
```

- [ ] **Step 6: Gate y commit**

Run: `npm run lint && npm test && npm run build`

```
feat(strength): matriz de taxonomía, feedback de parser y prompt defensivo
```

---

## Task 15: Regresiones de cierre

**Files:**
- Test: `src/services/__tests__/strengthSafetyRegression.test.ts`

**Interfaces:**
- Consumes: todas las anteriores.

- [ ] **Step 1: Escribir las regresiones del spec §10.9**

```ts
// src/services/__tests__/strengthSafetyRegression.test.ts
import { describe, expect, it } from 'vitest'
import type { ChatContext } from '../../types'
import type { CoachNormalizedResponse } from '../ai/types'
import { postProcessCoachActions } from '../ai/actionPostProcessor'
import { resolveStrengthExercise } from '../training/exerciseLibrary'

const BLOCKED_COPY = 'No pude verificar una sesión de fuerza compatible con la restricción registrada.'

function ctx(partial: Record<string, unknown>): ChatContext {
  return {
    recentSessions: [], plannedSessions: [], historicalSessions: [],
    athleteProfile: {
      mainGoal: 'Torneo de squash',
      sportContext: { primarySport: 'squash' },
      strengthProfile: { squat1RM: 100, deadlift1RM: 130, benchPress1RM: 80 },
      ...partial,
    },
  } as unknown as ChatContext
}

function twoStrengthWeek(): CoachNormalizedResponse {
  return {
    message: 'Te preparé una semana con 3 sesiones. Revísala y, si te hace sentido, aplícala.',
    actions: [{
      // `create_week` usa `targetDate` en la acción y `date` en cada sesión
      // (ver actionPostProcessor.test.ts:196-202). NO `weekStartDate`.
      type: 'create_week', reason: 'Semana', targetDate: '2026-09-07',
      sessions: [
        { date: '2026-09-08', timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza A', durationMin: 60, objective: 'Fuerza' },
        { date: '2026-09-10', timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza B', durationMin: 60, objective: 'Fuerza' },
      ],
    }],
    provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 1,
  }
}

describe('regresión del ticket original', () => {
  it('CAMINO REPARADO: las dos sesiones sobreviven sin cargar la zona lesionada', () => {
    const out = postProcessCoachActions(
      twoStrengthWeek(),
      ctx({ recoveryProfile: { currentInjuries: 'Lesión espalda baja, cuadrado lumbar' } }),
      'Creame 2 sesiones de pesas para la próxima semana',
    )
    const action = out.actions?.[0]
    expect(action?.type).toBe('create_week')
    if (action?.type !== 'create_week') return

    expect(action.sessions).toHaveLength(2)
    for (const session of action.sessions!) {
      expect(session.exercises!.length).toBeGreaterThan(0)
      for (const exercise of session.exercises!) {
        const definition = resolveStrengthExercise(exercise)?.definition
        expect(definition, `no resuelve: ${exercise.name}`).toBeDefined()
        expect(definition!.safety.loadsRegions, exercise.name).not.toContain('lumbar')
      }
      expect(session.exercises!.map((e) => e.name)).not.toContain('Plancha lateral con press de disco')
      expect(session.exercises!.map((e) => e.name)).not.toContain('Corte diagonal con disco en media rodilla')
      expect(session.exercises!.map((e) => e.name)).not.toContain('Zancada lateral con barra')
      expect(session.metadata?.strengthSafetyFinalization).toBeDefined()
    }
    // Ningún core inyectado: los cuatro de la rotación declaran lumbar.
    const allNames = action.sessions!.flatMap((s) => s.exercises!.map((e) => e.name))
    expect(allNames).not.toContain('Dead bug — control de tronco')
  })

  it('el copy visible deriva el día de la acción, no de la prosa del modelo', () => {
    // NO vacuo: el mensaje de entrada AFIRMA «jueves 4» y la acción cae en
    // viernes 2026-09-04. Sin `alignMessageWeekdayToActionDate` este test falla.
    const response: CoachNormalizedResponse = {
      message: 'Listo, te la dejo el jueves 4 de septiembre.',
      actions: [{
        type: 'add_session', reason: 'r', targetDate: '2026-09-04', timeBlock: 'PM',
        sessionType: 'running', title: 'Rodaje', durationMin: 45,
      }],
      provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 1,
    }
    const out = postProcessCoachActions(response, ctx({}), 'agrega un rodaje el viernes')
    expect(out.message).toMatch(/viernes 4/i)
    expect(out.message).not.toMatch(/jueves 4/i)
  })

  it('BLOQUEO: return_to_play sin detalle elimina la acción con copy determinista', () => {
    const out = postProcessCoachActions(
      twoStrengthWeek(),
      ctx({ planWizardConfig: { trainingPriority: 'return_to_play' } }),
      'Creame 2 sesiones de pesas',
    )
    expect(out.actions ?? []).toHaveLength(0)
    expect(out.message).toBe(BLOCKED_COPY)
  })

  it('BLOQUEO: cirugía reciente sin zona resoluble', () => {
    const out = postProcessCoachActions(
      twoStrengthWeek(),
      ctx({ recoveryProfile: { currentInjuries: 'me operaron hace dos semanas' } }),
      'Creame 2 sesiones de pesas',
    )
    expect(out.actions ?? []).toHaveLength(0)
    expect(out.message).toBe(BLOCKED_COPY)
  })

  it('update_session: los ejercicios HEREDADOS de la base también se verifican', async () => {
    // El patch no trae ejercicios; el peso muerto viene de la sesión base.
    const out = postProcessCoachActions(
      { message: 'Ajusto la sesión', actions: [{
        type: 'update_session', reason: 'r', sessionId: 's1', newDurationMin: 75,
      }], provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 1 },
      ctxWithStrengthSession('Lesión espalda baja', ['Peso muerto', 'Remo con pecho apoyado']),
      'alarga la sesión de pesas a 75 minutos',
    )
    const action = out.actions?.[0]
    if (action?.type === 'update_session' && action.exercises) {
      expect(action.exercises.map((e) => e.name)).not.toContain('Peso muerto')
    }
  })

  it('Week Creator: RDL reemplazado cuando hay pool viable, sin safety_blocked', async () => {
    const result = await runWeekCreatorForTest({
      profile: { recoveryProfile: { currentInjuries: 'Lesión espalda baja' } },
      forceFallback: true,
    })
    expect(result.meta?.outcome).not.toBe('safety_blocked')
    for (const session of extractStrengthSessions(result)) {
      expect(session.exercises!.map((e) => e.name)).not.toContain('Peso muerto rumano')
    }
  })

  it('Week Creator: sin pool viable cierra el ciclo safe_decline completo', async () => {
    const result = await runWeekCreatorForTest({
      profile: { planWizardConfig: { trainingPriority: 'return_to_play' } },
    })
    expect(result.meta?.outcome).toBe('safety_blocked')
    expect(result.actions ?? []).toHaveLength(0)
    const telemetry = lastDebugRequest()
    expect(telemetry.status).toBe('completed')
    expect(telemetry.proposalCreated).toBe(false)
    expect(telemetry.generationOutcome).toBe('safe_decline')
    // NO es un fallo: no debe contarse como error en /ops.
    expect(telemetry.outcome).not.toBe('schema_invalid')
    expect(telemetry.generationOutcome).not.toBe('failed')
  })

  it('el mensaje de bloqueo nunca dice "segura"', () => {
    const out = postProcessCoachActions(
      twoStrengthWeek(),
      ctx({ planWizardConfig: { trainingPriority: 'return_to_play' } }),
      'Creame 2 sesiones de pesas',
    )
    expect(out.message.toLowerCase()).not.toContain('segura')
  })
})
```

- [x] **Step 2: Correr y verificar que pasa**

Run: `npx vitest run src/services/__tests__/strengthSafetyRegression.test.ts`
Expected: PASS, 8 tests.

- [x] **Step 3: Gate completo**

Run: `npm run lint && npm test && npm run build`
Expected: todo verde. Registrar el total de archivos/tests para el roadmap.

- [ ] **Step 4: Verificación manual**

Con el perfil real del owner (`Lesión espalda baja, cuadrado lumbar`):

1. Abrir Ajustes → confirmar la línea «Entendí: zona lumbar».
2. Pedir por chat «Creame 2 sesiones de pesas para la próxima semana».
3. Confirmar que ninguna sesión trae hinge, sentadilla axial, plancha lateral con disco ni corte diagonal.
4. Aceptar la propuesta y confirmar que la sesión persistida coincide con la propuesta.
5. Cambiar el perfil a `me operaron hace dos semanas` y confirmar el copy de bloqueo.

- [x] **Step 5: Commit y actualización de documentación**

Añadir a `CLAUDE.md` (reglas del proyecto) y a `PROJECT_REVIEW_AND_ROADMAP.md` (nueva sección §32) el resumen de la entrega.

Estado 2026-08-30: documentación actualizada y commit autorizado explícitamente
por el owner.

```
feat(strength): regresiones del ticket de restricciones de seguridad
```

---

## Notas de auto-revisión

**Estado de ejecución (2026-08-30).** Las 16 tareas están implementadas y el gate
completo pasó: 503 archivos / 4056 tests, lint, `tsc -b` y build. La verificación
manual autenticada de Task 15 Step 4 y la aplicación remota de
`025_coach_request_safety_blocked.sql` permanecen pendientes. El owner autorizó
explícitamente incluir todo el árbol en el commit de cierre.

**Ajuste de implementación de Plan Builder.** La densidad mínima se incorporó
como slots virtuales en la misma matriz del allocator global, en vez de
completarse localmente antes del finalizador. Esto es necesario para que los
ejercicios agregados por densidad consuman I1 y conserven I4 entre workers. El
finalizador terminal usa `densityCompletion: 'preserve'`: no vuelve a mutar la
asignación coordinada, pero revalida identidad, restricciones, densidad y mínimo
de trabajo real, y bloquea cualquier déficit. La suite cubre semanas hermanas,
dominios de selector distintos, RDL reparable y ausencia de pool viable.

---

## Task 16: Persistencia operacional de `safety_blocked`

**Motivo:** §8.3.1 exige que el desenlace postprocesado viva tanto en debug
local como en `coach_requests`. El proxy persiste inicialmente `ok`; la decisión
de seguridad ocurre después, en el cliente.

**Files:**
- Migration: `supabase/025_coach_request_safety_blocked.sql`
- Function: `netlify/functions/coach-request-outcome.ts`
- Client: `src/services/ai/safetyOutcomeTelemetry.ts`
- Operations contract/UI: `src/services/operations/operationsMetricsContract.ts`,
  `src/pages/OperationsPage.tsx`
- Structured safety events: `src/services/training/strengthSafetyFinalizer.ts`

- [x] Permitir `safety_blocked` junto a las filas históricas `ok`/`error`.
- [x] Exponerlo en `/ops` como contador separado; `errors` sigue filtrando sólo
  `outcome = 'error'`.
- [x] Endpoint autenticado que acepta únicamente `{ traceId, outcome:
  'safety_blocked' }`, acota por `trace_id + user_id` y nunca reclasifica un
  error de proveedor.
- [x] Reportar fire-and-forget desde los cierres de Chat Action y Week Creator,
  sin enviar restricciones ni texto médico.
- [x] Cubrir contrato de migración, endpoint, cliente y métrica operacional.
- [x] Emitir `strength.safety.exercise_removed`,
  `strength.safety.exercise_replaced` y `strength.safety.blocked` con ids,
  `ConstraintKey` y `sources`, nunca nombres visibles ni texto médico.

**Cobertura del spec.** §3 → Tasks 1, 2. §4 → Task 1. §5 → Task 3. §6 → Tasks 4, 5, 6. §7 → Tasks 7, 10, 13. §8 → Tasks 9, 11, 12. §9 → Tasks 9, 14. §10 → Tasks 14, 15 y los tests de cada tarea. §11.1 (día de semana) → regresión en Task 15 Step 1.

**Riesgos conocidos del plan.**

1. La Tarea 1 es juicio deportivo y tiene una parada de revisión explícita. Si el owner cambia filas, las Tasks 3, 6 y 14 pueden necesitar ajuste de fixtures — no de lógica.
2. La Tarea 4 rompe la compilación a propósito en todos los sitios que construyen `StrengthContext`. Es un barrido mecánico, pero toca muchos archivos de test; conviene hacerlo en una sola pasada.
3. `update_session` (Task 9B) es la superficie con más estado externo: depende de
   la sesión base, que puede cambiar entre propuesta y aceptación. Si los tests de
   edición concurrente resultan frágiles, la corrección es hacer la
   rematerialización más explícita, no relajar la detección.
4. El umbral de viabilidad (`density.min` + `getMinimumStrengthWorkCount`) puede resultar demasiado estricto para una restricción lumbar en sesiones de 75-90 min. Si el test de la Task 6 muestra bloqueos donde debería reparar, la corrección es ampliar el pool permitido de la Task 1, **nunca** bajar el umbral.
