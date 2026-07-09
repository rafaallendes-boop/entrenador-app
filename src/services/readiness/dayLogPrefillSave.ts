import type { DayLog } from '../../types'

export type PrefillField = 'sleepHours' | 'sleepQuality' | 'energyLevel'

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
