import { addDays, addWeeks, differenceInCalendarDays } from 'date-fns'
import type {
  AthleteProfile,
  GoalEvent,
  MacroPlan,
  MacroPlanPhase,
  PlanWizardConfig,
  SupportedSport,
} from '../../types'
import type {
  PlanPhaseBlock,
  TrainingPlan,
  TrainingPlanWeek,
} from '../../types/planBuilder'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import { v4 as uuid } from '../../utils/uuid'
import { computeMacroPlan, computeWeeksRemaining, resolvePhase } from '../macroPlan'
import { resolveConfiguredGenerationStrategy } from './generationState'

export interface BuildPlanShellInput {
  athleteId: string
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  goalEvent: GoalEvent
  macroPlan?: MacroPlan
  now?: Date
}

export interface BuildPlanShellResult {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
}

export const MAX_COMPETITION_PLAN_WEEKS = 12

const INTENT_BY_PHASE: Record<MacroPlanPhase, string> = {
  base: 'Construir base amplia con continuidad y dosis sostenible.',
  build: 'Subir especificidad manteniendo soporte util y frescura.',
  peak: 'Priorizar sesiones clave con maxima calidad y volumen controlado.',
  taper: 'Reducir volumen, proteger frescura y mantener sensaciones competitivas.',
  race: 'Activaciones cortas y utiles. Llegar fresco al evento.',
  transition: 'Descargar, recuperar y volver gradualmente a rutina liviana.',
}

function defaultLoadForPhase(phase: MacroPlanPhase): number {
  switch (phase) {
    case 'base':  return 60
    case 'build': return 70
    case 'peak':  return 75
    case 'taper': return 45
    case 'race':  return 25
    case 'transition': return 35
  }
}

function supportLoadForSport(
  sport: SupportedSport,
  phase: MacroPlanPhase,
  primarySport: SupportedSport | undefined,
  primaryLoad: number,
): number {
  if (sport === primarySport) return primaryLoad

  const multiplierBySport: Partial<Record<SupportedSport, Partial<Record<MacroPlanPhase, number>>>> = {
    strength: {
      base: 0.55,
      build: 0.6,
      peak: 0.5,
      taper: 0.3,
      race: 0.15,
      transition: 0.25,
    },
    running: {
      base: primarySport === 'squash' ? 0.45 : 0.55,
      build: primarySport === 'squash' ? 0.4 : 0.55,
      peak: primarySport === 'squash' ? 0.25 : 0.45,
      taper: 0.15,
      race: 0,
      transition: 0.25,
    },
    cycling: {
      base: 0.45,
      build: 0.35,
      peak: 0.2,
      taper: 0,
      race: 0,
      transition: 0.25,
    },
    mobility: {
      base: 0.3,
      build: 0.3,
      peak: 0.35,
      taper: 0.45,
      race: 0.35,
      transition: 0.5,
    },
  }

  const multiplier = multiplierBySport[sport]?.[phase] ?? 0.35
  return Math.round(primaryLoad * multiplier)
}

function resolvePhaseForWeekOffset(offsetFromEvent: number, primarySport?: SupportedSport): MacroPlanPhase {
  return resolvePhase(offsetFromEvent, primarySport)
}

