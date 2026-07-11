import type { WhoopWorkout } from '../../types'
import { mapWhoopSport } from './whoopSportMap'

export function buildWhoopCompletionNotes(workouts: WhoopWorkout[]): string | undefined {
  const recent = [...workouts]
    .sort((a, b) => b.startAt.localeCompare(a.startAt) || b.workoutId.localeCompare(a.workoutId))
    .slice(0, 3)
  if (recent.length === 0) return undefined

  const parts = recent.map((workout) => (
    `${workout.date} ${mapWhoopSport(workout.sportName) ?? workout.sportName} ${workout.durationMin} min`
  ))
  return `Whoop: ultimos entrenamientos: ${parts.join('; ')}.`
}
