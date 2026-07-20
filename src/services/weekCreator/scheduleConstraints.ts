import type { CoachSessionProposal, DayOfWeek, TimeBlock } from '../../types'

export type DayScheduleConstraint = TimeBlock | 'unavailable' | undefined

const WEEKDAY_BY_INDEX: DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

const DAY_CONSTRAINT_LABELS: Record<DayOfWeek, string[]> = {
  monday: ['lunes', 'lun', 'monday'],
  tuesday: ['martes', 'mar', 'tuesday'],
  wednesday: ['miercoles', 'mie', 'wednesday'],
  thursday: ['jueves', 'jue', 'thursday'],
  friday: ['viernes', 'vie', 'friday'],
  saturday: ['sabados', 'sabado', 'sab', 'saturday'],
  sunday: ['domingos', 'domingo', 'dom', 'sunday'],
}

export interface ScheduleCapacityInput {
  trainingDays: DayOfWeek[]
  doubleSessionDays?: DayOfWeek[]
  allowDoubleSession: boolean
  scheduleConstraints?: string
}

export interface ScheduleCapacity {
  /** Days that can host at least one session. */
  trainingDays: DayOfWeek[]
  /** Days that can host a second session. */
  doubleSessionDays: DayOfWeek[]
  /** Total AM/PM blocks the configuration leaves usable. */
  capacity: number
}

/**
 * Single source of truth for how many blocks a schedule actually leaves open.
 * A day pinned to one block (only AM / only PM) can host a session but never a
 * double; an unavailable day hosts nothing. Callers that compute capacity by
 * hand drift from the preflight and either block a viable week or wave through
 * an impossible one.
 */
export function resolveScheduleCapacity(input: ScheduleCapacityInput): ScheduleCapacity {
  const trainingDays = input.trainingDays.filter((day) =>
    resolveDayScheduleConstraint(input.scheduleConstraints, day) !== 'unavailable')
  if (!input.allowDoubleSession) {
    return { trainingDays, doubleSessionDays: [], capacity: trainingDays.length }
  }

  // An empty `doubleSessionDays` means "any training day", so it has to be
  // materialized before filtering or the filter would widen it back out.
  const configured = (input.doubleSessionDays ?? []).length > 0
    ? (input.doubleSessionDays as DayOfWeek[])
    : trainingDays
  const doubleSessionDays = configured.filter((day) =>
    trainingDays.includes(day)
    && resolveDayScheduleConstraint(input.scheduleConstraints, day) == null)

  return {
    trainingDays,
    doubleSessionDays,
    capacity: trainingDays.length + doubleSessionDays.length,
  }
}

export function resolveDayScheduleConstraint(
  value: string | undefined,
  day: DayOfWeek,
): DayScheduleConstraint {
  const constraints = normalizeConstraintText(value)
  if (!constraints) return undefined

  const labels = DAY_CONSTRAINT_LABELS[day]
  if (hasDayScopedConstraint(constraints, labels, ['no disponible', 'sin disponibilidad'])) {
    return 'unavailable'
  }
  if (hasDayScopedConstraint(constraints, labels, ['solo am', 'solamente am', 'unicamente am'])) {
    return 'AM'
  }
  if (hasDayScopedConstraint(constraints, labels, ['solo pm', 'solamente pm', 'unicamente pm'])) {
    return 'PM'
  }
  return undefined
}

function hasDayScopedConstraint(
  constraints: string,
  dayLabels: string[],
  phrases: string[],
): boolean {
  return dayLabels.some((label) =>
    phrases.some((phrase) =>
      constraints.includes(`${phrase} ${label}`) ||
      constraints.includes(`${phrase} los ${label}`) ||
      constraints.includes(`${phrase} el ${label}`) ||
      constraints.includes(`${label} ${phrase}`) ||
      constraints.includes(`los ${label} ${phrase}`) ||
      constraints.includes(`el ${label} ${phrase}`),
    ),
  )
}

function normalizeConstraintText(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[,;.]+/g, ' | ')
    .replace(/[:()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function dayOfWeekFromIsoDate(date: string): DayOfWeek | undefined {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return undefined
  return WEEKDAY_BY_INDEX[parsed.getUTCDay()]
}

/**
 * Narrows a config to what the schedule constraints actually leave open, so
 * the repair pipeline reubicates to another date instead of flipping a session
 * back into a forbidden block. Shared by the Week Creator repair pass and the
 * Phase 3 local hydrator; keeping two copies let them drift apart.
 */
export function buildScheduleAwareConfig<T extends ScheduleCapacityInput>(config: T): T {
  const capacity = resolveScheduleCapacity(config)
  return {
    ...config,
    trainingDays: capacity.trainingDays,
    doubleSessionDays: capacity.doubleSessionDays,
    allowDoubleSession: capacity.doubleSessionDays.length > 0,
  }
}

/**
 * Moves sessions onto the block a day is pinned to (only AM / only PM).
 *
 * `skipOccupied` is for the post-repair pass: it must not manufacture a
 * collision the repair pipeline has already run past \u2014 leave that for
 * validation instead.
 */
export function alignSessionsToScheduleConstraints(
  sessions: CoachSessionProposal[],
  scheduleConstraints: string | undefined,
  options: { skipOccupied?: boolean } = {},
): { sessions: CoachSessionProposal[]; adjustedCount: number } {
  let adjustedCount = 0
  const occupied = new Set(sessions.map((session) => `${session.date}|${session.timeBlock}`))
  const aligned = sessions.map((session) => {
    const day = dayOfWeekFromIsoDate(session.date)
    if (!day) return session
    const constraint = resolveDayScheduleConstraint(scheduleConstraints, day)
    if (constraint !== 'AM' && constraint !== 'PM') return session
    if (session.timeBlock === constraint) return session
    if (options.skipOccupied && occupied.has(`${session.date}|${constraint}`)) return session
    occupied.delete(`${session.date}|${session.timeBlock}`)
    occupied.add(`${session.date}|${constraint}`)
    adjustedCount += 1
    return { ...session, timeBlock: constraint }
  })
  return { sessions: aligned, adjustedCount }
}
