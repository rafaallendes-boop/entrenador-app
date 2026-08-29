import { differenceInCalendarDays } from 'date-fns'
import type { AIRequestClass, ChatContext, DayLog, Session } from '../../types'
import { todayISO, toISO } from '../../utils/date'
import { getDayName } from './promptModules/shared'

const DEFAULT_MAX_RECENT_MESSAGES = 8
const DEFAULT_MAX_RECENT_MESSAGE_CHARS = 1400
const MAX_RECENT_MESSAGE_AGE_DAYS = 7
const MONTHS_SHORT_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DEFAULT_MAX_SESSION_LINES = 12
const DEFAULT_MAX_SESSION_CHARS = 3200
const DEFAULT_MAX_WEEK_LOGS = 5
const DEFAULT_MAX_WEEK_LOG_CHARS = 900
const MAX_ATHLETE_MEMORY_CHARS = 500

export function optimizeChatContext(context: ChatContext, requestClass?: AIRequestClass): ChatContext {
  const budget = getBudget(requestClass ?? inferRequestClassFromIntent(context.intent))
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
  const normalized = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const weekDayPattern = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoy|manana)\b/
  const planningVerbPattern = /\b(cr[eé]a(?:r|me)?|haz(?:me)?|arma(?:me)?|genera(?:r|me)?|planifica(?:r)?|organiza(?:r)?|programa(?:r)?)\b/
  const planningTargetPattern = /\b(semana|microciclo|plan(?:\s+de\s+entrenamiento)?|rutina)\b/
  const adjustmentVerbPattern = /\b(ajusta(?:r|me)?|ajustame|cambia(?:r|me)?|cambiame|cambie|modifica(?:r|me)?|modificame|mueve|mueveme|reordena(?:r|me)?|actualiza(?:r|me)?|quit(?:a|ar|ame)|borra(?:r|me)?|borrame|elimina(?:r|me)?|eliminame|saca(?:r|me)?|sacame|pon(?:er|me)?|agrega(?:r|me)?|reemplaza(?:r|me)?|reduce|baja|sube|incorpora)\b/
  const adjustmentTargetPattern = /\b(semana|sesion(?:es)?|entreno|entrenamiento|descanso|libre|off|plan|carga|running|squash|fuerza|cycling|ciclismo|movilidad)\b/
  const specificSessionPattern = /\b(sesion(?:es)?|entreno|entrenamiento|descanso|libre|off|running|squash|fuerza|cycling|ciclismo|movilidad|am|pm)\b/

  if (
    /\b(resumen\s+semanal|coach\s+note|resume\s+mi\s+semana|resumeme\s+la\s+semana|cierre\s+de\s+semana|balance\s+semanal)\b/.test(normalized)
  ) {
    return 'weekly_summary'
  }

  if (
    adjustmentVerbPattern.test(normalized)
    && (
      adjustmentTargetPattern.test(normalized)
      || weekDayPattern.test(normalized)
    )
  ) {
    return 'adjust_session'
  }

  if (
    planningVerbPattern.test(normalized)
    && weekDayPattern.test(normalized)
    && specificSessionPattern.test(normalized)
    && !planningTargetPattern.test(normalized)
  ) {
    return 'adjust_session'
  }

  if (
    (
      planningVerbPattern.test(normalized)
      && planningTargetPattern.test(normalized)
    )
    || /\b(plan\s+semanal|plan\s+para\s+esta\s+semana)\b/.test(normalized)
  ) {
    return 'plan_week'
  }

  return 'general_chat'
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

export function inferRequestClassFromIntent(intent: ChatContext['intent'] | undefined): AIRequestClass {
  switch (intent) {
    case 'plan_week':
    case 'adjust_session':
      return 'chat_action'
    case 'weekly_summary':
      return 'weekly_summary'
    default:
      return 'chat_general'
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
