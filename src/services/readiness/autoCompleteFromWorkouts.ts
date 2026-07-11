import { db } from '../../db/db'
import { useTrainingStore } from '../../store/useTrainingStore'
import type { Session, WhoopWorkout, WhoopWorkoutAutoComplete } from '../../types'
import { getActiveAthleteId, getSelfAthleteId, getSwitchEpoch } from '../athlete/activeAthlete'
import { filterRowsToActiveScope } from '../athlete/activeScopeFilter'
import { buildWhoopCompletionNotes } from './whoopCompletionNotes'
import { WHOOP_WORKOUT_WINDOW_DAYS } from './pullWorkouts'
import { mapWhoopSport } from './whoopSportMap'

const MIN_WORKOUT_DURATION_MIN = 15
const MIN_WORKOUT_DURATION_MS = MIN_WORKOUT_DURATION_MIN * 60_000
const LOG_PREFIX = '[whoop:auto-complete]'

export function resolveAmbiguousMatch(
  workout: WhoopWorkout,
  candidates: Session[],
): Session | null {
  void workout
  void candidates
  return null
}

let runChain: Promise<void> = Promise.resolve()

export function autoCompleteFromWorkouts(): Promise<void> {
  const run = runChain.then(runMatcherOnce)
  runChain = run.catch(() => undefined)
  return run
}

async function runMatcherOnce(): Promise<void> {
  const selfAthleteId = getSelfAthleteId()
  if (!selfAthleteId || getActiveAthleteId() !== selfAthleteId) return

  const epochAtStart = getSwitchEpoch()
  const scopeStillSelf = () => (
    getSwitchEpoch() === epochAtStart && getActiveAthleteId() === selfAthleteId
  )
  const sinceIso = new Date(Date.now() - WHOOP_WORKOUT_WINDOW_DAYS * 86_400_000).toISOString()

  const workouts = (await db.whoopWorkouts.where('athleteId').equals(selfAthleteId).toArray())
    .filter((workout) => workout.startAt >= sinceIso)
  if (workouts.length === 0 || !scopeStillSelf()) return

  const markerRows = await db.sessions
    .filter((session) => session.autoCompletion != null)
    .toArray()
  if (!scopeStillSelf()) return

  const durableWorkoutIds = new Set(
    filterRowsToActiveScope(markerRows)
      .map((session) => session.autoCompletion?.workoutId)
      .filter((id): id is string => Boolean(id)),
  )
  const pending = workouts
    .filter((workout) => !durableWorkoutIds.has(workout.workoutId))
    .filter((workout) => workout.autoComplete == null || workout.autoComplete.status === 'no_session')
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.workoutId.localeCompare(b.workoutId))

  for (const workout of pending) {
    if (!scopeStillSelf()) return
    try {
      await processWorkout(workout, workouts, scopeStillSelf)
    } catch (error) {
      console.error(`${LOG_PREFIX} workout processing failed`, {
        workoutId: workout.workoutId,
        error,
      })
    }
  }
}

async function markWorkout(
  workout: WhoopWorkout,
  autoComplete: Omit<WhoopWorkoutAutoComplete, 'processedAt'>,
): Promise<void> {
  await db.whoopWorkouts.update(workout.id, {
    autoComplete: { ...autoComplete, processedAt: Date.now() },
  })
}

async function processWorkout(
  workout: WhoopWorkout,
  allWorkouts: WhoopWorkout[],
  scopeStillSelf: () => boolean,
): Promise<void> {
  console.info(`${LOG_PREFIX} Whoop workout detected`, {
    workoutId: workout.workoutId,
    sport: workout.sportName,
    date: workout.date,
  })

  const sport = mapWhoopSport(workout.sportName)
  if (!sport) {
    await markWorkout(workout, { status: 'unmapped_sport' })
    return
  }
  const startMs = Date.parse(workout.startAt)
  const endMs = Date.parse(workout.endAt)
  const measuredDurationMs = endMs - startMs
  const isShort = Number.isFinite(measuredDurationMs) && measuredDurationMs > 0
    ? measuredDurationMs < MIN_WORKOUT_DURATION_MS
    : workout.durationMin < MIN_WORKOUT_DURATION_MIN
  if (isShort) {
    await markWorkout(workout, { status: 'skipped_short' })
    return
  }

  console.info(`${LOG_PREFIX} Matching planned session...`)
  const dayRows = await db.sessions.where('date').equals(workout.date).toArray()
  if (!scopeStillSelf()) return
  const candidates = filterRowsToActiveScope(dayRows)
    .filter((session) => session.type === sport && session.status === 'planned')

  if (candidates.length === 0) {
    console.info(`${LOG_PREFIX} No planned session found`, { workoutId: workout.workoutId })
    await markWorkout(workout, { status: 'no_session' })
    return
  }

  const target = candidates.length === 1
    ? candidates[0]
    : resolveAmbiguousMatch(workout, candidates)
  if (!target) {
    console.info(`${LOG_PREFIX} Multiple candidate sessions. Skipping auto completion`, {
      workoutId: workout.workoutId,
      candidates: candidates.length,
    })
    await markWorkout(workout, { status: 'skipped_multiple' })
    return
  }

  console.info(`${LOG_PREFIX} Session matched`, {
    workoutId: workout.workoutId,
    sessionId: target.id,
  })
  const patch: Partial<Session> = {
    status: 'completed',
    actualDurationMin: workout.durationMin,
    autoCompletion: {
      source: 'whoop_workout',
      workoutId: workout.workoutId,
      completedAt: new Date().toISOString(),
    },
  }
  if (!target.completionNotes) {
    const notes = buildWhoopCompletionNotes(allWorkouts)
    if (notes) patch.completionNotes = notes
  }

  if (!scopeStillSelf()) return
  await useTrainingStore.getState().updateSession(target.id, patch)
  if (!scopeStillSelf()) return

  const confirmed = await db.sessions.get(target.id)
  if (!scopeStillSelf()) return
  if (confirmed?.status === 'completed' && confirmed.autoCompletion?.workoutId === workout.workoutId) {
    console.info(`${LOG_PREFIX} Session auto-completed`, {
      workoutId: workout.workoutId,
      sessionId: target.id,
    })
    await markWorkout(workout, { status: 'completed', sessionId: target.id })
  } else {
    console.warn(`${LOG_PREFIX} updateSession had no effect; leaving workout for retry`, {
      workoutId: workout.workoutId,
      sessionId: target.id,
    })
  }
}
