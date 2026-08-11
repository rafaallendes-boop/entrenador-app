import { describe, expect, it } from 'vitest'

import type { PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { getExpectedSessionsForPlanWeek } from '../dateRange'
import { validatePlanWeek } from '../validator'

function wizard(): PlanWizardConfig {
  return {
    goalEventId: 'event-1',
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    sessionsPerWeek: 5,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['strength', 'running'],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    partnerAvailability: 'either',
    createdAt: '',
    updatedAt: '',
  }
}

function plan(overrides: Partial<TrainingPlan['macroSnapshot']> = {}): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'shell',
    title: 'Plan',
    startDate: '2026-09-07',
    endDate: '2026-09-12',
    totalWeeks: 1,
    phases: [{
      phase: 'race', startWeekIndex: 0, endWeekIndex: 0, blockFocus: '', intentBySport: {},
    }],
    wizardConfig: wizard(),
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-09-12',
      currentPhase: 'race',
      weeksRemaining: 0,
      blockFocus: '',
      headline: '',
      timeline: [],
      sportDetails: [{
        sport: 'squash',
        role: 'primary',
        phaseFocus: '',
        weeklyIntent: '',
        volumeBias: 'minimal',
        intensityBias: 'minimal',
        notes: '',
      }],
      secondaryEvents: [],
      computedAt: 0,
      ...overrides,
    },
    createdAt: 0,
    updatedAt: 0,
  }
}

function week(sessions: TrainingPlanWeek['sessions']): TrainingPlanWeek {
  return {
    id: 'week-1',
    planId: 'plan-1',
    weekIndex: 0,
    weekStartDate: '2026-09-07',
    phase: 'race',
    status: 'draft',
    sessions,
    weekObjectives: [],
    targetLoadBySport: { squash: 20 },
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('hallazgo 1 — el validator sólo exige ancla si el evento objetivo es de squash', () => {
  it('no exige ancla squash cuando el evento objetivo es de otro deporte', () => {
    // Atleta cuyo deporte principal es squash pero cuyo evento objetivo del
    // ciclo es una carrera. `repairWeek` ya se abstiene en este caso; el
    // validator no puede exigir un ancla que el repair nunca va a construir.
    const issues = validatePlanWeek(
      plan({ goalEventSport: 'running' }),
      week([{
        date: '2026-09-09',
        timeBlock: 'AM',
        sessionType: 'running',
        title: 'Carrera objetivo',
        objective: 'Competir',
        durationMin: 60,
        rpe: 9,
      }]),
    )

    expect(issues.map((issue) => issue.code))
      .not.toContain('squash.event_window.anchor_count')
    expect(issues.map((issue) => issue.code))
      .not.toContain('squash.event_window.incompatible_support')
  })

  it('sigue exigiendo el ancla cuando el evento objetivo sí es de squash', () => {
    const issues = validatePlanWeek(plan({ goalEventSport: 'squash' }), week([]))
    expect(issues.map((issue) => issue.code)).toContain('squash.event_window.anchor_count')
  })

  it('un snapshot antiguo sin deporte declarado conserva el comportamiento actual', () => {
    const issues = validatePlanWeek(plan(), week([]))
    expect(issues.map((issue) => issue.code)).toContain('squash.event_window.anchor_count')
  })
})

describe('hallazgo 2 — el validator tolera una semana sin arreglo de sesiones', () => {
  it('no lanza cuando `sessions` viene ausente en una fila deserializada', () => {
    const malformed = { ...week([]), sessions: undefined } as unknown as TrainingPlanWeek
    expect(() => validatePlanWeek(plan(), malformed)).not.toThrow()
  })
})

describe('hallazgo 3 — el cupo de la semana race admite ancla + 2 apoyos', () => {
  it('espera 3 sesiones en la semana que contiene el ancla', () => {
    // El prompt pide "una ancla y como máximo 2 apoyos"; si el cupo es 2, una
    // respuesta que obedece la instrucción se recorta y falla por conteo.
    expect(getExpectedSessionsForPlanWeek(plan({ goalEventSport: 'squash' }), week([]))).toBe(3)
  })

  it('mantiene el tope de 2 apoyos en una semana race sin ancla', () => {
    const planWithLateAnchor = plan({ goalEventSport: 'squash', goalEventDate: '2026-09-26' })
    const earlyWeek = { ...week([]), weekStartDate: '2026-09-07' }
    expect(getExpectedSessionsForPlanWeek(planWithLateAnchor, earlyWeek)).toBe(2)
  })
})
