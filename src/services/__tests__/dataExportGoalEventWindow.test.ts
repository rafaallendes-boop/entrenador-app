import { describe, expect, it } from 'vitest'

import { parseAppDataExport } from '../dataExport'

function backupWithEvent(event: Record<string, unknown>) {
  return {
    app: 'Entrenador',
    version: 3,
    exportedAt: '2026-08-11T12:00:00.000Z',
    exportedFromAppVersion: 'legacy-test',
    tables: {
      sessions: [],
      dayLogs: [],
      weekSummaries: [],
      trainingPlans: [],
      trainingPlanWeeks: [],
      chatMessages: [],
      coachProposals: [],
      athleteProfiles: [{
        id: 'athlete-1',
        updatedAt: 1,
        goalEvents: [event],
        macroPlan: undefined as unknown,
      }],
    },
  }
}

const baseEvent = {
  id: 'evt-1',
  title: 'Nacional de squash',
  date: '2026-09-07',
  sport: 'squash',
  priority: 'primary',
}

describe('backup/import de la ventana del evento', () => {
  it('preserva término y día clave en un round-trip', () => {
    const parsed = parseAppDataExport(backupWithEvent({
      ...baseEvent,
      endDate: '2026-09-13',
      keyDate: '2026-09-10',
    }))
    const event = parsed.tables.athleteProfiles[0]!.goalEvents![0]!

    expect(event).toMatchObject({ endDate: '2026-09-13', keyDate: '2026-09-10' })

    const second = parseAppDataExport(JSON.parse(JSON.stringify(parsed)))
    expect(second.tables.athleteProfiles[0]!.goalEvents![0]).toEqual(event)
  })

  it('un backup antiguo sin campos nuevos sigue siendo un evento de un día', () => {
    const parsed = parseAppDataExport(backupWithEvent(baseEvent))
    const event = parsed.tables.athleteProfiles[0]!.goalEvents![0]!

    expect(event.date).toBe('2026-09-07')
    expect(event.endDate).toBeUndefined()
    expect(event.keyDate).toBeUndefined()
  })

  it('rechaza un término anterior al inicio en vez de importarlo', () => {
    expect(() => parseAppDataExport(backupWithEvent({
      ...baseEvent,
      endDate: '2026-09-01',
    }))).toThrow(/endDate/)
  })

  it('rechaza un día clave fuera de la ventana', () => {
    expect(() => parseAppDataExport(backupWithEvent({
      ...baseEvent,
      endDate: '2026-09-13',
      keyDate: '2026-09-20',
    }))).toThrow(/keyDate/)
  })

  it('preserva la ventana denormalizada del macroplan', () => {
    const backup = backupWithEvent({ ...baseEvent, endDate: '2026-09-13' })
    backup.tables.athleteProfiles[0]!.macroPlan = {
      goalEventId: 'evt-1',
      goalEventDate: '2026-09-07',
      goalEventEndDate: '2026-09-13',
      goalEventKeyDate: '2026-09-10',
      currentPhase: 'peak',
      weeksRemaining: 4,
      blockFocus: 'Afinar',
      headline: 'Afinar',
      timeline: [],
      computedAt: 1,
    }

    const parsed = parseAppDataExport(backup)
    const macroPlan = parsed.tables.athleteProfiles[0]!.macroPlan!

    expect(macroPlan).toMatchObject({
      goalEventDate: '2026-09-07',
      goalEventEndDate: '2026-09-13',
      goalEventKeyDate: '2026-09-10',
    })

    const second = parseAppDataExport(JSON.parse(JSON.stringify(parsed)))
    expect(second.tables.athleteProfiles[0]!.macroPlan).toEqual(macroPlan)
  })

  it('un macroplan antiguo sin ventana no inventa un término', () => {
    const backup = backupWithEvent(baseEvent)
    backup.tables.athleteProfiles[0]!.macroPlan = {
      goalEventId: 'evt-1',
      goalEventDate: '2026-09-07',
      currentPhase: 'peak',
      weeksRemaining: 4,
      blockFocus: 'Afinar',
      headline: 'Afinar',
      timeline: [],
      computedAt: 1,
    }

    const macroPlan = parseAppDataExport(backup).tables.athleteProfiles[0]!.macroPlan!
    expect(macroPlan.goalEventDate).toBe('2026-09-07')
    expect(macroPlan.goalEventEndDate).toBeUndefined()
    expect(macroPlan.goalEventKeyDate).toBeUndefined()
  })

  it('rechaza un término mal formado', () => {
    expect(() => parseAppDataExport(backupWithEvent({
      ...baseEvent,
      endDate: '13-09-2026',
    }))).toThrow(/endDate/)
  })

  it('rechaza una ventana denormalizada incoherente en el macroplan', () => {
    const backup = backupWithEvent(baseEvent)
    backup.tables.athleteProfiles[0]!.macroPlan = {
      goalEventId: 'evt-1',
      goalEventDate: '2026-09-07',
      goalEventEndDate: '2026-09-01',
      currentPhase: 'peak',
      weeksRemaining: 4,
      blockFocus: 'Afinar',
      headline: 'Afinar',
      timeline: [],
      computedAt: 1,
    }

    expect(() => parseAppDataExport(backup)).toThrow(/goalEventEndDate/)
  })
})
