/**
 * Shared helpers used across per-sport prompt modules.
 */

import type { ChatContext, GoalEvent, Session, SupportedSport } from '../../../types'
import { isCompetitionSquashMatch } from '../../../utils/squash'
import { todayISO } from '../../../utils/date'
import { computeMacroPlan } from '../../macroPlan'
import { resolveGoalEventWindow } from '../../goalEventWindow'

// ─── Translation constants ──────────────────────────────────────────────────

export const SQUASH_SUBTYPE_ES: Record<string, string> = {
  training: 'entrenamiento', match: 'partido', competitive: 'competitivo',
  control: 'control', light: 'suave',
}
export const RUNNING_TYPE_ES: Record<string, string> = {
  z2: 'Z2 aeróbico', tempo: 'tempo', intervals: 'intervalos', long: 'long run',
}
export const SESSION_TYPE_ES: Record<string, string> = {
  squash: 'squash', running: 'running', strength: 'fuerza',
  mobility: 'movilidad', recovery: 'recuperación', nutrition: 'nutrición',
}
export const STATUS_ES: Record<string, string> = {
  planned: 'planificado', completed: 'completado', adjusted: 'ajustado', skipped: 'saltado',
}
export const DAY_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
export const DAY_FULL_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// ─── Session utilities ──────────────────────────────────────────────────────

export function getAllContextSessions(context: ChatContext): Session[] {
  const merged = new Map<string, Session>()

  for (const session of context.recentSessions ?? []) merged.set(session.id, session)
  for (const session of context.plannedSessions ?? []) merged.set(session.id, session)
  for (const session of context.historicalSessions ?? []) merged.set(session.id, session)

  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

export function getPlannedSessions(context: ChatContext): Session[] {
  if (context.plannedSessions && context.plannedSessions.length > 0) {
    return [...context.plannedSessions].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
  }

  const today = todayISO()
  return getAllContextSessions(context).filter(session => session.date >= today)
}

export function getHistoricalSessions(context: ChatContext): Session[] {
  if (context.historicalSessions && context.historicalSessions.length > 0) {
    return [...context.historicalSessions].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
  }

  const today = todayISO()
  return getAllContextSessions(context).filter(
    session => session.status !== 'planned' || session.date < today,
  )
}

// ─── Fatigue derivation (shared across all sports) ──────────────────────────

export function deriveFatigueLevel(context: ChatContext): number {
  const dayLog = context.dayLog
  if (!dayLog) return 4

  let score = 4
  if (dayLog.energyLevel != null && dayLog.energyLevel <= 3) score += 2
  else if (dayLog.energyLevel != null && dayLog.energyLevel <= 5) score += 1
  if (dayLog.painLevel != null && dayLog.painLevel >= 6) score += 3
  else if (dayLog.painLevel != null && dayLog.painLevel >= 3) score += 1
  if (dayLog.sleepHours != null && dayLog.sleepHours < 6) score += 2
  else if (dayLog.sleepHours != null && dayLog.sleepHours < 7) score += 1
  if (dayLog.rpeActual != null && dayLog.rpeActual >= 8) score += 2
  else if (dayLog.rpeActual != null && dayLog.rpeActual >= 6) score += 1

  return Math.max(1, Math.min(10, score))
}

// ─── Competition detection ──────────────────────────────────────────────────

export function findNextCompetitiveSession(
  sessions: Session[],
  today: string,
  sportFilter?: string,
): Session | undefined {
  return sessions
    .filter(session =>
      session.date >= today &&
      (session.type === 'squash' ? isCompetitionSquashMatch(session) : session.subtype === 'competitive') &&
      (sportFilter == null || session.type === sportFilter),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))[0]
}

export function getMacroPlan(context: ChatContext) {
  return computeMacroPlan(context.athleteProfile)
}

export function getMacroPlanSportDetail(context: ChatContext, sport: SupportedSport) {
  return getMacroPlan(context)?.sportDetails.find((detail) => detail.sport === sport)
}

// ─── Date / formatting helpers ──────────────────────────────────────────────

export function diffDays(fromISODate: string, toISODate: string): number | null {
  try {
    const from = new Date(`${fromISODate}T00:00:00`)
    const to = new Date(`${toISODate}T00:00:00`)
    const ms = to.getTime() - from.getTime()
    return Math.round(ms / (24 * 60 * 60 * 1000))
  } catch {
    return null
  }
}

export function addDaysToISO(isoDate: string, days: number): string {
  try {
    const [y, mo, d] = isoDate.split('-').map(Number)
    const date = new Date(y, mo - 1, d + days)
    const yy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    return `${yy}-${mm}-${dd}`
  } catch {
    return isoDate
  }
}

