import { describe, expect, it } from 'vitest'
import { resolveSquashWeeklyExposurePolicy } from '../squashWeeklyExposurePolicy'

describe('A2.5 — política semanal de exposición competitiva', () => {
  const baseInput = {
    primarySport: 'squash' as const,
    hasSquashGoalEvent: true,
    phase: 'base' as const,
    currentFatigue: 'normal' as const,
    partnerAvailability: 'partner' as const,
    hasMedicalRestriction: false,
  }

  it('usa mejor de 3 en base aunque el selector de fase tenga pool match vacío', () => {
    expect(resolveSquashWeeklyExposurePolicy(baseInput)).toEqual({
      ensure: true,
      format: 'best_of_3',
      durationCapMin: 45,
      targetRpe: 6,
      minimumDaysBeforeEvent: 0,
    })
  })

  it('usa mejor de 5 en build/peak con carga normal y reduce a mejor de 3 si está loaded', () => {
    for (const phase of ['build', 'peak'] as const) {
      expect(resolveSquashWeeklyExposurePolicy({ ...baseInput, phase })).toMatchObject({
        ensure: true,
        format: 'best_of_5',
        durationCapMin: 55,
        targetRpe: 7,
      })
      expect(resolveSquashWeeklyExposurePolicy({ ...baseInput, phase, currentFatigue: 'loaded' })).toMatchObject({
        ensure: true,
        format: 'best_of_3',
        durationCapMin: 40,
        targetRpe: 6,
      })
    }
  })

  it('limita taper a mejor de 3 y exige al menos tres días antes del evento', () => {
    expect(resolveSquashWeeklyExposurePolicy({ ...baseInput, phase: 'taper' })).toMatchObject({
      ensure: true,
      format: 'best_of_3',
      durationCapMin: 40,
      targetRpe: 6,
      minimumDaysBeforeEvent: 3,
    })
  })

  it.each([
    ['no_squash_goal_event', { hasSquashGoalEvent: false }],
    ['partner_unavailable', { partnerAvailability: 'solo' as const }],
    ['medical_restriction', { hasMedicalRestriction: true }],
    ['severe_overload', { currentFatigue: 'overloaded' as const }],
  ])('respeta el veto %s', (reason, override) => {
    expect(resolveSquashWeeklyExposurePolicy({ ...baseInput, ...override })).toEqual({
      ensure: false,
      reason,
    })
  })

  it('cuenta el evento real en race y no agrega otro partido', () => {
    expect(resolveSquashWeeklyExposurePolicy({ ...baseInput, phase: 'race' })).toEqual({
      ensure: false,
      reason: 'race_event_counts',
    })
  })
})
