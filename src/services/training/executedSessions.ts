import type { Session, SessionStatus } from '../../types'

export function isExecutedStatus(status: SessionStatus): boolean {
  return status === 'completed' || status === 'adjusted'
}

type ExecutedRow = Pick<Session, 'status' | 'date' | 'timeBlock'>

function byRecency<T extends ExecutedRow>(sessions: T[]): T[] {
  return sessions.sort((a, b) => b.date.localeCompare(a.date) || (b.timeBlock ?? '').localeCompare(a.timeBlock ?? ''))
}

/** Reference is the target session/day, exclusive. Omit only for legacy callers
 * that already supplied a bounded history. This helper never reads the clock. */
export function getExecutedSessions<T extends ExecutedRow>(
  sessions: readonly T[], beforeDate?: string,
): T[] {
  return byRecency(sessions.filter(s => isExecutedStatus(s.status) && (!beforeDate || s.date < beforeDate)))
}

/** "Lo que el atleta ya hizo", inclusivo del día de referencia. Las lecturas de
 * historial —contexto del coach, adherencia— sí deben ver la sesión que se
 * completó hoy; sólo los llamadores prospectivos necesitan el corte exclusivo. */
export function getExecutedSessionsThrough<T extends ExecutedRow>(
  sessions: readonly T[], throughDate?: string,
): T[] {
  return byRecency(sessions.filter(s => isExecutedStatus(s.status) && (!throughDate || s.date <= throughDate)))
}
