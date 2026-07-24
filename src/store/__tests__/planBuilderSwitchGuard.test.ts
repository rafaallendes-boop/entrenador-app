import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, PlanWizardConfig } from '../../types'
import type { PlanGenerationJob, TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  supabase: null as unknown,
  createPlanGenerationJob: vi.fn(),
  getLatestPlanGenerationJob: vi.fn(),
  getRunnablePlanGenerationJobs: vi.fn(),
  runPlanGenerationJob: vi.fn(),
  buildPlanShell: vi.fn(),
  commitPlan: vi.fn(),
  triggerBackgroundGeneration: vi.fn(),
  pollPlanGeneration: vi.fn(),
  pushTrainingPlan: vi.fn(),
  assertPlanBuilderWeekRateLimit: vi.fn(),
  reservePlanBuilderWeekUsage: vi.fn(),
  releasePlanBuilderWeekReservations: vi.fn(),
  syncPlanBuilderWeekUsageFromWeeks: vi.fn(),
}))

vi.mock('../../services/auth', () => ({
  get supabase() {
    return mocks.supabase
  },
}))

vi.mock('../useAuthStore', () => ({
  useAuthStore: {
    getState: () => ({ user: mocks.authUser }),
  },
}))

vi.mock('../../services/planBuilder/generationJobRunner', () => ({
  createPlanGenerationJob: mocks.createPlanGenerationJob,
  getLatestPlanGenerationJob: mocks.getLatestPlanGenerationJob,
  getRunnablePlanGenerationJobs: mocks.getRunnablePlanGenerationJobs,
  runPlanGenerationJob: mocks.runPlanGenerationJob,
}))

vi.mock('../../services/planBuilder/buildPlanShell', () => ({
  buildPlanShell: mocks.buildPlanShell,
}))

vi.mock('../../services/planBuilder/commitPlan', () => ({
  commitPlan: mocks.commitPlan,
}))

vi.mock('../../services/planBuilder/triggerBackgroundGeneration', async () => {
  const actual = await vi.importActual<typeof import('../../services/planBuilder/triggerBackgroundGeneration')>(
    '../../services/planBuilder/triggerBackgroundGeneration',
  )
  return {
    PlanEnqueueRejectedError: actual.PlanEnqueueRejectedError,
    triggerBackgroundGeneration: mocks.triggerBackgroundGeneration,
  }
})

vi.mock('../../services/planBuilder/pollPlanGeneration', async () => {
  const actual = await vi.importActual<typeof import('../../services/planBuilder/pollPlanGeneration')>(
    '../../services/planBuilder/pollPlanGeneration',
  )
  return {
    ...actual,
    pollPlanGeneration: mocks.pollPlanGeneration,
  }
})

vi.mock('../../services/planBuilder/rateLimit', () => ({
  assertPlanBuilderWeekRateLimit: mocks.assertPlanBuilderWeekRateLimit,
  reservePlanBuilderWeekUsage: mocks.reservePlanBuilderWeekUsage,
  releasePlanBuilderWeekReservations: mocks.releasePlanBuilderWeekReservations,
  syncPlanBuilderWeekUsageFromWeeks: mocks.syncPlanBuilderWeekUsageFromWeeks,
}))

vi.mock('../../services/syncService', () => ({
  pushTrainingPlan: mocks.pushTrainingPlan,
}))

import { db } from '../../db/db'
import { bumpSwitchEpoch, getSwitchEpoch } from '../../services/athlete/activeAthlete'
import { buildRunnerCallbacks, usePlanBuilderStore } from '../usePlanBuilderStore'

function flushPromises(): Promise<void> {
  return Promise.resolve().then(() => undefined)
}

