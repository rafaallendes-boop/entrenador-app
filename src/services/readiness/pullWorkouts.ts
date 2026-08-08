import { db } from '../../db/db'
import type { WhoopWorkout } from '../../types'
import { getActiveAthleteId, getSwitchEpoch } from '../athlete/activeAthlete'
import { getSupabase } from '../sync/syncSupabase'
import { runAthleteWrite } from '../sync/athleteWriteLease'
import { normalizeWorkoutScoreData, WHOOP_WORKOUT_ZONE_COLUMNS } from './whoopZoneDurations'

const BASE_WORKOUT_COLUMNS = 'workout_id,athlete_id,date,sport_name,start_at,end_at,duration_min,strain,avg_hr,max_hr,distance_m,score_state,updated_at'
const WORKOUT_COLUMNS = [BASE_WORKOUT_COLUMNS, ...WHOOP_WORKOUT_ZONE_COLUMNS].join(',')

interface WhoopWorkoutRemoteRow {
  workout_id: string
  athlete_id: string
  date: string
  sport_name: string
  start_at: string
  end_at: string
  duration_min: number
  strain: number | null
  avg_hr: number | null
  max_hr: number | null
  distance_m: number | null
  score_state: string
  updated_at: number | null
  zone_zero_milli: number | null
  zone_one_milli: number | null
  zone_two_milli: number | null
  zone_three_milli: number | null
  zone_four_milli: number | null
  zone_five_milli: number | null
  percent_recorded: number | null
}

function optionalNumber(value: number | null): number | undefined {
  return value == null ? undefined : value
}

// Canonicalize Supabase timestamptz values before lexical window comparisons.
// At an equal instant, `+00:00` sorts before `.000Z`, so mixed encodings are not
// safe to compare directly.
function toCanonicalIso(value: string): string | null {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

function toWhoopWorkout(row: WhoopWorkoutRemoteRow): WhoopWorkout | null {
  const scoreState = row.score_state === 'SCORED'
    || row.score_state === 'PENDING_SCORE'
    || row.score_state === 'UNSCORABLE'
    ? row.score_state
    : null
  if (!scoreState) return null

  const startAt = toCanonicalIso(row.start_at)
  const endAt = toCanonicalIso(row.end_at)
  if (!startAt || !endAt) return null

  const scoreData = normalizeWorkoutScoreData({
    scoreState,
    zones: {
      z0: row.zone_zero_milli,
      z1: row.zone_one_milli,
      z2: row.zone_two_milli,
      z3: row.zone_three_milli,
      z4: row.zone_four_milli,
      z5: row.zone_five_milli,
    },
    percentRecorded: row.percent_recorded,
  })

  return {
    id: `whoop:${row.athlete_id}:${row.workout_id}`,
    workoutId: row.workout_id,
    athleteId: row.athlete_id,
    date: row.date,
    sportName: row.sport_name,
    startAt,
    endAt,
    durationMin: row.duration_min,
    strain: optionalNumber(row.strain),
    avgHr: optionalNumber(row.avg_hr),
    maxHr: optionalNumber(row.max_hr),
    distanceM: optionalNumber(row.distance_m),
    scoreState,
    // `...scoreData` es deliberado: propaga solo las claves presentes, así que un
    // workout sin zonas conserva los campos AUSENTES en Dexie en vez de
    // `undefined` explícito, y el round-trip de backup no gana claves vacías.
    ...scoreData,
    updatedAt: row.updated_at ?? Date.now(),
  }
}

export const WHOOP_WORKOUT_WINDOW_DAYS = 14

let pullChain: Promise<void> = Promise.resolve()

export function pullWorkouts(): Promise<void> {
  const athleteId = getActiveAthleteId()
  if (!athleteId) return Promise.resolve()
  const context = {
    athleteId,
    epochAtStart: getSwitchEpoch(),
    sinceIso: new Date(Date.now() - WHOOP_WORKOUT_WINDOW_DAYS * 86_400_000).toISOString(),
  }
  const pull = pullChain.then(() => pullWorkoutsOnce(context))
  pullChain = pull.catch(() => undefined)
  return pull
}

async function pullWorkoutsOnce(context: {
  athleteId: string
  epochAtStart: number
  sinceIso: string
}): Promise<void> {
  const { athleteId, epochAtStart, sinceIso } = context

  const { data, error } = await getSupabase()
    .from('whoop_workouts')
    .select(WORKOUT_COLUMNS)
    .eq('athlete_id', athleteId)
    .gte('start_at', sinceIso)

  if (error) throw new Error(`pullWorkouts: ${error.message ?? 'supabase error'}`)
  if (!data) throw new Error('pullWorkouts: respuesta remota sin data')
  if (getSwitchEpoch() !== epochAtStart || getActiveAthleteId() !== athleteId) {
    throw new Error('pullWorkouts: athlete switched mid-pull')
  }

  await runAthleteWrite(athleteId, async () => {
    // `as unknown as` y no `as` directo: el cliente de Supabase deriva el tipo de
    // la fila del literal que recibe `.select()`, y `WORKOUT_COLUMNS` se compone
    // en runtime desde `WHOOP_WORKOUT_ZONE_COLUMNS`, así que su tipo es `string`
    // y la inferencia cae a `GenericStringError[]`. Es el precio de tener una
    // sola lista de columnas en vez de un literal duplicado; la forma real de la
    // fila la declara `WhoopWorkoutRemoteRow` y la valida `toWhoopWorkout`, que
    // descarta cualquier fila que no cumpla.
    const rows = (data as unknown as WhoopWorkoutRemoteRow[])
      .map(toWhoopWorkout)
      .filter((row): row is WhoopWorkout => row != null)
    const remoteIds = new Set(rows.map((row) => row.id))

    const localInWindow = await db.whoopWorkouts
      .where('athleteId')
      .equals(athleteId)
      .filter((row) => row.startAt >= sinceIso)
      .toArray()
    const staleIds = localInWindow
      .filter((row) => !remoteIds.has(row.id))
      .map((row) => row.id)
    if (staleIds.length > 0) await db.whoopWorkouts.bulkDelete(staleIds)

    if (rows.length === 0) return
    const existing = await db.whoopWorkouts.bulkGet(rows.map((row) => row.id))
    const merged = rows.map((row, index) => {
      const prior = existing[index]
      return prior?.autoComplete ? { ...row, autoComplete: prior.autoComplete } : row
    })
    await db.whoopWorkouts.bulkPut(merged)
  })
}
