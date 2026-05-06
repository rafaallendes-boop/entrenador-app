import type { ChatContext, CoachAction, Session, TimeBlock } from '../../types'
import { currentWeekStartISO } from '../../utils/date'
import type { CoachNormalizedResponse } from './types'

const WEEKDAYS = [
  { offset: 0, labels: ['lunes'] },
  { offset: 1, labels: ['martes'] },
  { offset: 2, labels: ['miercoles'] },
  { offset: 3, labels: ['jueves'] },
  { offset: 4, labels: ['viernes'] },
  { offset: 5, labels: ['sabado'] },
  { offset: 6, labels: ['domingo'] },
] as const

export function postProcessCoachActions(
  response: CoachNormalizedResponse,
  context: ChatContext,
  userMessage: string,
): CoachNormalizedResponse {
  if (response.requestClass !== 'chat_action' || !response.actions?.length) return response

  const normalizedMessage = normalizeText(userMessage)
  const resolvedDate = resolveWeekdayDate(normalizedMessage, context)
  const affectedSession = findAffectedSession(context, normalizedMessage, resolvedDate)
  const adjustmentIntent = isExistingSessionAdjustment(normalizedMessage)
  const sessions = getContextSessions(context)

  const actions = response.actions.map((action) => {
    const dateAligned = resolvedDate ? alignActionDate(action, resolvedDate) : action

    if (dateAligned.type === 'add_session' && adjustmentIntent && affectedSession) {
      return convertAddSessionToUpdateSession(dateAligned, affectedSession)
    }

    if (dateAligned.type === 'update_session' && affectedSession && !resolvesKnownSession(dateAligned.sessionId, sessions)) {
      return { ...dateAligned, sessionId: affectedSession.id }
    }

    return dateAligned
  })

  return { ...response, actions }
}

function alignActionDate(action: CoachAction, targetDate: string): CoachAction {
  if (action.type === 'add_session' || action.type === 'move_session' || action.type === 'insert_recovery') {
    return { ...action, targetDate }
  }

  if (action.type === 'create_week' && action.sessions) {
    return {
      ...action,
      sessions: action.sessions.map((session) => ({ ...session, date: targetDate })),
    }
  }

  return action
}

function convertAddSessionToUpdateSession(action: CoachAction, session: Session): CoachAction {
  const next: CoachAction = {
    type: 'update_session',
    sessionId: session.id,
    reason: action.reason,
  }

  if (action.title) next.newTitle = action.title
  if (action.objective) next.newObjective = action.objective
  if (action.durationMin != null) next.newDurationMin = action.durationMin
  if (action.rpe != null) next.newRpe = action.rpe
  if (action.sessionType && action.sessionType !== session.type) next.newType = action.sessionType
  if (action.subtype) next.subtype = action.subtype
  if (action.runningType) next.runningType = action.runningType
  if (action.targetPaceMin) next.targetPaceMin = action.targetPaceMin
  if (action.targetPaceMax) next.targetPaceMax = action.targetPaceMax
  if (action.targetHrMin != null) next.targetHrMin = action.targetHrMin
  if (action.targetHrMax != null) next.targetHrMax = action.targetHrMax
  if (action.intervalStructure) next.intervalStructure = action.intervalStructure
  if (action.cyclingDetails) next.cyclingDetails = action.cyclingDetails
  if (action.mobilityDetails) next.mobilityDetails = action.mobilityDetails
  if (action.squashDetails) next.squashDetails = action.squashDetails
  if (action.exercises) next.exercises = action.exercises
  if (action.warmup) next.warmup = action.warmup
  if (action.cooldown) next.cooldown = action.cooldown

  return next
}

function resolveWeekdayDate(normalizedMessage: string, context: ChatContext): string | undefined {
  const match = WEEKDAYS.find((day) => day.labels.some((label) => normalizedMessage.includes(label)))
  if (!match) return undefined
  return addDaysToISO(context.currentWeekSummary?.weekStartDate ?? currentWeekStartISO(), match.offset)
}

function findAffectedSession(
  context: ChatContext,
  normalizedMessage: string,
  resolvedDate: string | undefined,
): Session | undefined {
  const sessions = getContextSessions(context)
  const byId = sessions.find((session) => normalizedMessage.includes(session.id.slice(0, 8).toLowerCase()))
  if (byId) return byId

  if (!resolvedDate) return undefined
  const timeBlock = resolveTimeBlock(normalizedMessage)
  const candidates = sessions.filter((session) => {
    if (session.date !== resolvedDate) return false
    if (timeBlock && session.timeBlock !== timeBlock) return false
    return session.status !== 'skipped'
  })

  return candidates.length === 1 ? candidates[0] : undefined
}

function getContextSessions(context: ChatContext): Session[] {
  const merged = new Map<string, Session>()
  for (const session of context.recentSessions ?? []) merged.set(session.id, session)
  for (const session of context.plannedSessions ?? []) merged.set(session.id, session)
  for (const session of context.historicalSessions ?? []) merged.set(session.id, session)
  return [...merged.values()]
}

function resolvesKnownSession(sessionIdOrPrefix: string | undefined, sessions: Session[]): boolean {
  if (!sessionIdOrPrefix) return false
  if (sessionIdOrPrefix === 'ID_DE_8_CHARS') return false
  if (sessions.some((session) => session.id === sessionIdOrPrefix)) return true
  return sessions.filter((session) => session.id.startsWith(sessionIdOrPrefix)).length === 1
}

function resolveTimeBlock(normalizedMessage: string): TimeBlock | undefined {
  if (/\bpm\b/.test(normalizedMessage) || normalizedMessage.includes(' tarde')) return 'PM'
  if (/\bam\b/.test(normalizedMessage) || normalizedMessage.includes(' manana')) return 'AM'
  return undefined
}

function isExistingSessionAdjustment(normalizedMessage: string): boolean {
  return /\b(ajusta|ajustar|ajustame|cambia|cambiar|cambiame|modifica|modificar|actualiza|actualizar|reemplaza|reemplazar|edita|editar|baja|sube|mejora|hazla|hacerla)\b/.test(normalizedMessage)
}

function addDaysToISO(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day + days)
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}
