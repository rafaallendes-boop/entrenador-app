import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  athleteId: 'ath_a' as string | null, epoch: 1,
  upsertWeekSummary: vi.fn(), send: vi.fn(),
}))

vi.mock('../../services/athlete/activeAthlete', () => ({
  getActiveAthleteId: () => mocks.athleteId, getSelfAthleteId: () => 'ath_a', getSwitchEpoch: () => mocks.epoch,
  ATHLETE_PROFILE_LOCAL_ID: 'default', isSelfScopeActive: () => true,
}))
vi.mock('../../db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/queries')>()
  return {
    ...actual,
    getSessionsForWeek: vi.fn(async () => []),
    getDayLogsForWeek: vi.fn(async () => []),
    getWeekSummary: vi.fn(async () => undefined),
    getAthleteProfile: vi.fn(async () => undefined),
    recalculateWeekSummary: vi.fn(async () => undefined),
    upsertWeekSummary: (...args: unknown[]) => mocks.upsertWeekSummary(...args),
    captureActiveWeekScope: () => ({ athleteId: 'ath_a', includeLegacy: true }),
  }
})
vi.mock('../../services/athlete/coachNotes', () => ({ getCoachMemoryText: vi.fn(async () => undefined) }))
vi.mock('../../services/ai/CoachEngine', () => ({ CoachEngine: { send: (...args: unknown[]) => mocks.send(...args) } }))
vi.mock('../../services/weeklyReviewWindow', () => ({ isWeeklyReviewWindowOpen: () => true }))

import { useTrainingStore } from '../useTrainingStore'
import { currentWeekStartISO } from '../../utils/date'

describe('A5 — nota semanal y scope', () => {
  beforeEach(() => { mocks.athleteId = 'ath_a'; mocks.epoch = 1; mocks.upsertWeekSummary.mockReset(); mocks.send.mockReset() })

  it('no escribe la nota si el atleta cambió durante la IA', async () => {
    mocks.send.mockImplementation(async () => { mocks.athleteId = 'ath_b'; mocks.epoch = 2; return { message: 'Nota para A' } })
    await expect(useTrainingStore.getState().generateCoachNote(currentWeekStartISO())).rejects.toThrow('atleta activo cambió')
    expect(mocks.upsertWeekSummary).not.toHaveBeenCalled()
  })

  it('no envía si el atleta cambia durante las lecturas', async () => {
    const { getSessionsForWeek } = await import('../../db/queries')
    vi.mocked(getSessionsForWeek).mockImplementationOnce(async () => { mocks.athleteId = 'ath_b'; mocks.epoch = 2; return [] })
    await expect(useTrainingStore.getState().generateCoachNote(currentWeekStartISO())).rejects.toThrow('atleta activo cambió')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('escribe con el scope capturado al inicio', async () => {
    mocks.send.mockResolvedValue({ message: 'Nota' })
    mocks.upsertWeekSummary.mockResolvedValue({ id: 'w', weekStartDate: currentWeekStartISO(), updatedAt: 0 })
    await useTrainingStore.getState().generateCoachNote(currentWeekStartISO())
    expect(mocks.send.mock.calls[0][2]).toMatchObject({ targetAthleteId: 'ath_a' })
    expect(mocks.upsertWeekSummary.mock.calls[0][2]).toEqual({ athleteId: 'ath_a', includeLegacy: true })
  })
})
