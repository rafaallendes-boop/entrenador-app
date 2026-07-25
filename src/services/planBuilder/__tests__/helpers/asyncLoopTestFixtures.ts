import type { AthleteProfile, PlanWizardConfig } from '../../../../types'
import type { AIRawResponse, AIRequest } from '../../../ai/types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../../types/planBuilder'
import type {
  AsyncPlanGenerationWriter,
  RunAsyncPlanGenerationInput,
} from '../../asyncGenerationLoop'

const PLAN_START_DATE = '2026-06-01'
const CLOCK_START = 100_000

interface TokenUsage {
  input: number
  output: number
}

const DEFAULT_USAGE: TokenUsage = { input: 1200, output: 480 }

function addDaysISO(startDate: string, days: number): string {
  const date = new Date(`${startDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function addWeeksISO(startDate: string, weeks: number): string {
  return addDaysISO(startDate, weeks * 7)
}

function makeWizardConfig(): PlanWizardConfig {
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

function makePlan(weekCount: number, wizardConfig = makeWizardConfig()): TrainingPlan {
  const endDate = addDaysISO(addWeeksISO(PLAN_START_DATE, weekCount - 1), 6)
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'shell',
    title: 'Plan test',
    startDate: PLAN_START_DATE,
    endDate,
    totalWeeks: weekCount,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: weekCount - 1, blockFocus: '', intentBySport: {} }],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: endDate,
      currentPhase: 'build',
      weeksRemaining: weekCount,
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

function makeWeek(index: number, startDate: string): TrainingPlanWeek {
  return {
    id: `week-${index}`,
    planId: 'plan-1',
    weekIndex: index,
    weekStartDate: startDate,
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

/** Semana ya generada por una corrida previa: `draft` con al menos una sesión. */
function makeReadyWeek(week: TrainingPlanWeek): TrainingPlanWeek {
  return {
    ...week,
    status: 'draft',
    sessions: [{
      date: week.weekStartDate,
      timeBlock: 'AM',
      sessionType: 'squash',
      title: 'Semana previa',
      durationMin: 60,
      rpe: 6,
    }],
    generationMeta: { ...week.generationMeta, attempts: 1 },
  }
}

function makeProfile(): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: 1,
    sportContext: { enabledSports: ['squash'], primarySport: 'squash' },
  }
}

function makeSuccessRaw(targetDate: string, usage?: TokenUsage): AIRawResponse {
  return {
    text: JSON.stringify({
      type: 'create_week',
      targetDate,
      reason: 'Semana generada para test',
      weekObjectives: [{ sport: 'squash', goal: 'Technical rhythm' }],
      sessions: [
        {
          date: targetDate,
          timeBlock: 'AM',
          sessionType: 'squash',
          title: 'Squash tecnico',
          durationMin: 60,
          rpe: 6,
          squashDetails: {
            trainingFocus: 'technical',
            sessionMode: 'drill_session',
            sessionKind: 'technical',
            drills: [{ name: 'Drive', durationMin: 12 }],
          },
        },
      ],
    }),
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    traceId: 'trace',
    durationMs: 100,
    finishReason: 'end_turn',
    ...(usage ? { promptTokens: usage.input, completionTokens: usage.output } : {}),
  }
}

/**
 * Respuesta que produce 0 sesiones válidas (create_week sin sesiones). No es
 * truncada, así que la clasificación es `validation` y habilita el reintento.
 * Con el fallback local deshabilitado en el test, esto lleva la semana a `error`.
 */
function makeEmptyRaw(targetDate: string, usage?: TokenUsage): AIRawResponse {
  return {
    text: JSON.stringify({
      type: 'create_week',
      targetDate,
      reason: 'Sin sesiones',
      weekObjectives: [],
      sessions: [],
    }),
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    traceId: 'trace-empty',
    durationMs: 100,
    ...(usage ? { promptTokens: usage.input, completionTokens: usage.output } : {}),
  }
}

function parseWeekIndex(traceId: string): number {
  return Number(traceId.match(/week-(\d+)/)?.[1] ?? 0)
}

function parseAttempt(traceId: string): number {
  return Number(traceId.match(/attempt-(\d+)/)?.[1] ?? 1)
}

export interface MakeRunInputOptions {
  weekCount: number
  enqueuedAt?: number
  concurrency?: number
  tokensPerAttempt?: TokenUsage
  omitUsage?: boolean
  attemptsPerWeek?: number
  failAllWeeks?: boolean
  someWeekFails?: boolean
  budgetExhaust?: boolean
  cancelAfterFirstWeek?: boolean
  /** Semanas que entran a la corrida ya listas (el loop las omite si no hay targets explícitos). */
  preReadyWeekIndexes?: number[]
}

export function makeRunInputForTest(options: MakeRunInputOptions): {
  input: RunAsyncPlanGenerationInput
  base: AsyncPlanGenerationWriter
} {
  const wizardConfig = makeWizardConfig()
  const plan = makePlan(options.weekCount, wizardConfig)
  const preReady = new Set(options.preReadyWeekIndexes ?? [])
  const weeks = Array.from({ length: options.weekCount }, (_, index) => {
    const week = makeWeek(index, addWeeksISO(PLAN_START_DATE, index))
    return preReady.has(index) ? makeReadyWeek(week) : week
  })

  // Reloj determinista: avanza un paso fijo por llamada. El primer tick es el
  // worker start. El paso grande de `budgetExhaust` deja que la primera semana
  // pase el gate de presupuesto y agota el resto sin depender del conteo exacto
  // de llamadas a getNow.
  const step = options.budgetExhaust ? 100_000 : 1_000
  let tick = 0
  const now = (): number => CLOCK_START + step * tick++

  const cancelState = { cancel: false }

  const usage = options.omitUsage ? undefined : (options.tokensPerAttempt ?? DEFAULT_USAGE)

  const callLLM = async (request: AIRequest): Promise<AIRawResponse> => {
    const weekIndex = parseWeekIndex(request.traceId)
    const attempt = parseAttempt(request.traceId)
    const targetDate = addWeeksISO(PLAN_START_DATE, weekIndex)

    if (options.cancelAfterFirstWeek && weekIndex === 0) {
      cancelState.cancel = true
    }

    const failWholeWeek = Boolean(options.failAllWeeks) || Boolean(options.someWeekFails && weekIndex >= 1)
    if (failWholeWeek) {
      return makeEmptyRaw(targetDate, usage)
    }

    const attemptsNeeded = options.attemptsPerWeek ?? 1
    if (attempt < attemptsNeeded) {
      // Falla los primeros intentos para forzar reintentos antes del éxito.
      return makeEmptyRaw(targetDate, usage)
    }

    return makeSuccessRaw(targetDate, usage)
  }

  let currentPlan = plan
  const base: AsyncPlanGenerationWriter = {
    async getPlan() {
      return currentPlan
    },
    async putPlan(next) {
      currentPlan = next
    },
    async putWeek() {
      // no-op; los tests que necesitan capturar semanas envuelven este writer.
    },
    ...(options.cancelAfterFirstWeek
      ? { checkCancelled: async () => cancelState.cancel }
      : {}),
  }

  const concurrency =
    options.concurrency ??
    (options.budgetExhaust || options.cancelAfterFirstWeek ? 1 : undefined)

  const input: RunAsyncPlanGenerationInput = {
    plan,
    weeks,
    profile: makeProfile(),
    wizardConfig,
    jobId: 'job-telemetry',
    writer: base,
    callLLM,
    now,
    enqueuedAt: options.enqueuedAt ?? CLOCK_START - 2000,
    ...(concurrency != null ? { concurrency } : {}),
    ...(options.budgetExhaust ? { budgetMs: 400_000 } : {}),
  }

  return { input, base }
}
