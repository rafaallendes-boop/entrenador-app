import type { DayOfWeek, TimeBlock } from '../../types'

export type DayScheduleConstraint = TimeBlock | 'unavailable' | undefined

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
