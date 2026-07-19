import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hydrationMarks = vi.hoisted(() => new Set<string>())
const leaseMock = vi.hoisted(() => ({ veto: false, run: vi.fn() }))
const syncMocks = vi.hoisted(() => ({
  pushSessionForTarget: vi.fn(async () => {}),
  deleteSessionForTarget: vi.fn(async () => {}),
  rememberSessionDeleteTombstone: vi.fn(),
  pushWeekSummaryForAthlete: vi.fn(async () => {}),
}))

vi.mock('../../syncService', () => syncMocks)
vi.mock('../../sync/athleteWriteLease', () => ({
  runAthleteWrite: leaseMock.run.mockImplementation(
    async (_athleteId: string, operation: () => Promise<void>) => {
      if (leaseMock.veto) return false
      await operation()
      return true
    },
  ),
}))
vi.mock('../coachPlanningHydration', () => ({
  ensureWeekHydrated: vi.fn(async (owner: string, scope: { athleteId: string }, week: string) => {
    hydrationMarks.add(`${owner}:${scope.athleteId}:${week}`)
  }),
  isWeekHydrated: vi.fn((owner: string, athleteId: string, week: string) => (
    hydrationMarks.has(`${owner}:${athleteId}:${week}`)
  )),
}))

import { db } from '../../../db/db'
import type { Session } from '../../../types'
import { setSelfAthleteId } from '../activeAthlete'
import type { CoachSessionDraft } from '../coachSessionSerializer'
import * as hydration from '../coachPlanningHydration'
import {
  createSessionForAthlete,
  createSessionFromTemplateForAthlete,
  deleteSessionForAthlete,
  updateSessionForAthlete,
} from '../coachScopedWrites'

const owner = 'user-1'
const self = 'ath_user-1'
const managed = 'ath_m_a'
const now = Date.now()
const draft: CoachSessionDraft = {
  date: '2026-07-14',
  timeBlock: 'am',
  type: 'strength',
  title: ' Fuerza ',
  durationMin: 55,
  objective: ' Base ',
  exercises: [{ id: 'ex-1', name: ' Sentadilla ', sets: 3, reps: ' 8 ' }],
}
const templatePayload = {
  type: 'squash' as const,
  timeBlock: 'AM' as const,
  title: 'Drills',
  durationMin: 70,
  subtype: 'training' as const,
  squashDetails: {
    trainingFocus: 'technical' as const,
    drills: [{ name: 'boast-drive' }],
  },
}
const templateOverlay: CoachSessionDraft = {
  date: '2026-07-15', timeBlock: 'AM', type: 'squash', title: 'Desde plantilla',
  durationMin: 70, subtype: 'training',
}

function createFromTemplate(athleteId = managed) {
  return createSessionFromTemplateForAthlete(owner, athleteId, templatePayload, {
    date: '2026-07-15', overlayDraft: templateOverlay, originalsById: new Map(),
  })
}

function session(partial: Partial<Session> = {}): Session {
  return {
    id: 'session-1', athleteId: managed, date: '2026-07-14',
    weekStartDate: '2026-07-13', timeBlock: 'am', type: 'strength',
    status: 'planned', source: 'coach', authoredByRole: 'coach', title: 'Original',
    durationMin: 60, createdAt: now, updatedAt: now,
    ...partial,
  } as Session
}

