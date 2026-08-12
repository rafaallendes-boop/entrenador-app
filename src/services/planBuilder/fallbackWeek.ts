import type { AthleteProfile, CoachSessionProposal, DayOfWeek, PlanWizardConfig, RunningType, SupportedSport } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { getExpectedSessionsForPlanWeek, getPlanWeekDateRange, getPlanWeekTrainingDates } from './dateRange'
import { repairGeneratedWeek, type RepairResult } from './repairWeek'
import type { PlanWeekDescriptor } from './blockIdentity'
import { selectStrengthBlockTemplate } from '../training/strengthBlocks'
import {
  MAX_EVENT_WINDOW_SUPPORTS_PER_WEEK,
  isWithinPlanEventWindow,
  resolvePlanEventWindow,
} from './eventWindowRules'

type Slot = { date: string; timeBlock: 'AM' | 'PM'; role?: 'event_anchor' | 'support' }

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
  if (expected <= 0) return []

  if (week.phase === 'race' && getPrimarySport(plan) === 'squash') {
    const { anchorDate } = resolvePlanEventWindow(plan)
    const validRange = getPlanWeekDateRange(plan, week)
    const anchorInsideWeek = anchorDate >= validRange.startDate && anchorDate <= validRange.endDate
    const supportCount = Math.max(0, expected - (anchorInsideWeek ? 1 : 0))
    // El tope de dos apoyos es de la ventana, no de la semana: los días previos
    // al campeonato conservan sus slots de taper.
    const candidates = dates.filter((date) => date !== anchorDate)
    const insideSupports = candidates
      .filter((date) => isWithinPlanEventWindow(plan, date))
      .slice(0, MAX_EVENT_WINDOW_SUPPORTS_PER_WEEK)
    const outsideSupports = candidates.filter((date) => !isWithinPlanEventWindow(plan, date))
    const supportSlots: Slot[] = [...outsideSupports, ...insideSupports]
      .sort((left, right) => left.localeCompare(right))
      .slice(0, supportCount)
      .map((date) => ({ date, timeBlock: 'AM', role: 'support' }))
    const slots: Slot[] = anchorInsideWeek
      ? [...supportSlots, { date: anchorDate, timeBlock: 'PM', role: 'event_anchor' }]
      : supportSlots
    return slots
      .sort((left, right) => left.date.localeCompare(right.date) || left.timeBlock.localeCompare(right.timeBlock))
      .slice(0, expected)
  }

  if (dates.length === 0) return []

  const doubleDates = dates.filter((date) => canUseDoubleSessionOnDate(date, plan.wizardConfig))
  const strategicDoubleDate = pickStrategicDoubleDate(plan, week, expected, doubleDates)

  if (strategicDoubleDate && expected <= dates.length) {
    const skipDate = pickRestDateAfterStrategicDouble(dates, strategicDoubleDate)
    const slots: Slot[] = []

    for (const date of dates) {
      if (date === skipDate) continue
      slots.push({ date, timeBlock: 'AM' })
      if (date === strategicDoubleDate) slots.push({ date, timeBlock: 'PM' })
      if (slots.length >= expected) break
    }

    return slots.slice(0, expected)
  }

  const slots: Slot[] = []
  for (const date of dates) {
    slots.push({ date, timeBlock: 'AM' })
    if ((date === strategicDoubleDate || expected > dates.length) && canUseDoubleSessionOnDate(date, plan.wizardConfig)) {
      slots.push({ date, timeBlock: 'PM' })
    }
    if (slots.length >= expected) return slots.slice(0, expected)
  }

  for (const date of doubleDates) {
    if (slots.length >= expected) break
    if (!slots.some((slot) => slot.date === date && slot.timeBlock === 'PM')) {
      slots.push({ date, timeBlock: 'PM' })
    }
  }

  return slots.slice(0, expected)
}

function pickStrategicDoubleDate(
  plan: TrainingPlan,
  week: TrainingPlanWeek,
  expected: number,
  doubleDates: string[],
): string | undefined {
  if (!plan.wizardConfig.allowDoubleSession || doubleDates.length === 0) return undefined
  if (expected < 6) return undefined
  if (getPrimarySport(plan) !== 'squash') return undefined
  if (week.phase === 'taper' || week.phase === 'race' || week.phase === 'transition') return undefined

  const preferredMiddleIndex = Math.min(1, doubleDates.length - 1)
  return doubleDates[preferredMiddleIndex]
}

