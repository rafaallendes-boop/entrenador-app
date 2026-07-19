import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../syncService', () => ({
  pushAthlete: vi.fn(async () => {}),
  deleteManagedAthleteRemote: vi.fn(async () => 'deleted' as const),
  waitForInFlightAthleteOps: vi.fn(async () => {}),
  acquireAthleteDeletionBarrier: vi.fn(() => vi.fn()),
}))
vi.mock('../planBuilder/generationJobRunner', () => ({
  abortPlanGenerationForAthlete: vi.fn(async () => {}),
}))

import { db } from '../../db/db'
import { CHAT_SESSION_KEY } from '../../utils/chatSession'
import { deleteManagedAthletePermanently } from '../athlete/managedAthletes'
import { abortPlanGenerationForAthlete } from '../planBuilder/generationJobRunner'
import {
  clearAllAthleteDeleteTombstones,
  hasAthleteDeleteTombstone,
} from '../sync/athleteDeleteTombstones'
import { loadQueue, saveQueue } from '../sync/syncQueue'
import * as syncService from '../syncService'

const now = Date.now()
const archived = {
  id: 'ath_m_a',
  ownerAccountId: 'user-1',
  linkedAccountId: null,
  displayName: 'Ana',
  status: 'archived',
  createdAt: now,
  updatedAt: now,
}

class MemoryStorage implements Storage {
  private readonly state = new Map<string, string>()

  get length(): number { return this.state.size }
  clear(): void { this.state.clear() }
  getItem(key: string): string | null { return this.state.get(key) ?? null }
  key(index: number): string | null { return Array.from(this.state.keys())[index] ?? null }
  removeItem(key: string): void { this.state.delete(key) }
  setItem(key: string, value: string): void { this.state.set(key, value) }
}

function installLocalStorage(): void {
  Object.defineProperty(globalThis, 'Storage', { configurable: true, value: MemoryStorage })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
}

async function seedAthleteData(athleteId: string) {
  await db.sessions.put({ id: `s-${athleteId}`, athleteId, date: '2026-07-13', timeBlock: 'am', type: 'squash', status: 'planned', title: 'x', durationMin: 60, createdAt: now, updatedAt: now } as never)
  await db.dayLogs.put({ id: `d-${athleteId}`, athleteId, date: '2026-07-13', updatedAt: now } as never)
  await db.weekSummaries.put({ id: `w-${athleteId}`, athleteId, weekStartDate: '2026-07-13', updatedAt: now } as never)
  await db.chatMessages.put({ id: `c-${athleteId}`, athleteId, timestamp: now } as never)
  await db.coachProposals.put({ id: `p-${athleteId}`, athleteId, status: 'pending', createdAt: now } as never)
  await db.athleteProfiles.put({ id: `prof-${athleteId}`, athleteId, updatedAt: now } as never)
  await db.trainingPlans.put({ id: `tp-${athleteId}`, athleteId, status: 'active', startDate: '2026-07-01', updatedAt: now } as never)
  await db.trainingPlanWeeks.put({ id: `tpw-${athleteId}`, planId: `tp-${athleteId}`, athleteId, weekIndex: 0, weekStartDate: '2026-07-13', status: 'ready' } as never)
  await db.planGenerationJobs.put({ id: `job-${athleteId}`, planId: `tp-${athleteId}`, athleteId, status: 'cancelled', createdAt: now, updatedAt: now } as never)
  await db.readinessDaily.put({ id: `r-${athleteId}`, athleteId, date: '2026-07-13', source: 'whoop', updatedAt: now } as never)
  await db.whoopWorkouts.put({ id: `ww-${athleteId}`, athleteId, workoutId: `wk-${athleteId}`, date: '2026-07-13', updatedAt: now } as never)
  await db.athleteMemberships.put({ athleteId, accountId: 'user-1', role: 'coach', createdAt: now, updatedAt: now } as never)
  await db.athleteCoachNotes.put({ athleteId, updatedAt: now } as never)
}

