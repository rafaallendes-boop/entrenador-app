import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AthleteProfile, ChatContext, CoachSessionProposal, DayOfWeek } from '../../../types'
import { validateWeekCreatorResponse } from '../validateWeekCreatorResponse'
import { extractRequestedSessionsPerWeek, resolveWeekCreatorConfig, withRequestedSessionsPerWeek } from '../WeekCreatorConfig'
import { areSessionListsEquivalent, WeekCreatorEngine } from '../WeekCreatorEngine'
import { buildWeekCreatorPrompt } from '../WeekCreatorPromptBuilder'
import { useAIDebugStore } from '../../../store/useAIDebugStore'
import { db } from '../../../db/db'
import { findSquashDrillByName } from '../../training/drillLibrary'

const mockProviderCall = vi.hoisted(() => vi.fn())

vi.mock('../../ai/providerResolver', () => ({
  getActiveProvider: () => ({
    name: 'mock',
    call: mockProviderCall,
  }),
  getProviderForRequestClass: () => ({
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

beforeEach(async () => {
  mockProviderCall.mockReset()
  useAIDebugStore.getState().clear()
  // The engine now enforces the daily `week_creator` cap, so telemetry left
  // behind by earlier cases in this file would rate-limit later ones.
  await db.aiRequestLogs.clear()
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

  it('uses the active plan sports when wizard config exists', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      planWizardConfig: {
        goalEventId: 'goal-1',
        trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        sessionsPerWeek: 5,
        sessionDurationMins: 60,
        allowDoubleSession: false,
        complementarySports: ['strength'],
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }))

    expect(config.allowedSports).toEqual(['squash', 'strength'])
  })

  it('uses enabled sports as implicit support when wizard complementary sports are empty', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      planWizardConfig: {
        goalEventId: 'goal-1',
        trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        sessionsPerWeek: 5,
        sessionDurationMins: 60,
        allowDoubleSession: false,
        complementarySports: [],
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }))

    expect(config.allowedSports).toEqual(['squash', 'running', 'strength'])
  })

  it('translates spanish scheduleProfile.availableDays to DayOfWeek', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      scheduleProfile: { availableDays: ['lun', 'mié', 'vie', 'sáb'] },
    }))
    expect(config.trainingDays).toEqual(expect.arrayContaining(['monday', 'wednesday', 'friday', 'saturday']))
    expect(config.sessionsPerWeek).toBe(4)
    expect(config.configSource).toBe('schedule')
  })

  it('derives eight sessions from seven available days with double-session capacity in auto mode', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      scheduleProfile: {
        availableDays: ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'],
        doubleSessionDays: ['lun', 'mar', 'mié', 'jue', 'vie'],
      },
    }))
    expect(config.sessionsPerWeek).toBe(8)
    expect(config.maxSessionsPerWeek).toBe(8)
  })

  it('derives four sessions from five available days in auto mode', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      scheduleProfile: { availableDays: ['lun', 'mar', 'mié', 'jue', 'vie'] },
    }))
    expect(config.sessionsPerWeek).toBe(4)
  })

  it('derives seven sessions from six available days when auto mode has double-session days', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      scheduleProfile: {
        availableDays: ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
        doubleSessionDays: ['lun', 'mié', 'vie'],
      },
    }))

    expect(config.sessionsPerWeek).toBe(7)
    expect(config.maxSessionsPerWeek).toBe(8)
    expect(config.allowDoubleSession).toBe(true)
  })

  it('derives an auto double-session target when schedule capacity explicitly allows it', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      scheduleProfile: {
        availableDays: ['lun', 'mar', 'jue', 'vie', 'dom'],
        doubleSessionDays: ['lun', 'mar', 'jue', 'vie'],
        constraints: 'solo AM los martes, no disponible sabados',
      },
    }))

    expect(config.trainingDays).toEqual(['monday', 'tuesday', 'thursday', 'friday', 'sunday'])
    expect(config.doubleSessionDays).toEqual(['monday', 'tuesday', 'thursday', 'friday'])
    expect(config.sessionsPerWeek).toBe(6)
    expect(config.scheduleConstraints).toContain('solo AM')
  })

  it('clamps wizard sessions to the real day capacity when no doubles are available', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      planWizardConfig: {
        goalEventId: 'goal-1',
        trainingDays: ['monday', 'tuesday', 'wednesday'],
        sessionsPerWeek: 5,
        sessionDurationMins: 60,
        allowDoubleSession: false,
        complementarySports: ['strength'],
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }))

    expect(config.maxSessionsPerWeek).toBe(3)
    expect(config.sessionsPerWeek).toBe(3)
  })

  it('uses explicit schedule sessions and clamps them to real capacity', () => {
    expect(resolveWeekCreatorConfig(makeProfile({
      scheduleProfile: {
        availableDays: ['lun', 'mar', 'mié', 'jue', 'vie'],
        sessionsPerWeek: 5,
      },
    })).sessionsPerWeek).toBe(5)

    expect(resolveWeekCreatorConfig(makeProfile({
      scheduleProfile: {
        availableDays: ['lun', 'mar', 'mié'],
        sessionsPerWeek: 6,
      },
    })).sessionsPerWeek).toBe(3)
  })

  it('allows an explicit eight-session target when selected double days provide enough slots', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      scheduleProfile: {
        availableDays: ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
        doubleSessionDays: ['lun', 'mié', 'vie'],
        sessionsPerWeek: 8,
      },
    }))

    expect(config.sessionsPerWeek).toBe(8)
    expect(config.maxSessionsPerWeek).toBe(8)
    expect(config.doubleSessionDays).toEqual(['monday', 'wednesday', 'friday'])
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

  it('lets current schedule availability override stale plan wizard days for week creator', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      scheduleProfile: {
        availableDays: ['lun', 'mar', 'jue', 'vie', 'dom'],
        doubleSessionDays: ['lun', 'mar', 'jue', 'vie'],
        constraints: 'solo AM los martes, no disponible sabados',
      },
      planWizardConfig: {
        goalEventId: 'g1',
        trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
        sessionsPerWeek: 6,
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
    expect(config.trainingDays).toEqual(['monday', 'tuesday', 'thursday', 'friday', 'sunday'])
    expect(config.doubleSessionDays).toEqual(['monday', 'tuesday', 'thursday', 'friday'])
    expect(config.sessionsPerWeek).toBe(6)
    expect(config.allowDoubleSession).toBe(true)
    expect(config.scheduleConstraints).toContain('no disponible sabados')
  })

  it('lets the current athlete profile primary sport override a stale plan event sport', () => {
    const profile = makeProfile({
      primarySport: 'running',
      secondarySports: ['squash', 'strength', 'mobility'],
      sportContext: {
        enabledSports: ['running', 'squash', 'strength', 'mobility'],
        primarySport: 'running',
        secondarySports: ['squash', 'strength', 'mobility'],
      },
      goalEvents: [{ id: 'g1', title: 'Open antiguo', date: '2026-06-01', sport: 'squash', priority: 'primary' }],
      planWizardConfig: {
        goalEventId: 'g1',
        trainingDays: ['monday', 'tuesday', 'thursday', 'saturday'],
        sessionsPerWeek: 4,
        sessionDurationMins: 60,
        allowDoubleSession: false,
        complementarySports: ['strength', 'mobility'],
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    })
    const config = resolveWeekCreatorConfig(profile)

    expect(config.primarySport).toBe('running')
    expect(config.allowedSports).toEqual(expect.arrayContaining(['running', 'squash', 'strength', 'mobility']))

    const prompt = buildWeekCreatorPrompt({
      athleteProfile: profile,
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }, {
      userMessage: 'Crea una semana priorizando running',
      targetWeekStart: '2026-05-04',
      config,
    })

    expect(prompt.userPrompt).toContain('- Deporte principal a mantener presente: running')
    expect(prompt.userPrompt).toContain('Evento heredado/de plan anterior')
    expect(prompt.userPrompt).toContain('No uses el evento squash como restricción dura')
    expect(prompt.userPrompt).toContain('Prioridad explícita del usuario: running')
  })

  it('lets an explicit chat count override the wizard target within real capacity', () => {
    const config = resolveWeekCreatorConfig(makeProfile({
      planWizardConfig: {
        goalEventId: 'g1',
        trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
        doubleSessionDays: ['monday', 'wednesday', 'friday'],
        sessionsPerWeek: 7,
        sessionDurationMins: 60,
        allowDoubleSession: true,
        complementarySports: ['running', 'strength'],
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }))

    expect(withRequestedSessionsPerWeek(config, 'Créame 8 entrenamientos')).toMatchObject({
      configSource: 'wizard',
      sessionsPerWeek: 8,
    })
    expect(withRequestedSessionsPerWeek(config, 'Créame 5 sesiones')).toMatchObject({
      configSource: 'wizard',
      sessionsPerWeek: 5,
    })
  })

  it('extracts explicit session counts from chat messages', () => {
    expect(extractRequestedSessionsPerWeek('Créame 6 sesiones priorizando squash')).toBe(6)
    expect(extractRequestedSessionsPerWeek('Quiero cinco entrenamientos esta semana')).toBe(5)
    expect(extractRequestedSessionsPerWeek('Quiero ocho entrenamientos esta semana')).toBe(8)
    expect(extractRequestedSessionsPerWeek('Crear semana normal')).toBeUndefined()
  })
})

