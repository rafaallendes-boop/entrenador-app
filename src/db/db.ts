import Dexie, { type Table } from 'dexie'
import type { Session, DayLog, WeekSummary, ChatMessage } from '../types'

export class EntrenadorDB extends Dexie {
  sessions!: Table<Session>
  dayLogs!: Table<DayLog>
  weekSummaries!: Table<WeekSummary>
  chatMessages!: Table<ChatMessage>

  constructor() {
    super('EntrenadorDB')

    // v1 — original schema with completed: boolean
    this.version(1).stores({
      sessions:      'id, date, type, completed',
      dayLogs:       'id, &date',
      weekSummaries: 'id, &weekStartDate',
      chatMessages:  'id, timestamp',
    })

    // v2 — replace completed index with status
    this.version(2).stores({
      sessions:      'id, date, type, status',
      dayLogs:       'id, &date',
      weekSummaries: 'id, &weekStartDate',
      chatMessages:  'id, timestamp',
    }).upgrade(tx => {
      return tx.table('sessions').toCollection().modify((session: Record<string, unknown>) => {
        if (session.status == null) {
          session.status = session.completed ? 'completed' : 'planned'
        }
        delete session.completed
      })
    })

    this.version(3).stores({
      sessions:      'id, date, type, status, completedAt',
      dayLogs:       'id, &date',
      weekSummaries: 'id, &weekStartDate',
      chatMessages:  'id, timestamp',
    }).upgrade(tx => {
      return tx.table('sessions').toCollection().modify((session: Record<string, unknown>) => {
        if (session.status === 'completed' && session.completedAt == null) {
          session.completedAt = session.updatedAt ?? Date.now()
        }
      })
    })
  }
}

export const db = new EntrenadorDB()
