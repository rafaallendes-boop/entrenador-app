import { addDays } from 'date-fns'
import type { CoachAction, CoachSessionProposal } from '../../types'
import type { CoachNormalizedResponse, CreateWeekNormalizationDiagnostic } from '../ai/types'

export function isStrictISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

export function filterSessionsToWeek(
  sessions: CoachSessionProposal[],
  weekStartDate: string,
): CoachSessionProposal[] {
  const [y, m, d] = weekStartDate.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  // Seven calendar days, not 7*24h: a week containing a DST change is an hour
  // shorter or longer, and a fixed millisecond window pulled the next Monday in.
  const end = addDays(start, 7).getTime()
  const startTs = start.getTime()
  return sessions.filter((session) => {
    if (!isStrictISODate(session.date)) return false
    const [sy, sm, sd] = session.date.split('-').map(Number)
    const ts = new Date(sy, sm - 1, sd).getTime()
    return ts >= startTs && ts < end
  })
}

export function pickCreateWeekDiagnostic(
  normalized: Pick<CoachNormalizedResponse, 'meta'>,
  weekStartDate: string,
  action?: CoachAction,
): CreateWeekNormalizationDiagnostic | undefined {
  const diagnostics = normalized.meta?.createWeekDiagnostics
  if (!diagnostics || diagnostics.length === 0) return undefined

  if (action?.targetDate) {
    const exact = diagnostics.find((diagnostic) => diagnostic.targetDate === action.targetDate)
    if (exact) return exact
  }

  const byWeek = diagnostics.find((diagnostic) => diagnostic.targetDate === weekStartDate)
  if (byWeek) return byWeek

  return diagnostics.length === 1 ? diagnostics[0] : undefined
}

export function buildWeekRetryInstruction(
  previousError: string | undefined,
  targetWeekStart: string,
  expectedSessions: number,
  attempt: number,
): string | undefined {
  if (!previousError || attempt <= 1) return undefined
  if (attempt === 2) {
    return `${previousError} Corrige eso y devuelve exactamente una create_week con targetDate=${targetWeekStart} y ${expectedSessions} sesiones válidas.`
  }
  return `${previousError} Usa formato estricto: una sola create_week, targetDate=${targetWeekStart}, ${expectedSessions} sesiones, fechas dentro de esa semana y detalles obligatorios completos.`
}
