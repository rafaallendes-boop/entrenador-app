import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { exportAppData, parseAppDataExport } from '../dataExport'

const seal = {
  policyVersion: 1,
  exerciseFingerprint: 'local-only',
  constraintFingerprint: 'local-only',
  userMessageConstraints: [],
}

function containsSeal(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSeal)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
    key === 'strengthSafetyFinalization' || containsSeal(item),
  )
}

function backupFixture() {
  return {
    app: 'RallyIQ', version: 4, exportedAt: '2026-09-01T00:00:00.000Z', exportedFromAppVersion: 'test',
    tables: {
      sessions: [{
        id: 'session-1', date: '2026-09-02', timeBlock: 'AM', source: 'coach', type: 'strength', status: 'planned',
        title: 'Fuerza', durationMin: 50, createdAt: 1, updatedAt: 2,
        metadata: { strengthSafetyFinalization: seal },
      }],
      dayLogs: [], weekSummaries: [], trainingPlans: [], trainingPlanWeeks: [], chatMessages: [], athleteProfiles: [], athletes: [],
      coachProposals: [{
        id: 'proposal-1', message: 'm', status: 'pending', createdAt: 1,
        actions: [{ type: 'add_session', reason: 'r', strengthSafetyFinalization: seal }],
      }],
      sessionTemplates: [{
        id: 'template-1', name: 'Fuerza', kind: 'session', payloadVersion: 1, createdAt: 1, updatedAt: 2,
        payload: { metadata: { strengthSafetyFinalization: seal }, nested: [{ strengthSafetyFinalization: seal }] },
      }],
    },
  }
}

describe('sellos de seguridad en import/export', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('no exporta un sello local, ni en metadata ni en payload de plantilla', async () => {
    await db.sessions.put({
      id: 'session-db', date: '2026-09-02', timeBlock: 'AM', source: 'coach', type: 'strength', status: 'planned',
      title: 'Fuerza', durationMin: 50, createdAt: 1, updatedAt: 2, metadata: { strengthSafetyFinalization: seal },
    } as never)
    await db.sessionTemplates.put({
      id: 'template-db', name: 'Fuerza', kind: 'session', payloadVersion: 1, createdAt: 1, updatedAt: 2,
      payload: { metadata: { strengthSafetyFinalization: seal } },
    } as never)

    const { json } = await exportAppData()
    expect(containsSeal(JSON.parse(json))).toBe(false)
  })

  it('invalida sellos de sesión, acciones y payloads al leer un backup', () => {
    const parsed = parseAppDataExport(backupFixture())
    expect(parsed.tables.sessions[0]?.metadata?.strengthSafetyFinalization).toBeUndefined()
    expect(parsed.tables.coachProposals[0]?.actions[0]?.strengthSafetyFinalization).toBeUndefined()
    expect(containsSeal(parsed.tables.sessionTemplates[0]?.payload)).toBe(false)
  })
})
