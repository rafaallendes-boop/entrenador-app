import { describe, expect, it } from 'vitest'

import { buildWeekUserPrompt } from '../prompts/weekPrompt'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'

const plan = {
  id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'shell',
  title: 'Plan', startDate: '2026-09-07', endDate: '2026-09-13', totalWeeks: 1,
  phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 0, blockFocus: 'F', intentBySport: {} }],
  macroSnapshot: {
    goalEventId: 'e1', goalEventDate: '2026-11-03', currentPhase: 'build', weeksRemaining: 8,
    blockFocus: '', headline: '', timeline: [], sportDetails: [], secondaryEvents: [], computedAt: 0,
  },
  wizardConfig: {} as PlanWizardConfig, createdAt: 0, updatedAt: 0,
} as TrainingPlan

const week = {
  id: 'w0', planId: 'p1', weekIndex: 0, weekStartDate: '2026-09-07', phase: 'build',
  status: 'pending', sessions: [], weekObjectives: [{ goal: 'fuerza' }],
  targetLoadBySport: { strength: 80 }, validationIssues: [],
  generationMeta: { attempts: 0, provider: '', model: '' }, createdAt: 0, updatedAt: 0,
} as unknown as TrainingPlanWeek

const wizard = {
  goalEventId: 'e1',
  trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
  doubleSessionDays: [],
  sessionsPerWeek: 4, sessionDurationMins: 60, allowDoubleSession: false,
  complementarySports: ['strength'],
  currentFitnessLevel: 'fit', currentFatigue: 'fresh',
  createdAt: '', updatedAt: '',
} as PlanWizardConfig

function prompt(profile: AthleteProfile, wizardConfig: PlanWizardConfig = wizard): string {
  return buildWeekUserPrompt({ plan, week, profile, wizardConfig, outputFormat: 'json' })
}

describe('restricciones de lesión en el prompt de Plan Builder', () => {
  // El enforcement lee `recoveryProfile.currentInjuries`, `restrictions` **y**
  // `wizardConfig.injuryNotes` (`profileAdapter.ts:45`), pero el prompt leía
  // sólo el último. Con la lesión declarada en el perfil, el modelo quedaba
  // ciego y describía "press militar" en una semana con restricción de hombro.
  it('transporta una lesión declarada en el perfil, no sólo la del wizard', () => {
    const profile = {
      id: 'a1', updatedAt: 0,
      recoveryProfile: { currentInjuries: 'Dolor de hombro derecho' },
    } as AthleteProfile

    expect(prompt(profile).toLowerCase()).toContain('hombro')
  })

  it('sigue transportando la del wizard', () => {
    const profile = { id: 'a1', updatedAt: 0 } as AthleteProfile
    const wizardConfig = { ...wizard, injuryNotes: 'molestia lumbar' } as unknown as PlanWizardConfig

    expect(prompt(profile, wizardConfig).toLowerCase()).toContain('lumbar')
  })

  it('no inventa restricciones cuando no hay ninguna', () => {
    const profile = {
      id: 'a1', updatedAt: 0, recoveryProfile: { currentInjuries: 'Ninguna.' },
    } as AthleteProfile

    expect(prompt(profile)).not.toMatch(/Lesiones\/restricciones/)
  })

  // Condicionar la línea entera al parseo estructurado borraba del prompt
  // texto que ANTES sí llegaba: el parser marca "sobrecarga general" como
  // neutro y no produce ninguna zona, pero sigue siendo información que el
  // modelo debe considerar al prescribir carga.
  it('conserva el texto declarado aunque el parser no identifique zona', () => {
    const profile = { id: 'a1', updatedAt: 0 } as AthleteProfile
    const wizardConfig = { ...wizard, injuryNotes: 'Vengo con sobrecarga general' } as PlanWizardConfig

    const text = prompt(profile, wizardConfig)

    expect(text).toContain('Vengo con sobrecarga general')
    expect(text).not.toContain('zona identificada')
  })

  // `describeSafetyConstraints` habla en primera persona para la UI. Pegarlo
  // crudo tras "zona identificada:" le pedía al modelo evitar una zona que la
  // misma frase declara desconocida.
  it('no inyecta la copia de UI cuando la zona no se pudo identificar', () => {
    const profile = {
      id: 'a1', updatedAt: 0,
      sportContext: { enabledSports: ['squash'], trainingPriority: 'return_to_play' },
    } as unknown as AthleteProfile

    const text = prompt(profile)

    expect(text).toContain('Lesiones/restricciones activas:')
    expect(text).not.toContain('Detecté una restricción')
    expect(text).toContain('zona no identificada')
  })

  // Sin restricción alguna no debe aparecer la línea: un prompt que la incluye
  // vacía induce cautela que nadie pidió.
  it('omite la línea cuando no hay restricción declarada ni estructurada', () => {
    const profile = { id: 'a1', updatedAt: 0 } as AthleteProfile

    expect(prompt(profile)).not.toContain('Lesiones/restricciones activas:')
  })
})
