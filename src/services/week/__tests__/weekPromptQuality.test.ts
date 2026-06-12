import { describe, expect, it } from 'vitest'
import { buildWeekUserPrompt } from '../prompts/weekPrompt'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'

function makePlan(): TrainingPlan {
  return {
    id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'shell',
    title: 'Plan Torneo', startDate: '2026-06-08', endDate: '2026-07-26', totalWeeks: 7,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 6, blockFocus: 'Bloque específico', intentBySport: {} }],
    wizardConfig: makeWizard(),
    macroSnapshot: {
      goalEventId: 'e1', goalEventDate: '2026-07-20', currentPhase: 'build', weeksRemaining: 7,
      blockFocus: '', headline: '', timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'build', intensityBias: 'build', notes: '' }],
      secondaryEvents: [], computedAt: 0,
    },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlan
}

function makeWeek(overrides: Partial<TrainingPlanWeek> = {}): TrainingPlanWeek {
  return {
    id: 'w1', planId: 'p1', weekIndex: 1, weekStartDate: '2026-06-15',
    phase: 'build', status: 'pending', sessions: [],
    weekObjectives: [{ goal: 'Consolidar presión a la T' }, { goal: 'Subir carga de fuerza un escalón' }],
    targetLoadBySport: { squash: 75, strength: 41 },
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 0, updatedAt: 0,
    ...overrides,
  } as TrainingPlanWeek
}

function makePreviousWeek(overrides: Partial<TrainingPlanWeek> = {}): TrainingPlanWeek {
  return makeWeek({
    id: 'w0', weekIndex: 0, weekStartDate: '2026-06-08', status: 'draft',
    sessions: [
      { date: '2026-06-08', timeBlock: 'AM', sessionType: 'squash', title: 'Drills básicos', durationMin: 60, objective: 'x', rpe: 6 },
      { date: '2026-06-10', timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza base', durationMin: 60, objective: 'x', rpe: 7 },
    ] as TrainingPlanWeek['sessions'],
    ...overrides,
  })
}

function makeProfile(): AthleteProfile {
  return {
    id: 'default', updatedAt: 0, name: 'Rafa', age: 40, weightKg: 78,
    mainGoal: 'Competir', primarySport: 'squash',
  } as AthleteProfile
}

function makeWizard(overrides: Partial<PlanWizardConfig> = {}): PlanWizardConfig {
  return {
    goalEventId: 'e1',
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    sessionsPerWeek: 6, sessionDurationMins: 60, allowDoubleSession: true,
    complementarySports: ['running', 'strength'],
    currentFitnessLevel: 'fit', currentFatigue: 'fresh',
    injuryNotes: 'Molestia leve en hombro derecho',
    createdAt: '', updatedAt: '',
    ...overrides,
  } as PlanWizardConfig
}

describe('buildWeekUserPrompt quality blocks', () => {
  it('includes week objectives with an explicit instruction', () => {
    const prompt = buildWeekUserPrompt({
      plan: makePlan(), week: makeWeek(), profile: makeProfile(), wizardConfig: makeWizard(),
    })
    expect(prompt).toContain('OBJETIVOS DE ESTA SEMANA')
    expect(prompt).toContain('Consolidar presión a la T')
    expect(prompt).toContain('Cada sesión debe contribuir')
  })

  it('highlights injuries with adaptation guidance', () => {
    const prompt = buildWeekUserPrompt({
      plan: makePlan(), week: makeWeek(), profile: makeProfile(), wizardConfig: makeWizard(),
    })
    expect(prompt).toContain('Molestia leve en hombro derecho')
    expect(prompt).toContain('adapta cargas')
  })

  it('gives a conservative directive on the first week', () => {
    const prompt = buildWeekUserPrompt({
      plan: makePlan(), week: makeWeek({ weekIndex: 0, weekStartDate: '2026-06-08' }),
      profile: makeProfile(), wizardConfig: makeWizard(),
    })
    expect(prompt).toContain('PROGRESIÓN RESPECTO A LA SEMANA PREVIA')
    expect(prompt).toContain('Primera semana del plan')
  })

  it('detects a deload week from target load deltas', () => {
    const previousWeek = makePreviousWeek({ targetLoadBySport: { squash: 80, strength: 50 } })
    const prompt = buildWeekUserPrompt({
      plan: makePlan(),
      week: makeWeek({ targetLoadBySport: { squash: 50, strength: 30 } }),
      previousWeek,
      profile: makeProfile(), wizardConfig: makeWizard(),
    })
    expect(prompt).toContain('BAJAR carga')
  })

  it('asks to raise load when the plan targets more volume', () => {
    const previousWeek = makePreviousWeek({ targetLoadBySport: { squash: 50, strength: 30 } })
    const prompt = buildWeekUserPrompt({
      plan: makePlan(),
      week: makeWeek({ targetLoadBySport: { squash: 80, strength: 50 } }),
      previousWeek,
      profile: makeProfile(), wizardConfig: makeWizard(),
    })
    expect(prompt).toContain('SUBIR carga')
  })

  it('flags phase transitions between consecutive weeks', () => {
    const previousWeek = makePreviousWeek({ phase: 'build' })
    const prompt = buildWeekUserPrompt({
      plan: makePlan(),
      week: makeWeek({ phase: 'peak' }),
      previousWeek,
      profile: makeProfile(), wizardConfig: makeWizard(),
    })
    expect(prompt).toContain('Cambio de fase')
  })

  it('reduces load on taper regardless of target deltas', () => {
    const prompt = buildWeekUserPrompt({
      plan: makePlan(),
      week: makeWeek({ phase: 'taper' }),
      previousWeek: makePreviousWeek(),
      profile: makeProfile(), wizardConfig: makeWizard(),
    })
    expect(prompt).toContain('REDUCIR carga')
  })

  it('adds a squash phase content guide for build and peak weeks', () => {
    const buildPrompt = buildWeekUserPrompt({
      plan: makePlan(), week: makeWeek({ phase: 'build' }), profile: makeProfile(), wizardConfig: makeWizard(),
    })
    expect(buildPrompt).toContain('GUÍA DE CONTENIDO — FASE BUILD')
    expect(buildPrompt).toContain('pressure drills')

    const peakPrompt = buildWeekUserPrompt({
      plan: makePlan(), week: makeWeek({ phase: 'peak' }), profile: makeProfile(), wizardConfig: makeWizard(),
    })
    expect(peakPrompt).toContain('GUÍA DE CONTENIDO — FASE PEAK')
  })

  it('keeps the critical session count rule intact', () => {
    const prompt = buildWeekUserPrompt({
      plan: makePlan(), week: makeWeek(), profile: makeProfile(), wizardConfig: makeWizard(),
    })
    expect(prompt).toContain('Regla crítica de cantidad')
    expect(prompt).toContain('EXACTAMENTE 6 sesiones')
  })
})
