import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/syncService', () => ({
  pushCoachProposal: vi.fn(async () => {}),
  pushSession: vi.fn(async () => {}),
  pushDayLog: vi.fn(async () => {}),
  pushWeekSummary: vi.fn(async () => {}),
  deleteWeekSummaries: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  canWriteAthleteProfileLocally: vi.fn(() => true),
}))

import { db } from '../../db/db'
import { bumpSwitchEpoch, setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import * as syncService from '../../services/syncService'
import { useCoachActionsStore } from '../useCoachActionsStore'
import { useTrainingStore } from '../useTrainingStore'

describe('acceptProposal - switch guard', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_user-1')
    useCoachActionsStore.setState({ proposals: [] })
    useTrainingStore.getState().resetForAthleteSwitch()
  })

  afterEach(() => {
    db.close()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    useCoachActionsStore.setState({ proposals: [] })
    useTrainingStore.getState().resetForAthleteSwitch()
  })

  it('aborts an accept interrupted by an athlete switch and leaves the proposal pending', async () => {
    await db.coachProposals.put({
      id: 'p1',
      createdAt: Date.now(),
      status: 'pending',
      message: 'm',
      athleteId: 'ath_user-1',
      actions: [{ type: 'insert_recovery', targetDate: '2026-07-06', reason: 'test' }],
    })
    await useCoachActionsStore.getState().loadProposals()

    const originalAddSession = useTrainingStore.getState().addSession
    useTrainingStore.setState({
      addSession: async (partial) => {
        bumpSwitchEpoch()
        return originalAddSession(partial)
      },
    })

    try {
      const result = await useCoachActionsStore.getState().acceptProposal('p1')

      expect(result.errors.length).toBeGreaterThan(0)
      const stored = await db.coachProposals.get('p1')
      expect(stored?.status).toBe('pending')
      expect(await db.sessions.toArray()).toEqual([])
      expect(syncService.deleteWeekSummaries).toHaveBeenCalled()
    } finally {
      useTrainingStore.setState({ addSession: originalAddSession })
    }
  })

  it('rolls back the previous athlete week summary when the accept is interrupted by a real switch', async () => {
    await db.weekSummaries.put({
      id: 'w-self',
      athleteId: 'ath_user-1',
      weekStartDate: '2026-07-06',
      updatedAt: 1,
      totalSessions: 0,
      totalMinutes: 0,
      plannedSessions: 0,
      completedSessions: 0,
      plannedMinutes: 0,
      completedMinutes: 0,
      squashSessions: 0,
      runningSessions: 0,
      strengthSessions: 0,
    })
    await db.coachProposals.put({
      id: 'p1',
      createdAt: Date.now(),
      status: 'pending',
      message: 'm',
      athleteId: 'ath_user-1',
      actions: [{ type: 'insert_recovery', targetDate: '2026-07-06', reason: 'test' }],
    })
    await useCoachActionsStore.getState().loadProposals()

    const originalAddSession = useTrainingStore.getState().addSession
    useTrainingStore.setState({
      addSession: async (partial) => {
        const created = await originalAddSession(partial)
        setActiveAthleteId('ath_m_1')
        bumpSwitchEpoch()
        return created
      },
    })

    try {
      const result = await useCoachActionsStore.getState().acceptProposal('p1')

      expect(result.errors.length).toBeGreaterThan(0)
      const selfSummary = (await db.weekSummaries.toArray()).find((summary) => (
        summary.athleteId === 'ath_user-1' && summary.weekStartDate === '2026-07-06'
      ))
      expect(selfSummary?.totalSessions).toBe(0)
      expect(await db.sessions.toArray()).toEqual([])
    } finally {
      useTrainingStore.setState({ addSession: originalAddSession })
      setActiveAthleteId('ath_user-1')
    }
  })
})
