import { describe, expect, it } from 'vitest'
import { resolveStrengthExercise } from '../exerciseLibrary'
import { selectStrengthSession, type StrengthContext } from '../strengthSelector'
import type { StrengthConstraint } from '../../../types/strengthSafety'

const lumbar: StrengthConstraint[] = [{ kind: 'region', region: 'lumbar', sources: ['current_injuries'] }]
const context: StrengthContext = {
  fatigueLevel: 5, phase: 'build', recentExercises: [], goal: 'fuerza', sportProfile: 'sport_support',
  experienceLevel: 'intermediate', sessionDurationMin: 60, safetyConstraints: lumbar,
}

describe('pool del selector bajo restricciones', () => {
  it('nunca selecciona una región excluida', () => {
    for (const exercise of selectStrengthSession(context).exercises) {
      expect(resolveStrengthExercise(exercise)?.definition?.safety.loadsRegions).not.toContain('lumbar')
    }
  })
})
