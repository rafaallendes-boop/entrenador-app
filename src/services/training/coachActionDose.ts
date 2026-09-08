import { hasNeighboringHardSession, runningExposureInWeek } from './runningPolicy'
import type { CoachAction, ChatContext, Session } from '../../types'
import { finalizeSessionDose } from './sessionDoseFinalizer'

/** Last prospective dose check, after all content/type mutations. */
export function finalizeCoachActionDose(action: CoachAction, context: ChatContext, sessions: Session[]):
  { ok: true; action: CoachAction } | { ok: false; message: string } {
  if (action.type === 'shorten_session' || action.type === 'lengthen_session') {
    const current = sessions.find(s => s.id === action.sessionId)
    if (current?.status === 'planned' && (current.type === 'running' || current.type === 'squash')) {
      return finalizeCoachActionDose({ ...action, type: 'update_session' }, context, sessions)
    }
  }
  if (action.type === 'create_week' && action.sessions) {
    const proposals: NonNullable<CoachAction['sessions']> = []
    const prospectiveRows = action.sessions.map(s => ({ date: s.date, type: s.sessionType, status: 'planned' as const, rpe: s.rpe, subtype: s.subtype, runningDetails: s.runningType ? { runningType: s.runningType } : undefined }))
    for (const session of action.sessions) {
      const result = finalizeSessionDose(session, context.athleteProfile, { historicalSessions: sessions, neighboringHardSession: hasNeighboringHardSession(prospectiveRows.filter(s => s.date !== session.date || s.type !== session.sessionType), session.date), ...runningExposureInWeek([...sessions.filter(s => s.status !== 'planned'), ...proposals.map(s => ({ date: s.date, type: s.sessionType, status: 'planned' as const, durationMin: s.durationMin }))], session.date), runningAcwr: context.loadAnalytics?.runningAcwr })
      if (!result.ok) return result
      proposals.push(result.session)
    }
    return { ok: true, action: { ...action, sessions: proposals } }
  }
  const current = action.type === 'update_session' ? sessions.find(s => s.id === action.sessionId) ?? sessions.find(s => action.sessionId && s.id.startsWith(action.sessionId)) : undefined
  // Preserve historical/manual content for metadata-only updates.
  const changesDose = action.runningTemplateRef != null || action.newDurationMin != null || action.runningType != null || action.intervalStructure != null || action.squashDetails != null || action.newType != null
  if (action.type !== 'add_session' && !(action.type === 'update_session' && changesDose && current?.status === 'planned')) return { ok: true, action }
  const type = action.type === 'add_session' ? action.sessionType : action.newType ?? current?.type
  if (type !== 'running' && type !== 'squash') return { ok: true, action }
  const proposal = {
    date: action.targetDate ?? current?.date ?? '', timeBlock: action.timeBlock ?? current?.timeBlock ?? 'AM' as const,
    sessionType: type, title: action.title ?? action.newTitle ?? current?.title ?? '',
    durationMin: action.type === 'add_session' ? action.durationMin ?? 60 : action.newDurationMin ?? current?.durationMin ?? 60,
    runningType: action.runningType ?? current?.runningDetails?.runningType,
    targetPaceMin: action.targetPaceMin ?? current?.runningDetails?.targetPaceMin,
    targetPaceMax: action.targetPaceMax ?? current?.runningDetails?.targetPaceMax,
    runningTemplateRef: action.runningTemplateRef ?? current?.runningDetails?.templateRef,
    runningSelectionReason: action.runningSelectionReason ?? current?.runningDetails?.selectionReason,
    intervalStructure: action.intervalStructure ?? (action.runningTemplateRef ? undefined : current?.runningDetails?.intervalStructure),
    squashDetails: action.squashDetails ?? current?.squashDetails,
  }
  // A duration-only edit of an engine timed run can be re-budgeted locally.
  if (action.newDurationMin != null && !action.intervalStructure && proposal.intervalStructure?.blocks[0]?.notes?.includes('Incluido en el tiempo total.')) proposal.intervalStructure = undefined
  const result = finalizeSessionDose(proposal, context.athleteProfile, { historicalSessions: sessions, neighboringHardSession: hasNeighboringHardSession(sessions.filter(s => s.id !== current?.id), proposal.date), ...runningExposureInWeek(sessions.filter(s => s.id !== current?.id), proposal.date), runningAcwr: context.loadAnalytics?.runningAcwr })
  if (!result.ok) return result
  return { ok: true, action: { ...action, ...(action.type === 'add_session' ? { durationMin: result.session.durationMin } : { newDurationMin: result.session.durationMin }), runningType: result.session.runningType,
    targetPaceMin: result.session.targetPaceMin, targetPaceMax: result.session.targetPaceMax,
    ...(action.type === 'add_session' ? { title: result.session.title } : { newTitle: result.session.title }),
    runningTemplateRef: result.session.runningTemplateRef, runningSelectionReason: result.session.runningSelectionReason,
    intervalStructure: result.session.intervalStructure, squashDetails: result.session.squashDetails } }
}
