import { describe, expect, it } from 'vitest'

import type { AthleteProfile, ChatContext } from '../../../types'
import { resolveWeekCreatorConfig } from '../WeekCreatorConfig'
import { WeekCreatorEngine } from '../WeekCreatorEngine'

function makeProfile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: Date.now(),
    sportContext: {
      enabledSports: ['squash', 'running', 'strength'],
      primarySport: 'squash',
    },
    ...overrides,
  }
}

describe('resolveWeekCreatorConfig', () => {
  it('returns null when profile is missing', () => {
    expect(resolveWeekCreatorConfig(null)).toBeNull()
    expect(resolveWeekCreatorConfig(undefined)).toBeNull()
  })

  it('returns null when no allowed sports can be derived', () => {
    expect(resolveWeekCreatorConfig({ id: 'x', updatedAt: 0 })).toBeNull()
  })

  it('derives a fallback config from athlete profile alone (no wizard)', () => {
    const config = resolveWeekCreatorConfig(makeProfile())
    expect(config).not.toBeNull()
    expect(config!.fromWizard).toBe(false)
    expect(config!.allowedSports).toEqual(expect.arrayContaining(['squash', 'running', 'strength']))
    expect(config!.primarySport).toBe('squash')
    expect(config!.sessionsPerWeek).toBeGreaterThanOrEqual(3)
    expect(config!.trainingDays.length).toBeGreaterThan(0)
  })

  it('translates spanish scheduleProfile.availableDays to DayOfWeek', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      scheduleProfile: { availableDays: ['lun', 'mié', 'vie', 'sáb'] },
    }))
    expect(config!.trainingDays).toEqual(expect.arrayContaining(['monday', 'wednesday', 'friday', 'saturday']))
    expect(config!.sessionsPerWeek).toBe(4)
  })

  it('uses planWizardConfig when present and marks fromWizard=true', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      goalEvents: [{ id: 'g1', title: 'X', date: '2026-06-01', sport: 'squash', priority: 'primary' }],
      planWizardConfig: {
        goalEventId: 'g1',
        trainingDays: ['monday', 'tuesday', 'thursday', 'saturday'],
        sessionsPerWeek: 4,
        sessionDurationMins: 60,
        allowDoubleSession: false,
        complementarySports: ['running', 'strength'],
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }))
    expect(config!.fromWizard).toBe(true)
    expect(config!.sessionsPerWeek).toBe(4)
    expect(config!.trainingDays).toEqual(['monday', 'tuesday', 'thursday', 'saturday'])
  })
})

describe('WeekCreatorEngine', () => {
  it('returns a profile-incomplete message when no allowed sports exist (no wizard required)', async () => {
    const context: ChatContext = {
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      athleteProfile: { id: 'athlete-1', updatedAt: Date.now() },
    }
    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )
    expect(response.actions).toBeUndefined()
    expect(response.message).toContain('deportes permitidos')
    expect(response.message).not.toContain('plan de competencia')
    expect(response.requestClass).toBe('week_creator')
  })
})