describe('deleteManagedAthletePermanently', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    installLocalStorage()
    localStorage.clear()
    clearAllAthleteDeleteTombstones()
    db.close()
    await db.delete()
    await db.open()
    vi.clearAllMocks()
    vi.mocked(syncService.deleteManagedAthleteRemote).mockResolvedValue('deleted')
    vi.mocked(syncService.acquireAthleteDeletionBarrier).mockImplementation(() => vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  it('respeta el orden de Fase A y conserva el tombstone tras el éxito', async () => {
    await db.athletes.put(archived as never)
    const calls: string[] = []
    vi.mocked(syncService.acquireAthleteDeletionBarrier).mockImplementation(() => {
      calls.push('barrier')
      return vi.fn()
    })
    vi.mocked(abortPlanGenerationForAthlete).mockImplementation(async () => { calls.push('abort') })
    vi.mocked(syncService.waitForInFlightAthleteOps).mockImplementation(async () => { calls.push('wait') })
    vi.mocked(syncService.deleteManagedAthleteRemote).mockImplementation(async () => {
      calls.push('remote')
      return 'deleted'
    })

    await deleteManagedAthletePermanently('user-1', 'ath_m_a')

    expect(calls).toEqual(['barrier', 'abort', 'wait', 'remote'])
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
  })

  it('purga todas las tablas athlete-keyed sin tocar otro atleta y limpia su chat', async () => {
    await db.athletes.bulkPut([
      archived,
      { ...archived, id: 'ath_m_b', displayName: 'Beto', status: 'active' },
    ] as never)
    await seedAthleteData('ath_m_a')
    await seedAthleteData('ath_m_b')
    await db.sessionTemplates.put({
      id: 'template-1',
      name: 'Voleas',
      kind: 'session',
      payloadVersion: 1,
      payload: { type: 'squash', timeBlock: 'AM', title: 'Voleas', durationMin: 60 },
      createdAt: now,
      updatedAt: now,
    })
    localStorage.setItem(`${CHAT_SESSION_KEY}:ath_m_a`, 'chat-a')

    await deleteManagedAthletePermanently('user-1', 'ath_m_a')

    for (const table of [
      db.sessions,
      db.dayLogs,
      db.weekSummaries,
      db.chatMessages,
      db.coachProposals,
      db.athleteProfiles,
      db.trainingPlans,
      db.trainingPlanWeeks,
      db.planGenerationJobs,
      db.readinessDaily,
      db.whoopWorkouts,
    ]) {
      expect(await table.filter((row: { athleteId?: string }) => row.athleteId === 'ath_m_a').count()).toBe(0)
      expect(await table.filter((row: { athleteId?: string }) => row.athleteId === 'ath_m_b').count()).toBe(1)
    }
    expect(await db.athleteMemberships.where('athleteId').equals('ath_m_a').count()).toBe(0)
    expect(await db.athleteMemberships.where('athleteId').equals('ath_m_b').count()).toBe(1)
    expect(await db.athleteCoachNotes.get('ath_m_a')).toBeUndefined()
    expect(await db.athleteCoachNotes.get('ath_m_b')).toBeDefined()
    expect(await db.athletes.get('ath_m_a')).toBeUndefined()
    expect(await db.athletes.get('ath_m_b')).toBeDefined()
    expect(await db.sessionTemplates.get('template-1')).toBeDefined()
    expect(localStorage.getItem(`${CHAT_SESSION_KEY}:ath_m_a`)).toBeNull()
  })

  it('failed revierte su tombstone, conserva cola y datos, y libera barrera', async () => {
    await db.athletes.put(archived as never)
    await seedAthleteData('ath_m_a')
    saveQueue([{ userId: 'user-1', table: 'sessions', action: 'upsert', payload: { id: 's-ath_m_a', athlete_id: 'ath_m_a' }, enqueuedAt: now }] as never)
    const release = vi.fn()
    vi.mocked(syncService.acquireAthleteDeletionBarrier).mockReturnValue(release)
    vi.mocked(syncService.deleteManagedAthleteRemote).mockResolvedValue('failed')

    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).rejects.toThrow(/No se pudo eliminar/)

    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(false)
    expect(loadQueue()).toHaveLength(1)
    expect(await db.sessions.get('s-ath_m_a')).toBeDefined()
    expect(await db.athletes.get('ath_m_a')).toBeDefined()
    expect(release).toHaveBeenCalledOnce()
  })

  it('si el tombstone no persiste aborta antes de abort, drain y remoto', async () => {
    await db.athletes.put(archived as never)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })

    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).rejects.toThrow('quota')

    expect(abortPlanGenerationForAthlete).not.toHaveBeenCalled()
    expect(syncService.waitForInFlightAthleteOps).not.toHaveBeenCalled()
    expect(syncService.deleteManagedAthleteRemote).not.toHaveBeenCalled()
    expect(await db.athletes.get('ath_m_a')).toBeDefined()
  })

  it('si el rollback no puede limpiar informa que el atleta quedó bloqueado', async () => {
    await db.athletes.put(archived as never)
    await seedAthleteData('ath_m_a')
    vi.mocked(syncService.deleteManagedAthleteRemote).mockResolvedValue('failed')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {})

    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).rejects.toThrow(/desbloquear/)

    expect(await db.sessions.get('s-ath_m_a')).toBeDefined()
    expect(await db.athletes.get('ath_m_a')).toBeDefined()
  })

  it('durably_queued purga y conserva solo el delete canónico del atleta', async () => {
    await db.athletes.put(archived as never)
    await seedAthleteData('ath_m_a')
    saveQueue([
      { userId: 'user-1', table: 'sessions', action: 'upsert', payload: { id: 's-ath_m_a', athlete_id: 'ath_m_a' }, enqueuedAt: now },
      { userId: 'user-1', table: 'sessions', action: 'session_completion', payload: { p_session_id: 's-ath_m_a' }, enqueuedAt: now },
      { userId: 'user-1', table: 'athletes', action: 'delete', payload: { id: 'ath_m_a' }, enqueuedAt: now + 1 },
    ] as never)
    vi.mocked(syncService.deleteManagedAthleteRemote).mockResolvedValue('durably_queued')

    await deleteManagedAthletePermanently('user-1', 'ath_m_a')

    expect(loadQueue()).toEqual([
      expect.objectContaining({ table: 'athletes', action: 'delete', payload: { id: 'ath_m_a' } }),
    ])
    expect(await db.athletes.get('ath_m_a')).toBeUndefined()
  })

  it('un fallo dentro de la transacción revierte toda la purga local', async () => {
    await db.athletes.put(archived as never)
    await seedAthleteData('ath_m_a')
    const spy = vi.spyOn(db.whoopWorkouts, 'where').mockImplementation(() => { throw new Error('boom') })

    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).rejects.toThrow('boom')
    spy.mockRestore()

    expect(await db.sessions.get('s-ath_m_a')).toBeDefined()
    expect(await db.athleteProfiles.get('prof-ath_m_a')).toBeDefined()
    expect(await db.athletes.get('ath_m_a')).toBeDefined()
  })

  it('rechaza doble borrado concurrente, estado no archivado y atletas no elegibles', async () => {
    await db.athletes.put(archived as never)
    vi.mocked(syncService.acquireAthleteDeletionBarrier).mockReturnValueOnce(null)
    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).rejects.toThrow(/en curso/)

    await db.athletes.put({ ...archived, status: 'active' } as never)
    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).rejects.toThrow(/archivado/)
    await db.athletes.put({ ...archived, id: 'ath_m_c', linkedAccountId: 'user-9' } as never)
    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_c')).rejects.toThrow(/cuenta vinculada/)
  })

  it('es idempotente al repetir sobre un atleta ya borrado con tombstone', async () => {
    await db.athletes.put(archived as never)
    await deleteManagedAthletePermanently('user-1', 'ath_m_a')

    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).resolves.toBeUndefined()

    expect(syncService.deleteManagedAthleteRemote).toHaveBeenCalledTimes(1)
  })
})
