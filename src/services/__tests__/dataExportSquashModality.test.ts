import { describe, expect, it } from 'vitest'

import { sessionToDraft } from '../athlete/coachSessionSerializer'
import { parseAppDataExport } from '../dataExport'

function mixedBackup() {
  return {
    app: 'Entrenador',
    version: 3,
    exportedAt: '2026-08-10T12:00:00.000Z',
    exportedFromAppVersion: 'legacy-test',
    tables: {
      sessions: [{
        id: 'mixed-session',
        date: '2026-08-10',
        weekStartDate: '2026-08-10',
        timeBlock: 'AM',
        source: 'coach',
        type: 'squash',
        status: 'planned',
        title: 'Sesión mixta histórica',
        durationMin: 45,
        subtype: 'control',
        createdAt: 1,
        updatedAt: 2,
        squashDetails: {
          trainingFocus: 'technical',
          sessionMode: 'drill_session',
          sessionKind: 'mixed',
          blocks: [{
            kind: 'shadows',
            drills: [{
              name: 'Ghosting 4 esquinas', durationMin: 10, executionMode: 'either',
            }],
          }, {
            kind: 'control',
            drills: [{
              name: 'Paralelas de derecha — 100', durationMin: 35, executionMode: 'solo',
            }],
          }],
        },
      }],
      dayLogs: [],
      weekSummaries: [],
      trainingPlans: [],
      trainingPlanWeeks: [],
      chatMessages: [],
      coachProposals: [],
      athleteProfiles: [],
    },
  }
}

describe('backup/import de modalidad squash', () => {
  it('conserva mixed, blocks y executionMode heredado y la sesión sigue editable', () => {
    const first = parseAppDataExport(mixedBackup())
    const session = first.tables.sessions[0]!

    expect(session.squashDetails).toMatchObject({
      sessionKind: 'mixed',
      blocks: [{ kind: 'shadows' }, { kind: 'control' }],
      drills: [
        { name: 'Ghosting 4 esquinas', executionMode: 'either' },
        { name: 'Paralelas de derecha — 100', executionMode: 'solo' },
      ],
    })
    expect(sessionToDraft(session).squashKind).toBe('control')

    const second = parseAppDataExport(JSON.parse(JSON.stringify(first)))
    expect(second.tables.sessions[0]!.squashDetails).toEqual(session.squashDetails)
  })
})
