import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../db/db'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import {
  bumpSwitchEpoch,
  setActiveAthleteId,
  setSelfAthleteId,
} from '../../athlete/activeAthlete'
import { closePlanCycle } from '../closePlanCycle'

const mocks = vi.hoisted(() => ({
  archiveTrainingPlan: vi.fn(),
  pushTrainingPlan: vi.fn(),
  pushTrainingPlanWeeks: vi.fn(),
}))

vi.mock('../../syncService', () => ({
  archiveTrainingPlan: mocks.archiveTrainingPlan,
  pushTrainingPlan: mocks.pushTrainingPlan,
  pushTrainingPlanWeeks: mocks.pushTrainingPlanWeeks,
}))

const plan = (fields: Partial<TrainingPlan> = {}): TrainingPlan => ({
  id: 'p1',
  athleteId: 'ath_self',
  goalEventId: 'event-1',
  status: 'active',
  generationState: 'complete',
  title: 'Torneo',
  startDate: '2026-06-01',
  endDate: '2026-08-15',
  totalWeeks: 2,
  phases: [],
  wizardConfig: {} as never,
  macroSnapshot: {} as never,
  createdAt: 1,
  updatedAt: 1,
  ...fields,
})

const week = (fields: Partial<TrainingPlanWeek> = {}): TrainingPlanWeek => ({
  id: 'w1',
  athleteId: 'ath_self',
  planId: 'p1',
  weekIndex: 0,
  weekStartDate: '2026-06-01',
  phase: 'base',
  status: 'accepted',
  sessions: [],
  weekObjectives: [],
  targetLoadBySport: {},
  validationIssues: [],
  generationMeta: { attempts: 1 },
  createdAt: 1,
  updatedAt: 1,
  ...fields,
})

describe('closePlanCycle', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    mocks.archiveTrainingPlan.mockReset().mockResolvedValue(undefined)
    mocks.pushTrainingPlan.mockReset().mockResolvedValue(undefined)
    mocks.pushTrainingPlanWeeks.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('archiva sólo el evento dirigido', async () => {
    await db.trainingPlans.bulkPut([
      plan({ id: 'target', goalEventId: 'event-1' }),
      plan({ id: 'future', goalEventId: 'event-2' }),
    ])

    await closePlanCycle({ goalEventId: 'event-1' })

    expect((await db.trainingPlans.get('target'))?.status).toBe('archived')
    expect((await db.trainingPlans.get('future'))?.status).toBe('active')
  })

  it('elige un canónico determinista y supersede los duplicados', async () => {
    await db.trainingPlans.bulkPut([
      plan({ id: 'z', updatedAt: 10, acceptedAt: 20, createdAt: 30 }),
      plan({ id: 'a', updatedAt: 10, acceptedAt: 20, createdAt: 30 }),
    ])

    await closePlanCycle({ goalEventId: 'event-1' })

    expect((await db.trainingPlans.get('a'))?.status).toBe('archived')
    expect((await db.trainingPlans.get('z'))?.status).toBe('superseded')
    expect(mocks.archiveTrainingPlan.mock.calls[0]?.[0].id).toBe('a')
    expect(mocks.pushTrainingPlan.mock.calls[0]?.[0].id).toBe('z')
  })

  it('usa un updatedAt estrictamente mayor aunque el reloj local esté atrasado', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    await db.trainingPlans.put(plan({ updatedAt: 1_000 }))

    await closePlanCycle({ goalEventId: 'event-1' })

    expect((await db.trainingPlans.get('p1'))?.updatedAt).toBe(1_001)
    expect(mocks.archiveTrainingPlan.mock.calls[0]?.[0].updatedAt).toBe(1_001)
  })

  it('no actúa sin atleta activo', async () => {
    await db.trainingPlans.put(plan())
    setActiveAthleteId(null)

    await closePlanCycle({ goalEventId: 'event-1' })

    expect((await db.trainingPlans.get('p1'))?.status).toBe('active')
    expect(mocks.archiveTrainingPlan).not.toHaveBeenCalled()
  })

  it('no toca un plan de otro atleta', async () => {
    await db.trainingPlans.put(plan({ athleteId: 'ath_other' }))

    await closePlanCycle({ goalEventId: 'event-1' })

    expect((await db.trainingPlans.get('p1'))?.status).toBe('active')
    expect(mocks.archiveTrainingPlan).not.toHaveBeenCalled()
  })

  it('un managed no adopta filas legacy', async () => {
    setActiveAthleteId('ath_managed')
    await db.trainingPlans.put(plan({ athleteId: undefined as never }))

    await closePlanCycle({ goalEventId: 'event-1' })

    expect((await db.trainingPlans.get('p1'))?.status).toBe('active')
    expect(mocks.archiveTrainingPlan).not.toHaveBeenCalled()
  })

  it('el self estampa el mismo scope remoto en un plan y sus weeks legacy', async () => {
    await db.trainingPlans.put(plan({ athleteId: undefined as never }))
    await db.trainingPlanWeeks.put(week({ athleteId: undefined }))

    await closePlanCycle({ goalEventId: 'event-1' })

    const [archivedPlan, archivedWeeks] = mocks.archiveTrainingPlan.mock.calls[0]
    expect(archivedPlan.athleteId).toBe('ath_self')
    expect(archivedWeeks).toHaveLength(1)
    expect(archivedWeeks[0].athleteId).toBe('ath_self')
  })

  it('un switch mientras prepara el cierre aborta antes de mutar o pushear', async () => {
    await db.trainingPlans.put(plan())

    const closing = closePlanCycle({ goalEventId: 'event-1' })
    setActiveAthleteId('ath_other')
    bumpSwitchEpoch()
    await closing

    expect((await db.trainingPlans.get('p1'))?.status).toBe('active')
    expect(mocks.archiveTrainingPlan).not.toHaveBeenCalled()
  })

  it('no toca drafts y es idempotente', async () => {
    await db.trainingPlans.bulkPut([
      plan({ id: 'active' }),
      plan({ id: 'draft', status: 'draft' }),
    ])
    await closePlanCycle({ goalEventId: 'event-1' })
    mocks.archiveTrainingPlan.mockClear()

    await closePlanCycle({ goalEventId: 'event-1' })

    expect((await db.trainingPlans.get('draft'))?.status).toBe('draft')
    expect(mocks.archiveTrainingPlan).not.toHaveBeenCalled()
  })
})
