import { describe, expect, it } from 'vitest'

import { parseAppDataExport } from '../dataExport'

describe('backup/import de procedencia de Plan Builder', () => {
  it('preserva planId y planWeekId en sesiones materializadas', () => {
    const backup = {
      app: 'RallyIQ',
      version: 4,
      exportedAt: '2026-08-13T12:00:00.000Z',
      exportedFromAppVersion: 'test',
      tables: {
        sessions: [{
          id: 'session-plan-1',
          athleteId: 'athlete-1',
          date: '2026-08-17',
          weekStartDate: '2026-08-17',
          timeBlock: 'AM',
          source: 'coach',
          planId: 'plan-1',
          planWeekId: 'plan-week-1',
          type: 'squash',
          status: 'planned',
          title: 'Control de profundidad',
          durationMin: 45,
          createdAt: 1,
          updatedAt: 2,
        }],
        dayLogs: [],
        readinessDaily: [],
        whoopWorkouts: [],
        weekSummaries: [],
        trainingPlans: [],
        trainingPlanWeeks: [],
        chatMessages: [],
        coachProposals: [],
        athleteProfiles: [],
        athletes: [],
        athleteCoachNotes: [],
        sessionTemplates: [],
      },
    }

    const first = parseAppDataExport(backup)
    expect(first.tables.sessions[0]).toMatchObject({
      planId: 'plan-1',
      planWeekId: 'plan-week-1',
    })

    const second = parseAppDataExport(JSON.parse(JSON.stringify(first)))
    expect(second.tables.sessions[0]).toMatchObject({
      planId: 'plan-1',
      planWeekId: 'plan-week-1',
    })
  })
})
