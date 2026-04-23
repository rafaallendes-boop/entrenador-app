import { describe, expect, it } from 'vitest'

import type { ChatContext } from '../../types'
import { buildWeekPlanningPrompt } from '../weekPlanning/WeekPlanningPromptBuilder'

function makeContext(): ChatContext {
  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    weekDayLogs: [],
    athleteProfile: {
      id: 'athlete-1',
      updatedAt: Date.now(),
      name: 'Rafa',
      sportContext: {
        enabledSports: ['squash', 'running', 'strength'],
        primarySport: 'squash',
        secondarySports: ['running', 'strength'],
        trainingPriority: 'performance',
      },
      goalEvents: [
        {
          id: 'goal-1',
          title: 'Regional',
          date: '2026-05-30',
          sport: 'squash',
          priority: 'primary',
        },
      ],
      macroPlan: {
        goalEventId: 'goal-1',
        goalEventDate: '2026-05-30',
        currentPhase: 'build',
        weeksRemaining: 5,
        blockFocus: 'carga específica',
        headline: 'Build',
        timeline: [],
        sportDetails: [
          {
            sport: 'squash',
            role: 'primary',
            phaseFocus: 'match readiness',
            weeklyIntent: 'build',
            volumeBias: 'build',
            intensityBias: 'hold',
            notes: 'priorizar squash',
          },
        ],
        secondaryEvents: [],
        computedAt: Date.now(),
      },
      planWizardConfig: {
        goalEventId: 'goal-1',
        trainingDays: ['monday', 'tuesday', 'thursday', 'saturday'],
        sessionsPerWeek: 4,
        sessionDurationMins: 60,
        allowDoubleSession: false,
        complementarySports: ['running', 'strength'],
        currentFitnessLevel: 'normal',
        currentFatigue: 'fresh',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
    intent: 'plan_week',
  }
}

describe('WeekPlanningPromptBuilder', () => {
  it('builds a specialized create_week prompt without general chat instructions', () => {
    const prompt = buildWeekPlanningPrompt(makeContext(), {
      userMessage: 'Créame la semana para la próxima semana',
      targetWeekStart: '2026-05-04',
    })

    expect(prompt.systemPrompt).toContain('EXCLUSIVAMENTE con un bloque <actions>')
    expect(prompt.systemPrompt).toContain('UNA acción create_week')
    expect(prompt.systemPrompt).not.toContain('INSTRUCCIONES DEL COACH-PLANNER')
    expect(prompt.userPrompt).toContain('targetDate=2026-05-04')
    expect(prompt.userPrompt).toContain('Deportes permitidos: squash, running, strength')
    expect(prompt.userPrompt).toContain('Sesiones por semana: 4')
  })
})
