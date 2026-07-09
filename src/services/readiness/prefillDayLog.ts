import type { DayLog, ReadinessDaily } from '../../types'

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function prefillDayLog(
  existing: Partial<DayLog>,
  readiness: ReadinessDaily | undefined,
): { patch: Partial<DayLog>; prefillSource: NonNullable<DayLog['prefillSource']> } {
  const patch: Partial<DayLog> = {}
  const prefillSource: NonNullable<DayLog['prefillSource']> = {}
  if (!readiness) return { patch, prefillSource }

  if (isEmpty(existing.sleepHours) && readiness.sleepHours != null) {
    patch.sleepHours = readiness.sleepHours
    prefillSource.sleepHours = 'whoop'
  }
  if (isEmpty(existing.sleepQuality) && readiness.sleepPerformance != null) {
    patch.sleepQuality = clamp(Math.round(readiness.sleepPerformance / 20), 1, 5)
    prefillSource.sleepQuality = 'whoop'
  }
  if (isEmpty(existing.energyLevel) && readiness.recoveryScore != null) {
    patch.energyLevel = clamp(Math.round(readiness.recoveryScore / 10), 1, 10)
    prefillSource.energyLevel = 'whoop'
  }

  return { patch, prefillSource }
}
