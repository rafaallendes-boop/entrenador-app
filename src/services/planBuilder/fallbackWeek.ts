import type { AthleteProfile, CoachSessionProposal, DayOfWeek, PlanWizardConfig, RunningType, SupportedSport } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { getExpectedSessionsForPlanWeek, getPlanWeekTrainingDates } from './dateRange'
import { repairGeneratedWeek, type RepairResult } from './repairWeek'

type Slot = { date: string; timeBlock: 'AM' | 'PM' }

function isoDateToDayOfWeek(date: string): DayOfWeek | null {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  const mapping: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return mapping[parsed.getUTCDay()] ?? null
}

function canUseDoubleSessionOnDate(date: string, wizardConfig: PlanWizardConfig): boolean {
  if (!wizardConfig.allowDoubleSession) return false
  if (!wizardConfig.doubleSessionDays || wizardConfig.doubleSessionDays.length === 0) return true
  const day = isoDateToDayOfWeek(date)
  return Boolean(day && wizardConfig.doubleSessionDays.includes(day))
}

function buildSlots(plan: TrainingPlan, week: TrainingPlanWeek): Slot[] {
  const dates = getPlanWeekTrainingDates(plan, week)
  const singles = dates.map((date) => ({ date, timeBlock: 'AM' as const }))
  const doubles = dates
    .filter((date) => canUseDoubleSessionOnDate(date, plan.wizardConfig))
    .map((date) => ({ date, timeBlock: 'PM' as const }))

  return [...singles, ...doubles]
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

function getPrimarySport(plan: TrainingPlan): SupportedSport | undefined {
  return plan.macroSnapshot.sportDetails.find((detail) => detail.role === 'primary')?.sport
}

function getAllowedSports(plan: TrainingPlan): SupportedSport[] {
  return [
    ...new Set<SupportedSport>([
      ...plan.macroSnapshot.sportDetails.map((detail) => detail.sport),
      ...plan.wizardConfig.complementarySports,
      'mobility',
    ]),
  ]
}

function minimumPrimarySessions(plan: TrainingPlan, week: TrainingPlanWeek, expected: number): number {
  const primary = getPrimarySport(plan)
  if (!primary || expected <= 0 || week.phase === 'transition') return 0
  if (primary === 'squash' && (week.phase === 'build' || week.phase === 'peak')) {
    return expected >= 4
      ? Math.min(expected, Math.floor(expected / 2) + 1)
      : Math.min(expected, 2)
  }
  return Math.min(expected, 1)
}

function supportSports(plan: TrainingPlan, primary: SupportedSport | undefined): SupportedSport[] {
  const allowed = getAllowedSports(plan).filter((sport) => sport !== primary)
  const preferred: SupportedSport[] = primary === 'squash'
    ? ['strength', 'running', 'cycling', 'mobility']
    : ['strength', 'running', 'cycling', 'squash', 'mobility']

  return [
    ...preferred.filter((sport) => allowed.includes(sport)),
    ...allowed.filter((sport) => !preferred.includes(sport)),
  ]
}

function buildSportSequence(plan: TrainingPlan, week: TrainingPlanWeek, expected: number): SupportedSport[] {
  const primary = getPrimarySport(plan)
  const sequence: SupportedSport[] = []
  const primaryMinimum = minimumPrimarySessions(plan, week, expected)

  if (primary) {
    for (let i = 0; i < primaryMinimum; i++) {
      sequence.push(primary)
    }
  }

  const supports = supportSports(plan, primary)
  for (const sport of supports) {
    if (sequence.length >= expected) break
    sequence.push(sport)
  }

  while (sequence.length < expected) {
    sequence.push(primary ?? supports[0] ?? 'mobility')
  }

  return sequence.slice(0, expected)
}

function squashSubtype(index: number, phase: TrainingPlanWeek['phase']): CoachSessionProposal['subtype'] {
  if (phase === 'race' || phase === 'taper') return index === 0 ? 'control' : 'light'
  if (index === 0) return 'training'
  if (index === 1) return 'control'
  return 'match'
}

function runningTypeForWeek(week: TrainingPlanWeek): RunningType {
  if (week.phase === 'peak' || week.phase === 'build') return 'tempo'
  if (week.phase === 'base') return 'z2'
  if (week.phase === 'race' || week.phase === 'taper') return 'z2'
  return 'z2'
}

function fallbackTitle(sport: SupportedSport, index: number, week: TrainingPlanWeek): string {
  switch (sport) {
    case 'squash':
      return index === 0
        ? 'Squash - Técnica Aplicada'
        : index === 1
          ? 'Squash - Control y Patrones'
          : 'Squash - Juego Condicionado'
    case 'running':
      return runningTypeForWeek(week) === 'tempo'
        ? 'Carrera Tempo - Resistencia Específica'
        : 'Rodaje Z2 - Base Aeróbica'
    case 'strength':
      return 'Fuerza Soporte Squash'
    case 'cycling':
      return 'Bici Z2 - Descarga Aeróbica'
    case 'mobility':
    default:
      return 'Movilidad y Recuperación'
  }
}

function fallbackObjective(sport: SupportedSport, week: TrainingPlanWeek): string {
  switch (sport) {
    case 'squash':
      return `Mantener prioridad técnica y competitiva de squash en fase ${week.phase}.`
    case 'running':
      return 'Desarrollar resistencia complementaria sin interferir con la calidad de squash.'
    case 'strength':
      return 'Fuerza de soporte con foco en potencia, estabilidad lateral y tolerancia de carga.'
    case 'cycling':
      return 'Trabajo aeróbico complementario de bajo impacto.'
    case 'mobility':
    default:
      return 'Recuperar rango de movimiento y bajar carga residual.'
  }
}

function fallbackRpe(sport: SupportedSport, week: TrainingPlanWeek): number {
  if (week.phase === 'taper' || week.phase === 'race') {
    if (sport === 'squash') return 6
    if (sport === 'mobility') return 3
    return 5
  }
  if (sport === 'squash') return 7
  if (sport === 'strength' || sport === 'running') return 6
  return 4
}

function buildSeedSession(
  sport: SupportedSport,
  slot: Slot,
  index: number,
  week: TrainingPlanWeek,
  wizardConfig: PlanWizardConfig,
): CoachSessionProposal {
  const durationMin = sport === 'mobility'
    ? Math.min(45, wizardConfig.sessionDurationMins)
    : wizardConfig.sessionDurationMins

  return {
    date: slot.date,
    timeBlock: slot.timeBlock,
    sessionType: sport,
    title: fallbackTitle(sport, index, week),
    durationMin,
    rpe: fallbackRpe(sport, week),
    objective: fallbackObjective(sport, week),
    subtype: sport === 'squash' ? squashSubtype(index, week.phase) : undefined,
    runningType: sport === 'running' ? runningTypeForWeek(week) : undefined,
  }
}

export function buildLocalFallbackWeek(input: {
  plan: TrainingPlan
  week: TrainingPlanWeek
  previousWeek?: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
}): RepairResult {
  const expected = getExpectedSessionsForPlanWeek(input.plan, input.week)
  const slots = buildSlots(input.plan, input.week).slice(0, expected)
  const sports = buildSportSequence(input.plan, input.week, slots.length)
  const sportCounts = new Map<SupportedSport, number>()
  const seedSessions = slots.map((slot, index) => {
    const sport = sports[index] ?? 'mobility'
    const sportIndex = sportCounts.get(sport) ?? 0
    sportCounts.set(sport, sportIndex + 1)
    return buildSeedSession(sport, slot, sportIndex, input.week, input.wizardConfig)
  })

  return repairGeneratedWeek(seedSessions, {
    plan: input.plan,
    week: input.week,
    previousWeek: input.previousWeek,
    profile: input.profile,
    wizardConfig: input.wizardConfig,
  })
}