function dayOfWeek(date: Date): PlanWizardConfig['trainingDays'][number] {
  const mapping: PlanWizardConfig['trainingDays'][number][] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return mapping[date.getDay()]
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function findFirstTrainingDateOnOrAfter(
  requestedDate: Date,
  eventDate: Date,
  wizardConfig: PlanWizardConfig,
): Date {
  const allowedDays = new Set(wizardConfig.trainingDays)
  const start = startOfLocalDay(requestedDate)
  const end = startOfLocalDay(eventDate)
  const maxLookaheadDays = Math.max(0, differenceInCalendarDays(end, start))

  for (let i = 0; i <= maxLookaheadDays; i++) {
    const candidate = addDays(start, i)
    if (allowedDays.has(dayOfWeek(candidate))) return candidate
  }

  return start
}

function groupIntoPhases(weekPhases: MacroPlanPhase[]): PlanPhaseBlock[] {
  if (weekPhases.length === 0) return []
  const blocks: PlanPhaseBlock[] = []
  let start = 0
  for (let i = 1; i <= weekPhases.length; i++) {
    if (i === weekPhases.length || weekPhases[i] !== weekPhases[start]) {
      const phase = weekPhases[start]
      blocks.push({
        phase,
        startWeekIndex: start,
        endWeekIndex: i - 1,
        blockFocus: INTENT_BY_PHASE[phase],
        intentBySport: {},
      })
      start = i
    }
  }
  return blocks
}

export function buildPlanShell(input: BuildPlanShellInput): BuildPlanShellResult {
  const { athleteId, profile, wizardConfig, goalEvent } = input
  const now = input.now ?? new Date()
  const requestedStartDate = startOfLocalDay(now)
  const goalEventDate = fromISO(goalEvent.date)
  const macroSnapshot = input.macroPlan ?? computeMacroPlan(profile, now)
  if (!macroSnapshot) {
    throw new Error('No se puede generar el plan sin un MacroPlan base (falta evento principal).')
  }

  const firstTrainingDate = findFirstTrainingDateOnOrAfter(requestedStartDate, goalEventDate, wizardConfig)
  const eventWeekStart = getWeekStart(fromISO(goalEvent.date))
  const uncappedFirstWeekStart = getWeekStart(firstTrainingDate)
  // Calendar days, not elapsed milliseconds: both operands are local midnights,
  // and a plan spanning a DST change is short (or long) by an hour. Dividing the
  // raw span by 7*24h and truncating dropped a whole week from every plan that
  // crossed a spring-forward transition.
  const uncappedTotalWeeks = Math.max(
    1,
    Math.floor(differenceInCalendarDays(eventWeekStart, uncappedFirstWeekStart) / 7) + 1,
  )
  const totalWeeks = Math.min(MAX_COMPETITION_PLAN_WEEKS, uncappedTotalWeeks)
  const firstWeekStart =
    uncappedTotalWeeks > MAX_COMPETITION_PLAN_WEEKS
      ? addWeeks(eventWeekStart, -(MAX_COMPETITION_PLAN_WEEKS - 1))
      : uncappedFirstWeekStart
  const planStartDate = uncappedTotalWeeks > MAX_COMPETITION_PLAN_WEEKS
    ? toISO(firstWeekStart)
    : toISO(requestedStartDate)

  const weekPhases: MacroPlanPhase[] = []
  const primarySport = macroSnapshot.sportDetails.find((detail) => detail.role === 'primary')?.sport
  for (let i = 0; i < totalWeeks; i++) {
    const weekStart = addWeeks(firstWeekStart, i)
    const weekReferenceDate = weekStart.getTime() > now.getTime()
      ? weekStart
      : i === 0
        ? now
        : weekStart
    const remaining = computeWeeksRemaining(goalEvent.date, weekReferenceDate)
    weekPhases.push(resolvePhaseForWeekOffset(remaining, primarySport))
  }

  const phases = groupIntoPhases(weekPhases)
  const calendarEndDate = toISO(addDays(addWeeks(firstWeekStart, totalWeeks - 1), 6))
  const endDate = goalEvent.date >= planStartDate ? goalEvent.date : calendarEndDate

  const allowedSports: SupportedSport[] = Array.from(
    new Set<SupportedSport>([
      ...(macroSnapshot.sportDetails
        .filter((detail) => detail.role === 'primary')
        .map((detail) => detail.sport)),
      ...(profile.sportContext?.enabledSports ?? []),
      ...wizardConfig.complementarySports,
    ]),
  )

  const planId = uuid()
  const nowTs = Date.now()
  const plan: TrainingPlan = {
    id: planId,
    athleteId,
    goalEventId: goalEvent.id,
    status: 'draft',
    generationState: 'shell',
    title: `Plan ${goalEvent.title}`,
    startDate: planStartDate,
    endDate,
    totalWeeks,
    phases,
    wizardConfig,
    macroSnapshot,
    createdAt: nowTs,
    updatedAt: nowTs,
    generationSummary: {
      startedAt: nowTs,
      strategy: resolveConfiguredGenerationStrategy(totalWeeks),
      completedWeeks: 0,
      failedWeeks: [],
      totalAttempts: 0,
    },
  }

  const weeks: TrainingPlanWeek[] = weekPhases.map((phase, index) => {
    const weekStart = addWeeks(firstWeekStart, index)
    const targetLoadBySport: Partial<Record<SupportedSport, number>> = {}
    const baseline = defaultLoadForPhase(phase)
    for (const sport of allowedSports) {
      targetLoadBySport[sport] = supportLoadForSport(sport, phase, primarySport, baseline)
    }
    return {
      id: uuid(),
      planId,
      weekIndex: index,
      weekStartDate: toISO(weekStart),
      phase,
      status: 'pending',
      sessions: [],
      weekObjectives: [{ goal: INTENT_BY_PHASE[phase] }],
      targetLoadBySport,
      validationIssues: [],
      generationMeta: { attempts: 0 },
      createdAt: nowTs,
      updatedAt: nowTs,
    }
  })

  return { plan, weeks }
}
