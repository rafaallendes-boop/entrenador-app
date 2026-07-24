import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AthleteProfile } from '../../../types'
import type { PlanGenerationJob, TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'

vi.mock('../generatePlan', () => ({
  generatePlanWeeks: vi.fn(),
}))
vi.mock('../recentContext', () => ({
  buildPlanBuilderRecentContext: vi.fn(async () => undefined),
}))

import { db } from '../../../db/db'
import {
  clearAllAthleteDeleteTombstones,
  rememberAthleteDeleteTombstone,
} from '../../sync/athleteDeleteTombstones'
import { generatePlanWeeks } from '../generatePlan'
import {
  abortPlanGenerationForAthlete,
  runPlanGenerationJob,
} from '../generationJobRunner'

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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const profile = { id: 'profile-a', athleteId: 'ath_m_a', updatedAt: 1 } as AthleteProfile

function plan(athleteId = 'ath_m_a'): TrainingPlan {
  return {
    id: `plan-${athleteId}`,
    athleteId,
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'shell',
    title: 'Plan test',
    startDate: '2026-07-13',
    endDate: '2026-07-19',
    totalWeeks: 1,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 0, blockFocus: '', intentBySport: {} }],
    wizardConfig: {} as TrainingPlan['wizardConfig'],
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-07-19',
      currentPhase: 'build',
      weeksRemaining: 1,
      blockFocus: '',
      headline: '',
      timeline: [],
      sportDetails: [],
      secondaryEvents: [],
      computedAt: 1,
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function week(athleteId = 'ath_m_a'): TrainingPlanWeek {
  return {
    id: `week-${athleteId}`,
    athleteId,
    planId: `plan-${athleteId}`,
    weekIndex: 0,
    weekStartDate: '2026-07-13',
    phase: 'build',
    status: 'pending',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 1,
    updatedAt: 1,
  }
}

function job(athleteId = 'ath_m_a'): PlanGenerationJob {
  return {
    id: `job-${athleteId}`,
    planId: `plan-${athleteId}`,
    athleteId,
    status: 'queued',
    strategy: 'single',
    totalWeeks: 1,
    completedWeeks: 0,
    failedWeekIndexes: [],
    currentWeekIndex: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

async function seedRunnable(athleteId = 'ath_m_a') {
  await db.trainingPlans.put(plan(athleteId))
  await db.trainingPlanWeeks.put(week(athleteId))
  await db.planGenerationJobs.put(job(athleteId))
}

describe('abortPlanGenerationForAthlete', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    installLocalStorage()
    clearAllAthleteDeleteTombstones()
    db.close()
    await db.delete()
    await db.open()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  it('cancela jobs activos y acota la espera de un run bloqueado', async () => {
    await seedRunnable()
    const generation = deferred<TrainingPlanWeek[]>()
    vi.mocked(generatePlanWeeks).mockReturnValue(generation.promise)
    const run = runPlanGenerationJob({ jobId: 'job-ath_m_a', profile })
    await vi.waitFor(() => expect(generatePlanWeeks).toHaveBeenCalledOnce())

    const startedAt = Date.now()
    await abortPlanGenerationForAthlete('ath_m_a', { waitMs: 25 })
    const elapsed = Date.now() - startedAt

    expect(elapsed).toBeLessThan(1000)
    expect((await db.planGenerationJobs.get('job-ath_m_a'))?.status).toBe('cancelled')

    generation.resolve([week()])
    await run
  })

  it('espera la promesa real cuando el run termina dentro de waitMs', async () => {
    await seedRunnable()
    const generation = deferred<TrainingPlanWeek[]>()
    vi.mocked(generatePlanWeeks).mockReturnValue(generation.promise)
    const run = runPlanGenerationJob({ jobId: 'job-ath_m_a', profile })
    await vi.waitFor(() => expect(generatePlanWeeks).toHaveBeenCalledOnce())

    let settled = false
    const abort = abortPlanGenerationForAthlete('ath_m_a', { waitMs: 5000 }).then(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).toBe(false)
    generation.resolve([week()])
    await abort
    await run
    expect(settled).toBe(true)
  })

  it('suprime onWeekUpdate, checkpoints y catch después del tombstone', async () => {
    await seedRunnable()
    const generation = deferred<TrainingPlanWeek[]>()
    let emitWeek: ((next: TrainingPlanWeek) => void) | undefined
    vi.mocked(generatePlanWeeks).mockImplementation((input) => {
      emitWeek = input.onWeekUpdate
      return generation.promise
    })
    const run = runPlanGenerationJob({ jobId: 'job-ath_m_a', profile })
    await vi.waitFor(() => expect(generatePlanWeeks).toHaveBeenCalledOnce())

    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    const weekPut = vi.spyOn(db.trainingPlanWeeks, 'put')
    const weeksBulkPut = vi.spyOn(db.trainingPlanWeeks, 'bulkPut')
    const planPut = vi.spyOn(db.trainingPlans, 'put')
    const jobPut = vi.spyOn(db.planGenerationJobs, 'put')
    emitWeek?.({ ...week(), status: 'draft', updatedAt: 100 })
    generation.reject(new Error('provider failed'))

    await run

    expect(weekPut).not.toHaveBeenCalled()
    expect(weeksBulkPut).not.toHaveBeenCalled()
    expect(planPut).not.toHaveBeenCalled()
    expect(jobPut).not.toHaveBeenCalled()
    expect((await db.trainingPlanWeeks.get('week-ath_m_a'))?.status).toBe('generating')
    expect((await db.planGenerationJobs.get('job-ath_m_a'))?.lastError).toBeUndefined()
  })

  it('no recrea plan, weeks ni job si el ciclo se borra durante la generación', async () => {
    await seedRunnable()
    const generation = deferred<TrainingPlanWeek[]>()
    let emitWeek: ((next: TrainingPlanWeek) => void) | undefined
    vi.mocked(generatePlanWeeks).mockImplementation((input) => {
      emitWeek = input.onWeekUpdate
      return generation.promise
    })
    const run = runPlanGenerationJob({ jobId: 'job-ath_m_a', profile })
    await vi.waitFor(() => expect(generatePlanWeeks).toHaveBeenCalledOnce())

    await db.transaction(
      'rw',
      db.trainingPlans,
      db.trainingPlanWeeks,
      db.planGenerationJobs,
      async () => {
        await db.trainingPlanWeeks.where('planId').equals('plan-ath_m_a').delete()
        await db.planGenerationJobs.where('planId').equals('plan-ath_m_a').delete()
        await db.trainingPlans.delete('plan-ath_m_a')
      },
    )

    emitWeek?.({ ...week(), status: 'draft', updatedAt: 100 })
    generation.resolve([{ ...week(), status: 'draft', updatedAt: 100 }])
    await run

    expect(await db.trainingPlans.get('plan-ath_m_a')).toBeUndefined()
    expect(await db.trainingPlanWeeks.where('planId').equals('plan-ath_m_a').count()).toBe(0)
    expect(await db.planGenerationJobs.where('planId').equals('plan-ath_m_a').count()).toBe(0)
  })

  it('confirma el checkpoint antes de notificar onPlanUpdate', async () => {
    await seedRunnable()
    const run = runPlanGenerationJob({
      jobId: 'job-ath_m_a',
      profile,
      callbacks: { onPlanUpdate: () => { throw new Error('subscriber failed') } },
    })

    await expect(run).rejects.toThrow('subscriber failed')

    expect((await db.trainingPlans.get('plan-ath_m_a'))?.generationState).toBe('generating')
  })

  it('notifica el streaming antes de diferir su persistencia', async () => {
    await seedRunnable()
    const generation = deferred<TrainingPlanWeek[]>()
    let emitWeek: ((next: TrainingPlanWeek) => void) | undefined
    vi.mocked(generatePlanWeeks).mockImplementation((input) => {
      emitWeek = input.onWeekUpdate
      return generation.promise
    })
    const events: string[] = []
    const run = runPlanGenerationJob({
      jobId: 'job-ath_m_a',
      profile,
      callbacks: { onWeekUpdate: () => { events.push('notify') } },
    })
    await vi.waitFor(() => expect(generatePlanWeeks).toHaveBeenCalledOnce())
    events.length = 0
    const originalPut = db.trainingPlanWeeks.put.bind(db.trainingPlanWeeks)
    vi.spyOn(db.trainingPlanWeeks, 'put').mockImplementation(async (next) => {
      events.push('persist')
      return originalPut(next)
    })

    emitWeek?.({ ...week(), status: 'draft', updatedAt: 100 })
    expect(events).toEqual(['notify'])
    await vi.waitFor(() => expect(events).toEqual(['notify', 'persist']))

    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    generation.resolve([{ ...week(), status: 'draft', updatedAt: 100 }])
    await run
  })

  it('no cancela jobs de otros atletas', async () => {
    await db.planGenerationJobs.bulkPut([job('ath_m_a'), job('ath_m_b')])

    await abortPlanGenerationForAthlete('ath_m_a', { waitMs: 0 })

    expect((await db.planGenerationJobs.get('job-ath_m_a'))?.status).toBe('cancelled')
    expect((await db.planGenerationJobs.get('job-ath_m_b'))?.status).toBe('queued')
  })
})