function pickRestDateAfterStrategicDouble(dates: string[], doubleDate: string): string | undefined {
  const afterDouble = dates.find((date) => date > doubleDate)
  if (afterDouble) return afterDouble
  return [...dates].reverse().find((date) => date !== doubleDate)
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
  if (primary === 'squash') return buildSquashPrimarySportSequence(plan, week, expected)

  const primaryMinimum = minimumPrimarySessions(plan, week, expected)
  const supports = supportSports(plan, primary)

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

function buildSquashPrimarySportSequence(plan: TrainingPlan, week: TrainingPlanWeek, expected: number): SupportedSport[] {
  const allowedSupports = new Set(supportSports(plan, 'squash'))
  const canUse = (sport: SupportedSport) => sport === 'squash' || allowedSupports.has(sport)
  const withoutAerobic = (sport: SupportedSport) => sport !== 'running' && sport !== 'cycling'
  const pushIfAllowed = (sequence: SupportedSport[], sport: SupportedSport) => {
    if (canUse(sport)) sequence.push(sport)
  }

  const template: SupportedSport[] = []

  if (week.phase === 'race') {
    pushIfAllowed(template, 'mobility')
    pushIfAllowed(template, 'squash')
  } else if (week.phase === 'taper') {
    for (const sport of ['strength', 'squash', 'mobility', 'squash', 'strength', 'squash'] as SupportedSport[]) {
      if (withoutAerobic(sport)) pushIfAllowed(template, sport)
    }
  } else if (week.phase === 'peak') {
    for (const sport of ['strength', 'squash', 'strength', 'squash', 'squash', 'squash', 'mobility'] as SupportedSport[]) {
      if (withoutAerobic(sport)) pushIfAllowed(template, sport)
    }
  } else {
    for (const sport of ['strength', 'squash', 'running', 'squash', 'strength', 'squash', 'mobility'] as SupportedSport[]) {
      pushIfAllowed(template, sport)
    }
  }

  if (template.length === 0) template.push('squash')
  while (template.length < expected) template.push('squash')
  return template.slice(0, expected)
}

function squashSubtype(index: number, phase: TrainingPlanWeek['phase'], weekIndex: number): CoachSessionProposal['subtype'] {
  if (phase === 'race') return 'light'
  if (phase === 'taper') return index === 0 ? 'control' : 'light'
  const rotation: Array<NonNullable<CoachSessionProposal['subtype']>> = ['training', 'control', 'match', 'competitive']
  return rotation[(index + weekIndex) % rotation.length]
}

function runningTypeForWeek(plan: TrainingPlan, week: TrainingPlanWeek): RunningType {
  if (getPrimarySport(plan) === 'squash' && (week.phase === 'build' || week.phase === 'peak')) return 'z2'
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

function runningTitle(runningType: RunningType, squashSupport: boolean): string {
  if (squashSupport) return 'Rodaje Z2 - Soporte Squash'

  switch (runningType) {
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

function getWeekIndexInPhaseBlock(plan: TrainingPlan, week: TrainingPlanWeek): number {
  const block = plan.phases.find((phase) =>
    week.weekIndex >= phase.startWeekIndex && week.weekIndex <= phase.endWeekIndex,
  )
  return Math.max(0, week.weekIndex - (block?.startWeekIndex ?? week.weekIndex))
}

function strengthTitle(plan: TrainingPlan, week: TrainingPlanWeek, strengthIndex: number): string {
  const template = selectStrengthBlockTemplate(week.phase, getWeekIndexInPhaseBlock(plan, week) + strengthIndex)
  const description = template.description
    .replace(/^Peak\s+[ABC]\s+-\s+/i, '')
    .replace(/^Build\s+[ABC]\s+-\s+/i, '')
    .replace(/^Taper\s+[ABC]?\s*-?\s*/i, '')
    .trim()
  return description
    ? `Gym Tipo ${template.subTemplate} - ${description}`
    : `Gym Tipo ${template.subTemplate}`
}

function fallbackTitle(sport: SupportedSport, index: number, plan: TrainingPlan, week: TrainingPlanWeek): string {
  switch (sport) {
    case 'squash':
      return squashTitle(index, week)
    case 'running':
      return runningTitle(runningTypeForWeek(plan, week), getPrimarySport(plan) === 'squash')
    case 'strength':
      return strengthTitle(plan, week, index)
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
  plan: TrainingPlan,
  week: TrainingPlanWeek,
  wizardConfig: PlanWizardConfig,
): CoachSessionProposal {
  if (slot.role === 'event_anchor' && getPrimarySport(plan) === 'squash') {
    return {
      date: slot.date,
      timeBlock: slot.timeBlock,
      sessionType: 'squash',
      title: 'Squash - Competencia Objetivo',
      objective: 'Representar la única ancla del campeonato y reservar su carga competitiva en el calendario.',
      durationMin: wizardConfig.sessionDurationMins,
      rpe: 8,
      subtype: 'competitive',
      squashKind: 'match',
    }
  }

  const squashPrimary = getPrimarySport(plan) === 'squash'
  const durationMin = week.phase === 'race' && sport === 'squash'
    ? Math.min(20, wizardConfig.sessionDurationMins)
    : sport === 'running' && squashPrimary
    ? Math.min(40, wizardConfig.sessionDurationMins)
    : sport === 'mobility'
      ? Math.min(week.phase === 'race' ? 30 : 45, wizardConfig.sessionDurationMins)
      : wizardConfig.sessionDurationMins
  const runningType = sport === 'running' ? runningTypeForWeek(plan, week) : undefined
  const subtype = sport === 'squash' ? squashSubtype(index, week.phase, week.weekIndex) : undefined
  const timeBlock = resolvePreferredTimeBlock(sport, subtype, slot.timeBlock)

  const raceActivation = week.phase === 'race' && sport === 'squash'

  return {
    date: slot.date,
    timeBlock,
    sessionType: sport,
    title: raceActivation ? 'Squash - Activación de Campeonato' : fallbackTitle(sport, index, plan, week),
    durationMin,
    rpe: raceActivation ? 3 : sport === 'running' && squashPrimary ? 4 : fallbackRpe(sport, week),
    objective: raceActivation
      ? 'Activar timing y desplazamientos sin fatiga residual ni match-play adicional.'
      : fallbackObjective(sport, week),
    subtype,
    squashKind: raceActivation ? 'shadows' : undefined,
    runningType,
  }
}

function resolvePreferredTimeBlock(
  sport: SupportedSport,
  subtype: CoachSessionProposal['subtype'],
  fallback: Slot['timeBlock'],
): Slot['timeBlock'] {
  if (sport === 'strength') return 'AM'
  if (sport === 'squash' && (subtype === 'match' || subtype === 'competitive')) return 'PM'
  return fallback
}

export function buildDeterministicWeek(input: {
  plan: TrainingPlan
  week: TrainingPlanWeek
  previousWeek?: TrainingPlanWeek
  planWeekDescriptors: readonly PlanWeekDescriptor[]
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
}): RepairResult {
  const expected = getExpectedSessionsForPlanWeek(input.plan, input.week)
  const slots = buildSlots(input.plan, input.week, expected)
  const sports = buildSportSequence(input.plan, input.week, slots.length)
  const sportCounts = new Map<SupportedSport, number>()
  const seedSessions = slots.map((slot, index) => {
    const sport = slot.role === 'event_anchor' && getPrimarySport(input.plan) === 'squash'
      ? 'squash'
      : sports[index] ?? 'mobility'
    const sportIndex = sportCounts.get(sport) ?? 0
    sportCounts.set(sport, sportIndex + 1)
    return buildSeedSession(sport, slot, sportIndex, input.plan, input.week, input.wizardConfig)
  })

  return repairGeneratedWeek(seedSessions, {
    plan: input.plan,
    week: input.week,
    previousWeek: input.previousWeek,
    planWeekDescriptors: input.planWeekDescriptors,
    profile: input.profile,
    wizardConfig: input.wizardConfig,
  })
}

export const buildLocalFallbackWeek = buildDeterministicWeek
