import { addDays, addWeeks } from 'date-fns'
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

function resolvePhaseForWeekOffset(offsetFromEvent: number): MacroPlanPhase {
  return resolvePhase(offsetFromEvent)
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
  const macroSnapshot = input.macroPlan ?? computeMacroPlan(profile, now)
  if (!macroSnapshot) {
    throw new Error('No se puede generar el plan sin un MacroPlan base (falta evento principal).')
  }

  const eventDate = fromISO(goalEvent.date)
  const firstWeekStart = getWeekStart(now)
  const eventWeekStart = getWeekStart(eventDate)
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const weeksUntilEvent = Math.max(
    0,
    Math.round((eventWeekStart.getTime() - firstWeekStart.getTime()) / msPerWeek),
  )
  // Include event week + at least 1 week. Cap at 20 to avoid runaway.
  const totalWeeks = Math.min(20, Math.max(1, weeksUntilEvent + 1))

  const weekPhases: MacroPlanPhase[] = []
  for (let i = 0; i < totalWeeks; i++) {
    const weekStart = addWeeks(firstWeekStart, i)
    const remaining = computeWeeksRemaining(goalEvent.date, weekStart)
    weekPhases.push(resolvePhaseForWeekOffset(remaining))
  }

  const phases = groupIntoPhases(weekPhases)
  const endDate = toISO(addDays(addWeeks(firstWeekStart, totalWeeks - 1), 6))

  const allowedSports: SupportedSport[] = Array.from(
    new Set<SupportedSport>([
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
    title: `Plan ${goalEvent.title}`,
    startDate: toISO(firstWeekStart),
    endDate,
    totalWeeks,
    phases,
    wizardConfig,
    macroSnapshot,
    createdAt: nowTs,
    updatedAt: nowTs,
  }

  const weeks: TrainingPlanWeek[] = weekPhases.map((phase, index) => {
    const weekStart = addWeeks(firstWeekStart, index)
    const targetLoadBySport: Partial<Record<SupportedSport, number>> = {}
    const baseline = defaultLoadForPhase(phase)
    for (const sport of allowedSports) {
      targetLoadBySport[sport] = sport === macroSnapshot.sportDetails.find(d => d.role === 'primary')?.sport
        ? baseline
        : Math.round(baseline * 0.55)
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
