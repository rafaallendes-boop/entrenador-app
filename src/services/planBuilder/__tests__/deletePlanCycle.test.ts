import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../db/db'
import type {
  PlanGenerationJob,
  TrainingPlan,
  TrainingPlanWeek,
} from '../../../types/planBuilder'
import {
  bumpSwitchEpoch,
  setActiveAthleteId,
  setSelfAthleteId,
} from '../../athlete/activeAthlete'
import { deletePlanCycle } from '../deletePlanCycle'

const mocks = vi.hoisted(() => ({
  softDeleteTrainingPlan: vi.fn(),
}))

vi.mock('../../syncService', () => ({
  softDeleteTrainingPlan: mocks.softDeleteTrainingPlan,
}))

const plan = (fields: Partial<TrainingPlan> = {}): TrainingPlan => ({
  id: 'p1',
  athleteId: 'ath_self',
  goalEventId: 'event-1',
  status: 'archived',
  generationState: 'complete',
  title: 'Torneo',
  startDate: '2026-06-01',
  endDate: '2026-08-15',
  totalWeeks: 2,
  phases: [],
  wizardConfig: {} as never,
  macroSnapshot: {} as never,
  createdAt: 1,
  updatedAt: 2,
  ...fields,
})

const week = (index: number, fields: Partial<TrainingPlanWeek> = {}): TrainingPlanWeek => ({
  id: `w${index}`,
  athleteId: 'ath_self',
  planId: 'p1',
  weekIndex: index,
  weekStartDate: '2026-06-01',
  phase: 'base',
  status: 'accepted',
  sessions: [],
  weekObjectives: [],
  targetLoadBySport: {},
  validationIssues: [],
  generationMeta: { attempts: 1 },
  createdAt: 1,
  updatedAt: 2,
  ...fields,
})

const job = (fields: Partial<PlanGenerationJob> = {}): PlanGenerationJob => ({
  id: 'job-1',
  planId: 'p1',
  athleteId: 'ath_self',
  status: 'succeeded',
  strategy: 'single',
  totalWeeks: 2,
  completedWeeks: 2,
  failedWeekIndexes: [],
  currentWeekIndex: null,
  createdAt: 1,
  updatedAt: 2,
  ...fields,
})

describe('deletePlanCycle', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    await db.trainingPlans.put(plan())
    await db.trainingPlanWeeks.bulkPut([week(0), week(1)])
    await db.planGenerationJobs.put(job())
    mocks.softDeleteTrainingPlan.mockReset().mockResolvedValue('pushed')
  })

  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('pushed purga plan, weeks y jobs después del remoto', async () => {
    let wasLocalDuringPush = false
    mocks.softDeleteTrainingPlan.mockImplementation(async () => {
      wasLocalDuringPush = (await db.trainingPlans.get('p1')) != null
      return 'pushed'
    })

    expect(await deletePlanCycle('p1')).toBe('deleted')

    expect(wasLocalDuringPush).toBe(true)
    expect(await db.trainingPlans.get('p1')).toBeUndefined()
    expect(await db.trainingPlanWeeks.where('planId').equals('p1').count()).toBe(0)
    expect(await db.planGenerationJobs.where('planId').equals('p1').count()).toBe(0)
  })

  it('no_remote también permite la purga local', async () => {
    mocks.softDeleteTrainingPlan.mockResolvedValue('no_remote')
    expect(await deletePlanCycle('p1')).toBe('deleted')
    expect(await db.trainingPlans.get('p1')).toBeUndefined()
  })

  it('queued conserva todo para converger por sync', async () => {
    mocks.softDeleteTrainingPlan.mockResolvedValue('queued')
    expect(await deletePlanCycle('p1')).toBe('pending_sync')
    expect(await db.trainingPlans.get('p1')).toBeDefined()
    expect(await db.trainingPlanWeeks.where('planId').equals('p1').count()).toBe(2)
    expect(await db.planGenerationJobs.where('planId').equals('p1').count()).toBe(1)
  })

  it('failed o throw conservan todo', async () => {
    mocks.softDeleteTrainingPlan.mockResolvedValueOnce('failed')
    expect(await deletePlanCycle('p1')).toBe('failed')
    expect(await db.trainingPlans.get('p1')).toBeDefined()

    mocks.softDeleteTrainingPlan.mockRejectedValueOnce(new Error('boom'))
    expect(await deletePlanCycle('p1')).toBe('failed')
    expect(await db.trainingPlans.get('p1')).toBeDefined()
  })

  it.each(['queued', 'running'] as const)(
    'no inicia el remoto con un job %s',
    async (status) => {
      await db.planGenerationJobs.put(job({ status }))

      expect(await deletePlanCycle('p1')).toBe('failed')
      expect(mocks.softDeleteTrainingPlan).not.toHaveBeenCalled()
      expect(await db.trainingPlans.get('p1')).toBeDefined()
    },
  )

  it('si aparece un job después del commit remoto, la purga lo retira con el padre', async () => {
    mocks.softDeleteTrainingPlan.mockImplementation(async () => {
      await db.planGenerationJobs.put(job({ id: 'late-job', status: 'queued' }))
      return 'pushed'
    })

    expect(await deletePlanCycle('p1')).toBe('deleted')
    expect(await db.trainingPlans.get('p1')).toBeUndefined()
    expect(await db.planGenerationJobs.where('planId').equals('p1').count()).toBe(0)
  })

  it('no actúa sin atleta activo', async () => {
    setActiveAthleteId(null)
    expect(await deletePlanCycle('p1')).toBe('failed')
    expect(mocks.softDeleteTrainingPlan).not.toHaveBeenCalled()
  })

  it('no actúa sobre un plan de otro atleta', async () => {
    await db.trainingPlans.put(plan({ athleteId: 'ath_other' }))
    expect(await deletePlanCycle('p1')).toBe('failed')
    expect(mocks.softDeleteTrainingPlan).not.toHaveBeenCalled()
  })

  it('un managed no puede borrar un plan legacy', async () => {
    setActiveAthleteId('ath_managed')
    await db.trainingPlans.put(plan({ athleteId: undefined as never }))
    expect(await deletePlanCycle('p1')).toBe('failed')
    expect(mocks.softDeleteTrainingPlan).not.toHaveBeenCalled()
  })

  it('el self normaliza plan y weeks legacy al mismo scope remoto', async () => {
    await db.trainingPlans.put(plan({ athleteId: undefined as never }))
    await db.trainingPlanWeeks.bulkPut([
      week(0, { athleteId: undefined }),
      week(1, { athleteId: 'ath_wrong' }),
    ])

    expect(await deletePlanCycle('p1')).toBe('deleted')

    const [remotePlan, remoteWeeks] = mocks.softDeleteTrainingPlan.mock.calls[0]
    expect(remotePlan.athleteId).toBe('ath_self')
    expect(remoteWeeks.map((row: TrainingPlanWeek) => row.athleteId))
      .toEqual(['ath_self', 'ath_self'])
  })

  it('un switch durante la preparación aborta antes del remoto', async () => {
    const deleting = deletePlanCycle('p1')
    setActiveAthleteId('ath_other')
    bumpSwitchEpoch()

    expect(await deleting).toBe('failed')
    expect(mocks.softDeleteTrainingPlan).not.toHaveBeenCalled()
    expect(await db.trainingPlans.get('p1')).toBeDefined()
  })

  it('un plan inexistente ya está deleted', async () => {
    expect(await deletePlanCycle('missing')).toBe('deleted')
    expect(mocks.softDeleteTrainingPlan).not.toHaveBeenCalled()
  })
})
