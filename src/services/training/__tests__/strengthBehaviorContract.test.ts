import { describe, expect, it } from 'vitest'

import type { CoachExerciseProposal, StrengthProfile } from '../../../types'
import { findStrengthExerciseByName, STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'
import { enhanceStrengthSessionExercises, resolveStrengthExerciseBlock } from '../strengthSessionStructure'

/**
 * Contrato de comportamiento del pipeline tras las Entregas 1–3.
 *
 * Este snapshot no se presenta como evidencia histórica pre-migración. La
 * exactitud del traslado de las dos fuentes antiguas vive en el ledger
 * independiente de `exerciseLibrary1RMCoverage.test.ts`.
 *
 * NO correr `vitest -u` sobre este archivo.
 */

/** Perfil fijo: números redondos para que el peso derivado sea legible. */
const PROFILE: StrengthProfile = {
  squat1RM: 100,
  deadlift1RM: 120,
  benchPress1RM: 80,
  overheadPress1RM: 50,
  pullUpMaxReps: 10,
}

/** 3 repeticiones fuerza el tramo de porcentaje más alto: expone el factor. */
const REPS = 3

function proposalFor(name: string): CoachExerciseProposal {
  return { name, sets: 3, reps: REPS }
}

describe('contrato de comportamiento de fuerza', () => {
  it('los 117 ejercicios producen el mismo grupo, unidad, carga y referencias', async () => {
    const rows = STRENGTH_EXERCISE_LIBRARY
      .map((definition) => {
        // `durationMin: 30` es obligatorio. Con 45 o más,
        // `normalizeStrengthSessionExercises:24` llama a `ensureCoreBlock`, que
        // antepone un "Control de tronco dead bug" cuando hay 0 o 1 ejercicios
        // de core — o sea, siempre en este contrato. El resultado sería medir
        // `dead_bug` 77 veces. Buscar por nombre tampoco salva el caso, porque
        // el propio `dead_bug` quedaría duplicado.
        const enhanced = enhanceStrengthSessionExercises(
          [proposalFor(definition.name)],
          { durationMin: 30, strengthProfile: PROFILE, safetyConstraints: [] },
        ) ?? []

        // Guard explícito: si una futura inyección vuelve a agregar ejercicios,
        // este test falla en vez de medir el equivocado en silencio.
        if (enhanced.length !== 1) {
          throw new Error(`${definition.id}: se esperaba 1 ejercicio, llegaron ${enhanced.length}`)
        }
        const [result] = enhanced

        return {
          id: definition.id,
          resolvedBlock: resolveStrengthExerciseBlock({ name: definition.name, group: undefined }),
          reps: result?.reps ?? null,
          weight: result?.weight ?? null,
          targetPercent1RM: result?.targetPercent1RM ?? null,
          targetRpe: result?.targetRpe ?? null,
          group: result?.group ?? null,
          loadReference: definition.loadReference ?? null,
        }
      })
      .sort((left, right) => left.id.localeCompare(right.id))

    expect(rows).toHaveLength(117)
    // Guard de que el contrato mide algo: si nadie recibe peso, el snapshot no
    // protegería la prescripción de carga, que es lo que más importa.
    expect(rows.filter((row) => row.weight != null).length).toBeGreaterThan(10)

    await expect(`${JSON.stringify(rows, null, 2)}\n`)
      .toMatchFileSnapshot('./__snapshots__/strengthBehaviorContract.json')
  })

  it('cada nombre canónico resuelve a su propio id', () => {
    const offenders = STRENGTH_EXERCISE_LIBRARY
      .filter((definition) => findStrengthExerciseByName(definition.name)?.id !== definition.id)
      .map((definition) => definition.id)
    expect(offenders).toEqual([])
  })
})
