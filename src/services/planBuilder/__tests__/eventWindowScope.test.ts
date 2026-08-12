import { describe, expect, it } from 'vitest'

import type { PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { getExpectedSessionsForPlanWeek } from '../dateRange'
import { isWithinPlanEventWindow } from '../eventWindowRules'
import { repairGeneratedWeek } from '../repairWeek'
import { validatePlanWeek } from '../validator'
import { buildRepairContextForTest, buildSkeletonSessionForTest } from './helpers/repairTestFixtures'

/**
 * Las reglas de carga de la ventana aplican a los días del evento, no a la
 * semana `race` completa. Un evento sábado→domingo no puede vaciar el lunes.
 */
function wizard(): PlanWizardConfig {
  return {
    goalEventId: 'event-1',
    trainingDays: ['monday', 'wednesday', 'friday', 'saturday', 'sunday'],
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

// Semana lunes 2026-09-07 → domingo 2026-09-13; evento sábado 12 → domingo 13.
function plan(): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'shell',
    title: 'Plan',
    startDate: '2026-09-07',
    endDate: '2026-09-13',
    totalWeeks: 1,
    phases: [{
      phase: 'race', startWeekIndex: 0, endWeekIndex: 0, blockFocus: '', intentBySport: {},
    }],
    wizardConfig: wizard(),
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-09-12',
      goalEventEndDate: '2026-09-13',
      goalEventSport: 'squash',
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

describe('isWithinPlanEventWindow', () => {
  it('distingue los días del evento del resto de la semana race', () => {
    expect(isWithinPlanEventWindow(plan(), '2026-09-07')).toBe(false)
    expect(isWithinPlanEventWindow(plan(), '2026-09-11')).toBe(false)
    expect(isWithinPlanEventWindow(plan(), '2026-09-12')).toBe(true)
    expect(isWithinPlanEventWindow(plan(), '2026-09-13')).toBe(true)
  })
})

describe('validator — la carga fuera de la ventana no es un apoyo del evento', () => {
  it('no exige que una sesión de fuerza previa al evento sea activación', () => {
    const issues = validatePlanWeek(plan(), week([
      {
        date: '2026-09-07',
        timeBlock: 'AM',
        sessionType: 'strength',
        title: 'Fuerza lunes',
        objective: 'Mantener',
        durationMin: 60,
        rpe: 7,
      },
      {
        date: '2026-09-12',
        timeBlock: 'AM',
        sessionType: 'squash',
        squashKind: 'match',
        subtype: 'competitive',
        title: 'Torneo',
        objective: 'Competir',
        durationMin: 90,
        rpe: 9,
      },
    ]))

    expect(issues.map((issue) => issue.code))
      .not.toContain('squash.event_window.incompatible_support')
    expect(issues.map((issue) => issue.code))
      .not.toContain('squash.event_window.support_out_of_bounds')
  })

  it('sigue exigiendo apoyos compatibles dentro de la ventana', () => {
    const issues = validatePlanWeek(plan(), week([
      {
        date: '2026-09-12',
        timeBlock: 'AM',
        sessionType: 'squash',
        squashKind: 'match',
        subtype: 'competitive',
        title: 'Torneo',
        objective: 'Competir',
        durationMin: 90,
        rpe: 9,
      },
      {
        date: '2026-09-13',
        timeBlock: 'AM',
        sessionType: 'strength',
        title: 'Fuerza dentro de la ventana',
        objective: 'Cargar',
        durationMin: 60,
        rpe: 8,
      },
    ]))

    expect(issues.map((issue) => issue.code))
      .toContain('squash.event_window.incompatible_support')
  })
})

describe('repair — sólo reemplaza carga dentro de la ventana', () => {
  function raceContext() {
    const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 4 })
    context.wizardConfig = { ...context.wizardConfig, complementarySports: ['strength'] }
    context.plan = {
      ...context.plan,
      wizardConfig: { ...context.plan.wizardConfig, complementarySports: ['strength'] },
      startDate: '2026-08-03',
      endDate: '2026-08-09',
      macroSnapshot: {
        ...context.plan.macroSnapshot,
        goalEventDate: '2026-08-07',
        goalEventEndDate: '2026-08-08',
        // Ancla explícita el sábado: sin `keyDate` el ancla sería el inicio y
        // chocaría con la sesión de apoyo del viernes.
        goalEventKeyDate: '2026-08-08',
        goalEventSport: 'squash',
      },
    }
    context.week = { ...context.week, phase: 'race', weekStartDate: '2026-08-03' }
    return context
  }

  const anchor = () => buildSkeletonSessionForTest({
    date: '2026-08-08',
    timeBlock: 'AM',
    sessionType: 'squash',
    squashKind: 'match',
    subtype: 'competitive',
    title: 'Torneo',
    objective: 'Competir',
    durationMin: 90,
    rpe: 9,
  })

  it('conserva la fuerza del lunes cuando el evento es sábado y domingo', () => {
    const strengthMonday = buildSkeletonSessionForTest({
      date: '2026-08-03',
      timeBlock: 'AM',
      sessionType: 'strength',
      title: 'Fuerza lunes',
      objective: 'Mantener',
      durationMin: 60,
      rpe: 7,
    })

    const result = repairGeneratedWeek([strengthMonday, anchor()], raceContext())
    const monday = result.sessions.find((session) => session.date === '2026-08-03')

    expect(monday?.sessionType).toBe('strength')
    expect(result.meta.warnings.map((warning) => warning.code))
      .not.toContain('event_window_incompatible_load_replaced')
  })

  it('sigue reemplazando la carga que cae dentro de la ventana', () => {
    const strengthSunday = buildSkeletonSessionForTest({
      date: '2026-08-07',
      timeBlock: 'AM',
      sessionType: 'strength',
      title: 'Fuerza dentro de la ventana',
      objective: 'Cargar',
      durationMin: 60,
      rpe: 8,
    })

    const result = repairGeneratedWeek([anchor(), strengthSunday], raceContext())

    expect(result.sessions.find((session) => session.date === '2026-08-07')?.sessionType)
      .not.toBe('strength')
    expect(result.meta.warnings.map((warning) => warning.code))
      .toContain('event_window_incompatible_load_replaced')
  })
})

describe('cupo de la semana race', () => {
  it('cuenta los días previos al evento además del ancla y sus apoyos', () => {
    // lun/mié/vie fuera de la ventana + ancla el sábado + 1 apoyo el domingo.
    expect(getExpectedSessionsForPlanWeek(plan(), week([]))).toBe(5)
  })

  it('no deja que la ventana aporte más de un ancla y dos apoyos', () => {
    const longWindow = plan()
    longWindow.macroSnapshot = {
      ...longWindow.macroSnapshot,
      goalEventDate: '2026-09-07',
      goalEventEndDate: '2026-09-13',
    }
    // Toda la semana cae dentro de la ventana: ancla + 2 apoyos como máximo.
    expect(getExpectedSessionsForPlanWeek(longWindow, week([]))).toBe(3)
  })
})
