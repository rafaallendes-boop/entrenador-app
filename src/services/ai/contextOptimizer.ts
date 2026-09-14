import { differenceInCalendarDays } from 'date-fns'
import type { AIRequestClass, ChatContext, DayLog, MessageRole, Session, SessionType, TimeBlock } from '../../types'
import { todayISO, toISO } from '../../utils/date'
import { getDayName } from './promptModules/shared'
import { resolveChatRoute, type ChatRouteKind } from '../chatRouting'
import { captureFromChatContext } from './chatSourceCapture'
import type { MessageTargetResolution } from '../chat/messageTargets'

export interface PromptTargetRef {
  id: string
  date: string
  timeBlock: TimeBlock
  type: SessionType
  title: string
}

/**
 * Proyección para el prompt (B4). Nunca llega al postprocesador, a la
 * validación ni al resolver de objetivos: esos consumen el `ChatContext`
 * completo. Lleva la captura del dominio para que los resolvers de fuerza no
 * decidan sobre listas recortadas.
 */
export type PromptContext = ChatContext & {
  readonly projection: 'prompt'
  targetIndex?: PromptTargetRef[]
  overflowTargets?: PromptTargetRef[]
  targetDates?: string[]
}

const DEFAULT_MAX_RECENT_MESSAGES = 8
const DEFAULT_MAX_RECENT_MESSAGE_CHARS = 1400
const MAX_RECENT_MESSAGE_AGE_DAYS = 7
const MONTHS_SHORT_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DEFAULT_MAX_SESSION_LINES = 12
const DEFAULT_MAX_SESSION_CHARS = 3200
const DEFAULT_MAX_WEEK_LOGS = 5
const DEFAULT_MAX_WEEK_LOG_CHARS = 900
const MAX_ATHLETE_MEMORY_CHARS = 500

export function optimizeChatContext(
  context: ChatContext,
  requestClass?: AIRequestClass,
  targets?: MessageTargetResolution,
): PromptContext {
  const budget = getBudget(requestClass ?? inferRequestClassFromIntent(context.intent))
  const today = todayISO()
  const domainSessions = mergeUniqueSessions(context.recentSessions ?? [], context.plannedSessions ?? [], context.historicalSessions ?? [])
  const byId = new Map(domainSessions.map((session) => [session.id, session]))
  const resolvedTargets = targets?.kind === 'resolved' ? targets : undefined

  // I15: objetivos, luego vecinos, luego resto. Mismos valores de límites;
  // selectWithinBudget los aplica también a la primera sesión.
  const targetIds = resolvedTargets?.targets.map((target) => target.sessionId) ?? []
  const targetDates = new Set(resolvedTargets?.targets.map((target) => target.date) ?? [])
  const neighborIds = domainSessions
    .filter((session) => targetDates.has(session.date) && !targetIds.includes(session.id))
    .map((session) => session.id)
  const priorityIds = [...targetIds, ...neighborIds]
  const prioritySessions = priorityIds.map((id) => byId.get(id)).filter((session): session is Session => session != null)
  const isUpcoming = (session: Session) => session.status === 'planned' && session.date >= today

  // Un objetivo que no está en la lista de su categoría (p. ej. una sesión
  // omitida ayer) se agrega a su pool; entra al detalle sólo si cabe.
  const plannedSessions = trimPlannedSessions(
    mergeUniqueSessions(context.plannedSessions ?? inferPlannedSessions(context.recentSessions), prioritySessions.filter(isUpcoming)),
    budget.maxPlannedSessionLines,
    budget.maxPlannedSessionChars,
    priorityIds,
  )
  const historicalSessions = trimHistoricalSessions(
    mergeUniqueSessions(context.historicalSessions ?? inferHistoricalSessions(context.recentSessions), prioritySessions.filter((session) => !isUpcoming(session))),
    budget.maxHistoricalSessionLines,
    budget.maxHistoricalSessionChars,
    priorityIds,
  )
  const toRef = (sessionId: string): PromptTargetRef[] => {
    const session = byId.get(sessionId)
    return session ? [{ id: session.id, date: session.date, timeBlock: session.timeBlock, type: session.type, title: session.title }] : []
  }

  return {
    ...context,
    sourceCapture: captureFromChatContext(context),
    projection: 'prompt',
    recentSessions: mergeUniqueSessions(plannedSessions, historicalSessions),
    plannedSessions,
    historicalSessions,
    recentMessages: trimRecentMessages(
      context.recentMessages,
      budget.maxRecentMessages,
      budget.maxRecentMessageChars,
    ),
    weekDayLogs: trimWeekDayLogs(
      context.weekDayLogs,
      budget.maxWeekLogs,
      budget.maxWeekLogChars,
    ),
    athleteMemory: trimAthleteMemory(context.athleteMemory),
    ...(resolvedTargets
      ? {
          targetIndex: resolvedTargets.targets.flatMap((target) => toRef(target.sessionId)),
          overflowTargets: resolvedTargets.overflow.flatMap((target) => toRef(target.sessionId)),
          targetDates: resolvedTargets.dates,
        }
      : {}),
  }
}

