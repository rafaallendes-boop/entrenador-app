import Dexie, { type Table } from 'dexie'
import type { Session, DayLog, WeekSummary, ChatMessage, CoachProposal, AthleteProfile } from '../types'
import type { TrainingPlan, TrainingPlanWeek } from '../types/planBuilder'
import type { SyncDiagnosticEvent, SyncErrorLogEntry } from '../types/syncDiagnostics'
import { getOrCreateChatSessionId } from '../utils/chatSession'
import { toISO, getWeekStart, fromISO } from '../utils/date'

export class EntrenadorDB extends Dexie {
  sessions!: Table<Session>
  dayLogs!: Table<DayLog>
  weekSummaries!: Table<WeekSummary>
  chatMessages!: Table<ChatMessage>
  coachProposals!: Table<CoachProposal>
  athleteProfiles!: Table<AthleteProfile>
  trainingPlans!: Table<TrainingPlan>
  trainingPlanWeeks!: Table<TrainingPlanWeek>
  syncDiagnostics!: Table<SyncDiagnosticEvent, number>
  syncErrorLog!: Table<SyncErrorLogEntry, number>

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

    // v4 — historical schema step kept as a no-op to preserve user data
    // when upgrading from older local databases.
    this.version(4).stores({
      sessions:      'id, date, type, status, completedAt',
      dayLogs:       'id, &date',
      weekSummaries: 'id, &weekStartDate',
      chatMessages:  'id, timestamp',
    })

    // v5 — add chatSessionId index for multi-session chat support
    this.version(5).stores({
      sessions:      'id, date, type, status, completedAt',
      dayLogs:       'id, &date',
      weekSummaries: 'id, &weekStartDate',
      chatMessages:  'id, timestamp, chatSessionId',
    }).upgrade(async tx => {
      const currentSessionId = getOrCreateChatSessionId()
      await tx.table('chatMessages').toCollection().modify((message: Record<string, unknown>) => {
        if (typeof message.chatSessionId !== 'string' || !message.chatSessionId) {
          message.chatSessionId = currentSessionId
        }
      })
    })

    this.version(6).stores({
      sessions:       'id, date, type, status, completedAt',
      dayLogs:        'id, &date',
      weekSummaries:  'id, &weekStartDate',
      chatMessages:   'id, timestamp, chatSessionId',
      coachProposals: 'id, status, createdAt, resolvedAt, chatMessageId',
    })

    this.version(7).stores({
      sessions:        'id, date, type, status, completedAt',
      dayLogs:         'id, &date',
      weekSummaries:   'id, &weekStartDate',
      chatMessages:    'id, timestamp, chatSessionId',
      coachProposals:  'id, status, createdAt, resolvedAt, chatMessageId',
      athleteProfiles: 'id, updatedAt',
    })

    // v8 — add weekStartDate index on sessions for efficient week-based queries
    this.version(8).stores({
      sessions:        'id, date, weekStartDate, type, status, completedAt',
      dayLogs:         'id, &date',
      weekSummaries:   'id, &weekStartDate',
      chatMessages:    'id, timestamp, chatSessionId',
      coachProposals:  'id, status, createdAt, resolvedAt, chatMessageId',
      athleteProfiles: 'id, updatedAt',
    }).upgrade(tx => {
      return tx.table('sessions').toCollection().modify((session: Record<string, unknown>) => {
        if (!session.weekStartDate && typeof session.date === 'string') {
          try {
            session.weekStartDate = toISO(getWeekStart(fromISO(session.date as string)))
          } catch {
            // Leave undefined if date is malformed
          }
        }
      })
    })

    // v9 — add training plan entities owned by Plan Builder module
    this.version(9).stores({
      sessions:          'id, date, weekStartDate, type, status, completedAt',
      dayLogs:           'id, &date',
      weekSummaries:     'id, &weekStartDate',
      chatMessages:      'id, timestamp, chatSessionId',
      coachProposals:    'id, status, createdAt, resolvedAt, chatMessageId',
      athleteProfiles:   'id, updatedAt',
      trainingPlans:     'id, athleteId, goalEventId, status, startDate, updatedAt',
      trainingPlanWeeks: 'id, planId, weekStartDate, status, [planId+weekIndex]',
    })

    // v10 — add sync diagnostics + error log tables for observability.
    // These are local-only ring buffers; no Supabase sync.
    this.version(10).stores({
      sessions:          'id, date, weekStartDate, type, status, completedAt',
      dayLogs:           'id, &date',
      weekSummaries:     'id, &weekStartDate',
      chatMessages:      'id, timestamp, chatSessionId',
      coachProposals:    'id, status, createdAt, resolvedAt, chatMessageId',
      athleteProfiles:   'id, updatedAt',
      trainingPlans:     'id, athleteId, goalEventId, status, startDate, updatedAt',
      trainingPlanWeeks: 'id, planId, weekStartDate, status, [planId+weekIndex]',
      syncDiagnostics:   '++id, timestamp, kind, entity, status',
      syncErrorLog:      '++id, timestamp, entity, errorCategory',
    })
  }
}

export const db = new EntrenadorDB()
