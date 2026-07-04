import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../db'
import {
  getDayLog,
  getDayLogsForWeek,
  getWeekSummary,
  getAllWeekSummaries,
  getSessionsForWeek,
  getSessionsForDay,
  getHistoricalSessionsWindow,
  getMatchSessions,
  getAthleteProfile,
  upsertAthleteProfile,
} from '../queries'
import { ATHLETE_PROFILE_LOCAL_ID, setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import { withActiveAthleteStamp } from '../../services/athlete/activeScopeFilter'

const asManaged = () => {
  setSelfAthleteId('ath_self')
  setActiveAthleteId('ath_m_1')
}
const asSelf = () => {
  setSelfAthleteId('ath_self')
  setActiveAthleteId('ath_self')
}

describe('lecturas athlete-aware con política legacy self-only', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })
  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('getDayLog: managed activo NO adopta la fila legacy del owner', async () => {
    await db.dayLogs.put({ id: 'legacy', date: '2026-07-01', updatedAt: 1 } as never)
    asManaged()
    expect(await getDayLog('2026-07-01')).toBeUndefined()
    asSelf()
    expect((await getDayLog('2026-07-01'))?.id).toBe('legacy')
  })

  it('getDayLogsForWeek: managed activo no adopta legacy; self sí', async () => {
    await db.dayLogs.bulkPut([
      { id: 'scoped-m', athleteId: 'ath_m_1', date: '2026-06-29', updatedAt: 1 },
      { id: 'legacy', date: '2026-06-30', updatedAt: 1 },
    ] as never)
    asManaged()
    expect((await getDayLogsForWeek('2026-06-29')).map((r) => r.id)).toEqual(['scoped-m'])
    expect((await db.dayLogs.get('legacy'))?.athleteId).toBeUndefined() // no adoptada ni estampada
  })

  it('getWeekSummary: managed activo no ve la summary legacy', async () => {
    await db.weekSummaries.put({ id: 'legacy-w', weekStartDate: '2026-06-29', updatedAt: 1 } as never)
    asManaged()
    expect(await getWeekSummary('2026-06-29')).toBeUndefined()
    asSelf()
    expect((await getWeekSummary('2026-06-29'))?.id).toBe('legacy-w')
  })

  it('getSessionsForWeek / getSessionsForDay: scoped por atleta activo, legacy solo self', async () => {
    await db.sessions.bulkPut([
      { id: 's-m', athleteId: 'ath_m_1', date: '2026-06-29', type: 'squash', status: 'planned', durationMin: 60 },
      { id: 's-self', athleteId: 'ath_self', date: '2026-06-29', type: 'squash', status: 'planned', durationMin: 60 },
      { id: 's-legacy', date: '2026-06-30', type: 'running', status: 'planned', durationMin: 30 },
    ] as never)
    asManaged()
    expect((await getSessionsForWeek('2026-06-29')).map((s) => s.id)).toEqual(['s-m'])
    expect((await getSessionsForDay('2026-06-30')).map((s) => s.id)).toEqual([])
    asSelf()
    expect((await getSessionsForWeek('2026-06-29')).map((s) => s.id).sort()).toEqual(['s-legacy', 's-self'])
  })

  it('getAllWeekSummaries / getHistoricalSessionsWindow / getMatchSessions scoped', async () => {
    await db.weekSummaries.bulkPut([
      { id: 'w-m', athleteId: 'ath_m_1', weekStartDate: '2026-06-22', updatedAt: 1 },
      { id: 'w-legacy', weekStartDate: '2026-06-29', updatedAt: 1 },
    ] as never)
    await db.sessions.bulkPut([
      { id: 'h-m', athleteId: 'ath_m_1', date: '2026-06-01', type: 'squash', status: 'completed', durationMin: 60 },
      {
        id: 'h-legacy',
        date: '2026-06-02',
        type: 'squash',
        subtype: 'competitive',
        status: 'completed',
        durationMin: 60,
      },
    ] as never)
    asManaged()
    expect((await getAllWeekSummaries()).map((w) => w.id)).toEqual(['w-m'])
    expect((await getHistoricalSessionsWindow('2026-07-01')).map((s) => s.id)).toEqual(['h-m'])
    expect((await getMatchSessions()).map((s) => s.id)).toEqual([])
  })

  it('una sesión creada con gestionado activo queda visible en su scope de inmediato', async () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    const session = withActiveAthleteStamp({
      id: 's-new',
      date: '2026-07-06',
      type: 'squash',
      status: 'planned',
      durationMin: 45,
      weekStartDate: '2026-07-06',
      createdAt: 1,
      updatedAt: 1,
    } as { id: string; athleteId?: string })
    await db.sessions.add(session as never)
    expect((await getSessionsForWeek('2026-07-06')).map((s) => s.id)).toEqual(['s-new'])
  })

  it('regresión: sin atleta activo, comportamiento legacy intacto', async () => {
    await db.sessions.put({ id: 's1', date: '2026-06-29', type: 'squash', status: 'planned', durationMin: 60 } as never)
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    expect((await getSessionsForWeek('2026-06-29')).map((s) => s.id)).toEqual(['s1'])
  })
})

describe('perfil por atleta', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })
  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('self activo lee/escribe la fila default (compat)', async () => {
    asSelf()
    const created = await upsertAthleteProfile({ name: 'Rafa' })
    expect(created.id).toBe(ATHLETE_PROFILE_LOCAL_ID)
    expect((await getAthleteProfile())?.name).toBe('Rafa')
  })

  it('gestionado activo NO ve el perfil del self y crea su propia fila', async () => {
    asSelf()
    await upsertAthleteProfile({ name: 'Rafa' })

    asManaged()
    expect(await getAthleteProfile()).toBeUndefined()
    const managed = await upsertAthleteProfile({ name: 'Cliente 1' })
    expect(managed.id).toBe('ath_m_1')
    expect(managed.athleteId).toBe('ath_m_1')
    expect((await getAthleteProfile())?.name).toBe('Cliente 1')

    asSelf()
    expect((await getAthleteProfile())?.name).toBe('Rafa')
    expect(await db.athleteProfiles.count()).toBe(2)
  })

  it('sin atleta activo, comportamiento legacy intacto', async () => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    const created = await upsertAthleteProfile({ name: 'Legacy' })
    expect(created.id).toBe(ATHLETE_PROFILE_LOCAL_ID)
  })

  it('un patch con athleteId NO puede re-scopear el perfil', async () => {
    asSelf()
    const created = await upsertAthleteProfile({ name: 'Rafa', athleteId: 'ath_m_2' } as never)
    expect(created.athleteId).toBe('ath_self')

    const updated = await upsertAthleteProfile({ athleteId: 'ath_m_2' } as never)
    expect(updated.athleteId).toBe('ath_self')
    expect(updated.name).toBe('Rafa')
    expect(await db.athleteProfiles.count()).toBe(1)
  })
})
