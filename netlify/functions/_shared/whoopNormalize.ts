import type { WhoopRaw } from './whoopClient'
import { normalizeWorkoutScoreData } from '../../../src/services/readiness/whoopZoneDurations'
import {
  READINESS_METRIC_CLEAR,
  type BiometricReadingRow,
  type ReadinessRow,
  type WorkoutRow,
} from './whoopSupabase'

type JsonObject = Record<string, unknown>
type ScoreState = 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE' | null

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' ? value as JsonObject : {}
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function scoreStateOf(value: JsonObject): ScoreState {
  const state = stringValue(value.score_state)
  return state === 'SCORED' || state === 'PENDING_SCORE' || state === 'UNSCORABLE' ? state : null
}

function parseTimezoneOffsetMs(value: unknown): number {
  const raw = stringValue(value)
  if (!raw || raw === 'Z') return 0
  const match = raw.match(/^([+-])(\d{2}):(\d{2})$/)
  if (!match) return 0
  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0
  return sign * ((hours * 60) + minutes) * 60_000
}

function dayOf(value: unknown, timezoneOffset?: unknown, shiftMs = 0): string | null {
  const raw = stringValue(value)
  if (!raw) return null
  const ms = new Date(raw).getTime()
  if (!Number.isFinite(ms)) return null
  return new Date(ms + shiftMs + parseTimezoneOffsetMs(timezoneOffset)).toISOString().slice(0, 10)
}

function cycleIdOf(value: JsonObject): string | null {
  return value.cycle_id != null ? String(value.cycle_id) : null
}

// A WHOOP cycle runs from sleep onset to the next sleep onset, so neither
// boundary lands on the cycle's waking day when the user falls asleep past
// local midnight. The reliable anchor is the wake time: the end of the main
// sleep that opens the cycle. Cycles without sleep data in the window shift
// the boundary toward the waking afternoon instead.
const WAKE_SHIFT_MS = 6 * 3_600_000

function fallbackCycleDay(cycle: JsonObject): string | null {
  if (stringValue(cycle.end)) return dayOf(cycle.end, cycle.timezone_offset, -WAKE_SHIFT_MS)
  return dayOf(cycle.created_at ?? cycle.start, cycle.timezone_offset, WAKE_SHIFT_MS)
}

function sleepMillis(stageSummary: JsonObject): number | null {
  const light = num(stageSummary.total_light_sleep_time_milli)
  const slowWave = num(stageSummary.total_slow_wave_sleep_time_milli)
  const rem = num(stageSummary.total_rem_sleep_time_milli)
  const staged = (light ?? 0) + (slowWave ?? 0) + (rem ?? 0)
  if (staged > 0) return staged

  const inBed = num(stageSummary.total_in_bed_time_milli)
  if (inBed == null) return null
  const awake = num(stageSummary.total_awake_time_milli) ?? 0
  const noData = num(stageSummary.total_no_data_time_milli) ?? 0
  return Math.max(0, inBed - awake - noData)
}

function roundedHours(ms: number | null): number | null {
  return ms == null ? null : Math.round((ms / 3_600_000) * 10) / 10
}

function getDay(byDay: Map<string, ReadinessRow>, date: string): ReadinessRow {
  const existing = byDay.get(date)
  if (existing) return existing
  const row = { date }
  byDay.set(date, row)
  return row
}

type ReadinessMetricKey = Exclude<keyof ReadinessRow, 'date'>

function clearMetricUnlessScored(row: ReadinessRow, key: ReadinessMetricKey): void {
  if (typeof row[key] !== 'number') row[key] = READINESS_METRIC_CLEAR
}

