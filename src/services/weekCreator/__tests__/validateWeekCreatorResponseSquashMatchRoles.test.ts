import { describe, expect, it } from 'vitest'

import { validateWeekCreatorResponse } from '../validateWeekCreatorResponse'

const FIVE_GAMES = 'Partido de entrenamiento al mejor de 5 juegos'

function standaloneSession(date: string) {
  const drill = { name: FIVE_GAMES, durationMin: 60 }
  return {
    date,
    timeBlock: 'AM' as const,
    sessionType: 'squash' as const,
    subtype: 'match' as const,
    title: 'Partido de entrenamiento',
    durationMin: 60,
    objective: 'Competir puntos con estructura de partido.',
    squashDetails: {
      trainingFocus: 'tactical' as const,
      sessionMode: 'practice_match' as const,
      sessionKind: 'match' as const,
      drills: [drill],
      blocks: [{ kind: 'match' as const, drills: [drill] }],
    },
  }
}

describe('validateWeekCreatorResponse: roles de partido de squash', () => {
  it('does not treat two canonical standalone matches as duplicate drill content', () => {
    const result = validateWeekCreatorResponse({
      targetWeekStart: '2026-05-04',
      context: { recentSessions: [], plannedSessions: [], historicalSessions: [] },
      config: {
        allowedSports: ['squash'],
        primarySport: 'squash',
        sessionsPerWeek: 2,
        maxSessionsPerWeek: 2,
        sessionDurationMins: 60,
        trainingDays: ['monday', 'wednesday'],
        allowDoubleSession: false,
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        fromWizard: true,
        configSource: 'wizard',
      },
      response: {
        message: 'Semana lista',
        provider: 'test',
        timestamp: 0,
        traceId: 'standalone-roles',
        requestClass: 'week_creator',
        actions: [{
          type: 'create_week',
          reason: 'Dos partidos separados',
          targetDate: '2026-05-04',
          sessions: [standaloneSession('2026-05-04'), standaloneSession('2026-05-06')],
        }],
      },
    })

    expect(result.ok).toBe(true)
    expect(result.code).not.toBe('duplicate_squash_content')
  })
})
