import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import * as syncService from '../../services/syncService'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import {
  getSessionsForWeek,
  getSessionsForWeekCore,
  recalculateWeekSummary,
  recalculateWeekSummaryCore,
  upsertWeekSummaryCore,
} from '../queries'
import type { Session } from '../../types'

const WEEK = '2026-07-13'

function session(partial: Partial<Session>): Session {
  return {
    id: 'session', date: '2026-07-14', timeBlock: 'AM', type: 'squash',
    status: 'completed', title: 'Sesión', durationMin: 60,
    createdAt: 1, updatedAt: 1, ...partial,
  } as Session
}

describe('week summary core con scope explícito', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_user-1')
    vi.spyOn(syncService, 'pushWeekSummary').mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('recalcula solo el resumen del gestionado', async () => {
    await db.sessions.bulkPut([
      session({ id: 's-m', athleteId: 'ath_m', durationMin: 45 }),
      session({ id: 's-self', athleteId: 'ath_user-1', durationMin: 90 }),
    ])
    const { summary, changed } = await recalculateWeekSummaryCore(
      { athleteId: 'ath_m', includeLegacy: false }, '2026-07-14',
    )
    expect(changed).toBe(true)
    expect(summary).toMatchObject({ athleteId: 'ath_m', completedMinutes: 45 })
    expect(await db.weekSummaries
      .where('[athleteId+weekStartDate]').equals(['ath_user-1', WEEK]).first()).toBeUndefined()
  })

  it('no emite pushes desde el núcleo', async () => {
    await db.sessions.put(session({ id: 's-m', athleteId: 'ath_m' }))
    await recalculateWeekSummaryCore({ athleteId: 'ath_m', includeLegacy: false }, '2026-07-14')
    expect(syncService.pushWeekSummary).not.toHaveBeenCalled()
  })

  it('adopta legacy solo cuando includeLegacy está habilitado', async () => {
    await db.sessions.put(session({ id: 's-legacy', athleteId: undefined }))
    expect((await getSessionsForWeekCore(
      { athleteId: 'ath_user-1', includeLegacy: true }, WEEK,
    )).map((row) => row.id)).toContain('s-legacy')
    expect(await getSessionsForWeekCore({ athleteId: 'ath_m', includeLegacy: false }, WEEK)).toHaveLength(0)
  })

  it('devuelve changed=false cuando no hay cambios significativos', async () => {
    const scope = { athleteId: 'ath_m', includeLegacy: false }
    expect((await upsertWeekSummaryCore(scope, WEEK, { totalSessions: 1 })).changed).toBe(true)
    expect((await upsertWeekSummaryCore(scope, WEEK, { totalSessions: 1 })).changed).toBe(false)
  })

  it('genera updatedAt monotónico con reloj congelado', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const scope = { athleteId: 'ath_m', includeLegacy: false }
    const first = await upsertWeekSummaryCore(scope, WEEK, { totalSessions: 1 })
    const second = await upsertWeekSummaryCore(scope, WEEK, { totalSessions: 2 })
    expect(second.summary.updatedAt).toBeGreaterThan(first.summary.updatedAt)
  })

  it('el wrapper conserva el push y el scope capturado', async () => {
    await db.sessions.put(session({ id: 's-self', athleteId: 'ath_user-1' }))
    await recalculateWeekSummary('2026-07-14')
    expect((await db.weekSummaries
      .where('[athleteId+weekStartDate]').equals(['ath_user-1', WEEK]).first())?.completedSessions).toBe(1)
    expect(syncService.pushWeekSummary).toHaveBeenCalled()
  })

  it('sin activo conserva el modo pre-hidratación', async () => {
    setActiveAthleteId(null)
    await db.sessions.bulkPut([
      session({ id: 'legacy', athleteId: undefined }),
      session({ id: 'scoped', athleteId: 'ath_other' }),
    ])
    expect((await getSessionsForWeek(WEEK)).map((row) => row.id).sort()).toEqual(['legacy', 'scoped'])
  })
})
