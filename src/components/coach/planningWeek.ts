import { addDays, format, parseISO } from 'date-fns'
import type { Session, SessionStatus } from '../../types'

const STATUS_LABELS: Record<SessionStatus, string> = {
  planned: 'Planificada',
  completed: 'Completada',
  adjusted: 'Ajustada',
  skipped: 'Saltada',
}

export function sessionStatusLabel(status: SessionStatus): string {
  return STATUS_LABELS[status]
}

export function groupSessionsByDay(
  sessions: Session[],
  weekStartISO: string,
): Array<{ date: string; sessions: Session[] }> {
  const start = parseISO(weekStartISO)
  return Array.from({ length: 7 }, (_, index) => {
    const date = format(addDays(start, index), 'yyyy-MM-dd')
    return {
      date,
      sessions: sessions.filter((session) => session.date === date),
    }
  })
}
