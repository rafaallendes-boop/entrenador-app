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

function buildSlots(plan: TrainingPlan, week: TrainingPlanWeek, expected: number): Slot[] {
  const dates = getPlanWeekTrainingDates(plan, week)
  const singles = dates.map((date) => ({ date, timeBlock: 'AM' as const }))
  const doubles = dates
    .filter((date) => canUseDoubleSessionOnDate(date, plan.wizardConfig))
    .map((date) => ({ date, timeBlock: 'PM' as const }))

  if (expected <= singles.length) return singles.slice(0, expected)
  return [...singles, ...doubles].slice(0, expected)
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
  if (primary === 'squash' && (week.phase === 'taper' || week.phase === 'race')) {
    return expected >= 4 ? 2 : Math.min(expected, 1)
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
  const primaryMinimum = minimumPrimarySessions(plan, week, expected)
  const supports = supportSports(plan, primary).filter((sport) => {
    if (primary === 'squash' && (week.phase === 'taper' || week.phase === 'race')) {
      return sport !== 'running' && sport !== 'cycling'
    }
    return true
  })

  if (!primary) {
    const sequence = [...supports]
    while (sequence.length < expected) sequence.push(supports[0] ?? 'mobility')
    return sequence.slice(0, expected)
  }

  const sequence: SupportedSport[] = [primary]
  let primaryCount = 1
  let supportIndex = 0

  while (sequence.length < expected) {
    const remainingSlots = expected - sequence.length
    const remainingPrimary = Math.max(0, primaryMinimum - primaryCount)
    const shouldAddSupport = supportIndex < supports.length && remainingSlots > remainingPrimary

    if (shouldAddSupport) {
      sequence.push(supports[supportIndex])
      supportIndex += 1
    } else {
      sequence.push(primary)
      primaryCount += 1
    }
  }

  return sequence.slice(0, expected)
}

function squashSubtype(index: number, phase: TrainingPlanWeek['phase'], weekIndex: number): CoachSessionProposal['subtype'] {
  if (phase === 'race' || phase === 'taper') return index === 0 ? 'control' : 'light'
  const rotation: Array<NonNullable<CoachSessionProposal['subtype']>> = ['training', 'control', 'match', 'competitive']
  return rotation[(index + weekIndex) % rotation.length]
}

function runningTypeForWeek(week: TrainingPlanWeek): RunningType {
  if (week.phase === 'race' || week.phase === 'taper') return 'z2'
  if (week.phase === 'base') return week.weekIndex % 3 === 2 ? 'long' : 'z2'
  if (week.phase === 'peak' || week.phase === 'build') {
    const rotation: RunningType[] = ['tempo', 'intervals', 'z2']
    return rotation[week.weekIndex % rotation.length]
  }
  return 'z2'
}

function squashTitle(index: number, week: TrainingPlanWeek): string {
  const buildTitles = [
    'Squash - Técnica Aplicada',
    'Squash - Control y Patrones',
    'Squash - Juego Condicionado',
    'Squash - Sombras y Salidas',
    'Squash - Aplicación Táctica',
    'Squash - Match Play Controlado',
  ]
  const taperTitles = [
    'Squash - Ritmo y Precisión',
    'Squash - Activación Técnica',
    'Squash - Control Ligero',
    'Squash - Puntos Cortos',
  ]
  const titles = week.phase === 'taper' || week.phase === 'race' ? taperTitles : buildTitles
  return titles[(index + week.weekIndex) % titles.length]
}

function runningTitle(week: TrainingPlanWeek): string {
  switch (runningTypeForWeek(week)) {
    case 'tempo':
      return 'Carrera Tempo - Resistencia Específica'
    case 'intervals':
      return 'Intervalos Running - Cambios Controlados'
    case 'long':
      return 'Rodaje Largo - Base Aeróbica'
    case 'z2':
    default:
      return 'Rodaje Z2 - Base Aeróbica'
  }
}

function strengthTitle(week: TrainingPlanWeek): string {
  const titles = [
    'Fuerza Soporte Squash',
    'Fuerza Potencia Lateral',
    'Fuerza Estabilidad y Core',
    'Fuerza Tren Superior y Frenado',
  ]
  return titles[week.weekIndex % titles.length]
}

function fallbackTitle(sport: SupportedSport, index: number, week: TrainingPlanWeek): string {
  switch (sport) {
    case 'squash':
      return squashTitle(index, week)
    case 'running':
      return runningTitle(week)
    case 'strength':
      return strengthTitle(week)
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
    subtype: sport === 'squash' ? squashSubtype(index, week.phase, week.weekIndex) : undefined,
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
  const slots = buildSlots(input.plan, input.week, expected)
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
