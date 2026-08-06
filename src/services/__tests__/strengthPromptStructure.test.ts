import { describe, expect, it } from 'vitest'

import type { AthleteProfile, MacroPlan, PlanWizardConfig } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { buildStrengthRulesSection } from '../ai/promptModules/strengthPrompt'
import { buildWeekUserPrompt } from '../week/prompts/weekPrompt'

function makeWizardConfig(): PlanWizardConfig {
  return {
    goalEventId: 'goal-1',
    trainingDays: ['monday', 'tuesday', 'thursday', 'friday'],
    sessionsPerWeek: 4,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['strength'],
    currentFitnessLevel: 'fit',
    currentFatigue: 'normal',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  }
}

function makeMacroSnapshot(): MacroPlan {
  return {
    goalEventId: 'goal-1',
    goalEventDate: '2026-07-01',
    currentPhase: 'build',
    weeksRemaining: 7,
    blockFocus: 'Preparacion fisica squash',
    headline: 'Build squash',
    timeline: [],
    sportDetails: [
      {
        sport: 'squash',
        role: 'primary',
        phaseFocus: 'Subir calidad competitiva',
        weeklyIntent: 'progress',
        volumeBias: 'build',
        intensityBias: 'hold',
        notes: 'Deporte principal',
      },
      {
        sport: 'strength',
        role: 'support',
        phaseFocus: 'Soporte S&C',
        weeklyIntent: 'support',
        volumeBias: 'hold',
        intensityBias: 'hold',
        notes: 'Preparacion fisica',
      },
    ],
    secondaryEvents: [],
    computedAt: 1,
  }
}

function makePlan(wizardConfig = makeWizardConfig()): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'goal-1',
    status: 'draft',
    generationState: 'shell',
    title: 'Plan squash',
    startDate: '2026-05-04',
    endDate: '2026-05-10',
    totalWeeks: 1,
    phases: [{
      phase: 'build',
      startWeekIndex: 0,
      endWeekIndex: 0,
      blockFocus: 'Preparacion fisica squash',
      intentBySport: { squash: 'progress', strength: 'support' },
    }],
    wizardConfig,
    macroSnapshot: makeMacroSnapshot(),
    createdAt: 1,
    updatedAt: 1,
  }
}

function makeWeek(): TrainingPlanWeek {
  return {
    id: 'week-1',
    planId: 'plan-1',
    weekIndex: 0,
    weekStartDate: '2026-05-04',
    phase: 'build',
    status: 'draft',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: { squash: 320, strength: 240 },
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 1,
    updatedAt: 1,
  }
}

function makeProfile(): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: 1,
    name: 'Rafael',
    sportContext: {
      enabledSports: ['squash', 'strength'],
      primarySport: 'squash',
      secondarySports: ['strength'],
    },
    goalEvents: [{
      id: 'goal-1',
      title: 'Torneo squash',
      date: '2026-07-01',
      sport: 'squash',
      priority: 'primary',
    }],
  }
}

describe('strength prompt structure', () => {
  it('does not encode supersets as A1/A2 prefixes in exercise notes', () => {
    const rules = buildStrengthRulesSection()

    expect(rules).not.toContain('Etiquetado por bloques')
    expect(rules).not.toMatch(/\b[ABC][12]\b/)
    expect(rules).not.toContain('despues del prefijo de bloque')
  })

  it('limits strength technical notes to the approved cue shortlist', () => {
    const rules = buildStrengthRulesSection()

    expect(rules).toContain('Control y amplitud en el descenso')
    expect(rules).toContain('Salir explosivo')
    expect(rules).toContain('Peso considera mancuernas (2)')
    expect(rules).toContain('No subir carga si se pierde postura')
    expect(rules).toContain('Control posicion de la cadera')
  })

  it('adds the squash S&C day-theme template to plan-builder week prompts', () => {
    const wizardConfig = makeWizardConfig()
    const prompt = buildWeekUserPrompt({
      plan: makePlan(wizardConfig),
      week: makeWeek(),
      profile: makeProfile(),
      wizardConfig,
    })

    expect(prompt).toContain('3-4 sesiones de fuerza')
    expect(prompt).toContain('olimpico + sentadilla')
    expect(prompt).toContain('press + estocadas unilaterales')
    expect(prompt).toContain('peso muerto/hinge + cadena posterior')
    expect(prompt).toContain('velocidad/footwork + plio ligera')
    expect(prompt).toContain('si fase, fatiga o competencia lo desaconsejan')
  })
})