/**
 * Turnos del DOMINIO: los mismos límites de cantidad y antigüedad que la
 * proyección, pero sin recortar caracteres. Una referencia posterior a los
 * primeros 260 caracteres de un turno ya no se pierde (F06).
 */
export function selectDomainRecentMessages(
  messages: ReadonlyArray<{ role: MessageRole; content: string; timestamp?: number }>,
  now: number,
): NonNullable<ChatContext['recentMessages']> {
  return messages
    .filter((message) => message.timestamp == null || differenceInCalendarDays(new Date(now), new Date(message.timestamp)) <= MAX_RECENT_MESSAGE_AGE_DAYS)
    .slice(-DEFAULT_MAX_RECENT_MESSAGES)
    .map((message) => (message.timestamp != null
      ? { role: message.role, content: message.content, timestamp: message.timestamp }
      : { role: message.role, content: message.content }))
}

/** Proyección del router único hacia el `intent` legacy de `ChatContext`. */
export function intentFromRoute(kind: ChatRouteKind): ChatContext['intent'] {
  switch (kind) {
    case 'weekly_summary': return 'weekly_summary'
    case 'week_creator': return 'plan_week'
    case 'chat_action': return 'adjust_session'
    case 'plan_builder_redirect':
    case 'chat_general':
    default:
      return 'general_chat'
  }
}

/**
 * Ya no tiene regex propias: es una proyección de `resolveChatRoute`, que es
 * la autoridad. Se conserva por compatibilidad con `ChatContext.intent`.
 */
export function detectChatIntent(message: string, context?: ChatContext): ChatContext['intent'] {
  return intentFromRoute(resolveChatRoute(message, context).kind)
}

function trimRecentMessages(
  messages: ChatContext['recentMessages'] | undefined,
  maxRecentMessages: number,
  maxRecentMessageChars: number,
): ChatContext['recentMessages'] {
  if (!messages || messages.length === 0) return messages

  const now = new Date()
  const todayIso = todayISO()
  const selected: NonNullable<ChatContext['recentMessages']> = []
  let usedChars = 0

  for (const message of [...messages].reverse()) {
    if (message.timestamp != null && differenceInCalendarDays(now, new Date(message.timestamp)) > MAX_RECENT_MESSAGE_AGE_DAYS) continue
    const content = labelPreviousDayMessage(clipText(message.content, 260), message.timestamp, todayIso)
    const cost = content.length
    if (selected.length >= maxRecentMessages) break
    if (selected.length > 0 && usedChars + cost > maxRecentMessageChars) break
    selected.push(message.timestamp != null
      ? { role: message.role, content, timestamp: message.timestamp }
      : { role: message.role, content })
    usedChars += cost
  }

  return selected.reverse()
}

/** Messages replayed from previous days get a date label so the model never treats their "hoy" as current. */
function labelPreviousDayMessage(content: string, timestamp: number | undefined, todayIso: string): string {
  if (timestamp == null) return content
  const messageDate = new Date(timestamp)
  const messageIso = toISO(messageDate)
  if (messageIso === todayIso) return content
  return `[${getDayName(messageIso)} ${MONTHS_SHORT_ES[messageDate.getMonth()]}] ${content}`
}

