import { describe, expect, it } from 'vitest'
import { buildScheduledNotifications } from '../notifications'
import type { NotificationPreferences } from '../notifications'
import type { MacroWeekCoherenceSummary, Session } from '../../types'

const ALL_ENABLED: NotificationPreferences = {
  sessionReminders: true,
  dailyCheckIn: true,
  weeklyPlanning: true,
  coachFollowUp: true,
  loadAlerts: true,
}

function makeSession(partial: Partial<Session> = {}): Session {
  return {
    id: partial.id ?? 'session-1',
    date: partial.date ?? '2026-04-08',
    timeBlock: partial.timeBlock ?? 'AM',
    type: partial.type ?? 'running',
    status: partial.status ?? 'planned',
    title: partial.title ?? 'Running Z2',
    durationMin: partial.durationMin ?? 45,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    ...partial,
  }
}

function makeCoherenceSummary(overrides?: Partial<MacroWeekCoherenceSummary>): MacroWeekCoherenceSummary {
  return {
    currentPhase: 'build',
    blockGoal: 'Subir especificidad de running',
    weeklyRule: 'running: calidad controlada',
    targetDistributionBySport: { running: 'primary' },
    actualDistributionBySport: { running: 1 },
    expectedSessionsBySport: { running: '3-5 sesiones' },
    coherenceStatus: 'warning',
    coherenceIssues: ['La semana no parece consistente con la fase build.'],
    ...overrides,
  }
}

describe('notifications', () => {
  it('builds session reminder notifications for planned sessions today', () => {
    const items = buildScheduledNotifications(
      [makeSession({ id: 's1', title: 'Tempo AM', timeBlock: 'AM' })],
      '2026-04-08',
      new Date('2026-04-08T08:00:00'),
      ALL_ENABLED,
    )

    expect(items.some((item) => item.category === 'session_reminders')).toBe(true)
    expect(items.find((item) => item.category === 'session_reminders')?.title).toBe('Sesion en 30 min')
  })

  it('adds a daily check-in notification when completed sessions are missing feedback', () => {
    const items = buildScheduledNotifications(
      {
        sessions: [makeSession({ status: 'completed', title: 'Squash match' })],
      },
      '2026-04-08',
      new Date('2026-04-08T18:00:00'),
      ALL_ENABLED,
    )

    const checkIn = items.find((item) => item.category === 'daily_checkin')
    expect(checkIn?.title).toBe('Cierra tu sesion de hoy')
  })

  it('adds weekly planning and coach follow-up nudges when the week has no plan or note', () => {
    const items = buildScheduledNotifications(
      {
        sessions: [],
        currentWeekSummary: {
          id: 'week-1',
          weekStartDate: '2026-04-06',
          totalSessions: 0,
          totalMinutes: 0,
          plannedSessions: 0,
          completedSessions: 0,
          plannedMinutes: 0,
          completedMinutes: 0,
          squashSessions: 0,
          runningSessions: 0,
          strengthSessions: 0,
        },
      },
      '2026-04-08',
      new Date('2026-04-08T09:00:00'),
      ALL_ENABLED,
    )

    expect(items.some((item) => item.category === 'weekly_planning')).toBe(true)
    expect(items.some((item) => item.category === 'coach_followup')).toBe(false)
  })

  it('adds a load alert when macro week coherence has warnings', () => {
    const items = buildScheduledNotifications(
      {
        sessions: [makeSession()],
        macroWeekCoherence: makeCoherenceSummary(),
      },
      '2026-04-08',
      new Date('2026-04-08T10:00:00'),
      ALL_ENABLED,
    )

    const loadAlert = items.find((item) => item.category === 'load_alerts')
    expect(loadAlert?.body).toContain('fase build')
  })

  it('respects disabled categories', () => {
    const items = buildScheduledNotifications(
      {
        sessions: [makeSession({ status: 'completed' })],
        macroWeekCoherence: makeCoherenceSummary(),
      },
      '2026-04-08',
      new Date('2026-04-08T10:00:00'),
      {
        ...ALL_ENABLED,
        dailyCheckIn: false,
        loadAlerts: false,
      },
    )

    expect(items.some((item) => item.category === 'daily_checkin')).toBe(false)
    expect(items.some((item) => item.category === 'load_alerts')).toBe(false)
  })
})
