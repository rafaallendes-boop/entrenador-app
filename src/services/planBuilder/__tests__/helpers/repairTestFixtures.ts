import type {
  AthleteProfile,
  CoachSessionProposal,
  DayOfWeek,
  MacroPlanPhase,
  PlanWizardConfig,
  SupportedSport,
} from '../../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../../types/planBuilder'
import type { RepairContext } from '../../repairWeek'

interface RepairContextFixtureOptions {
  primarySport?: SupportedSport
  phase?: MacroPlanPhase
  sessionsPerWeek?: number
  targetLoadBySport?: Partial<Record<SupportedSport, number>>
  planWeekDescriptors?: RepairContext['planWeekDescriptors']
  /** Semana ISO (lunes) a usar como `week.weekStartDate`/`plan.startDate`. Por defecto la fixture original. */
  weekStartDate?: string
  trainingDays?: DayOfWeek[]
  allowDoubleSession?: boolean
  doubleSessionDays?: DayOfWeek[]
  /** Deportes complementarios habilitados además del primario (`getAllowedSports` los exige para no filtrarlos en el paso 5). */
  complementarySports?: SupportedSport[]
}

function addIsoDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function buildRepairContextForTest(
  options: RepairContextFixtureOptions = {},
): RepairContext {
  const primarySport = options.primarySport ?? 'squash'
  const phase = options.phase ?? 'base'
  const sessionsPerWeek = options.sessionsPerWeek ?? 1
  const weekStartDate = options.weekStartDate ?? '2026-08-03'
  const weekEndDate = addIsoDays(weekStartDate, 6)
  const wizardConfig: PlanWizardConfig = {
    goalEventId: 'event-1',
    trainingDays: options.trainingDays
      ?? ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    sessionsPerWeek,
    sessionDurationMins: 45,
    allowDoubleSession: options.allowDoubleSession ?? false,
    doubleSessionDays: options.doubleSessionDays ?? [],
    complementarySports: options.complementarySports ?? [],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    partnerAvailability: 'either',
    createdAt: '',
    updatedAt: '',
  }
  const plan: TrainingPlan = {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'shell',
    title: 'Fixture plan',
    startDate: weekStartDate,
    endDate: weekEndDate,
    totalWeeks: 1,
    phases: [{
      phase,
      startWeekIndex: 0,
      endWeekIndex: 0,
      blockFocus: 'fixture',
      intentBySport: {},
    }],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: weekEndDate,
      currentPhase: phase,
      weeksRemaining: 1,
      blockFocus: 'fixture',
      headline: '',
      timeline: [],
      sportDetails: [{
        sport: primarySport,
        role: 'primary',
        phaseFocus: '',
        weeklyIntent: '',
        volumeBias: 'hold',
        intensityBias: 'hold',
        notes: '',
      }],
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 0,
    updatedAt: 0,
  }
  const week: TrainingPlanWeek = {
    id: 'week-0',
    planId: plan.id,
    weekIndex: 0,
    weekStartDate,
    phase,
    status: 'pending',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: options.targetLoadBySport ?? {},
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 0,
    updatedAt: 0,
  }
  const profile: AthleteProfile = {
    id: 'athlete-1',
    updatedAt: 0,
    primarySport,
    mainGoal: 'Fixture goal',
    sportContext: {
      primarySport,
      enabledSports: [primarySport],
      secondarySports: [],
      trainingPriority: 'performance',
    },
    goalEvents: [{
      id: 'event-1',
      title: 'Fixture event',
      date: plan.endDate,
      sport: primarySport,
      priority: 'primary',
      competitiveLevel: 'competitive',
    }],
  }

  return {
    plan,
    week,
    profile,
    wizardConfig,
    planWeekDescriptors: options.planWeekDescriptors ?? [{ weekIndex: week.weekIndex, phase: week.phase }],
  }
}

type SkeletonSessionFixtureInput = Partial<CoachSessionProposal> & {
  fullyHydrated?: boolean
}