export function formatMin(min: number): string {
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

export function formatDateShort(iso: string): string {
  if (!iso) return ''
  try {
    const [y, mo, d] = iso.split('-').map(Number)
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
    return `${d} ${months[mo - 1]} ${y}`
  } catch {
    return iso
  }
}

export function getDayName(iso: string): string {
  try {
    const [y, mo, d] = iso.split('-').map(Number)
    const day = new Date(y, mo - 1, d).getDay()
    return `${DAY_ES[day]} ${d}`
  } catch {
    return iso
  }
}

export function getDayFullName(iso: string): string {
  try {
    const [y, mo, d] = iso.split('-').map(Number)
    const day = new Date(y, mo - 1, d).getDay()
    return DAY_FULL_ES[day]
  } catch {
    return iso
  }
}

export function buildWeekDatesList(weekStart: string): string {
  const lines = ['DÍAS DE LA SEMANA ACTUAL:']
  for (let i = 0; i < 7; i++) {
    const date = addDaysToISO(weekStart, i)
    const dayName = getDayFullName(date)
    lines.push(`  ${date} (${dayName})`)
  }
  return lines.join('\n')
}

/** Derives interval/VO2max pace from 5K time. */
export function deriveIntervalPace(fiveKTime: string): string {
  try {
    const parts = fiveKTime.split(':').map(Number)
    const totalSecs = parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1]
    const paceSecs = Math.round(totalSecs / 5)
    const m = Math.floor(paceSecs / 60)
    const s = paceSecs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  } catch {
    return '4:15'
  }
}

/** Adds `secs` seconds to a "M:SS" pace string. */
export function addSecsToPace(pace: string, secs: number): string {
  try {
    const [m, s] = pace.split(':').map(Number)
    const total = m * 60 + s + secs
    const mm = Math.floor(total / 60)
    const ss = total % 60
    return `${mm}:${ss.toString().padStart(2, '0')}`
  } catch {
    return pace
  }
}

export function formatMatchMeta(session: Session): string {
  if (!isCompetitionSquashMatch(session)) {
    return ''
  }

  const parts: string[] = []
  if (session.opponent) parts.push(`vs ${session.opponent}`)
  if (session.matchResult) parts.push(session.matchResult === 'win' ? 'ganó' : 'perdió')
  if (session.gamesWon != null || session.gamesLost != null) {
    parts.push(`games ${session.gamesWon ?? '?'}-${session.gamesLost ?? '?'}`)
  }
  if (session.location) parts.push(`en ${session.location}`)

  return parts.length > 0 ? ` · ${parts.join(' · ')}` : ''
}

export function scoreCompetitivePriority(session: Session, memory: string, today: string): number {
  let score = 0
  const daysAway = diffDays(today, session.date)
  const haystack = `${session.title} ${session.objective ?? ''} ${session.opponent ?? ''} ${session.notes ?? ''}`.toLowerCase()

  if (daysAway != null) {
    if (daysAway <= 1) score += 5
    else if (daysAway <= 3) score += 4
    else if (daysAway <= 5) score += 3
    else score += 1
  }

  if (session.type === 'squash') {
    if (session.subtype === 'competitive') score += 2
  } else if (session.subtype === 'competitive') {
    score += 2
  }
  if (session.opponent) score += 1

  const strongKeywords = ['torneo', 'liga', 'cuadro', 'final', 'semifinal', 'ranking', 'objetivo', 'importante']
  const mediumKeywords = ['match', 'partido', 'competencia', 'rival']

  if (strongKeywords.some(keyword => haystack.includes(keyword))) score += 3
  else if (mediumKeywords.some(keyword => haystack.includes(keyword))) score += 1

  if (memory) {
    if (session.opponent && memory.includes(session.opponent.toLowerCase())) score += 2
    if (strongKeywords.some(keyword => memory.includes(keyword) && haystack.includes(keyword))) score += 3
    if (memory.includes(session.date)) score += 2
  }

  return score
}

export function explainPrioritySignals(session: Session, memory: string, today: string): string[] {
  const reasons: string[] = []
  const daysAway = diffDays(today, session.date)
  const haystack = `${session.title} ${session.objective ?? ''} ${session.opponent ?? ''} ${session.notes ?? ''}`.toLowerCase()

  if (daysAway != null) {
    if (daysAway <= 1) reasons.push('muy cercana en el calendario')
    else if (daysAway <= 3) reasons.push('cercana en el calendario')
  }
  if (session.subtype === 'competitive') reasons.push('marcada como competitive')
  if (session.opponent) reasons.push(`rival definido: ${session.opponent}`)
  if (['torneo', 'liga', 'final', 'ranking', 'objetivo'].some(keyword => haystack.includes(keyword))) {
    reasons.push('titulo u objetivo con senal competitiva fuerte')
  }
  if (memory && session.opponent && memory.includes(session.opponent.toLowerCase())) {
    reasons.push('memoria reciente menciona el rival')
  }
  if (memory && memory.includes(session.date)) {
    reasons.push('memoria reciente menciona la fecha')
  }

  return reasons
}

/** Find next goal event for a specific sport */
export function getNextGoalEventForSport(
  context: ChatContext,
  sport: string,
): GoalEvent | undefined {
  const today = todayISO()
  return [...(context.athleteProfile?.goalEvents ?? [])]
    .filter((event) => resolveGoalEventWindow(event).endDate >= today && event.sport === sport)
    .sort((a, b) => {
      const left = resolveGoalEventWindow(a)
      const right = resolveGoalEventWindow(b)
      const leftActive = left.startDate <= today && left.endDate >= today
      const rightActive = right.startDate <= today && right.endDate >= today
      if (leftActive !== rightActive) return leftActive ? -1 : 1
      return left.startDate.localeCompare(right.startDate)
    })[0]
}