function trimPlannedSessions(
  sessions: Session[],
  maxSessionLines: number,
  maxSessionChars: number,
  priorityIds: readonly string[] = [],
): Session[] {
  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
  return sortChronologically(selectWithinBudget(prioritize(ordered, priorityIds), maxSessionLines, maxSessionChars))
}

function trimHistoricalSessions(
  sessions: Session[],
  maxSessionLines: number,
  maxSessionChars: number,
  priorityIds: readonly string[] = [],
): Session[] {
  const ordered = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
  return sortChronologically(selectWithinBudget(prioritize(ordered, priorityIds), maxSessionLines, maxSessionChars))
}

/** Los ids prioritarios primero, en su orden; el resto conserva el orden de la categoría. */
function prioritize(ordered: Session[], priorityIds: readonly string[]): Session[] {
  if (priorityIds.length === 0) return ordered
  const rank = new Map(priorityIds.map((id, index) => [id, index]))
  const first = ordered.filter((session) => rank.has(session.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  return [...first, ...ordered.filter((session) => !rank.has(session.id))]
}

/** Límites actuales, ahora estrictos también para la primera sesión. Omitir la que no cabe y seguir con otras; el índice conserva todo objetivo omitido. */
function selectWithinBudget(prioritized: Session[], maxSessionLines: number, maxSessionChars: number): Session[] {
  const selected: Session[] = []
  const seen = new Set<string>()
  let usedChars = 0
  for (const session of prioritized) {
    if (selected.length >= maxSessionLines) break
    if (seen.has(session.id)) continue
    const cost = estimateSessionCost(session)
    if (usedChars + cost > maxSessionChars) continue
    selected.push(session)
    seen.add(session.id)
    usedChars += cost
  }
  return selected
}

function sortChronologically(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

function trimWeekDayLogs(
  logs: DayLog[] | undefined,
  maxWeekLogs: number,
  maxWeekLogChars: number,
): DayLog[] | undefined {
  if (!logs || logs.length === 0) return logs

  const selected: DayLog[] = []
  let usedChars = 0

  for (const log of [...logs].reverse()) {
    const cost = estimateLogCost(log)
    if (selected.length >= maxWeekLogs) break
    if (selected.length > 0 && usedChars + cost > maxWeekLogChars) break
    selected.push(trimLog(log))
    usedChars += cost
  }

  return selected.reverse()
}

function trimAthleteMemory(memory?: string): string | undefined {
  if (!memory?.trim()) return undefined
  return clipText(memory.trim(), MAX_ATHLETE_MEMORY_CHARS)
}

export function inferRequestClassFromIntent(intent: ChatContext['intent'] | undefined): AIRequestClass {
  switch (intent) {
    case 'plan_week': return 'week_creator'
    case 'adjust_session': return 'chat_action'
    case 'weekly_summary': return 'weekly_summary'
    default: return 'chat_general'
  }
}

function getBudget(requestClass: AIRequestClass) {
  switch (requestClass) {
    case 'chat_action':
      return {
        maxRecentMessages: 4,
        maxRecentMessageChars: 700,
        maxPlannedSessionLines: 6,
        maxPlannedSessionChars: 1600,
        maxHistoricalSessionLines: 6,
        maxHistoricalSessionChars: 1600,
        maxWeekLogs: 2,
        maxWeekLogChars: 420,
      }
    case 'chat_general':
      return {
        maxRecentMessages: 4,
        maxRecentMessageChars: 680,
        maxPlannedSessionLines: 4,
        maxPlannedSessionChars: 1000,
        maxHistoricalSessionLines: 4,
        maxHistoricalSessionChars: 1000,
        maxWeekLogs: 1,
        maxWeekLogChars: 260,
      }
    case 'weekly_summary':
      return {
        maxRecentMessages: 2,
        maxRecentMessageChars: 300,
        maxPlannedSessionLines: 10,
        maxPlannedSessionChars: 2200,
        maxHistoricalSessionLines: 12,
        maxHistoricalSessionChars: 2600,
        maxWeekLogs: 4,
        maxWeekLogChars: 1200,
      }
    case 'week_creator':
    case 'plan_builder_week':
      return {
        maxRecentMessages: 0,
        maxRecentMessageChars: 0,
        maxPlannedSessionLines: DEFAULT_MAX_SESSION_LINES - 4,
        maxPlannedSessionChars: 1800,
        maxHistoricalSessionLines: DEFAULT_MAX_SESSION_LINES - 4,
        maxHistoricalSessionChars: 1800,
        maxWeekLogs: 2,
        maxWeekLogChars: 420,
      }
    case 'plan_builder_pair':
      return {
        maxRecentMessages: 0,
        maxRecentMessageChars: 0,
        maxPlannedSessionLines: DEFAULT_MAX_SESSION_LINES,
        maxPlannedSessionChars: 2600,
        maxHistoricalSessionLines: DEFAULT_MAX_SESSION_LINES - 2,
        maxHistoricalSessionChars: 2200,
        maxWeekLogs: 2,
        maxWeekLogChars: 420,
      }
    case 'import_extract':
    case 'coach_assistant_message':
      return {
        maxRecentMessages: 0,
        maxRecentMessageChars: 0,
        maxPlannedSessionLines: 0,
        maxPlannedSessionChars: 0,
        maxHistoricalSessionLines: 0,
        maxHistoricalSessionChars: 0,
        maxWeekLogs: 0,
        maxWeekLogChars: 0,
      }
    default:
      return {
        maxRecentMessages: DEFAULT_MAX_RECENT_MESSAGES,
        maxRecentMessageChars: DEFAULT_MAX_RECENT_MESSAGE_CHARS,
        maxPlannedSessionLines: DEFAULT_MAX_SESSION_LINES - 4,
        maxPlannedSessionChars: DEFAULT_MAX_SESSION_CHARS - 1400,
        maxHistoricalSessionLines: DEFAULT_MAX_SESSION_LINES - 4,
        maxHistoricalSessionChars: DEFAULT_MAX_SESSION_CHARS - 1400,
        maxWeekLogs: DEFAULT_MAX_WEEK_LOGS,
        maxWeekLogChars: DEFAULT_MAX_WEEK_LOG_CHARS,
      }
  }
}

function clipText(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

function inferPlannedSessions(sessions: Session[]): Session[] {
  return sessions.filter(session => session.status === 'planned' || session.date >= todayISO())
}

function inferHistoricalSessions(sessions: Session[]): Session[] {
  return sessions.filter(session => session.status !== 'planned' || session.date < todayISO())
}

function mergeUniqueSessions(...groups: Session[][]): Session[] {
  const merged = new Map<string, Session>()

  for (const session of groups.flat()) {
    merged.set(session.id, session)
  }

  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

function estimateSessionCost(session: Session): number {
  return [
    session.title,
    session.objective,
    session.notes,
    session.completionNotes,
    session.runningDetails?.targetPaceMin,
    session.runningDetails?.targetPaceMax,
    session.opponent,
    session.location,
    ...(session.exercises?.slice(0, 4).map(ex => `${ex.name} ${ex.sets}x${ex.reps}`) ?? []),
  ].filter(Boolean).join(' ').length + 80
}

function estimateLogCost(log: DayLog): number {
  return [
    log.sleepHours?.toString(),
    log.energyLevel?.toString(),
    log.painLevel?.toString(),
    log.rpeActual?.toString(),
    log.postSessionComment,
    log.generalNotes,
  ].filter(Boolean).join(' ').length + 40
}

function trimLog(log: DayLog): DayLog {
  return {
    ...log,
    postSessionComment: log.postSessionComment ? clipText(log.postSessionComment, 120) : undefined,
    generalNotes: log.generalNotes ? clipText(log.generalNotes, 120) : undefined,
    painNotes: log.painNotes ? clipText(log.painNotes, 80) : undefined,
  }
}
