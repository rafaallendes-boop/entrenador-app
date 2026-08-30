import { describe, expect, it } from 'vitest'
import type { ChatContext } from '../../types'
import { buildCoachSystemPrompt } from '../ai/promptBuilder'
import { getStrengthSelectionContext } from '../ai/promptModules/strengthPrompt'

describe('promptBuilder strength safety context', () => {
  it('adds canonical strength restrictions as defence in depth', () => {
    const context: ChatContext = {
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      athleteProfile: {
        id: 'athlete-1',
        updatedAt: 1,
        sportContext: {
          primarySport: 'squash',
          enabledSports: ['squash', 'strength'],
          trainingPriority: 'performance',
        },
        recoveryProfile: { currentInjuries: 'dolor lumbar' },
        planWizardConfig: {
          goalEventId: 'goal-1',
          trainingDays: ['monday'],
          sessionsPerWeek: 2,
          sessionDurationMins: 60,
          allowDoubleSession: false,
          complementarySports: ['strength'],
          currentFitnessLevel: 'normal',
          currentFatigue: 'normal',
          createdAt: '2026-08-30T00:00:00.000Z',
          updatedAt: '2026-08-30T00:00:00.000Z',
        },
      },
    }

    const prompt = buildCoachSystemPrompt(context, { requestClass: 'chat_general' })

    expect(prompt).toContain('Restricciones resueltas de fuerza: Entendí: zona lumbar.')
    expect(prompt).toContain('No propongas ejercicios que carguen esas zonas o patrones.')
    expect(getStrengthSelectionContext(context).safetyConstraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'region', region: 'lumbar' }),
    ]))
  })
})
