import { db } from '../../db/db'
import type { ReadinessDaily } from '../../types'
import { getActiveAthleteId } from '../athlete/activeAthlete'
import { getSupabase } from '../sync/syncSupabase'

interface ReadinessDailyRow {
  athlete_id: string
  date: string
  recovery_score: number | null
  hrv_ms: number | null
  rhr_bpm: number | null
  strain: number | null
  sleep_hours: number | null
  sleep_performance: number | null
  source: string | null
  updated_at: number | null
}

function optionalNumber(value: number | null): number | undefined {
  return value == null ? undefined : value
}

function toReadinessDaily(row: ReadinessDailyRow): ReadinessDaily {
  const source = row.source ?? 'whoop'
  return {
    id: `${source}:${row.athlete_id}:${row.date}`,
    athleteId: row.athlete_id,
    date: row.date,
    recoveryScore: optionalNumber(row.recovery_score),
    hrvMs: optionalNumber(row.hrv_ms),
    rhrBpm: optionalNumber(row.rhr_bpm),
    strain: optionalNumber(row.strain),
    sleepHours: optionalNumber(row.sleep_hours),
    sleepPerformance: optionalNumber(row.sleep_performance),
    source,
    updatedAt: row.updated_at ?? Date.now(),
  }
}

export async function pullReadiness(): Promise<void> {
  const athleteId = getActiveAthleteId()
  if (!athleteId) return

  const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await getSupabase()
    .from('readiness_daily')
    .select('athlete_id,date,recovery_score,hrv_ms,rhr_bpm,strain,sleep_hours,sleep_performance,source,updated_at')
    .eq('athlete_id', athleteId)
    .gte('date', since)

  if (error || !data) return

  const rows = (data as ReadinessDailyRow[]).map(toReadinessDaily)
  if (rows.length > 0) await db.readinessDaily.bulkPut(rows)
}
