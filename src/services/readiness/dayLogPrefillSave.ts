import type { DayLog } from '../../types'

export type PrefillField = 'sleepHours' | 'sleepQuality' | 'energyLevel' | 'rpeActual'

export interface DayLogPrefillPatch {
  patch: Partial<DayLog>
  prefillSource: NonNullable<DayLog['prefillSource']>
}

export function buildDayLogSavePatch(
  patch: Partial<DayLog>,
  dayLog?: DayLog,
  editedPrefillFields: PrefillField[] = [],
): Partial<DayLog> {
  const persistedSource: NonNullable<DayLog['prefillSource']> = {
    ...(dayLog?.prefillSource ?? {}),
  }

  editedPrefillFields.forEach((field) => {
    delete persistedSource[field]
  })

  return {
    ...patch,
    prefillSource: Object.keys(persistedSource).length > 0
      ? persistedSource
      : undefined,
  }
}

export function hasDayLogPrefillPatch(prefill: DayLogPrefillPatch): boolean {
  return Object.keys(prefill.patch).length > 0
}

/** True when a check-in field was prefilled from Whoop (objective), not declared by the athlete. */
export function isWhoopPrefilled(
  log: { prefillSource?: DayLog['prefillSource'] },
  field: PrefillField,
): boolean {
  return log.prefillSource?.[field] === 'whoop'
}

/**
 * Initial value for a session's RPE slider. Falls back to the day's effort only when
 * there is exactly one completed session AND that effort was declared by the athlete.
 * A Whoop-prefilled effort (objective strain) must never seed Session.actualRpe, which
 * feeds ACWR/load — mirrors the exclusion in `collectActualRpeValues`.
 */
export function sessionRpeInitialValue(
  sessionActualRpe: number | null | undefined,
  dayLog: { rpeActual?: number | null; prefillSource?: DayLog['prefillSource'] } | undefined,
  completedSessionsCount: number,
): number | undefined {
  if (sessionActualRpe != null) return sessionActualRpe
  if (completedSessionsCount !== 1) return undefined
  if (dayLog?.rpeActual == null) return undefined
  if (isWhoopPrefilled(dayLog, 'rpeActual')) return undefined
  return dayLog.rpeActual
}

export function buildWhoopPrefillSavePatch(
  prefill: DayLogPrefillPatch,
  dayLog?: DayLog,
): Partial<DayLog> {
  const prefillSource: NonNullable<DayLog['prefillSource']> = {
    ...(dayLog?.prefillSource ?? {}),
    ...prefill.prefillSource,
  }

  return {
    ...prefill.patch,
    prefillSource: Object.keys(prefillSource).length > 0
      ? prefillSource
      : undefined,
  }
}

export function canAutoPersistWhoopPrefill(input: {
  date: string
  today: string
  activeAthleteId?: string | null
  selfAthleteId?: string | null
  readinessAthleteId?: string | null
}): boolean {
  return input.date === input.today
    && input.activeAthleteId != null
    && input.selfAthleteId != null
    && input.activeAthleteId === input.selfAthleteId
    && input.readinessAthleteId === input.activeAthleteId
}
