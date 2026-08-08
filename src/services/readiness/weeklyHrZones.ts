import type { WhoopWorkout } from '../../types'
import {
  HR_ZONE_KEYS,
  resolveHighZoneDurationMs,
  resolveHrCaptureState,
  type HrZoneKey,
} from './workoutMetrics'

export interface WeeklyHrZoneDay {
  date: string
  totalMs: number
  byZone: Record<HrZoneKey, number>
}

export interface WeeklyHrZoneSummary {
  days: WeeklyHrZoneDay[]
  workoutCount: number
  totalRecordedMs: number
  highZoneMs: number
  lowCaptureCount: number
  unknownCaptureCount: number
}

function emptyDay(date: string): WeeklyHrZoneDay {
  return {
    date,
    totalMs: 0,
    byZone: { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
  }
}

/**
 * Solo entrenamientos SCORED CON distribución participan de alguna cifra, ni
 * siquiera del conteo. Los minutos registrados se derivan de la suma de zonas y
 * no de `durationMin`, para que el titular y las columnas no puedan discrepar.
 */
export function buildWeeklyHrZoneSummary(
  workouts: WhoopWorkout[],
  weekDays: string[],
): WeeklyHrZoneSummary | null {
  const dayIndex = new Map(weekDays.map((date, index) => [date, index]))
  const days = weekDays.map(emptyDay)

  let workoutCount = 0
  let totalRecordedMs = 0
  let highZoneMs = 0
  let lowCaptureCount = 0
  let unknownCaptureCount = 0

  for (const workout of workouts) {
    const index = dayIndex.get(workout.date)
    if (index === undefined) continue

    const zones = workout.zoneDurations
    if (!zones || workout.scoreState !== 'SCORED') continue

    workoutCount += 1
    for (const key of HR_ZONE_KEYS) {
      days[index].byZone[key] += zones[key]
      days[index].totalMs += zones[key]
      totalRecordedMs += zones[key]
    }
    highZoneMs += resolveHighZoneDurationMs(workout) ?? 0

    const capture = resolveHrCaptureState(workout)
    if (capture?.kind === 'low') lowCaptureCount += 1
    if (capture?.kind === 'unknown') unknownCaptureCount += 1
  }

  return workoutCount === 0 ? null : {
    days, workoutCount, totalRecordedMs, highZoneMs, lowCaptureCount, unknownCaptureCount,
  }
}
