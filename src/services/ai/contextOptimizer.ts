import type { ChatContext, DayLog, Session } from '../../types'
import { todayISO } from '../../utils/date'

const DEFAULT_MAX_RECENT_MESSAGES = 8
const DEFAULT_MAX_RECENT_MESSAGE_CHARS = 1400
const DEFAULT_MAX_SESSION_LINES = 12
const DEFAULT_MAX_SESSION_CHARS = 3200
const DEFAULT_MAX_WEEK_LOGS = 5
const DEFAULT_MAX_WEEK_LOG_CHARS = 900
const MAX_ATHLETE_MEMORY_CHARS = 500

export function optimizeChatContext(context: ChatContext): ChatContext {
  const budget = getBudget(context.intent)
  const plannedSessions = trimPlannedSessions(
    context.plannedSessions ?? inferPlannedSessions(context.recentSessions),
    budget.maxPlannedSessionLines,
    budget.maxPlannedSessionChars,
  )
  const historicalSessions = trimHistoricalSessions(
    context.historicalSessions ?? inferHistoricalSessions(context.recentSessions),
    budget.maxHistoricalSessionLines,
    budget.maxHistoricalSessionChars,
  )

  return {
    ...context,
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
  }
}

export function detectChatIntent(message: string): ChatContext['intent'] {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('resumen semanal') ||
    normalized.includes('coach note') ||
    normalized.includes('resume mi semana')
  ) {
    return 'weekly_summary'
  }

  if (
    normalized.includes('crea la semana') ||
    normalized.includes('crear semana') ||
    normalized.includes('plan semanal') ||
    normalized.includes('planifica la semana')
  ) {
    return 'plan_week'
  }

  if (
    normalized.includes('ajusta') ||
    normalized.includes('cambia') ||
    normalized.includes('modifica') ||
    normalized.includes('mueve') ||
    normalized.includes('actualiza')
  ) {
    return 'adjust_session'
  }

  return 'general_chat'
}

function trimRecentMessages(
  messages: ChatContext['recentMessages'] | undefined,
  maxRecentMessages: number,
  maxRecentMessageChars: number,
): ChatContext['recentMessages'] {
  if (!messages || messages.length === 0) return messages

  const selected: NonNullable<ChatContext['recentMessages']> = []
  let usedChars = 0

  for (const message of [...messages].reverse()) {
    const content = clipText(message.content, 260)
    const cost = content.length
    if (selected.length >= maxRecentMessages) break
    if (selected.length > 0 && usedChars + cost > maxRecentMessageChars) break
    selected.push({ role: message.role, content })
    usedChars += cost
  }

  return selected.reverse()
}

function trimPlannedSessions(
  sessions: Session[],
  maxSessionLines: number,
  maxSessionChars: number,
): Session[] {
  const prioritized = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))

  const selected: Session[] = []
  let usedChars = 0
  const seen = new Set<string>()

  for (const session of prioritized) {
    if (selected.length >= maxSessionLines) break
    if (seen.has(session.id)) continue
    const cost = estimateSessionCost(session)
    if (selected.length > 0 && usedChars + cost > maxSessionChars) break
      selected.push(session)
      seen.add(session.id)
      usedChars += cost
  }

  return selected
}

function trimHistoricalSessions(
  sessions: Session[],
  maxSessionLines: number,
  maxSessionChars: number,
): Session[] {
  const prioritized = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))

  const selected: Session[] = []
  let usedChars = 0
  const seen = new Set<string>()

  for (const session of prioritized) {
    if (selected.length >= maxSessionLines) break
    if (seen.has(session.id)) continue
    const cost = estimateSessionCost(session)
    if (selected.length > 0 && usedChars + cost > maxSessionChars) break
    selected.push(session)
    seen.add(session.id)
    usedChars += cost
  }

  return selected.sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
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

function getBudget(intent: ChatContext['intent']) {
  switch (intent) {
    case 'plan_week':
      return {
        maxRecentMessages: 4,
        maxRecentMessageChars: 700,
        maxPlannedSessionLines: 10,
        maxPlannedSessionChars: 2200,
        maxHistoricalSessionLines: 10,
        maxHistoricalSessionChars: 2600,
        maxWeekLogs: 4,
        maxWeekLogChars: 700,
      }
    case 'adjust_session':
      return {
        maxRecentMessages: 6,
        maxRecentMessageChars: 1000,
        maxPlannedSessionLines: 8,
        maxPlannedSessionChars: 1800,
        maxHistoricalSessionLines: 8,
        maxHistoricalSessionChars: 1800,
        maxWeekLogs: 3,
        maxWeekLogChars: 520,
      }
    case 'weekly_summary':
      return {
        maxRecentMessages: 2,
        maxRecentMessageChars: 300,
        maxPlannedSessionLines: 10,
        maxPlannedSessionChars: 2200,
        maxHistoricalSessionLines: 12,
        maxHistoricalSessionChars: 2600,
        maxWeekLogs: 7,
        maxWeekLogChars: 1300,
      }
    default:
      return {
        maxRecentMessages: DEFAULT_MAX_RECENT_MESSAGES,
        maxRecentMessageChars: DEFAULT_MAX_RECENT_MESSAGE_CHARS,
        maxPlannedSessionLines: DEFAULT_MAX_SESSION_LINES,
        maxPlannedSessionChars: DEFAULT_MAX_SESSION_CHARS,
        maxHistoricalSessionLines: DEFAULT_MAX_SESSION_LINES,
        maxHistoricalSessionChars: DEFAULT_MAX_SESSION_CHARS,
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