describe('coach scoped writes', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    hydrationMarks.clear()
    leaseMock.veto = false
    setSelfAthleteId(self)
    db.close()
    await db.delete()
    await db.open()
    await db.athletes.bulkPut([
      {
        id: self, ownerAccountId: owner, linkedAccountId: owner,
        status: 'active', createdAt: now, updatedAt: now,
      },
      {
        id: managed, ownerAccountId: owner, linkedAccountId: null,
        status: 'active', createdAt: now, updatedAt: now,
      },
      {
        id: 'ath_archived', ownerAccountId: owner, linkedAccountId: null,
        status: 'archived', createdAt: now, updatedAt: now,
      },
    ])
  })

  afterEach(() => {
    setSelfAthleteId(null)
    db.close()
  })

  it('create usa el athleteId explícito, autoría y semana derivadas', async () => {
    const created = await createSessionForAthlete(owner, managed, draft)
    expect(created).toMatchObject({
      athleteId: managed,
      authoredByRole: 'coach',
      weekStartDate: '2026-07-13',
      source: 'coach',
      title: 'Fuerza',
    })
    expect((await db.sessions.get(created.id))?.athleteId).toBe(managed)
    expect(syncMocks.pushSessionForTarget).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id }),
      { kind: 'scoped', athleteId: managed },
    )
  })

  it('create del self estampa authoredByRole self aunque otro atleta esté activo', async () => {
    const created = await createSessionForAthlete(owner, self, draft)
    expect(created.authoredByRole).toBe('self')
    expect(created.athleteId).toBe(self)
  })

  it('create desde plantilla conserva contenido rico y garantías del core', async () => {
    const created = await createFromTemplate()
    expect(created).toMatchObject({
      athleteId: managed,
      authoredByRole: 'coach',
      status: 'planned',
      date: '2026-07-15',
      title: 'Desde plantilla',
    })
    expect(created.squashDetails?.drills).toEqual([{ name: 'boast-drive' }])
    expect(hydration.ensureWeekHydrated).toHaveBeenCalledWith(
      owner,
      { athleteId: managed, includeLegacy: false },
      '2026-07-13',
    )
    const summary = await db.weekSummaries.where('athleteId').equals(managed).first()
    expect(summary?.plannedSessions).toBe(1)
  })

  it('rechaza archivado, ajeno y sessionId de otro atleta sin mutar', async () => {
    await expect(createSessionForAthlete(owner, 'ath_archived', draft)).rejects.toThrow('archivado')
    await expect(createFromTemplate('ath_archived')).rejects.toThrow('archivado')
    await expect(createSessionForAthlete(owner, 'ath_missing', draft)).rejects.toThrow('roster')
    await db.sessions.put(session({ id: 'self-session', athleteId: self }))
    await expect(updateSessionForAthlete(owner, managed, 'self-session', { title: 'No' }))
      .rejects.toThrow('no pertenece')
    expect((await db.sessions.get('self-session'))?.title).toBe('Original')
  })

  it('update aplica el patch a la fila vigente, ignora campos prohibidos y renueva timestamp', async () => {
    await db.sessions.put(session())
    const patch = {
      title: ' Editada ',
      objective: undefined,
      id: 'otro-id',
      athleteId: self,
      status: 'completed',
    } as never
    const updated = await updateSessionForAthlete(owner, managed, 'session-1', patch)
    expect(updated).toMatchObject({
      id: 'session-1', athleteId: managed, status: 'planned', title: 'Editada',
      authoredByRole: 'coach', weekStartDate: '2026-07-13',
    })
    expect(updated.objective).toBeUndefined()
    expect(updated.updatedAt).toBeGreaterThan(now)
  })

  it('mover de fecha recalcula la semana original y la destino', async () => {
    await db.sessions.put(session())
    const updated = await updateSessionForAthlete(owner, managed, 'session-1', {
      date: '2026-07-21',
    })
    expect(updated.weekStartDate).toBe('2026-07-20')
    const summaries = await db.weekSummaries.where('athleteId').equals(managed).toArray()
    expect(summaries.map((row) => [row.weekStartDate, row.plannedSessions]).sort()).toEqual([
      ['2026-07-13', 0],
      ['2026-07-20', 1],
    ])
    expect(hydration.ensureWeekHydrated).toHaveBeenCalledWith(
      owner,
      { athleteId: managed, includeLegacy: false },
      '2026-07-20',
    )
  })

  it.each([
    ['create normal', () => createSessionForAthlete(owner, managed, draft)],
    ['create desde plantilla', () => createFromTemplate()],
  ])('revalida roster dentro de la transacción después de hidratar: %s', async (_label, create) => {
    vi.mocked(hydration.ensureWeekHydrated).mockImplementationOnce(async (user, scope, week) => {
      hydrationMarks.add(`${user}:${scope.athleteId}:${week}`)
      await db.athletes.update(managed, { status: 'archived' })
    })
    await expect(create()).rejects.toThrow('archivado')
    expect(await db.sessions.count()).toBe(0)
    expect(syncMocks.pushSessionForTarget).not.toHaveBeenCalled()
  })

  it('create desde plantilla respeta el veto del lease de borrado', async () => {
    leaseMock.veto = true
    await expect(createFromTemplate()).rejects.toThrow('siendo eliminado')
    expect(leaseMock.run).toHaveBeenCalledWith(managed, expect.any(Function))
    expect(await db.sessions.count()).toBe(0)
    expect(syncMocks.pushSessionForTarget).not.toHaveBeenCalled()
  })

  it('si se invalida la marca, rehidrata y reintenta antes de escribir', async () => {
    vi.mocked(hydration.isWeekHydrated).mockImplementationOnce(() => false)
    const created = await createSessionForAthlete(owner, managed, draft)
    expect(created.athleteId).toBe(managed)
    expect(hydration.ensureWeekHydrated).toHaveBeenCalledTimes(2)
    expect(await db.sessions.count()).toBe(1)
  })

  it('delete hace commit, tombstone y después push usando el target capturado', async () => {
    await db.sessions.put(session())
    const order: string[] = []
    syncMocks.rememberSessionDeleteTombstone.mockImplementation(() => { order.push('tombstone') })
    syncMocks.deleteSessionForTarget.mockImplementation(async () => { order.push('push') })

    await deleteSessionForAthlete(owner, managed, 'session-1')

    expect(await db.sessions.get('session-1')).toBeUndefined()
    expect(order).toEqual(['tombstone', 'push'])
    expect(syncMocks.deleteSessionForTarget).toHaveBeenCalledWith(
      'session-1',
      { kind: 'scoped', athleteId: managed },
    )
  })
})
