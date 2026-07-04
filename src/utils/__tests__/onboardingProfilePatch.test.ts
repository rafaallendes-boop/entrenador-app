import { describe, expect, it } from 'vitest'

import { buildOnboardingAthleteProfilePatch, parseOptionalKg } from '../onboardingProfilePatch'
import type { AthleteProfile } from '../../types'

describe('buildOnboardingAthleteProfilePatch', () => {
  it('builds the real sport context captured by the expanded onboarding', () => {
    const existingProfile: AthleteProfile = {
      id: 'default',
      updatedAt: 1,
      scheduleProfile: { sessionsPerWeek: 4 },
      goalEvents: [
        { id: 'old-primary', title: 'Open viejo', date: '2026-07-01', sport: 'squash', priority: 'primary' },
        { id: 'secondary-1', title: 'Liga', date: '2026-09-01', sport: 'squash', priority: 'secondary' },
      ],
    }

    const patch = buildOnboardingAthleteProfilePatch({
      existingProfile,
      name: '  Rafa  ',
      selectedSports: ['squash', 'strength', 'running'],
      primarySport: 'running',
      priority: 'performance',
      availableDays: ['lun', 'mié', 'vie'],
      doubleSessionDays: ['mié'],
      goalEventTitle: '  10K Vitacura  ',
      goalEventDate: '2026-08-15',
      goalEventNotes: '  buscar PB  ',
      availabilityNotes: '  jueves con poco tiempo  ',
      currentInjuries: '  molestia tobillo  ',
      previousInjuries: '  rodilla 2024  ',
      restrictions: '  evitar impacto excesivo  ',
      strengthNotes: '  barra y mancuernas  ',
      squat1RM: '120,5',
      deadlift1RM: '150',
      benchPress1RM: '90',
      overheadPress1RM: '62.5',
      createId: () => 'new-event',
    })

    expect(patch).toMatchObject({
      name: 'Rafa',
      onboardingDeferredAt: undefined,
      sportContext: {
        enabledSports: ['squash', 'strength', 'running'],
        primarySport: 'running',
        secondarySports: ['squash', 'strength'],
        trainingPriority: 'performance',
      },
      mainGoal: 'Competir mejor',
      scheduleProfile: {
        sessionsPerWeek: 4,
        availableDays: ['lun', 'mié', 'vie'],
        doubleSessionDays: ['mié'],
        constraints: 'jueves con poco tiempo',
      },
      strengthProfile: {
        squat1RM: 120.5,
        deadlift1RM: 150,
        benchPress1RM: 90,
        overheadPress1RM: 62.5,
        notes: 'barra y mancuernas',
      },
      recoveryProfile: {
        currentInjuries: 'molestia tobillo',
        previousInjuries: 'rodilla 2024',
        restrictions: 'evitar impacto excesivo',
      },
    })
    expect(patch.goalEvents).toEqual([
      {
        id: 'old-primary',
        title: '10K Vitacura',
        date: '2026-08-15',
        sport: 'running',
        priority: 'primary',
        notes: 'buscar PB',
        eventType: 'race',
      },
      { id: 'secondary-1', title: 'Liga', date: '2026-09-01', sport: 'squash', priority: 'secondary' },
    ])
  })

  it('omits empty optional profile sections', () => {
    const patch = buildOnboardingAthleteProfilePatch({
      name: '',
      selectedSports: ['mobility'],
      primarySport: 'mobility',
      priority: 'fitness',
      availableDays: ['sáb'],
      doubleSessionDays: [],
      goalEventTitle: '',
      goalEventDate: '',
      goalEventNotes: '',
      availabilityNotes: '',
      currentInjuries: '',
      previousInjuries: '',
      restrictions: '',
      strengthNotes: '',
      squat1RM: '',
      deadlift1RM: '0',
      benchPress1RM: '-10',
      overheadPress1RM: 'abc',
    })

    expect(patch.name).toBeUndefined()
    expect(patch.strengthProfile).toBeUndefined()
    expect(patch.recoveryProfile).toBeUndefined()
    expect(patch.goalEvents).toBeUndefined()
    expect(patch.scheduleProfile).toMatchObject({ availableDays: ['sáb'] })
    expect(patch.scheduleProfile?.doubleSessionDays).toBeUndefined()
    expect(patch.scheduleProfile?.constraints).toBeUndefined()
  })
})

describe('parseOptionalKg', () => {
  it('accepts comma decimal kg values and rejects non-positive values', () => {
    expect(parseOptionalKg('100,5')).toBe(100.5)
    expect(parseOptionalKg('0')).toBeUndefined()
    expect(parseOptionalKg('-5')).toBeUndefined()
    expect(parseOptionalKg('n/a')).toBeUndefined()
  })
})