export function normalizeWhoop(raw: WhoopRaw): { readiness: ReadinessRow[]; readings: BiometricReadingRow[] } {
  const byDay = new Map<string, ReadinessRow>()
  const readings: BiometricReadingRow[] = []
  const cycleDayById = new Map<string, string>()
  const sleepDayById = new Map<string, string>()
  const earliestSleepEndByCycle = new Map<string, number>()

  for (const item of raw.sleep) {
    const sleep = asObject(item)
    if (bool(sleep.nap) === true) continue
    const end = stringValue(sleep.end)
    const day = dayOf(sleep.end, sleep.timezone_offset)
    if (!end || !day) continue
    const sleepId = sleep.id != null ? String(sleep.id) : null
    if (sleepId) sleepDayById.set(sleepId, day)
    const cycleId = cycleIdOf(sleep)
    if (!cycleId) continue
    const endMs = new Date(end).getTime()
    const previousEndMs = earliestSleepEndByCycle.get(cycleId)
    if (previousEndMs == null || endMs < previousEndMs) {
      earliestSleepEndByCycle.set(cycleId, endMs)
      cycleDayById.set(cycleId, day)
    }
  }

  for (const item of raw.cycles) {
    const cycle = asObject(item)
    const rawId = cycle.id != null ? String(cycle.id) : null
    if (!rawId || cycleDayById.has(rawId)) continue
    const date = fallbackCycleDay(cycle)
    if (date) cycleDayById.set(rawId, date)
  }

  for (const item of raw.recovery) {
    const rec = asObject(item)
    const score = asObject(rec.score)
    const cycleId = cycleIdOf(rec)
    const recSleepId = rec.sleep_id != null ? String(rec.sleep_id) : null
    const date = (cycleId ? cycleDayById.get(cycleId) : null)
      ?? (recSleepId ? sleepDayById.get(recSleepId) : null)
      ?? dayOf(rec.created_at ?? rec.updated_at ?? rec.start ?? rec.end, rec.timezone_offset)
    if (!date) continue

    const rawId = cycleId ?? stringValue(rec.sleep_id)
    const recordedAt = stringValue(rec.created_at) ?? stringValue(rec.updated_at) ?? `${date}T00:00:00.000Z`
    const scoreState = scoreStateOf(rec)
    if (scoreState === 'PENDING_SCORE') continue
    if (scoreState === 'UNSCORABLE') {
      const row = getDay(byDay, date)
      clearMetricUnlessScored(row, 'recoveryScore')
      clearMetricUnlessScored(row, 'hrvMs')
      clearMetricUnlessScored(row, 'rhrBpm')
      continue
    }

    const recoveryScore = num(score.recovery_score)
    const hrvMs = num(score.hrv_rmssd_milli)
    const rhrBpm = num(score.resting_heart_rate)
    if (recoveryScore == null && hrvMs == null && rhrBpm == null) continue

    const row = getDay(byDay, date)
    if (recoveryScore != null) row.recoveryScore = recoveryScore
    if (hrvMs != null) row.hrvMs = hrvMs
    if (rhrBpm != null) row.rhrBpm = rhrBpm

    if (recoveryScore != null) {
      readings.push({ source: 'whoop', metric: 'recovery', value: recoveryScore, recordedAt, rawId })
    }
    if (hrvMs != null) readings.push({ source: 'whoop', metric: 'hrv', value: hrvMs, recordedAt, rawId })
    if (rhrBpm != null) readings.push({ source: 'whoop', metric: 'rhr', value: rhrBpm, recordedAt, rawId })
  }

  for (const item of raw.sleep) {
    const sleep = asObject(item)
    if (bool(sleep.nap) === true) continue

    const score = asObject(sleep.score)
    const stageSummary = asObject(score.stage_summary)
    const cycleId = cycleIdOf(sleep)
    const date = (cycleId ? cycleDayById.get(cycleId) : null)
      ?? dayOf(sleep.end ?? sleep.created_at ?? sleep.start, sleep.timezone_offset)
    if (!date) continue

    const scoreState = scoreStateOf(sleep)
    if (scoreState === 'PENDING_SCORE') continue
    if (scoreState === 'UNSCORABLE') {
      const row = getDay(byDay, date)
      clearMetricUnlessScored(row, 'sleepHours')
      clearMetricUnlessScored(row, 'sleepPerformance')
      continue
    }

    const sleepHours = roundedHours(sleepMillis(stageSummary))
    const sleepPerformance = num(score.sleep_performance_percentage)
    if (sleepHours == null && sleepPerformance == null) continue

    const row = getDay(byDay, date)
    if (sleepHours != null) row.sleepHours = sleepHours
    if (sleepPerformance != null) row.sleepPerformance = sleepPerformance
    const recordedAt = stringValue(sleep.start) ?? stringValue(sleep.created_at) ?? `${date}T00:00:00.000Z`
    const rawId = sleep.id != null ? String(sleep.id) : null

    if (sleepHours != null) {
      readings.push({ source: 'whoop', metric: 'sleep_hours', value: sleepHours, recordedAt, rawId })
    }
    if (sleepPerformance != null) {
      readings.push({ source: 'whoop', metric: 'sleep_performance', value: sleepPerformance, recordedAt, rawId })
    }
  }

  for (const item of raw.cycles) {
    const cycle = asObject(item)
    const score = asObject(cycle.score)
    const rawId = cycle.id != null ? String(cycle.id) : null
    const date = (rawId ? cycleDayById.get(rawId) : null) ?? fallbackCycleDay(cycle)
    if (!date) continue

    const scoreState = scoreStateOf(cycle)
    if (scoreState === 'PENDING_SCORE') continue
    if (scoreState === 'UNSCORABLE') {
      const row = getDay(byDay, date)
      clearMetricUnlessScored(row, 'strain')
      continue
    }

    const strain = num(score.strain)
    if (strain == null) continue

    const row = getDay(byDay, date)
    row.strain = strain
    const recordedAt = stringValue(cycle.start) ?? stringValue(cycle.created_at) ?? `${date}T00:00:00.000Z`
    readings.push({ source: 'whoop', metric: 'strain', value: strain, recordedAt, rawId })
  }

  return { readiness: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)), readings }
}

