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
import { clearAllAthleteDeleteTombstones } from '../../sync/athleteDeleteTombstones'
import { generatePlanWeeks } from '../generatePlan'
import { buildPlanBuilderRecentContext } from '../recentContext'
import { runPlanGenerationJob } from '../generationJobRunner'
import { PRODUCTIVE_QUALITY_VERSION } from '../qualityReview'

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

const ATHLETE_ID = 'ath_local_q'
const PLAN_ID = 'plan-local-q'
const profile = { id: 'profile-local', athleteId: ATHLETE_ID, updatedAt: 1 } as AthleteProfile

function makePlan(totalWeeks: number): TrainingPlan {
  return {
    id: PLAN_ID,
    athleteId: ATHLETE_ID,
    goalEventId: 'event-1',
    status: 'draft',
    generationState: 'shell',
    title: 'Plan local',
    startDate: '2026-08-03',
    endDate: '2026-08-16',
    totalWeeks,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: totalWeeks - 1, blockFocus: '', intentBySport: {} }],
    // El quality review valida la semana contra el wizard, así que necesita un
    // config real: un objeto vacío revienta en `validateSportDistributionForWeek`.
    wizardConfig: {
      goalEventId: 'event-1',
      trainingDays: ['monday', 'wednesday', 'friday'],
      sessionsPerWeek: 3,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: ['strength'],
      currentFitnessLevel: 'normal',
      currentFatigue: 'fresh',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    } as TrainingPlan['wizardConfig'],
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: '2026-08-16',
      currentPhase: 'build',
      weeksRemaining: totalWeeks,
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

