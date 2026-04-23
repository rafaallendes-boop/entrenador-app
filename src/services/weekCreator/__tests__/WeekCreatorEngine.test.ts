import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AthleteProfile, ChatContext } from '../../../types'
import { resolveWeekCreatorConfig } from '../WeekCreatorConfig'
import { WeekCreatorEngine } from '../WeekCreatorEngine'

const mockProviderCall = vi.hoisted(() => vi.fn())

vi.mock('../../ai/providerResolver', () => ({
  getActiveProvider: () => ({
    name: 'mock',
    call: mockProviderCall,
  }),
}))

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

beforeEach(() => {
  mockProviderCall.mockReset()
})

describe('resolveWeekCreatorConfig', () => {
  it('returns conservative defaults when profile is missing', () => {
    expect(resolveWeekCreatorConfig(null)).toMatchObject({
      allowedSports: ['squash'],
      primarySport: 'squash',
      sessionsPerWeek: 3,
      sessionDurationMins: 60,
      fromWizard: false,
      configSource: 'defaults',
    })
    expect(resolveWeekCreatorConfig(undefined)).toMatchObject({
      allowedSports: ['squash'],
      configSource: 'defaults',
    })
  })

  it('falls back to squash when no allowed sports can be derived', () => {
    expect(resolveWeekCreatorConfig({ id: 'x', updatedAt: 0 })).toMatchObject({
      allowedSports: ['squash'],
      primarySport: 'squash',
      configSource: 'defaults',
    })
  })

  it('derives a fallback config from athlete profile alone (no wizard)', () => {
    const config = resolveWeekCreatorConfig(makeProfile())
    expect(config.fromWizard).toBe(false)
    expect(config.configSource).toBe('defaults')
    expect(config.allowedSports).toEqual(expect.arrayContaining(['squash', 'running', 'strength']))
    expect(config.primarySport).toBe('squash')
    expect(config.sessionsPerWeek).toBe(3)
    expect(config.trainingDays.length).toBeGreaterThan(0)
  })

  it('translates spanish scheduleProfile.availableDays to DayOfWeek', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      scheduleProfile: { availableDays: ['lun', 'mié', 'vie', 'sáb'] },
    }))
    expect(config.trainingDays).toEqual(expect.arrayContaining(['monday', 'wednesday', 'friday', 'saturday']))
    expect(config.sessionsPerWeek).toBe(4)
    expect(config.configSource).toBe('schedule')
  })

  it('uses inferred primary sport when enabled sports are missing', () => {
    const config = resolveWeekCreatorConfig({
      id: 'athlete-2',
      updatedAt: Date.now(),
      primarySport: 'running',
    })
    expect(config.allowedSports).toEqual(['running'])
    expect(config.primarySport).toBe('running')
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
    expect(config.fromWizard).toBe(true)
    expect(config.configSource).toBe('wizard')
    expect(config.sessionsPerWeek).toBe(4)
    expect(config.trainingDays).toEqual(['monday', 'tuesday', 'thursday', 'saturday'])
  })
})

describe('WeekCreatorEngine', () => {
  it('tries to generate a base week even when athleteProfile is missing', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: '<actions>' + JSON.stringify([
        {
          type: 'create_week',
          reason: 'Semana base conservadora',
          targetDate: '2026-05-04',
          sessions: [
            {
              date: '2026-05-04',
              timeBlock: 'AM',
              sessionType: 'squash',
              title: 'Squash tecnico base',
              durationMin: 60,
              squashDetails: {
                trainingFocus: 'technical',
                sessionMode: 'drill_session',
                drills: [{ name: 'Drives paralelos', durationMin: 20 }],
              },
            },
            {
              date: '2026-05-06',
              timeBlock: 'PM',
              sessionType: 'squash',
              title: 'Control y precision',
              durationMin: 60,
              squashDetails: {
                trainingFocus: 'technical',
                sessionMode: 'drill_session',
                drills: [{ name: 'Boast y recuperacion al T', durationMin: 20 }],
              },
            },
            {
              date: '2026-05-08',
              timeBlock: 'AM',
              sessionType: 'squash',
              title: 'Juegos condicionados suaves',
              durationMin: 60,
              squashDetails: {
                trainingFocus: 'conditioned_games',
                sessionMode: 'drill_session',
                drills: [{ name: 'Juego a dos esquinas', durationMin: 20 }],
              },
            },
          ],
        },
      ]) + '</actions>',
      provider: 'mock',
      model: 'mock-week-creator',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))

    const context: ChatContext = {
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    expect(mockProviderCall).toHaveBeenCalledTimes(1)
    expect(response.actions).toHaveLength(1)
    expect(response.actions?.[0]).toMatchObject({
      type: 'create_week',
      targetDate: '2026-05-04',
    })
    expect(response.message).toContain('3 sesiones')
    expect(response.message).not.toContain('deportes permitidos')
    expect(response.requestClass).toBe('week_creator')
  })
})
