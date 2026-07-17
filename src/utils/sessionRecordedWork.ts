import type { Session } from '../types'

/** Returns true when deleting the session would also delete recorded work. */
export function hasRecordedWork(session: Session): boolean {
  if (session.status === 'completed' || session.status === 'adjusted') return true
  if (session.completedAt != null) return true
  if (session.actualDurationMin != null) return true
  if (session.actualRpe != null) return true
  if (session.sessionFeedback != null) return true
  if (session.completionNotes != null && session.completionNotes.trim() !== '') return true
  if (session.autoCompletion != null) return true
  return session.exercises?.some((exercise) => exercise.completed === true) ?? false
}
