import type { Session } from '../../types'
import { getRoleForAthlete } from '../athlete/membershipCache'

export interface MarkSessionDoneParams {
  p_session_id: string
  p_status: Session['status']
  p_updated_at: number
  p_completed_at: number | null
  p_actual_rpe: number | null
  p_actual_duration_min: number | null
  p_completion_notes: string | null
  p_session_feedback: Record<string, unknown> | null
}

export function buildMarkSessionDoneParams(session: Session): MarkSessionDoneParams {
  return {
    p_session_id: session.id,
    p_status: session.status,
    p_updated_at: session.updatedAt,
    p_completed_at: session.completedAt ?? null,
    p_actual_rpe: session.actualRpe ?? null,
    p_actual_duration_min: session.actualDurationMin ?? null,
    p_completion_notes: session.completionNotes ?? null,
    p_session_feedback: (session.sessionFeedback as Record<string, unknown> | undefined) ?? null,
  }
}

export async function shouldRouteSessionCompletionViaRpc(session: Session, accountId: string): Promise<boolean> {
  if (session.authoredByRole !== 'coach' || !session.athleteId) return false
  return (await getRoleForAthlete(accountId, session.athleteId)) === 'self'
}
