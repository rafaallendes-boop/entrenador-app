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
  // "Esfuerzo" (final del día): Whoop strain (0-21) escalado a 1-10. Editable.
  // Strain es acumulativo, así que se refresca en cada sync mientras siga siendo
  // Whoop-sourced; nunca pisa un valor declarado a mano.
  if (readiness.strain != null) {
    const mapped = clamp(Math.round(readiness.strain / 2.1), 1, 10)
    const isManual = !isEmpty(existing.rpeActual) && existing.prefillSource?.rpeActual !== 'whoop'
    if (!isManual) {
      prefillSource.rpeActual = 'whoop'
      if (mapped !== existing.rpeActual) patch.rpeActual = mapped
    }
  }

  return { patch, prefillSource }
}
