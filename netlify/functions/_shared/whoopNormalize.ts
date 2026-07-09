import type { WhoopRaw } from './whoopClient'
import {
  READINESS_METRIC_CLEAR,
  type BiometricReadingRow,
  type ReadinessRow,
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

function dayOf(value: unknown, timezoneOffset?: unknown): string | null {
  const raw = stringValue(value)
  if (!raw) return null
  const ms = new Date(raw).getTime()
  if (!Number.isFinite(ms)) return null
  return new Date(ms + parseTimezoneOffsetMs(timezoneOffset)).toISOString().slice(0, 10)
}

function cycleIdOf(value: JsonObject): string | null {
  return value.cycle_id != null ? String(value.cycle_id) : null
}

function bestCycleDay(cycle: JsonObject): string | null {
  return dayOf(cycle.end ?? cycle.created_at ?? cycle.start, cycle.timezone_offset)
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

  for (const item of raw.cycles) {
    const cycle = asObject(item)
    const rawId = cycle.id != null ? String(cycle.id) : null
    const date = bestCycleDay(cycle)
    if (rawId && date) cycleDayById.set(rawId, date)
  }

  for (const item of raw.recovery) {
    const rec = asObject(item)
    const score = asObject(rec.score)
    const cycleId = cycleIdOf(rec)
    const date = (cycleId ? cycleDayById.get(cycleId) : null)
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
    const date = (rawId ? cycleDayById.get(rawId) : null) ?? bestCycleDay(cycle)
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
