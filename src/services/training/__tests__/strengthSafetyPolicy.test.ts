import { describe, expect, it } from 'vitest'
import { STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'
import { isExerciseAllowed, matchedConstraintKeys } from '../strengthSafetyConstraints'
import type { StrengthConstraint } from '../../../types/strengthSafety'

const byId = (id: string) => STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.id === id)!
const lumbar: StrengthConstraint[] = [{ kind: 'region', region: 'lumbar', sources: ['current_injuries'] }]

describe('política de seguridad de fuerza', () => {
  it('no infiere regiones: aplica solo intersecciones declaradas', () => {
    expect(isExerciseAllowed(byId('deadlift'), lumbar)).toBe(false)
    expect(isExerciseAllowed(byId('chest_supported_row'), lumbar)).toBe(true)
    expect(matchedConstraintKeys(byId('deadlift'), lumbar)).toEqual(['region:lumbar'])
  })
})
