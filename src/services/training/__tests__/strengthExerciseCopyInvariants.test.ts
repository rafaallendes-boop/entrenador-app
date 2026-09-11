import { describe, expect, it } from 'vitest'

import { STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'
import { RENAMED_STRENGTH_IDS, REWRITTEN_DESCRIPTION_IDS } from './strengthCopyScope'

/**
 * Guard de congelamiento previo al copy de fuerza (bloque del 2026-08-01, §1.1
 * del plan; spec y plan retirados tras el despliegue, historial en git).
 *
 * Este snapshot se genera ANTES de tocar `name`/`description` en
 * `exerciseLibrary.ts`. Congela por `id` los 16 campos de metadata que no
 * deben moverse en esta entrega, y marca explícitamente qué ids tienen
 * `name`/`description` en alcance (`stableName`/`stableDescription: null`)
 * para que un cambio fuera de esos ids se note como diferencia de snapshot.
 *
 * NO correr `vitest -u` sobre este archivo después de editar el catálogo. Si
 * el snapshot cambia, la edición salió del carril de copy — revisar el
 * cambio, no regenerar.
 */


describe('invariantes de copy de fuerza (pre-edición)', () => {
  it('congela metadata no editable y marca los campos de texto en alcance', async () => {
    const rows = [...STRENGTH_EXERCISE_LIBRARY]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({
        id,
        category,
        movement,
        intensityType,
        equipment,
        unilateral,
        tags,
        difficulty,
        sportsTransfer,
        squashTransfer,
        riskLevel,
        fatigueCost,
        loadReference,
        prescriptionUnit,
        appropriateForPhases,
        blockRotationGroup,
        name,
        description,
      }) => ({
        id,
        category,
        movement,
        intensityType,
        equipment,
        unilateral,
        tags,
        difficulty,
        sportsTransfer,
        squashTransfer,
        riskLevel,
        fatigueCost,
        loadReference,
        prescriptionUnit,
        appropriateForPhases,
        blockRotationGroup,
        stableName: RENAMED_STRENGTH_IDS.has(id) ? null : name,
        stableDescription: REWRITTEN_DESCRIPTION_IDS.has(id) ? null : description,
      }))

    expect(rows).toHaveLength(117)
    expect(rows.filter((row) => row.stableName === null)).toHaveLength(12)
    expect(rows.filter((row) => row.stableDescription === null)).toHaveLength(31)

    await expect(`${JSON.stringify(rows, null, 2)}\n`)
      .toMatchFileSnapshot('./__snapshots__/strengthExerciseCopyInvariants.json')
  })
})