async function waitUntil(assertion: () => void, attempts = 20): Promise<void> {
  let lastError: unknown
  for (let index = 0; index < attempts; index += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  throw lastError
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function makeProfile(): AthleteProfile {
  return {
    id: 'profile-1',
    name: 'Test Athlete',
    goalEvents: [],
  } as AthleteProfile
}

function makeProfileWithGoal(): AthleteProfile {
  return {
    ...makeProfile(),
    sportContext: {
      enabledSports: ['squash'],
      primarySport: 'squash',
    },
    goalEvents: [{
      id: 'goal-1',
      title: 'Regional',
      date: '2026-07-12',
      sport: 'squash',
      priority: 'primary',
    }],
  } as AthleteProfile
}

function makePlan(): TrainingPlan {
  const now = Date.now()
  const wizardConfig: PlanWizardConfig = {
    goalEventId: 'goal-1',
    trainingDays: ['monday'],
    sessionsPerWeek: 1,
    sessionDurationMins: 45,
    allowDoubleSession: false,
    complementarySports: [],
    currentFitnessLevel: 'normal',
    currentFatigue: 'normal',
    createdAt: '2026-07-01',
    updatedAt: '2026-07-01',
  }
  return {
    id: 'plan-1',
    athleteId: 'athlete-1',
    goalEventId: 'goal-1',
    status: 'draft',
    generationState: 'shell',
    title: 'Plan test',
    startDate: '2026-07-06',
    endDate: '2026-07-12',
    totalWeeks: 1,
    phases: [],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'goal-1',
      goalEventDate: '2026-07-12',
      currentPhase: 'base',
      weeksRemaining: 1,
      blockFocus: 'Base',
      headline: 'Base',
      timeline: [],
      sportDetails: [],
      secondaryEvents: [],
      computedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  }
}

function makeWeek(): TrainingPlanWeek {
  const now = Date.now()
  return {
    id: 'week-1',
    athleteId: 'athlete-1',
    planId: 'plan-1',
    weekIndex: 0,
    weekStartDate: '2026-07-06',
    phase: 'base',
    status: 'pending',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: now,
    updatedAt: now,
  }
}

function makeJob(): PlanGenerationJob {
  const now = Date.now()
  return {
    id: 'job-1',
    planId: 'plan-1',
    athleteId: 'athlete-1',
    status: 'queued',
    strategy: 'single',
    totalWeeks: 1,
    completedWeeks: 0,
    failedWeekIndexes: [],
    currentWeekIndex: null,
    createdAt: now,
    updatedAt: now,
  }
}

function resetPlanBuilderStore() {
  usePlanBuilderStore.setState({
    plan: null,
    weeks: [],
    issues: [],
    status: 'idle',
    currentWeekIndex: null,
    completedWeeks: 0,
    failedWeekIndexes: [],
    streamingTextByWeekIndex: {},
    generationJob: null,
    lastError: null,
  })
}

describe('plan generation callbacks - switch guard', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    vi.clearAllMocks()
    mocks.authUser = null
    mocks.supabase = null
    mocks.buildPlanShell.mockReturnValue({ plan: makePlan(), weeks: [makeWeek()] })
    mocks.commitPlan.mockResolvedValue({ errors: [], warnings: [] })
    mocks.getLatestPlanGenerationJob.mockResolvedValue(null)
    mocks.getRunnablePlanGenerationJobs.mockResolvedValue([])
    mocks.triggerBackgroundGeneration.mockResolvedValue(undefined)
    mocks.pollPlanGeneration.mockResolvedValue(null)
    mocks.pushTrainingPlan.mockResolvedValue(undefined)
    mocks.assertPlanBuilderWeekRateLimit.mockResolvedValue(undefined)
    mocks.reservePlanBuilderWeekUsage.mockResolvedValue(undefined)
    mocks.releasePlanBuilderWeekReservations.mockResolvedValue(undefined)
    mocks.syncPlanBuilderWeekUsageFromWeeks.mockResolvedValue(undefined)
    resetPlanBuilderStore()
  })

  afterEach(() => {
    db.close()
    resetPlanBuilderStore()
  })

  it('does not write state from a late onError after an athlete switch', () => {
    const callbacks = buildRunnerCallbacks(
      usePlanBuilderStore.setState,
      usePlanBuilderStore.getState,
    )

    bumpSwitchEpoch()
    callbacks.onError?.('fallo tardio del atleta anterior')

    expect(usePlanBuilderStore.getState().lastError).toBeNull()
    expect(usePlanBuilderStore.getState().status).toBe('idle')
  })

  it('uses the supplied switch epoch for callbacks created after a switch', () => {
    const epochBeforeSwitch = getSwitchEpoch()
    bumpSwitchEpoch()
    const callbacks = buildRunnerCallbacks(
      usePlanBuilderStore.setState,
      usePlanBuilderStore.getState,
      epochBeforeSwitch,
    )

    callbacks.onError?.('fallo tardio del atleta anterior')

    expect(usePlanBuilderStore.getState().lastError).toBeNull()
    expect(usePlanBuilderStore.getState().status).toBe('idle')
  })

  it('writes state when no switch happened', () => {
    const callbacks = buildRunnerCallbacks(
      usePlanBuilderStore.setState,
      usePlanBuilderStore.getState,
    )

    callbacks.onError?.('fallo real')

    expect(usePlanBuilderStore.getState().lastError).toBe('fallo real')
  })

  it('ignores late runner callbacks after the builder state was reset', () => {
    const plan = makePlan()
    const week = makeWeek()
    usePlanBuilderStore.setState({
      plan,
      weeks: [week],
      status: 'generating',
    })
    const callbacks = buildRunnerCallbacks(
      usePlanBuilderStore.setState,
      usePlanBuilderStore.getState,
    )

    usePlanBuilderStore.getState().resetBuilderState()
    callbacks.onWeekUpdate?.({ ...week, status: 'draft' })
    callbacks.onPlanUpdate?.({ ...plan, generationState: 'complete' }, [week])
    callbacks.onJobUpdate?.(makeJob())
    callbacks.onError?.('fallo tardío')

    expect(usePlanBuilderStore.getState()).toMatchObject({
      plan: null,
      weeks: [],
      generationJob: null,
      status: 'idle',
      completedWeeks: 0,
      lastError: null,
    })
  })

  it('does not write status or lastError from a late runPlanGenerationJob rejection after an athlete switch', async () => {
    const run = deferred<void>()
    mocks.createPlanGenerationJob.mockResolvedValue(makeJob())
    mocks.runPlanGenerationJob.mockReturnValue(run.promise)
    usePlanBuilderStore.setState({
      plan: makePlan(),
      weeks: [makeWeek()],
      status: 'shell_ready',
    })

    await usePlanBuilderStore.getState().runGeneration(makeProfile())
    expect(usePlanBuilderStore.getState().status).toBe('generating')

    bumpSwitchEpoch()
    usePlanBuilderStore.getState().resetForAthleteSwitch()
    run.reject(new Error('fallo local tardio'))
    await flushPromises()

    expect(usePlanBuilderStore.getState().status).toBe('idle')
    expect(usePlanBuilderStore.getState().lastError).toBeNull()
  })

  it('writes status and lastError from runPlanGenerationJob rejection when no switch happened', async () => {
    const run = deferred<void>()
    mocks.createPlanGenerationJob.mockResolvedValue(makeJob())
    mocks.runPlanGenerationJob.mockReturnValue(run.promise)
    usePlanBuilderStore.setState({
      plan: makePlan(),
      weeks: [makeWeek()],
      status: 'shell_ready',
    })

    await usePlanBuilderStore.getState().runGeneration(makeProfile())
    run.reject(new Error('fallo local real'))
    await flushPromises()

    expect(usePlanBuilderStore.getState().status).toBe('error')
    expect(usePlanBuilderStore.getState().lastError).toBe('fallo local real')
  })

  it('does not write an async resume error after an athlete switch', async () => {
    const lookup = deferred<PlanGenerationJob[]>()
    mocks.getRunnablePlanGenerationJobs.mockReturnValue(lookup.promise)

    const resume = usePlanBuilderStore.getState().resumeGenerationJobs(makeProfile())
    bumpSwitchEpoch()
    usePlanBuilderStore.getState().resetForAthleteSwitch()
    lookup.reject(new Error('resume tardio'))
    await resume

    expect(usePlanBuilderStore.getState().status).toBe('idle')
    expect(usePlanBuilderStore.getState().lastError).toBeNull()
  })

  it('does not write a late draft after an athlete switch', async () => {
    mocks.buildPlanShell.mockImplementation(() => {
      bumpSwitchEpoch()
      usePlanBuilderStore.getState().resetForAthleteSwitch()
      return { plan: makePlan(), weeks: [makeWeek()] }
    })

    await usePlanBuilderStore.getState().createDraft({
      profile: makeProfileWithGoal(),
      wizardConfig: makePlan().wizardConfig,
    })

    expect(usePlanBuilderStore.getState().status).toBe('idle')
    expect(usePlanBuilderStore.getState().plan).toBeNull()
  })

  it('does not start a remote poller for the previous athlete after a switch during enqueue', async () => {
    const enqueue = deferred<void>()
    mocks.authUser = { id: 'user-1' }
    mocks.supabase = {}
    mocks.triggerBackgroundGeneration.mockReturnValue(enqueue.promise)
    usePlanBuilderStore.setState({
      plan: makePlan(),
      weeks: [makeWeek()],
      status: 'shell_ready',
    })

    const run = usePlanBuilderStore.getState().runGeneration(makeProfile())
    await waitUntil(() => {
      expect(mocks.triggerBackgroundGeneration).toHaveBeenCalled()
      expect(usePlanBuilderStore.getState().status).toBe('generating')
    })

    bumpSwitchEpoch()
    usePlanBuilderStore.getState().resetForAthleteSwitch()
    enqueue.resolve()
    await run

    expect(usePlanBuilderStore.getState().status).toBe('idle')
    expect(usePlanBuilderStore.getState().plan).toBeNull()
    expect(mocks.pollPlanGeneration).not.toHaveBeenCalled()
  })

  it('does not write a late cancellation after an athlete switch', async () => {
    const push = deferred<void>()
    mocks.pushTrainingPlan.mockReturnValue(push.promise)
    usePlanBuilderStore.setState({
      plan: { ...makePlan(), generationState: 'generating' },
      weeks: [makeWeek()],
      status: 'generating',
    })

    const cancel = usePlanBuilderStore.getState().cancelGeneration()
    await waitUntil(() => {
      expect(mocks.pushTrainingPlan).toHaveBeenCalled()
    })

    bumpSwitchEpoch()
    usePlanBuilderStore.getState().resetForAthleteSwitch()
    push.resolve()
    await cancel

    expect(usePlanBuilderStore.getState().status).toBe('idle')
    expect(usePlanBuilderStore.getState().plan).toBeNull()
  })

  it('does not write a late accept result after an athlete switch', async () => {
    const commit = deferred<{ errors: string[]; warnings: string[] }>()
    mocks.commitPlan.mockReturnValue(commit.promise)
    usePlanBuilderStore.setState({
      plan: { ...makePlan(), generationState: 'complete' },
      weeks: [{ ...makeWeek(), status: 'draft' }],
      status: 'ready',
    })

    const accept = usePlanBuilderStore.getState().acceptPlan()
    await waitUntil(() => {
      expect(mocks.commitPlan).toHaveBeenCalled()
      expect(usePlanBuilderStore.getState().status).toBe('committing')
    })

    bumpSwitchEpoch()
    usePlanBuilderStore.getState().resetForAthleteSwitch()
    commit.resolve({ errors: [], warnings: [] })
    const result = await accept

    expect(result).toEqual({ errors: [], warnings: [] })
    expect(usePlanBuilderStore.getState().status).toBe('idle')
    expect(usePlanBuilderStore.getState().plan).toBeNull()
  })
})
