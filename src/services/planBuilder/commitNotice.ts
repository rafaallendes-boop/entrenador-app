export interface PlanCommitNotice {
  kind: 'lifecycle_sessions_removed'
  removedSessionCount: number
}

export interface WeekNavigationState {
  planCommitNotice?: PlanCommitNotice
  [key: string]: unknown
}

export function readPlanCommitNotice(state: unknown): PlanCommitNotice | null {
  if (!state || typeof state !== 'object') return null
  const notice = (state as WeekNavigationState).planCommitNotice
  if (
    notice?.kind !== 'lifecycle_sessions_removed'
    || !Number.isInteger(notice.removedSessionCount)
    || notice.removedSessionCount <= 0
  ) return null
  return notice
}

export function consumePlanCommitNoticeState(state: unknown): unknown {
  if (!state || typeof state !== 'object') return null
  const remaining: WeekNavigationState = { ...(state as WeekNavigationState) }
  delete remaining.planCommitNotice
  return Object.keys(remaining).length > 0 ? remaining : null
}