export function normalizeWhoopSportName(value: unknown): string | null {
  const raw = stringValue(value)
  if (!raw) return null
  const cleaned = raw.toLowerCase().replace(/[\s_]+/g, ' ').trim()
  return cleaned || null
}

export function normalizeWorkouts(raw: WhoopRaw): WorkoutRow[] {
  const rows: WorkoutRow[] = []
  for (const item of raw.workouts ?? []) {
    const workout = asObject(item)
    const workoutId = stringValue(workout.id)
    const start = stringValue(workout.start)
    const end = stringValue(workout.end)
    const sportName = normalizeWhoopSportName(workout.sport_name)
    const scoreState = scoreStateOf(workout)
    const date = dayOf(workout.start, workout.timezone_offset)
    if (!workoutId || !start || !end || !sportName || !scoreState || !date) continue

    const startMs = new Date(start).getTime()
    const endMs = new Date(end).getTime()
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue

    const score = scoreState === 'SCORED' ? asObject(workout.score) : {}
    const rawZones = asObject(score.zone_durations)
    const scoreData = normalizeWorkoutScoreData({
      scoreState,
      zones: {
        z0: rawZones.zone_zero_milli,
        z1: rawZones.zone_one_milli,
        z2: rawZones.zone_two_milli,
        z3: rawZones.zone_three_milli,
        z4: rawZones.zone_four_milli,
        z5: rawZones.zone_five_milli,
      },
      percentRecorded: score.percent_recorded,
    })
    rows.push({
      workoutId,
      date,
      sportName,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      durationMin: Math.round((endMs - startMs) / 60_000),
      strain: num(score.strain),
      avgHr: num(score.average_heart_rate),
      maxHr: num(score.max_heart_rate),
      distanceM: num(score.distance_meter),
      scoreState,
      zoneDurations: scoreData.zoneDurations ?? null,
      percentRecorded: scoreData.percentRecorded ?? null,
    })
  }
  return rows.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.workoutId.localeCompare(b.workoutId))
}
