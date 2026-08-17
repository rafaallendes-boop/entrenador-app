import type { HandlerEvent } from '@netlify/functions'
import type { AthleteProfile, PlanWizardConfig } from '../../../../src/types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../../src/types/planBuilder'

/**
 * Body mínimo REALMENTE válido para que el worker llegue a invocar
 * `callLLM` (no solo a pasar `isGeneratePlanPayload`, ver
 * `planGenerationShared.ts`). Un `plan`/`profile` demasiado esqueléticos
 * (como los que usaba `backgroundPlanEntitlement.test.ts`, Task 5) alcanzan
 * para probar el rechazo de entitlement — ese camino nunca llega a generar
 * una semana — pero Task 8 SÍ necesita llegar hasta `gatedCallLLM`, y
 * `runAsyncPlanGeneration`/`generateWeekCore` leen `plan.macroSnapshot.
 * sportDetails` antes de eso. Sin él, el worker lanza
 * "Cannot read properties of undefined (reading 'sportDetails')" ANTES de
 * intentar el gate — un falso positivo: los tests que esperan
 * `callAnthropicForWeek` no llamado pasarían igual, pero por la razón
 * equivocada, y los que esperan que SÍ se llame fallarían con "0 times".
 * Fixture copiado de `asyncGenerationLoop.test.ts` (`makePlan`/`makeWeek`/
 * `makeProfile`/`makeWizardConfig`), que ya ejercita `runAsyncPlanGeneration`
 * de punta a punta.
 */
function buildWizardConfig(): PlanWizardConfig {
  return {
    goalEventId: 'event-1',
    trainingDays: ['monday'],
    sessionsPerWeek: 1,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['running', 'strength'],
    currentFitnessLevel: 'normal',
    currentFatigue: 'fresh',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }
}

function buildPlan(): TrainingPlan {
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'shell',
    title: 'Plan test',
    startDate: '2026-06-01',
    endDate: '2026-06-14',
    totalWeeks: 2,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1, blockFocus: '', intentBySport: {} }],
    wizardConfig: buildWizardConfig(),
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-06-14',
      currentPhase: 'build',
      weeksRemaining: 2,
      blockFocus: '',
      headline: '',
      timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function buildWeek(): TrainingPlanWeek {
  return {
    id: 'week-0',
    planId: 'plan-1',
    weekIndex: 0,
    weekStartDate: '2026-06-01',
    phase: 'build',
    status: 'pending',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: { squash: 50 },
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 1,
    updatedAt: 1,
  }
}

function buildProfile(): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: 1,
    sportContext: { enabledSports: ['squash'], primarySport: 'squash' },
  }
}

export function buildBackgroundEvent(
  overrides: { authorization?: string; jobId?: string | undefined } = {},
): HandlerEvent {
  const { jobId } = overrides
  return {
    httpMethod: 'POST',
    headers: { authorization: overrides.authorization ?? 'Bearer tok-1' },
    body: JSON.stringify({
      plan: buildPlan(),
      weeks: [buildWeek()],
      profile: buildProfile(),
      wizardConfig: buildWizardConfig(),
      ...(jobId ? { jobId } : {}),
    }),
  } as unknown as HandlerEvent
}