export function buildSkeletonSessionForTest(
  input: SkeletonSessionFixtureInput = {},
): CoachSessionProposal {
  const { fullyHydrated = false, ...overrides } = input
  const session: CoachSessionProposal = {
    date: '2026-08-03',
    timeBlock: 'AM',
    sessionType: 'running',
    title: 'Fixture session',
    objective: 'Fixture objective',
    durationMin: 45,
    rpe: 5,
    ...overrides,
  }

  if (!fullyHydrated) return session
  if (session.sessionType !== 'running') {
    throw new Error('fullyHydrated fixture is defined only for running')
  }

  return {
    ...session,
    runningType: session.runningType ?? 'z2',
    targetPaceMin: session.targetPaceMin ?? '5:30',
    targetPaceMax: session.targetPaceMax ?? '6:00',
    targetHrMin: session.targetHrMin ?? 130,
    targetHrMax: session.targetHrMax ?? 145,
    intervalStructure: session.intervalStructure ?? {
      blocks: [{ label: 'Rodaje Z2', durationMin: session.durationMin }],
    },
  }
}

/**
 * Alias delgado de `buildSkeletonSessionForTest` con el nombre corto que usan
 * los tests de separación de sesiones duras (Tarea 2 y siguientes del plan
 * 2026-09-02-plan-builder-precision). No agrega comportamiento nuevo.
 */
export function makeProposal(overrides: Partial<CoachSessionProposal> = {}): CoachSessionProposal {
  return buildSkeletonSessionForTest(overrides)
}

/**
 * Alias de `makeProposal` con el nombre que usa el gate de calidad de
 * respaldo (Tarea 3 del plan 2026-09-02-plan-builder-precision), que opera
 * directamente sobre `TrainingPlanWeek.sessions` (`reviewPlanQuality`) en vez
 * de sobre propuestas crudas del repair. Mismo shape, mismo builder.
 */
export function makeSession(overrides: Partial<CoachSessionProposal> = {}): CoachSessionProposal {
  return buildSkeletonSessionForTest(overrides)
}

interface PlanFixtureOptions {
  primarySport?: SupportedSport
  phase?: MacroPlanPhase
  /** Semana ISO (lunes) a usar como `plan.startDate` (Tarea 5 del plan 2026-09-02-plan-builder-precision). */
  startDate?: string
  /** `TrainingPlan.status` (Tarea 7 del plan 2026-09-02-plan-builder-precision). Por defecto `'draft'`. */
  status?: TrainingPlan['status']
  /** Deportes de apoyo permitidos; sin esto `validatePlan` marca `session.sport.not_allowed`. */
  complementarySports?: SupportedSport[]
}

/**
 * Devuelve sólo el `TrainingPlan` que ya construye `buildRepairContextForTest`,
 * para tests de `reviewPlanQuality` (Tarea 3) que no necesitan `RepairContext`
 * completo (perfil, wizard config, descriptors de bloque).
 */
export function makePlan(overrides: PlanFixtureOptions = {}): TrainingPlan {
  const plan = buildRepairContextForTest({
    primarySport: overrides.primarySport,
    phase: overrides.phase,
    weekStartDate: overrides.startDate,
    complementarySports: overrides.complementarySports,
  }).plan
  if (overrides.status !== undefined) {
    return { ...plan, status: overrides.status }
  }
  return plan
}

interface WeekFixtureOptions {
  weekIndex?: number
  weekStartDate?: string
  phase?: MacroPlanPhase
  planId?: string
  sessions?: CoachSessionProposal[]
}

/**
 * `TrainingPlanWeek` mínimo para `reviewPlanQuality` (Tarea 3), con
 * `sessions` pasadas tal cual — no reutiliza `RepairContext['week']` porque
 * ese siempre arranca con `sessions: []` y sin `weekIndex` configurable.
 */
export function makeWeek(overrides: WeekFixtureOptions = {}): TrainingPlanWeek {
  const weekStartDate = overrides.weekStartDate ?? '2026-08-03'
  const weekIndex = overrides.weekIndex ?? 0
  return {
    id: `week-${weekIndex}`,
    planId: overrides.planId ?? 'plan-1',
    weekIndex,
    weekStartDate,
    phase: overrides.phase ?? 'base',
    status: 'pending',
    sessions: overrides.sessions ?? [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 0,
    updatedAt: 0,
  }
}