function makeWeek(weekIndex: number, overrides: Partial<TrainingPlanWeek> = {}): TrainingPlanWeek {
  return {
    id: `week-local-${weekIndex}`,
    athleteId: ATHLETE_ID,
    planId: PLAN_ID,
    weekIndex,
    weekStartDate: weekIndex === 0 ? '2026-08-03' : '2026-08-10',
    phase: 'build',
    status: 'pending',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** Semana generada por el motor local: lista, con taxonomía v2 y sin marca de calidad. */
function generatedWeek(weekIndex: number): TrainingPlanWeek {
  return makeWeek(weekIndex, {
    status: 'draft',
    sessions: [{
      date: weekIndex === 0 ? '2026-08-03' : '2026-08-10',
      timeBlock: 'AM',
      sessionType: 'squash',
      title: 'Sesion',
      durationMin: 60,
    }] as TrainingPlanWeek['sessions'],
    generationMeta: { attempts: 1, repairTaxonomyVersion: 2 },
  })
}

function makeJob(targetWeekIndexes?: number[]): PlanGenerationJob {
  return {
    id: 'job-local-q',
    planId: PLAN_ID,
    athleteId: ATHLETE_ID,
    status: 'queued',
    strategy: 'single',
    targetWeekIndexes,
    totalWeeks: 1,
    completedWeeks: 0,
    failedWeekIndexes: [],
    currentWeekIndex: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('local runner quality version stamping', () => {
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

  it('lee la ejecución vivida en una recalibración local', async () => {
    const plan = { ...makePlan(2), status: 'active' as const,
      pendingRecalibration: { weekIndexes: [1], requestedAt: new Date('2026-08-10T12:00:00Z').getTime() } }
    await db.trainingPlans.put(plan)
    await db.trainingPlanWeeks.bulkPut([makeWeek(0, { status: 'accepted' }), makeWeek(1)])
    await db.planGenerationJobs.put(makeJob([1]))
    vi.mocked(generatePlanWeeks).mockResolvedValue([generatedWeek(1)])

    await runPlanGenerationJob({ jobId: 'job-local-q', profile })

    expect(buildPlanBuilderRecentContext).toHaveBeenCalledWith(plan, undefined, { asOfDate: '2026-08-10' })
    expect(generatePlanWeeks).toHaveBeenCalledWith(expect.objectContaining({
      weeks: [expect.objectContaining({ weekIndex: 1 })],
    }))
  })

  it('stamps the effective run version on a week it generates', async () => {
    await db.trainingPlans.put(makePlan(1))
    await db.trainingPlanWeeks.put(makeWeek(0))
    await db.planGenerationJobs.put(makeJob())
    vi.mocked(generatePlanWeeks).mockResolvedValue([generatedWeek(0)])

    await runPlanGenerationJob({ jobId: 'job-local-q', profile })

    const persisted = await db.trainingPlanWeeks.get('week-local-0')
    expect(persisted?.generationMeta.qualityVersion).toBe(PRODUCTIVE_QUALITY_VERSION)
  })

  it('scores the finished plan with the effective run version', async () => {
    await db.trainingPlans.put(makePlan(1))
    await db.trainingPlanWeeks.put(makeWeek(0))
    await db.planGenerationJobs.put(makeJob())
    vi.mocked(generatePlanWeeks).mockResolvedValue([generatedWeek(0)])

    await runPlanGenerationJob({ jobId: 'job-local-q', profile })

    const persisted = await db.trainingPlans.get(PLAN_ID)
    expect(persisted?.generationSummary?.qualityReview?.qualityVersion)
      .toBe(PRODUCTIVE_QUALITY_VERSION)
  })

  it('survives a local engine path that returns no v2 taxonomy', async () => {
    // El motor local tiene caminos que no producen taxonomía v2. Marcar v2 igual
    // rompería el invariante y `resolveQualityVersion` haría lanzar el
    // checkpoint final, matando una generación que venía bien.
    await db.trainingPlans.put(makePlan(1))
    await db.trainingPlanWeeks.put(makeWeek(0))
    await db.planGenerationJobs.put(makeJob())
    const untaxonomised = makeWeek(0, {
      status: 'draft',
      sessions: [{
        date: '2026-08-03', timeBlock: 'AM', sessionType: 'squash', title: 'Sesion', durationMin: 60,
      }] as TrainingPlanWeek['sessions'],
      generationMeta: { attempts: 1 },
    })
    vi.mocked(generatePlanWeeks).mockResolvedValue([untaxonomised])

    await expect(runPlanGenerationJob({ jobId: 'job-local-q', profile })).resolves.toBeUndefined()

    const persisted = await db.trainingPlanWeeks.get('week-local-0')
    expect(persisted?.status).toBe('draft')
    expect(persisted?.generationMeta.qualityVersion).toBeUndefined()
    const plan = await db.trainingPlans.get(PLAN_ID)
    expect(plan?.generationSummary?.qualityReview?.qualityVersion).toBe(1)
  })

  it('stays on v1 when a legacy week survives outside the targets', async () => {
    // Regeneración parcial de un plan con historia: la semana 0 quedó lista sin
    // taxonomía v2 y nadie la reemplaza, así que la corrida no puede ser v2.
    await db.trainingPlans.put(makePlan(2))
    await db.trainingPlanWeeks.bulkPut([
      makeWeek(0, {
        status: 'draft',
        sessions: [{
          date: '2026-08-03', timeBlock: 'AM', sessionType: 'squash', title: 'Legacy', durationMin: 60,
        }] as TrainingPlanWeek['sessions'],
        generationMeta: { attempts: 1 },
      }),
      makeWeek(1),
    ])
    await db.planGenerationJobs.put(makeJob([1]))
    vi.mocked(generatePlanWeeks).mockResolvedValue([generatedWeek(1)])

    await runPlanGenerationJob({ jobId: 'job-local-q', profile })

    const persisted = await db.trainingPlanWeeks.get('week-local-1')
    expect(persisted?.generationMeta.qualityVersion).toBe(1)
    const plan = await db.trainingPlans.get(PLAN_ID)
    expect(plan?.generationSummary?.qualityReview?.qualityVersion).toBe(1)
  })
})