describe('WeekCreatorEngine', () => {
  it('asks the user to complete the athlete profile when config only has defaults', async () => {
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

    expect(mockProviderCall).not.toHaveBeenCalled()
    expect(response.actions).toEqual([])
    expect(response.message).toContain('completar tu perfil')
    expect(response.requestClass).toBe('week_creator')
  })

  it('prompts prioritized squash weeks as a real majority when four sessions are configured', () => {
    const context: ChatContext = {
      athleteProfile: makeProfile({
        planWizardConfig: {
          goalEventId: 'goal-1',
          trainingDays: ['monday', 'tuesday', 'thursday', 'friday'],
          sessionsPerWeek: 4,
          sessionDurationMins: 60,
          allowDoubleSession: false,
          complementarySports: ['strength', 'mobility'],
          currentFitnessLevel: 'normal',
          currentFatigue: 'normal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }
    const config = resolveWeekCreatorConfig(context.athleteProfile)

    const prompt = buildWeekCreatorPrompt(context, {
      userMessage: 'Crea una semana priorizando squash',
      targetWeekStart: '2026-05-04',
      config,
    })

    expect(prompt.systemPrompt).toContain('Eres un generador de semanas de entrenamiento.')
    expect(prompt.systemPrompt).not.toContain('dentro de un plan por evento ya estructurado')
    expect(prompt.userPrompt).toContain('al menos 3 sesiones de squash')
    expect(prompt.userPrompt).toContain('máximo 1 accesorias')
    expect(prompt.userPrompt).toContain('Usa el 1 cupo accesorio con deportes de soporte permitidos')
    expect(prompt.userPrompt).toContain('evita dos squash el mismo día')
    expect(prompt.userPrompt).toContain('Sesión solo técnica')
    expect(prompt.userPrompt).toContain('al menos 4 drills técnicos')
    expect(prompt.userPrompt).toContain('2 drills de ghosting y 2-3 drills de control')
  })

  it('prompts current-week creation as a partial week from today onward', () => {
    const context: ChatContext = {
      athleteProfile: makeProfile({
        primarySport: 'running',
        sportContext: {
          enabledSports: ['running'],
          primarySport: 'running',
        },
        scheduleProfile: {
          availableDays: ['lun', 'mar', 'jue', 'sáb'],
          sessionsPerWeek: 4,
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }
    const config = {
      ...resolveWeekCreatorConfig(context.athleteProfile),
      trainingDays: ['thursday', 'saturday'] as DayOfWeek[],
      sessionsPerWeek: 2,
      maxSessionsPerWeek: 2,
      scheduleConstraints: 'Semana parcial: planificar solo desde 2026-05-06 hasta 2026-05-10; no usar días pasados de esta semana.',
    }

    const prompt = buildWeekCreatorPrompt(context, {
      userMessage: 'Créame la semana',
      targetWeekStart: '2026-05-04',
      planningStartDate: '2026-05-06',
      weekEndDate: '2026-05-10',
      config,
    })

    expect(prompt.userPrompt).toContain('targetDate=2026-05-04')
    expect(prompt.userPrompt).toContain('programa sesiones solo desde 2026-05-06 hasta 2026-05-10')
    expect(prompt.userPrompt).toContain('- Sesiones por semana: 2')
    expect(prompt.userPrompt).toContain('- Días permitidos: thursday, saturday')
  })

  it('rejects current-week sessions before the effective planning start', () => {
    const profile = makeProfile({
      primarySport: 'running',
      sportContext: {
        enabledSports: ['running'],
        primarySport: 'running',
      },
      scheduleProfile: {
        availableDays: ['lun', 'mar', 'jue', 'sáb'],
        sessionsPerWeek: 4,
      },
    })
    const context: ChatContext = {
      athleteProfile: profile,
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }
    const config = {
      ...resolveWeekCreatorConfig(profile),
      trainingDays: ['thursday', 'saturday'] as DayOfWeek[],
      sessionsPerWeek: 2,
      maxSessionsPerWeek: 2,
    }

    const validation = validateWeekCreatorResponse({
      response: {
        message: 'Semana parcial',
        actions: [{
          type: 'create_week',
          reason: 'test',
          targetDate: '2026-05-04',
          weekObjectives: [],
          sessions: [
            {
              date: '2026-05-04',
              timeBlock: 'AM',
              sessionType: 'running',
              title: 'Running pasado',
              durationMin: 45,
              objective: 'No debe pasar',
              runningType: 'z2',
            },
            {
              date: '2026-05-07',
              timeBlock: 'AM',
              sessionType: 'running',
              title: 'Running valido',
              durationMin: 45,
              objective: 'Sesion valida',
              runningType: 'z2',
            },
          ],
        }],
        provider: 'mock',
        model: 'mock',
        timestamp: Date.now(),
        requestClass: 'week_creator',
        traceId: 'trace-test',
        durationMs: 0,
        retryUsed: false,
        fallbackUsed: false,
        meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false },
      },
      context,
      config,
      targetWeekStart: '2026-05-04',
      planningStartDate: '2026-05-06',
    })

    expect(validation.ok).toBe(false)
    expect(validation.code).toBe('invalid_week_dates')
    expect(validation.error).toContain('entre 2026-05-06 y 2026-05-10')
  })

  it('repairs current-week creation so past weekdays are not scheduled', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string; userMessage: string }) => {
      expect(request.userMessage).toContain('programa sesiones solo desde 2026-05-06 hasta 2026-05-10')
      expect(request.userMessage).toContain('- Sesiones por semana: 2')
      return {
        text: '<actions>' + JSON.stringify([
          {
            type: 'create_week',
            reason: 'Semana parcial',
            targetDate: '2026-05-04',
            sessions: [
              {
                date: '2026-05-04',
                timeBlock: 'AM',
                sessionType: 'running',
                title: 'Running lunes',
                durationMin: 45,
                objective: 'Base aeróbica',
                runningType: 'z2',
              },
              {
                date: '2026-05-05',
                timeBlock: 'AM',
                sessionType: 'running',
                title: 'Running martes',
                durationMin: 45,
                objective: 'Base aeróbica',
                runningType: 'z2',
              },
              {
                date: '2026-05-07',
                timeBlock: 'AM',
                sessionType: 'running',
                title: 'Running jueves',
                durationMin: 45,
                objective: 'Base aeróbica',
                runningType: 'z2',
              },
              {
                date: '2026-05-09',
                timeBlock: 'AM',
                sessionType: 'running',
                title: 'Running sabado',
                durationMin: 45,
                objective: 'Base aeróbica',
                runningType: 'z2',
              },
            ],
          },
        ]) + '</actions>',
        provider: 'mock',
        model: 'mock-week-creator',
        traceId: request.traceId,
        requestClass: request.requestClass,
      }
    })

    const context: ChatContext = {
      athleteProfile: makeProfile({
        primarySport: 'running',
        sportContext: {
          enabledSports: ['running'],
          primarySport: 'running',
        },
        scheduleProfile: {
          availableDays: ['lun', 'mar', 'jue', 'sáb'],
          sessionsPerWeek: 4,
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04', today: '2026-05-06' },
    )

    const sessions = response.actions?.[0].sessions ?? []
    expect(response.actions?.[0].targetDate).toBe('2026-05-04')
    expect(sessions).toHaveLength(2)
    expect(sessions.every((session) => session.date >= '2026-05-06' && session.date <= '2026-05-10')).toBe(true)
    expect(sessions.map((session) => session.date)).not.toContain('2026-05-04')
    expect(sessions.map((session) => session.date)).not.toContain('2026-05-05')
  })

  it('honors an explicit six-session request when profile capacity allows it', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string; userMessage: string; responseMimeType?: string; responseSchema?: Record<string, unknown> }) => {
      expect(request.userMessage).toContain('- Sesiones por semana: 6')
      expect(request.userMessage).toContain('responde solo con un objeto JSON')
      expect(request.responseMimeType).toBe('application/json')
      expect(request.responseSchema).toMatchObject({
        type: 'OBJECT',
        properties: expect.objectContaining({
          sessions: expect.any(Object),
        }),
      })
      return {
        text: '<actions>' + JSON.stringify([
          {
            type: 'create_week',
            reason: 'Semana squash de seis sesiones',
            targetDate: '2026-05-04',
            sessions: Array.from({ length: 6 }, (_, index) => ({
              date: `2026-05-${String(4 + index).padStart(2, '0')}`,
              timeBlock: 'AM',
              sessionType: 'squash',
              title: `Squash ${index + 1}`,
              durationMin: 60,
              objective: 'Prioridad squash',
              squashDetails: {
                trainingFocus: 'technical',
                sessionMode: 'drill_session',
                drills: [{ name: `Drill ${index + 1}`, durationMin: 20 }],
              },
            })),
          },
        ]) + '</actions>',
        provider: 'mock',
        model: 'mock-week-creator',
        traceId: request.traceId,
        requestClass: request.requestClass,
      }
    })

    const context: ChatContext = {
      athleteProfile: makeProfile({
        scheduleProfile: {
          availableDays: ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'],
          doubleSessionDays: ['lun', 'mar', 'mié', 'jue', 'vie'],
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame 6 sesiones priorizando squash',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    expect(response.actions?.[0].sessions).toHaveLength(6)
  })

  it('generates a base week when profile has schedule context', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string; generationId?: string }) => ({
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
              objective: 'sesión planificada',
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
              objective: 'sesión planificada',
              squashDetails: {
                trainingFocus: 'technical',
                sessionMode: 'drill_session',
                drills: [{ name: 'Tiros cruzados profundos', durationMin: 20 }],
              },
            },
            {
              date: '2026-05-08',
              timeBlock: 'AM',
              sessionType: 'squash',
              title: 'Juegos condicionados suaves',
              durationMin: 60,
              objective: 'sesión planificada',
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
      generationId: request.generationId,
      requestClass: request.requestClass,
      durationMs: 4200,
      serverDurationMs: 4350,
      authDurationMs: 90,
      promptTokens: 2800,
      completionTokens: 900,
      reasoningTokens: 220,
      cacheReadInputTokens: 120,
      serviceTier: 'priority',
      reasoningEffort: 'none',
      finishReason: 'stop',
    }))

    const context: ChatContext = {
      athleteProfile: makeProfile({
        scheduleProfile: { availableDays: ['lun', 'mié', 'vie'] },
      }),
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
    expect(response.generationId).toMatch(/^week_creator-generation-/)
    expect(mockProviderCall.mock.calls[0][0]).toMatchObject({
      generationId: response.generationId,
      logicalAttempt: 1,
      responseMimeType: 'application/json',
    })
    const debugRequest = useAIDebugStore.getState().requests.find((request) => request.traceId === response.traceId)
    expect(debugRequest).toMatchObject({
      generationId: response.generationId,
      attempt: 1,
      status: 'completed',
      durationMs: 4200,
      serverDurationMs: 4350,
      authDurationMs: 90,
      promptTokens: 2800,
      completionTokens: 900,
      reasoningTokens: 220,
      cacheReadInputTokens: 120,
      serviceTier: 'priority',
      reasoningEffort: 'none',
      finishReason: 'stop',
      expectedSessionCount: 3,
    })
    expect(debugRequest?.inputCharCount).toBeGreaterThan(0)
    expect(debugRequest?.responseSchemaCharCount).toBeGreaterThan(0)
    expect(debugRequest?.stageTimings?.map((stage) => stage.stage)).toEqual([
      'prompt_build',
      'provider_call',
      'normalize',
      'hydrate',
      'repair',
      'validate',
    ])
  })

  it('accepts a schema-mode raw JSON create_week response without actions markup', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: JSON.stringify({
        type: 'create_week',
        reason: 'Semana JSON estructurada',
        targetDate: '2026-05-04',
        sessions: [
          {
            date: '2026-05-04',
            timeBlock: 'AM',
            sessionType: 'squash',
            title: 'Squash tecnico',
            durationMin: 60,
            objective: 'Mejorar profundidad y control.',
            squashDetails: {
              trainingFocus: 'technical',
              sessionMode: 'drill_session',
              drills: [
                { name: 'Tiros paralelos profundos', durationMin: 12 },
                { name: 'Tiros cruzados profundos', durationMin: 12 },
                { name: 'Volea de control', durationMin: 10 },
                { name: 'Boast y recuperacion', durationMin: 10 },
              ],
            },
          },
          {
            date: '2026-05-06',
            timeBlock: 'AM',
            sessionType: 'squash',
            title: 'Squash control',
            durationMin: 60,
            objective: 'Sostener rallies con precision.',
            squashDetails: {
              trainingFocus: 'control',
              sessionMode: 'drill_session',
              drills: [
                { name: 'Drive con objetivo de zona', durationMin: 12 },
                { name: 'Drop controlado', durationMin: 10 },
                { name: 'Lob defensivo', durationMin: 10 },
                { name: 'Rally a media velocidad', durationMin: 12 },
              ],
            },
          },
          {
            date: '2026-05-08',
            timeBlock: 'AM',
            sessionType: 'strength',
            title: 'Fuerza base',
            durationMin: 60,
            objective: 'Construir soporte general.',
            exercises: [
              { name: 'Sentadilla goblet', sets: 3, reps: 8, group: 'legs' },
              { name: 'Peso muerto rumano', sets: 3, reps: 8, group: 'hinge' },
              { name: 'Remo mancuerna', sets: 3, reps: 10, group: 'pull' },
              { name: 'Plancha lateral', sets: 3, reps: '30s', group: 'core' },
              { name: 'Split squat', sets: 3, reps: 8, group: 'legs' },
            ],
          },
        ],
      }),
      provider: 'mock',
      model: 'mock-week-creator',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))

    const context: ChatContext = {
      athleteProfile: makeProfile({
        scheduleProfile: { availableDays: ['lun', 'mié', 'vie'] },
      }),
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
    expect(response.fallbackUsed).toBeFalsy()
    expect(response.actions?.[0]).toMatchObject({
      type: 'create_week',
      targetDate: '2026-05-04',
    })
    expect(response.actions?.[0].sessions).toHaveLength(3)
  })

  it('repairs a partial week when one incomplete session was dropped during normalization', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: '<actions>' + JSON.stringify([
        {
          type: 'create_week',
          reason: 'Semana build con descarte seguro',
          targetDate: '2026-05-04',
          sessions: [
            {
              date: '2026-05-04',
              timeBlock: 'AM',
              sessionType: 'squash',
              title: 'Squash tecnico base',
              durationMin: 60,
              objective: 'sesión planificada',
            },
            {
              date: '2026-05-05',
              timeBlock: 'PM',
              sessionType: 'strength',
              title: 'Fuerza general',
              durationMin: 45,
              objective: 'sesión planificada',
            },
            {
              date: '2026-05-06',
              sessionType: 'running',
              title: 'Rodaje Z2',
            },
            {
              date: '2026-05-07',
              timeBlock: 'PM',
              sessionType: 'squash',
              title: 'Control y precision',
              durationMin: 55,
              objective: 'sesión planificada',
            },
            {
              date: '2026-05-08',
              timeBlock: 'AM',
              sessionType: 'running',
              durationMin: 35,
              objective: 'sesión planificada',
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
      athleteProfile: makeProfile({
        planWizardConfig: {
          goalEventId: 'goal-1',
          trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
          sessionsPerWeek: 5,
          sessionDurationMins: 60,
          allowDoubleSession: false,
          complementarySports: ['running', 'strength'],
          currentFitnessLevel: 'normal',
          currentFatigue: 'normal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
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
    expect(response.actions?.[0].sessions).toHaveLength(5)
    expect(response.actions?.[0].sessions?.filter((session) => session.sessionType === 'squash')).toHaveLength(3)
    expect(response.message).toContain('Se agregaron 1 sesiones fallback')
  })

  it('finalizes an all-squash provider week into the required support mix', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: '<actions>' + JSON.stringify([
        {
          type: 'create_week',
          reason: 'Semana con soporte omitido por el modelo',
          targetDate: '2026-05-04',
          sessions: [
            squashSession('2026-05-04', 'AM', 'Squash 1', 'Tiros paralelos profundos'),
            squashSession('2026-05-05', 'AM', 'Squash 2', 'Tiros cruzados profundos'),
            squashSession('2026-05-06', 'AM', 'Squash 3', 'Boast y drive paralelo de salida'),
            squashSession('2026-05-07', 'AM', 'Squash 4', 'Drop y contra-drop por ambos lados'),
            squashSession('2026-05-08', 'AM', 'Squash 5', 'Drops desde media cancha'),
          ],
        },
      ]) + '</actions>',
      provider: 'mock',
      model: 'mock-week-creator',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))

    const context: ChatContext = {
      athleteProfile: makeProfile({
        planWizardConfig: {
          goalEventId: 'goal-1',
          trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
          sessionsPerWeek: 5,
          sessionDurationMins: 60,
          allowDoubleSession: false,
          complementarySports: ['running', 'strength'],
          currentFitnessLevel: 'normal',
          currentFatigue: 'normal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una semana con squash, running y fuerza',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    const sessions = response.actions?.[0].sessions ?? []
    expect(mockProviderCall).toHaveBeenCalledTimes(1)
    expect(sessions).toHaveLength(5)
    expect(sessions.filter((session) => session.sessionType === 'squash')).toHaveLength(3)
    expect(sessions.some((session) => session.sessionType === 'running')).toBe(true)
    expect(sessions.some((session) => session.sessionType === 'strength')).toBe(true)
    expect(response.message).toContain('Se ajustó la distribución final')
  })

  it('finalizes an all-squash provider week with implicit support sports from the athlete context', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: '<actions>' + JSON.stringify([
        {
          type: 'create_week',
          reason: 'Semana con soporte omitido por el modelo',
          targetDate: '2026-05-04',
          sessions: [
            squashSession('2026-05-04', 'AM', 'Squash 1', 'Tiros paralelos profundos'),
            squashSession('2026-05-05', 'AM', 'Squash 2', 'Tiros cruzados profundos'),
            squashSession('2026-05-06', 'AM', 'Squash 3', 'Boast y drive paralelo de salida'),
            squashSession('2026-05-07', 'AM', 'Squash 4', 'Drop y contra-drop por ambos lados'),
            squashSession('2026-05-08', 'AM', 'Squash 5', 'Drops desde media cancha'),
          ],
        },
      ]) + '</actions>',
      provider: 'mock',
      model: 'mock-week-creator',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))

    const context: ChatContext = {
      athleteProfile: makeProfile({
        planWizardConfig: {
          goalEventId: 'goal-1',
          trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
          sessionsPerWeek: 5,
          sessionDurationMins: 60,
          allowDoubleSession: false,
          complementarySports: [],
          currentFitnessLevel: 'normal',
          currentFatigue: 'normal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una semana de entrenamiento',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    const sessionTypes = response.actions?.[0].sessions?.map((session) => session.sessionType) ?? []
    expect(sessionTypes).toHaveLength(5)
    expect(sessionTypes.filter((type) => type === 'squash')).toHaveLength(3)
    expect(sessionTypes).toContain('running')
    expect(sessionTypes).toContain('strength')
    expect(response.message).toContain('Se ajustó la distribución final')
  })

  it('salvages a structurally valid provider week that uses an out-of-catalog squash drill', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: '<actions>' + JSON.stringify([
        {
          type: 'create_week',
          reason: 'Semana squash con un drill fuera de catálogo',
          targetDate: '2026-05-04',
          sessions: [
            squashSession('2026-05-04', 'AM', 'Squash 1', 'Tiros paralelos profundos'),
            squashSession('2026-05-05', 'AM', 'Squash 2', 'Drives paralelos con ' + 'recuperaci' + 'ón a' + 'l T'),
            squashSession('2026-05-06', 'AM', 'Squash 3', 'Boast y drive paralelo de salida'),
            {
              date: '2026-05-07',
              timeBlock: 'AM',
              sessionType: 'strength',
              title: 'Fuerza soporte squash',
              durationMin: 60,
              objective: 'Soporte general para squash.',
              exercises: [
                { name: 'Sentadilla goblet', sets: 3, reps: 8, group: 'legs' },
                { name: 'Remo con pecho apoyado', sets: 3, reps: 10, group: 'pull' },
                { name: 'Press Pallof', sets: 3, reps: '10/lado', group: 'core' },
                { name: 'Zancada lateral con barra', sets: 3, reps: '8/lado', group: 'legs' },
                { name: 'Plancha lateral', sets: 3, reps: '30s/lado', group: 'core' },
              ],
            },
            {
              date: '2026-05-08',
              timeBlock: 'AM',
              sessionType: 'running',
              title: 'Rodaje Z2 controlado',
              durationMin: 45,
              objective: 'Sumar base aeróbica de baja interferencia.',
              runningType: 'z2',
            },
          ],
        },
      ]) + '</actions>',
      provider: 'gemini',
      model: 'gemini-flash',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))

    const context: ChatContext = {
      athleteProfile: makeProfile({
        planWizardConfig: {
          goalEventId: 'goal-1',
          trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
          sessionsPerWeek: 5,
          sessionDurationMins: 60,
          allowDoubleSession: false,
          complementarySports: ['running', 'strength'],
          currentFitnessLevel: 'normal',
          currentFatigue: 'normal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    const sessions = response.actions?.[0].sessions ?? []
    const squashDrills = sessions
      .filter((session) => session.sessionType === 'squash')
      .flatMap((session) => session.squashDetails?.drills ?? [])

    expect(mockProviderCall).toHaveBeenCalledTimes(1)
    expect(response.fallbackUsed).toBeFalsy()
    expect(sessions).toHaveLength(5)
    expect(sessions.filter((session) => session.sessionType === 'squash')).toHaveLength(3)
    expect(squashDrills.length).toBeGreaterThan(0)
    expect(squashDrills.every((drill) => findSquashDrillByName(drill.name) != null)).toBe(true)
  })

  it('repairs duplicate squash drills locally instead of retrying the whole week', async () => {
    const duplicateSquashDetails = {
      trainingFocus: 'technical' as const,
      sessionMode: 'drill_session' as const,
      sessionKind: 'technical' as const,
      drills: [{ name: 'Tiros paralelos profundos', durationMin: 20 }],
    }

    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: '<actions>' + JSON.stringify([
        {
          type: 'create_week',
          reason: 'Semana squash con un duplicado reparable',
          targetDate: '2026-05-04',
          sessions: [
            {
              date: '2026-05-04',
              timeBlock: 'AM',
              sessionType: 'squash',
              title: 'Squash tecnica de golpes',
              durationMin: 60,
              objective: 'Profundidad y control de golpe.',
              squashDetails: duplicateSquashDetails,
            },
            {
              date: '2026-05-05',
              timeBlock: 'AM',
              sessionType: 'squash',
              title: 'Squash ghosting y drills de control',
              durationMin: 60,
              objective: 'Desplazamiento, vuelta a la T y control.',
              squashDetails: duplicateSquashDetails,
            },
            {
              date: '2026-05-06',
              timeBlock: 'AM',
              sessionType: 'strength',
              title: 'Fuerza soporte squash',
              durationMin: 60,
              objective: 'Soporte general para squash.',
              exercises: [
                { name: 'Sentadilla goblet', sets: 3, reps: 8, group: 'legs' },
                { name: 'Remo con pecho apoyado', sets: 3, reps: 10, group: 'pull' },
                { name: 'Press Pallof', sets: 3, reps: '10/lado', group: 'core' },
                { name: 'Zancada lateral con barra', sets: 3, reps: '8/lado', group: 'legs' },
                { name: 'Plancha lateral', sets: 3, reps: '30s/lado', group: 'core' },
              ],
            },
            {
              date: '2026-05-07',
              timeBlock: 'AM',
              sessionType: 'squash',
              title: 'Squash control frontal',
              durationMin: 60,
              objective: 'Tacto y control en zona delantera.',
              squashDetails: {
                trainingFocus: 'technical' as const,
                sessionMode: 'drill_session' as const,
                sessionKind: 'control' as const,
                drills: [{ name: '100 drops en solitario (50 por lado)', durationMin: 20 }],
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
      athleteProfile: makeProfile({
        planWizardConfig: {
          goalEventId: 'goal-1',
          trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday'],
          sessionsPerWeek: 4,
          sessionDurationMins: 60,
          allowDoubleSession: false,
          complementarySports: ['strength'],
          currentFitnessLevel: 'normal',
          currentFatigue: 'normal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una semana manteniendo squash como prioridad',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    const squashSignatures = (response.actions?.[0].sessions ?? [])
      .filter((session) => session.sessionType === 'squash')
      .map((session) => session.squashDetails?.drills.map((drill) => drill.name).sort().join('|'))

    expect(mockProviderCall).toHaveBeenCalledTimes(1)
    expect(response.fallbackUsed).toBeFalsy()
    expect(new Set(squashSignatures).size).toBe(squashSignatures.length)
    expect(response.message).toContain('evitar repetir los mismos drills')
  })

  it('repairs duplicate strength sessions locally instead of retrying the whole week', async () => {
    const repeatedExercises = [
      { name: 'Sentadilla', sets: 4, reps: 6, group: 'legs' },
      { name: 'Press banca', sets: 4, reps: 6, group: 'push' },
    ]

    mockProviderCall.mockImplementationOnce(async (request: { requestClass: string; traceId: string }) => ({
      text: '<actions>' + JSON.stringify([
        {
          type: 'create_week',
          reason: 'Semana fuerza repetida',
          targetDate: '2026-05-04',
          sessions: [
            {
              date: '2026-05-04',
              timeBlock: 'AM',
              sessionType: 'strength',
              title: 'Fuerza A',
              durationMin: 60,
              objective: 'Fuerza base',
              exercises: repeatedExercises,
            },
            {
              date: '2026-05-06',
              timeBlock: 'AM',
              sessionType: 'strength',
              title: 'Fuerza B',
              durationMin: 60,
              objective: 'Fuerza base',
              exercises: repeatedExercises,
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
      athleteProfile: makeProfile({
        sportContext: {
          enabledSports: ['strength'],
          primarySport: 'strength',
        },
        planWizardConfig: {
          goalEventId: 'goal-1',
          trainingDays: ['monday', 'wednesday'],
          sessionsPerWeek: 2,
          sessionDurationMins: 60,
          allowDoubleSession: false,
          complementarySports: [],
          currentFitnessLevel: 'normal',
          currentFatigue: 'normal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una semana con dos sesiones de fuerza',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    const strengthSignatures = (response.actions?.[0].sessions ?? [])
      .filter((session) => session.sessionType === 'strength')
      .map((session) => session.exercises?.map((exercise) => exercise.name).join('|'))

    expect(mockProviderCall).toHaveBeenCalledTimes(1)
    expect(response.fallbackUsed).toBeFalsy()
    expect(new Set(strengthSignatures).size).toBe(strengthSignatures.length)
  })

  it('returns a local fallback week without paying a second request when create_week is missing', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: 'Puedo armar una semana con squash, fuerza y running, pero no incluyo acciones.',
      provider: 'gemini',
      model: 'gemini-flash',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))

    const context: ChatContext = {
      athleteProfile: makeProfile({
        planWizardConfig: {
          goalEventId: 'goal-1',
          trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
          sessionsPerWeek: 5,
          sessionDurationMins: 60,
          allowDoubleSession: false,
          complementarySports: ['running', 'strength'],
          currentFitnessLevel: 'normal',
          currentFatigue: 'normal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una semana de entrenamiento para la próxima semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    expect(mockProviderCall).toHaveBeenCalledTimes(1)
    const providerGenerationIds = mockProviderCall.mock.calls.map(([request]) => request.generationId)
    const logicalAttempts = mockProviderCall.mock.calls.map(([request]) => request.logicalAttempt)
    expect(new Set(providerGenerationIds).size).toBe(1)
    expect(providerGenerationIds[0]).toMatch(/^week_creator-generation-/)
    expect(logicalAttempts).toEqual([1])
    expect(response.fallbackUsed).toBe(true)
    expect(response.actions?.[0]).toMatchObject({
      type: 'create_week',
      targetDate: '2026-05-04',
    })
    expect(response.actions?.[0].sessions).toHaveLength(5)
    expect(response.actions?.[0].sessions?.filter((session) => session.sessionType === 'squash')).toHaveLength(3)
    const strength = response.actions?.[0].sessions?.find((session) => session.sessionType === 'strength')
    expect(strength?.exercises?.slice(0, 2).every((exercise) => exercise.group === 'core')).toBe(true)
    expect(strength?.exercises?.some((exercise) => exercise.group === 'cardio')).toBe(true)
    expect(strength?.exercises?.at(-1)?.group).toBe('cardio')
    expect(response.message).toContain('semana base automática')
    expect(response.message).not.toContain('El proveedor')
    expect(response.message).not.toContain('no devolvió una semana aplicable')
    expect(response.message).not.toContain('Gemini no devolvió el formato estructurado')
    expect(response.actions?.[0].reason).not.toContain('provider')

    const requests = useAIDebugStore.getState().requests
    expect(requests.filter((request) => request.generationId === providerGenerationIds[0])).toHaveLength(2)
    expect(requests.some((request) =>
      request.status === 'failed' &&
      request.errorCode === 'missing_create_week' &&
      request.outcome === 'schema_invalid' &&
      request.warnings?.some((warning) => warning.includes('week_creator_failure:missing_create_week')),
    )).toBe(true)
    expect(requests.some((request) =>
      request.warnings?.some((warning) => warning.includes('week_creator_fallback:local attempts=1 category=unsafe_or_ambiguous')),
    )).toBe(true)
    expect(requests.some((request) =>
      request.warnings?.some((warning) => warning.includes('provider=')),
    )).toBe(false)
    expect(requests[0]).toMatchObject({
      status: 'completed',
      fallbackUsed: true,
      retryUsed: false,
      errorCode: 'missing_create_week',
      outcome: 'schema_invalid',
      expectedSessionCount: 5,
      trainingDayCount: 5,
      allowedSportCount: 3,
      doubleSessionAllowed: false,
      partialWeek: false,
      activeRestrictionsPresent: false,
    })
    expect(requests[0].stageTimings?.map((stage) => stage.stage)).toEqual([
      'fallback',
      'validate',
    ])
    expect(requests[0].responseCharCount).toBeUndefined()
  })

  it('does not stack duplicate squash sessions on the same day in six-session fallback weeks', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: 'Puedo armar una semana, pero no incluyo acciones.',
      provider: 'gemini',
      model: 'gemini-flash',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))

    const context: ChatContext = {
      athleteProfile: makeProfile({
        planWizardConfig: {
          goalEventId: 'goal-1',
          trainingDays: ['monday', 'tuesday', 'wednesday'],
          sessionsPerWeek: 6,
          sessionDurationMins: 60,
          allowDoubleSession: true,
          complementarySports: ['running', 'strength'],
          currentFitnessLevel: 'normal',
          currentFatigue: 'normal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una semana de entrenamiento para la próxima semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    const sessions = response.actions?.[0].sessions ?? []
    const squashDates = sessions
      .filter((session) => session.sessionType === 'squash')
      .map((session) => session.date)
    const strength = sessions.find((session) => session.sessionType === 'strength')

    expect(response.fallbackUsed).toBe(true)
    expect(sessions).toHaveLength(6)
    expect(new Set(squashDates).size).toBe(squashDates.length)
    expect(strength?.durationMin).toBe(60)
    expect(strength?.exercises?.length).toBeGreaterThanOrEqual(6)
    expect(strength?.exercises?.slice(0, 2).every((exercise) => exercise.group === 'core')).toBe(true)
    expect(strength?.exercises?.at(-1)?.group).toBe('cardio')
  })

  it('spreads six-session fallback weeks across available days before using doubles', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: 'Rate limit del provider, sin acciones.',
      provider: 'gemini',
      model: 'gemini-flash',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))

    const context: ChatContext = {
      athleteProfile: makeProfile({
        scheduleProfile: {
          availableDays: ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'],
          doubleSessionDays: ['lun', 'mar', 'mié', 'jue', 'vie'],
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame 6 sesiones priorizando squash',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-11' },
    )

    const sessions = response.actions?.[0].sessions ?? []
    const visibleText = JSON.stringify(sessions)
    const squashSessions = sessions.filter((session) => session.sessionType === 'squash')

    expect(response.fallbackUsed).toBe(true)
    expect(sessions).toHaveLength(6)
    expect(sessions.every((session) => session.timeBlock === 'AM')).toBe(true)
    expect(new Set(sessions.map((session) => session.date)).size).toBe(6)
    expect(squashSessions.every((session) => (session.squashDetails?.drills.length ?? 0) >= 4)).toBe(true)
    expect(squashSessions.some((session) => session.squashDetails?.sessionKind === 'mixed')).toBe(true)
    expect(squashSessions.some((session) =>
      session.squashDetails?.blocks?.some((block) => block.kind === 'match'),
    )).toBe(true)
    expect(squashSessions.some((session) =>
      session.squashDetails?.blocks?.some((block) => block.kind === 'shadows') &&
      session.squashDetails?.blocks?.some((block) => block.kind === 'control'),
    )).toBe(true)
    expect(visibleText).not.toMatch(new RegExp('recuperaci' + '[oó]n a' + 'l T', 'i'))
    expect(visibleText).not.toContain('Drives paralelos con ' + 'recuperaci' + 'ón a' + 'l T')
    expect(visibleText).toContain('Tiros paralelos profundos')
  })

  it('honors the exact eight-session chat request with an active wizard and uses only allowed double days', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: 'Respuesta sin una create_week aplicable.',
      provider: 'gemini',
      model: 'gemini-flash',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))

    const context: ChatContext = {
      athleteProfile: makeProfile({
        scheduleProfile: {
          availableDays: ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
          doubleSessionDays: ['lun', 'mié', 'vie'],
        },
        planWizardConfig: {
          goalEventId: 'goal-1',
          trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
          doubleSessionDays: ['monday', 'wednesday', 'friday'],
          sessionsPerWeek: 7,
          sessionDurationMins: 60,
          allowDoubleSession: true,
          complementarySports: ['running', 'strength'],
          currentFitnessLevel: 'normal',
          currentFatigue: 'normal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Creame una semana de entrenamiento para la próxima semana con 8 entrenamientos y respetando mis horarios disponibles',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-11' },
    )

    const sessions = response.actions?.[0].sessions ?? []
    const countsByDate = sessions.reduce<Record<string, number>>((counts, session) => {
      counts[session.date] = (counts[session.date] ?? 0) + 1
      return counts
    }, {})
    const doubleDates = Object.entries(countsByDate)
      .filter(([, count]) => count === 2)
      .map(([date]) => date)

    expect(response.fallbackUsed).toBe(true)
    expect(sessions).toHaveLength(8)
    expect(mockProviderCall.mock.calls[0]?.[0].userMessage).toContain('- Sesiones por semana: 8')
    expect(mockProviderCall.mock.calls[0]?.[0].userMessage).toContain('debes usar al menos 2 doble(s) AM/PM')
    expect(new Set(sessions.map((session) => `${session.date}:${session.timeBlock}`)).size).toBe(8)
    expect(doubleDates).toHaveLength(2)
    expect(doubleDates.every((date) => ['2026-05-11', '2026-05-13', '2026-05-15'].includes(date))).toBe(true)
  })

  it('repairs a Tuesday AM proposal to PM without a second provider request', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: '<actions>' + JSON.stringify([{
        type: 'create_week',
        reason: 'Semana de una sesión',
        targetDate: '2026-05-11',
        sessions: [
          squashSession('2026-05-12', 'AM', 'Squash martes', 'Tiros paralelos profundos'),
        ],
      }]) + '</actions>',
      provider: 'mock',
      model: 'mock-week-creator',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))
    const context: ChatContext = {
      athleteProfile: makeProfile({
        scheduleProfile: {
          availableDays: ['mar'],
          sessionsPerWeek: 1,
          constraints: 'martes: solo PM',
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-11' },
    )

    expect(mockProviderCall).toHaveBeenCalledTimes(1)
    expect(response.fallbackUsed).toBeFalsy()
    expect(response.actions?.[0].sessions).toHaveLength(1)
    expect(response.actions?.[0].sessions?.[0]).toMatchObject({
      date: '2026-05-12',
      timeBlock: 'PM',
    })
    expect(response.message).toContain('bloques AM/PM configurados')
    const debugRequest = useAIDebugStore.getState().requests.find(
      (request) => request.traceId === response.traceId,
    )
    expect(debugRequest?.repairStats).toMatchObject({
      repairedSessionCount: 0,
      correctiveActionCount: 0,
      correctedSessionsAffected: 0,
      hydration: {
        repairedSessionCount: 4,
        correctiveActionCount: 4,
        correctedSessionsAffected: 1,
      },
    })
  })

  it('builds the deterministic fallback in the configured PM block', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: 'No incluyo acciones.',
      provider: 'mock',
      model: 'mock-week-creator',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))
    const context: ChatContext = {
      athleteProfile: makeProfile({
        scheduleProfile: {
          availableDays: ['mar'],
          sessionsPerWeek: 1,
          constraints: 'solo PM los martes',
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-11' },
    )

    expect(mockProviderCall).toHaveBeenCalledTimes(1)
    expect(response.fallbackUsed).toBe(true)
    expect(response.actions?.[0].sessions?.[0]).toMatchObject({
      date: '2026-05-12',
      timeBlock: 'PM',
    })
  })

  it('uses doubles on other configured days when Tuesday is PM-only', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: 'No incluyo acciones.',
      provider: 'mock',
      model: 'mock-week-creator',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))
    const context: ChatContext = {
      athleteProfile: makeProfile({
        scheduleProfile: {
          availableDays: ['lun', 'mar', 'mié', 'jue', 'vie'],
          doubleSessionDays: ['lun', 'mar'],
          sessionsPerWeek: 6,
          constraints: 'martes solo PM',
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame 6 sesiones',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-11' },
    )
    const sessions = response.actions?.[0].sessions ?? []
    const tuesdaySessions = sessions.filter((session) => session.date === '2026-05-12')
    const mondaySessions = sessions.filter((session) => session.date === '2026-05-11')

    expect(response.fallbackUsed).toBe(true)
    expect(sessions).toHaveLength(6)
    expect(tuesdaySessions).toHaveLength(1)
    expect(tuesdaySessions[0]?.timeBlock).toBe('PM')
    expect(mondaySessions.map((session) => session.timeBlock).sort()).toEqual(['AM', 'PM'])
  })

  it('rejects impossible schedule capacity locally without calling the provider', async () => {
    const context: ChatContext = {
      athleteProfile: makeProfile({
        scheduleProfile: {
          availableDays: ['mar', 'mié'],
          doubleSessionDays: ['mar'],
          sessionsPerWeek: 3,
          constraints: 'martes solo PM; miércoles no disponible',
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame 3 sesiones',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-11' },
    )

    expect(mockProviderCall).not.toHaveBeenCalled()
    expect(response.actions).toEqual([])
    expect(response.message).toContain('3 sesiones')
    expect(response.message).toContain('1 bloque disponible')
    expect(useAIDebugStore.getState().requests[0]).toMatchObject({
      generationId: response.generationId,
      provider: 'mock',
      model: 'local-schedule-preflight',
      status: 'failed',
      errorCode: 'insufficient_schedule_capacity',
      generationOutcome: 'failed',
      expectedSessionCount: 3,
      trainingDayCount: 1,
      doubleSessionAllowed: false,
    })
  })

  it('keeps a PM-only day single-blocked when the model proposes a double there', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: '<actions>' + JSON.stringify([{
        type: 'create_week',
        reason: 'Semana con doble el martes',
        targetDate: '2026-05-11',
        sessions: [
          squashSession('2026-05-11', 'AM', 'Squash lunes', 'Tiros paralelos profundos'),
          squashSession('2026-05-12', 'AM', 'Squash martes', 'Drops desde media cancha'),
          {
            date: '2026-05-12',
            timeBlock: 'PM',
            sessionType: 'strength',
            title: 'Fuerza soporte',
            durationMin: 60,
            objective: 'Soporte sin repetir squash.',
            exercises: [{ name: 'Sentadilla goblet', sets: 3, reps: 8 }],
          },
        ],
      }]) + '</actions>',
      provider: 'mock',
      model: 'mock-week-creator',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))
    const context: ChatContext = {
      athleteProfile: makeProfile({
        scheduleProfile: {
          availableDays: ['lun', 'mar', 'mié'],
          doubleSessionDays: ['mar'],
          sessionsPerWeek: 3,
          constraints: 'martes solo PM',
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame 3 sesiones',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-11' },
    )

    const sessions = response.actions?.[0].sessions ?? []
    expect(mockProviderCall).toHaveBeenCalledTimes(1)
    expect(response.fallbackUsed).toBeFalsy()
    expect(sessions).toHaveLength(3)
    expect(sessions.filter((session) => session.date === '2026-05-12')).toHaveLength(1)
    expect(sessions.every((session) => session.date !== '2026-05-12' || session.timeBlock === 'PM')).toBe(true)
  })

  it('returns a valid fallback week when wizard sessions exceed day capacity', async () => {
    mockProviderCall.mockImplementation(async (request: { requestClass: string; traceId: string }) => ({
      text: 'No incluyo acciones.',
      provider: 'gemini',
      model: 'gemini-flash',
      traceId: request.traceId,
      requestClass: request.requestClass,
    }))

    const context: ChatContext = {
      athleteProfile: makeProfile({
        planWizardConfig: {
          goalEventId: 'goal-1',
          trainingDays: ['monday', 'tuesday', 'wednesday'],
          sessionsPerWeek: 5,
          sessionDurationMins: 60,
          allowDoubleSession: false,
          complementarySports: ['strength'],
          currentFitnessLevel: 'normal',
          currentFatigue: 'normal',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una semana de entrenamiento',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04' },
    )

    const sessions = response.actions?.[0].sessions ?? []
    expect(response.fallbackUsed).toBe(true)
    expect(sessions).toHaveLength(3)
    expect(new Set(sessions.map((session) => session.date)).size).toBe(3)
  })

  it('returns a friendly message instead of throwing when targetWeekStart is missing', async () => {
    const context: ChatContext = {
      athleteProfile: makeProfile({
        scheduleProfile: { availableDays: ['lun', 'mié', 'vie'] },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context,
      { surface: 'chat', targetWeekStart: '' },
    )

    expect(mockProviderCall).not.toHaveBeenCalled()
    expect(response.actions).toEqual([])
    expect(response.message).toMatch(/semana/i)
    expect(response.fallbackUsed).toBe(false)
  })

  it('propagates aborts without retrying or producing a fallback week', async () => {
    const controller = new AbortController()
    mockProviderCall.mockImplementation(async () => {
      controller.abort()
      const error = new Error('The operation was aborted')
      error.name = 'AbortError'
      throw error
    })

    const context: ChatContext = {
      athleteProfile: makeProfile({
        scheduleProfile: { availableDays: ['lun', 'mié', 'vie'] },
      }),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
    }

    await expect(WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context,
      { surface: 'chat', targetWeekStart: '2026-05-04', signal: controller.signal },
    )).rejects.toThrow(/abort/i)

    expect(mockProviderCall).toHaveBeenCalledTimes(1)
  })
})

describe('areSessionListsEquivalent', () => {
  const strengthSession = (exercises: CoachSessionProposal['exercises']): CoachSessionProposal => ({
    date: '2026-05-04',
    timeBlock: 'AM',
    sessionType: 'strength',
    title: 'Fuerza base',
    durationMin: 60,
    objective: 'Construir soporte general.',
    exercises,
  })

  const squashSessionWith = (drillName: string): CoachSessionProposal => ({
    date: '2026-05-05',
    timeBlock: 'AM',
    sessionType: 'squash',
    title: 'Squash técnico',
    durationMin: 60,
    objective: 'Técnica de profundidad.',
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      drills: [{ name: drillName, durationMin: 30 }],
      blocks: [],
    },
  })

  it('treats sessions with identical content as equivalent', () => {
    const exercises = [{ name: 'Sentadilla goblet', sets: 3, reps: 8, group: 'legs' as const }]
    expect(areSessionListsEquivalent(
      [strengthSession(exercises)],
      [strengthSession([...exercises])],
    )).toBe(true)
  })

  it('detects different strength exercises even when date, block, type and title match', () => {
    expect(areSessionListsEquivalent(
      [strengthSession([{ name: 'Sentadilla goblet', sets: 3, reps: 8, group: 'legs' }])],
      [strengthSession([{ name: 'Peso muerto rumano', sets: 3, reps: 8, group: 'legs' }])],
    )).toBe(false)
  })

  it('detects different squash drills behind identical session headers', () => {
    expect(areSessionListsEquivalent(
      [squashSessionWith('Tiros paralelos profundos')],
      [squashSessionWith('Drops desde media cancha')],
    )).toBe(false)
  })
})

describe('validateWeekCreatorResponse sport details', () => {
  it('accepts squash details that provide drills inside blocks', () => {
    const result = validateWeekCreatorResponse({
      targetWeekStart: '2026-05-04',
      context: { recentSessions: [], plannedSessions: [], historicalSessions: [] },
      config: {
        allowedSports: ['squash'],
        primarySport: 'squash',
        sessionsPerWeek: 1,
        maxSessionsPerWeek: 1,
        sessionDurationMins: 60,
        trainingDays: ['monday'],
        allowDoubleSession: false,
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        fromWizard: true,
        configSource: 'wizard',
      },
      response: {
        message: 'Semana lista',
        provider: 'gemini',
        timestamp: Date.now(),
        traceId: 'trace-1',
        requestClass: 'week_creator',
        actions: [{
          type: 'create_week',
          reason: 'Semana squash',
          targetDate: '2026-05-04',
          sessions: [{
            date: '2026-05-04',
            timeBlock: 'AM',
            sessionType: 'squash',
            title: 'Squash bloques',
            durationMin: 60,
            objective: 'sesión planificada',
            squashDetails: {
              trainingFocus: 'technical',
              drills: [],
              blocks: [{
                kind: 'technical',
                durationMin: 30,
                drills: [{ name: 'Tiros paralelos profundos', durationMin: 30 }],
              }],
            },
          }],
        }],
      },
    })

    expect(result.ok).toBe(true)
  })

  it('rejects all-squash weeks when support sports should fill accessory slots', () => {
    const result = validateWeekCreatorResponse({
      targetWeekStart: '2026-05-04',
      context: { recentSessions: [], plannedSessions: [], historicalSessions: [] },
      config: {
        allowedSports: ['squash', 'running', 'strength'],
        primarySport: 'squash',
        sessionsPerWeek: 5,
        maxSessionsPerWeek: 5,
        sessionDurationMins: 60,
        trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        allowDoubleSession: false,
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        fromWizard: true,
        configSource: 'wizard',
      },
      response: {
        message: 'Semana lista',
        provider: 'gemini',
        timestamp: Date.now(),
        traceId: 'trace-support',
        requestClass: 'week_creator',
        actions: [{
          type: 'create_week',
          reason: 'Semana squash sin soporte',
          targetDate: '2026-05-04',
          sessions: [
            squashSession('2026-05-04', 'AM', 'Squash 1', 'Tiros paralelos profundos'),
            squashSession('2026-05-05', 'AM', 'Squash 2', 'Tiros cruzados profundos'),
            squashSession('2026-05-06', 'AM', 'Squash 3', 'Boast y drive paralelo de salida'),
            squashSession('2026-05-07', 'AM', 'Squash 4', 'Drop y contra-drop por ambos lados'),
            squashSession('2026-05-08', 'AM', 'Squash 5', 'Drops desde media cancha'),
          ],
        }],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('deportes de soporte permitidos')
    expect(result.error).toContain('running')
    expect(result.error).toContain('strength')
  })

  it('returns soft warnings for incomplete sport details', () => {
    const result = validateWeekCreatorResponse({
      targetWeekStart: '2026-05-04',
      context: { recentSessions: [], plannedSessions: [], historicalSessions: [] },
      config: {
        allowedSports: ['running', 'strength'],
        primarySport: 'running',
        sessionsPerWeek: 2,
        maxSessionsPerWeek: 2,
        sessionDurationMins: 45,
        trainingDays: ['monday', 'wednesday'],
        allowDoubleSession: false,
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        fromWizard: true,
        configSource: 'wizard',
      },
      response: {
        message: 'Semana lista',
        provider: 'gemini',
        timestamp: Date.now(),
        traceId: 'trace-2',
        requestClass: 'week_creator',
        actions: [{
          type: 'create_week',
          reason: 'Semana base',
          targetDate: '2026-05-04',
          sessions: [
            {
              date: '2026-05-04',
              timeBlock: 'AM',
              sessionType: 'running',
              title: 'Running sin tipo',
              durationMin: 45,
              objective: 'sesión planificada',
            },
            {
              date: '2026-05-06',
              timeBlock: 'AM',
              sessionType: 'strength',
              title: 'Fuerza sin ejercicios',
              durationMin: 45,
              objective: 'sesión planificada',
            },
          ],
        }],
      },
    })

    expect(result.ok).toBe(true)
    expect(result.warning).toContain('runningType')
    expect(result.warning).toContain('no incluye ejercicios')
  })

  it('rejects squash sessions stacked on the same date when there are enough training days', () => {
    const result = validateWeekCreatorResponse({
      targetWeekStart: '2026-05-11',
      context: { recentSessions: [], plannedSessions: [], historicalSessions: [] },
      config: {
        allowedSports: ['squash', 'strength'],
        primarySport: 'squash',
        sessionsPerWeek: 4,
        maxSessionsPerWeek: 6,
        sessionDurationMins: 60,
        trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday'],
        allowDoubleSession: true,
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        fromWizard: false,
        configSource: 'schedule',
      },
      response: {
        message: 'Semana lista',
        provider: 'gemini',
        timestamp: Date.now(),
        traceId: 'trace-same-day-squash',
        requestClass: 'week_creator',
        actions: [{
          type: 'create_week',
          reason: 'Semana con squash duplicado',
          targetDate: '2026-05-11',
          sessions: [
            squashSession('2026-05-11', 'AM', 'Squash técnico A', 'Tiros paralelos profundos'),
            squashSession('2026-05-11', 'PM', 'Squash técnico B', 'Tiros cruzados profundos'),
            squashSession('2026-05-12', 'AM', 'Squash control', '100 drops en solitario (50 por lado)'),
            {
              date: '2026-05-13',
              timeBlock: 'AM',
              sessionType: 'strength',
              title: 'Fuerza soporte',
              durationMin: 60,
              objective: 'sesión planificada',
              exercises: [{ name: 'Sentadilla goblet', sets: 3, reps: 8 }],
            },
          ],
        }],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('hay suficientes días disponibles')
  })

  it('rejects double days when the week has enough available days to spread sessions', () => {
    const result = validateWeekCreatorResponse({
      targetWeekStart: '2026-05-11',
      context: { recentSessions: [], plannedSessions: [], historicalSessions: [] },
      config: {
        allowedSports: ['squash', 'running', 'strength'],
        primarySport: 'squash',
        sessionsPerWeek: 4,
        maxSessionsPerWeek: 6,
        sessionDurationMins: 60,
        trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        allowDoubleSession: true,
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        fromWizard: false,
        configSource: 'schedule',
      },
      response: {
        message: 'Semana lista',
        provider: 'gemini',
        timestamp: Date.now(),
        traceId: 'trace-double-day',
        requestClass: 'week_creator',
        actions: [{
          type: 'create_week',
          reason: 'Semana apilada',
          targetDate: '2026-05-11',
          sessions: [
            squashSession('2026-05-11', 'AM', 'Squash técnico', 'Tiros paralelos profundos'),
            {
              date: '2026-05-11',
              timeBlock: 'PM',
              sessionType: 'running',
              title: 'Running Z2',
              durationMin: 45,
              objective: 'sesión planificada',
              runningType: 'z2',
            },
            {
              date: '2026-05-12',
              timeBlock: 'AM',
              sessionType: 'strength',
              title: 'Fuerza soporte',
              durationMin: 60,
              objective: 'sesión planificada',
              exercises: [{ name: 'Sentadilla goblet', sets: 3, reps: 8 }],
            },
            squashSession('2026-05-13', 'AM', 'Squash control', '100 drops en solitario (50 por lado)'),
          ],
        }],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('hay suficientes días disponibles')
  })

  it('accepts double days when the date is explicitly marked as double-session capable', () => {
    const result = validateWeekCreatorResponse({
      targetWeekStart: '2026-05-11',
      context: { recentSessions: [], plannedSessions: [], historicalSessions: [] },
      config: {
        allowedSports: ['squash', 'running', 'strength'],
        primarySport: 'squash',
        sessionsPerWeek: 4,
        maxSessionsPerWeek: 6,
        sessionDurationMins: 60,
        trainingDays: ['monday', 'tuesday', 'thursday', 'friday', 'sunday'],
        doubleSessionDays: ['monday', 'tuesday', 'thursday', 'friday'],
        allowDoubleSession: true,
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        fromWizard: false,
        configSource: 'schedule',
      },
      response: {
        message: 'Semana lista',
        provider: 'gemini',
        timestamp: Date.now(),
        traceId: 'trace-explicit-double-day',
        requestClass: 'week_creator',
        actions: [{
          type: 'create_week',
          reason: 'Semana con doble permitida',
          targetDate: '2026-05-11',
          sessions: [
            squashSession('2026-05-11', 'AM', 'Squash técnico', 'Tiros paralelos profundos'),
            {
              date: '2026-05-11',
              timeBlock: 'PM',
              sessionType: 'strength',
              title: 'Fuerza soporte',
              durationMin: 60,
              objective: 'Soporte sin repetir squash.',
              exercises: [{ name: 'Sentadilla goblet', sets: 3, reps: 8 }],
            },
            squashSession('2026-05-12', 'AM', 'Squash control', '100 drops en solitario (50 por lado)'),
            squashSession('2026-05-14', 'AM', 'Squash frente', 'Drops desde media cancha'),
          ],
        }],
      },
    })

    expect(result.ok).toBe(true)
  })

  it('rejects simple schedule time constraints such as only AM on Tuesdays', () => {
    const result = validateWeekCreatorResponse({
      targetWeekStart: '2026-05-11',
      context: { recentSessions: [], plannedSessions: [], historicalSessions: [] },
      config: {
        allowedSports: ['squash'],
        primarySport: 'squash',
        sessionsPerWeek: 1,
        maxSessionsPerWeek: 6,
        sessionDurationMins: 60,
        trainingDays: ['monday', 'tuesday', 'thursday', 'friday', 'sunday'],
        doubleSessionDays: ['monday', 'tuesday', 'thursday', 'friday'],
        allowDoubleSession: true,
        scheduleConstraints: 'solo AM los martes, no disponible sabados',
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        fromWizard: false,
        configSource: 'schedule',
      },
      response: {
        message: 'Semana lista',
        provider: 'gemini',
        timestamp: Date.now(),
        traceId: 'trace-time-constraint',
        requestClass: 'week_creator',
        actions: [{
          type: 'create_week',
          reason: 'Semana con martes PM',
          targetDate: '2026-05-11',
          sessions: [
            squashSession('2026-05-12', 'PM', 'Squash martes tarde', 'Tiros paralelos profundos'),
          ],
        }],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('solo AM')
  })

  it('rejects squash drill names that do not resolve to the visible library', () => {
    const result = validateWeekCreatorResponse({
      targetWeekStart: '2026-05-11',
      context: { recentSessions: [], plannedSessions: [], historicalSessions: [] },
      config: {
        allowedSports: ['squash'],
        primarySport: 'squash',
        sessionsPerWeek: 1,
        maxSessionsPerWeek: 1,
        sessionDurationMins: 60,
        trainingDays: ['monday'],
        allowDoubleSession: false,
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        fromWizard: true,
        configSource: 'wizard',
      },
      response: {
        message: 'Semana lista',
        provider: 'gemini',
        timestamp: Date.now(),
        traceId: 'trace-unknown-drill',
        requestClass: 'week_creator',
        actions: [{
          type: 'create_week',
          reason: 'Semana con drill libre',
          targetDate: '2026-05-11',
          sessions: [
            squashSession('2026-05-11', 'AM', 'Squash técnico', 'Secuencia libre de rebotes a la pared trasera'),
          ],
        }],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('drill fuera de catálogo')
  })
})

function squashSession(date: string, timeBlock: 'AM' | 'PM', title: string, drillName: string) {
  return {
    date,
    timeBlock,
    sessionType: 'squash' as const,
    title,
    durationMin: 60,
    objective: 'sesión planificada',
    squashDetails: {
      trainingFocus: 'technical' as const,
      sessionMode: 'drill_session' as const,
      sessionKind: 'technical' as const,
      drills: [{ name: drillName, durationMin: 20 }],
    },
  }
}
