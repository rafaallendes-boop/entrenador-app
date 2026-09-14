import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Session } from '../../../types'

vi.mock('../../syncService', () => ({
  pullSessionsForDateRange: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  pushSession: vi.fn(async () => {}),
  pushWeekSummary: vi.fn(async () => {}),
  pushDayLog: vi.fn(async () => {}),
}))

import { db } from '../../../db/db'
import { applyCreateWeek } from '../applyCreateWeek'
import { setActiveAthleteId, setSelfAthleteId } from '../../athlete/activeAthlete'
import { withActiveAthleteStamp } from '../../athlete/activeScopeFilter'
import { v4 as uuid } from '../../../utils/uuid'
import * as syncService from '../../syncService'

// CreateWeekStoreAdapter exige addSession + loadWeek (applyCreateWeek.ts:14-17).
// addSession imita a useTrainingStore.addSession post-Task-6b: persiste y estampa.
const storeAdapter = {
  loadWeek: vi.fn(async () => {}),
  addSession: vi.fn(async (partial: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = Date.now()
    const session = withActiveAthleteStamp({ ...partial, id: uuid(), createdAt: now, updatedAt: now }) as Session
    await db.sessions.add(session)
    return session
  }),
}

describe('applyCreateWeek no borra planned sessions de otro atleta', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    vi.clearAllMocks()
  })
  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('gestionado activo reemplaza SUS planned, no las del self en la misma semana', async () => {
    await db.sessions.bulkPut([
      { id: 'self-planned', athleteId: 'ath_self', date: '2026-07-06', timeBlock: 'PM', type: 'squash', status: 'planned', durationMin: 60, updatedAt: 1 },
      { id: 'managed-planned', athleteId: 'ath_m_1', date: '2026-07-06', timeBlock: 'PM', type: 'squash', status: 'planned', durationMin: 60, updatedAt: 1 },
    ] as never)
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')

    await applyCreateWeek({
      // El input usa sessionType (no type): ver el mapeo type: session.sessionType en applyCreateWeek.
      sessions: [{ date: '2026-07-06', sessionType: 'squash', title: 'Drills', timeBlock: 'AM', durationMin: 45 }] as never,
      athleteProfile: null,
      store: storeAdapter as never,
    })

    expect(await db.sessions.get('self-planned')).toBeDefined() // intocada
    expect(await db.sessions.get('managed-planned')).toBeUndefined() // reemplazada
    expect(vi.mocked(syncService.deleteSession)).not.toHaveBeenCalledWith('self-planned')
    expect(storeAdapter.addSession).toHaveBeenCalled() // la semana nueva sí se creó
  })

  it('describe solo historial en la ruta default que no preserva manuales planned', async () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId(null)
    await db.sessions.put({
      id: 'completed-slot',
      athleteId: 'ath_self',
      date: '2026-07-06',
      timeBlock: 'AM',
      type: 'squash',
      status: 'completed',
      durationMin: 60,
      updatedAt: 1,
    } as never)

    const result = await applyCreateWeek({
      sessions: [{ date: '2026-07-06', sessionType: 'squash', title: 'Drills', timeBlock: 'AM', durationMin: 45 }] as never,
      athleteProfile: null,
      store: storeAdapter as never,
    })

    expect(result.warnings).toContain('Se mantuvieron sesiones con historial en: 2026-07-06 AM')
    expect(result.warnings.join(' ')).not.toContain('manuales o con historial')
  })

  it('describe manuales o historial cuando la ruta preserva manuales planned', async () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId(null)
    await db.sessions.put({
      id: 'manual-slot',
      athleteId: 'ath_self',
      date: '2026-07-06',
      timeBlock: 'AM',
      source: 'manual',
      type: 'squash',
      status: 'planned',
      durationMin: 60,
      updatedAt: 1,
    } as never)

    const result = await applyCreateWeek({
      sessions: [{ date: '2026-07-06', sessionType: 'squash', title: 'Drills', timeBlock: 'AM', durationMin: 45 }] as never,
      athleteProfile: null,
      store: storeAdapter as never,
      preserveManualSessions: true,
    })

    expect(result.warnings).toContain('Se mantuvieron sesiones manuales o con historial en: 2026-07-06 AM')
    expect(await db.sessions.get('manual-slot')).toBeDefined()
  })

  it('prevalida seguridad antes de borrar la semana previa', async () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId(null)
    await db.sessions.put({
      id: 'existing-planned',
      athleteId: 'ath_self',
      date: '2026-07-06',
      weekStartDate: '2026-07-06',
      timeBlock: 'PM',
      type: 'strength',
      status: 'planned',
      title: 'Fuerza previa',
      durationMin: 60,
      createdAt: 1,
      updatedAt: 1,
    })

    await expect(applyCreateWeek({
      sessions: [{
        date: '2026-07-06', sessionType: 'strength', title: 'Fuerza nueva',
        timeBlock: 'AM', durationMin: 60,
      }],
      athleteProfile: {
        id: 'athlete', updatedAt: 1,
        recoveryProfile: { currentInjuries: 'me operaron hace dos semanas' },
      },
      store: storeAdapter,
    })).rejects.toThrow('No pude identificar la zona')

    expect(await db.sessions.get('existing-planned')).toBeDefined()
    expect(storeAdapter.addSession).not.toHaveBeenCalled()
    expect(syncService.deleteSession).not.toHaveBeenCalledWith('existing-planned')
  })
})
