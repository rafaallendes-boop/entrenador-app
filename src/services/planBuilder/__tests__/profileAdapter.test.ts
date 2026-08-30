import { describe, expect, it } from 'vitest'

import type { AthleteProfile, PlanWizardConfig } from '../../../types'
import { buildAthleteParameters } from '../profileAdapter'

function makeProfile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    id: 'a1',
    updatedAt: 0,
    age: 30,
    sportContext: { primarySport: 'squash' },
    strengthProfile: { squat1RM: 120, deadlift1RM: 140, benchPress1RM: 90, overheadPress1RM: 65 },
    ...overrides,
  }
}

function makeWizard(overrides: Partial<PlanWizardConfig> = {}): PlanWizardConfig {
  return {
    goalEventId: 'e1',
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    doubleSessionDays: [],
    sessionsPerWeek: 5,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['strength'],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('buildAthleteParameters', () => {
  it('exposes available 1RM references when profile has them', () => {
    const params = buildAthleteParameters(makeProfile(), makeWizard())

    expect(params.available1RM.sort()).toEqual(['benchPress', 'deadlift', 'overheadPress', 'squat'])
  })

  it('excludes 1RM references for missing lifts', () => {
    const params = buildAthleteParameters(
      makeProfile({ strengthProfile: { squat1RM: 120, deadlift1RM: 140 } }),
      makeWizard(),
    )

    expect(params.available1RM.sort()).toEqual(['deadlift', 'squat'])
  })

  it('lowers target RPE when fatigue is overloaded', () => {
    const params = buildAthleteParameters(makeProfile(), makeWizard({ currentFatigue: 'overloaded' }))

    expect(params.rpeAdjustment).toBe(-1)
  })

  it('flags masters athletes as requiring extra recovery', () => {
    const params = buildAthleteParameters(makeProfile({ age: 41 }), makeWizard())

    expect(params.requireExtraRecovery).toBe(true)
  })

  it('calculates age from birth date using the supplied reference date', () => {
    const beforeBirthday = buildAthleteParameters(
      makeProfile({ age: undefined, birthDate: '1991-07-11' }),
      makeWizard(),
      new Date('2026-07-10T12:00:00.000Z'),
    )
    const afterBirthday = buildAthleteParameters(
      makeProfile({ age: undefined, birthDate: '1991-07-11' }),
      makeWizard(),
      new Date('2026-07-12T12:00:00.000Z'),
    )

    expect(beforeBirthday.ageYears).toBe(34)
    expect(beforeBirthday.requireExtraRecovery).toBe(false)
    expect(afterBirthday.ageYears).toBe(35)
    expect(afterBirthday.requireExtraRecovery).toBe(true)
  })

  it('preserves primary and complementary sports', () => {
    const params = buildAthleteParameters(makeProfile(), makeWizard({ complementarySports: ['running'] }))

    expect(params.primarySport).toBe('squash')
    expect(params.complementarySports).toEqual(['running'])
  })

  it('resolves safety constraints from recovery, wizard injury notes and training priority', () => {
    const params = buildAthleteParameters(
      makeProfile({
        recoveryProfile: { currentInjuries: 'dolor lumbar', restrictions: 'evitar overhead' },
        sportContext: { primarySport: 'squash', trainingPriority: 'return_to_play' },
      }),
      makeWizard({ injuryNotes: 'molestia de rodilla' }),
    )

    expect(params.safetyConstraints.map((constraint) => constraint.kind)).toContain('region')
    expect(params.safetyConstraints.map((constraint) => constraint.sources).flat()).toContain('training_priority')
  })
})
