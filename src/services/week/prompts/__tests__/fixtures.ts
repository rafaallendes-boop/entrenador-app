import type { TrainingPlan, TrainingPlanWeek } from '../../../../types/planBuilder'
import type { AthleteProfile, PlanWizardConfig } from '../../../../types'
import type { PlanBuilderRecentContext } from '../../../planBuilder/recentContextRender'
import type { WeekBatchPromptInput, WeekPromptInput } from '../weekPrompt'

/**
 * Fixtures compartidas de `weekPrompt`.
 *
 * Semilla tomada de `makePlan`/`makeWeek`/`makeProfile`/`makeWizard` en
 * `src/services/week/__tests__/weekPromptQuality.test.ts` (no tocar ese
 * archivo). `makeWeekPromptInput`/`makeWeekBatchPromptInput` son el punto de
 * extensión: las Tareas 6, 9 y 10 de este plan agregan overrides acá, no
 * builders nuevos.
 */

function makePlan(overrides?: Partial<TrainingPlan>): TrainingPlan {
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
    ...overrides,
  } as TrainingPlan
}

function makeWeek(overrides?: Partial<TrainingPlanWeek>): TrainingPlanWeek {
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

function makeProfile(overrides?: Partial<AthleteProfile>): AthleteProfile {
  return {
    id: 'default', updatedAt: 0, name: 'Rafa', age: 40, weightKg: 78,
    mainGoal: 'Competir', primarySport: 'squash',
    ...overrides,
  } as AthleteProfile
}

function makeWizard(overrides?: Partial<PlanWizardConfig>): PlanWizardConfig {
  return {
    goalEventId: 'e1',
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    sessionsPerWeek: 6, sessionDurationMins: 60, allowDoubleSession: true,
    complementarySports: ['running', 'strength'],
    currentFitnessLevel: 'fit', currentFatigue: 'fresh',
    createdAt: '', updatedAt: '',
    ...overrides,
  } as PlanWizardConfig
}

interface WeekPromptInputOverrides {
  plan?: Partial<TrainingPlan>
  week?: Partial<TrainingPlanWeek>
  previousWeek?: Partial<TrainingPlanWeek>
  profile?: Partial<AthleteProfile>
  wizardConfig?: Partial<PlanWizardConfig>
  recentContext?: PlanBuilderRecentContext
  outputFormat?: 'actions' | 'json'
}

export function makeWeekPromptInput(overrides?: WeekPromptInputOverrides): WeekPromptInput {
  const wizardConfig = makeWizard(overrides?.wizardConfig)
  return {
    plan: makePlan({ wizardConfig, ...overrides?.plan }),
    week: makeWeek(overrides?.week),
    previousWeek: overrides?.previousWeek ? makeWeek(overrides.previousWeek) : undefined,
    profile: makeProfile(overrides?.profile),
    wizardConfig,
    recentContext: overrides?.recentContext,
    outputFormat: overrides?.outputFormat,
  }
}

interface WeekBatchPromptInputOverrides {
  plan?: Partial<TrainingPlan>
  weeks?: [Partial<TrainingPlanWeek>, Partial<TrainingPlanWeek>]
  previousWeek?: Partial<TrainingPlanWeek>
  profile?: Partial<AthleteProfile>
  wizardConfig?: Partial<PlanWizardConfig>
  recentContext?: PlanBuilderRecentContext
  outputFormat?: 'actions' | 'json'
}

/**
 * Fixture de `PlanBuilderRecentContext` (Tarea 6). Overrides shallow, mismo
 * patrón que `makePlan`/`makeWeek`: para `livedPlanWeeks`, pasar el array
 * completo con los campos manuales reales (`avgManualActualRpe`,
 * `manualRpeSampleCount`, etc.), no los viejos (`avgActualRpe`/`avgEnergy`).
 */
export function makeRecentContext(overrides?: Partial<PlanBuilderRecentContext>): PlanBuilderRecentContext {
  return {
    referenceDate: '2026-06-08',
    lookbackWeeks: 4,
    hasHistory: true,
    weeks: [],
    structureWeeks: 0,
    weeklyStructure: [],
    summary: {
      dominantSports: [],
      recentPainNotes: [],
      recommendation: 'normal',
    },
    ...overrides,
  }
}

export function makeWeekBatchPromptInput(overrides?: WeekBatchPromptInputOverrides): WeekBatchPromptInput {
  const wizardConfig = makeWizard(overrides?.wizardConfig)
  const [firstWeekOverrides, secondWeekOverrides] = overrides?.weeks ?? [{}, {}]
  const weeks: [TrainingPlanWeek, TrainingPlanWeek] = [
    makeWeek({ id: 'w1', weekIndex: 1, weekStartDate: '2026-06-15', ...firstWeekOverrides }),
    makeWeek({ id: 'w2', weekIndex: 2, weekStartDate: '2026-06-22', ...secondWeekOverrides }),
  ]
  return {
    plan: makePlan({ wizardConfig, ...overrides?.plan }),
    weeks,
    previousWeek: overrides?.previousWeek ? makeWeek(overrides.previousWeek) : undefined,
    profile: makeProfile(overrides?.profile),
    wizardConfig,
    recentContext: overrides?.recentContext,
    outputFormat: overrides?.outputFormat,
  }
}
