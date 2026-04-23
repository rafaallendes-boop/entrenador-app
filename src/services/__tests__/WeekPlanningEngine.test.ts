import { describe, expect, it } from 'vitest'

import { WeekPlanningEngine } from '../weekPlanning/WeekPlanningEngine'

describe('WeekPlanningEngine', () => {
  it('returns a guided blocking response when planWizardConfig is missing', async () => {
    const response = await WeekPlanningEngine.sendWeekPlan(
      'Créame la semana',
      {
        recentSessions: [],
        plannedSessions: [],
        historicalSessions: [],
        athleteProfile: {
          id: 'athlete-1',
          updatedAt: Date.now(),
        },
        intent: 'plan_week',
      },
      {
        surface: 'chat',
        targetWeekStart: '2026-05-04',
      },
    )

    expect(response.actions).toBeUndefined()
    expect(response.message).toContain('falta la configuración del plan')
    expect(response.requestClass).toBe('plan_builder_week')
  })
})
