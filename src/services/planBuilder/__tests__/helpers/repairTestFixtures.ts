import type {
  AthleteProfile,
  CoachSessionProposal,
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
}

export function buildRepairContextForTest(
  options: RepairContextFixtureOptions = {},
): RepairContext {
  const primarySport = options.primarySport ?? 'squash'
  const phase = options.phase ?? 'base'
  const sessionsPerWeek = options.sessionsPerWeek ?? 1
  const wizardConfig: PlanWizardConfig = {
    goalEventId: 'event-1',
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    sessionsPerWeek,
    sessionDurationMins: 45,
    allowDoubleSession: false,
    doubleSessionDays: [],
    complementarySports: [],
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
    startDate: '2026-08-03',
    endDate: '2026-08-09',
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
      goalEventDate: '2026-08-09',
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
    weekStartDate: '2026-08-03',
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

  return { plan, week, profile, wizardConfig }
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
