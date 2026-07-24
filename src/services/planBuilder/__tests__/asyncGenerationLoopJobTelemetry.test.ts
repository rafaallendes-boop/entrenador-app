import { describe, expect, it, vi } from 'vitest'

import {
  runAsyncPlanGeneration,
  type AsyncPlanGenerationWriter,
  type PlanGenerationJobTelemetry,
  type PlanGenerationJobVariant,
} from '../asyncGenerationLoop'
import { makeRunInputForTest } from './helpers/asyncLoopTestFixtures'

// El fallback local recupera cualquier semana "normal" a `draft`, así que para
// ejercitar los caminos de error (partial/failed) lo deshabilitamos: cuando la
// semana no produce sesiones vía LLM, el fallback lanza y la semana queda en
// `error` a través de `makeErroredWeekFromResult`, un camino real del loop.
vi.mock('../fallbackWeek', async (importActual) => {
  const actual = await importActual<typeof import('../fallbackWeek')>()
  return {
    ...actual,
    buildLocalFallbackWeek: () => {
      throw new Error('fallback disabled for job telemetry tests')
    },
  }
})

const VARIANT: PlanGenerationJobVariant = {
  provider: 'claude', model: 'claude-sonnet-4-6', effort: 'omitted', thinkingMode: 'omitted',
  temperature: 0.25, maxTokens: 5000, promptVersion: 'v', schemaVersion: 'v',
  qualityVersion: 1, concurrency: 3, variantId: 's46-q1-abcd1234',
}

function collecting(base: AsyncPlanGenerationWriter, opts?: { rejectPutJob?: boolean }) {
  const jobs: PlanGenerationJobTelemetry[] = []
  return {
    jobs,
    writer: {
      ...base,
      async putJob(job: PlanGenerationJobTelemetry) {
        if (opts?.rejectPutJob) throw new Error('supabase down')
        jobs.push(job)
      },
    } as AsyncPlanGenerationWriter,
  }
}

describe('runAsyncPlanGeneration job telemetry', () => {
  it('emits one succeeded job with worker-relative and e2e timings', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 2, enqueuedAt: 1_000 })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })

    expect(jobs).toHaveLength(1)
    const job = jobs[0]
    expect(job.outcome).toBe('succeeded')
    expect(job.weekCountSucceeded).toBe(2)
    expect(job.firstWeekReadyE2eMs! - job.firstWeekReadyMs!).toBe(job.workerStartedAt - job.enqueuedAt)
    expect(job.planCompleteMs).not.toBeNull()
    expect(job.planCompleteMs).toBeLessThanOrEqual(job.terminalMs)
  })

  it('sums tokens across MULTIPLE attempts and prices the run', async () => {
    const { input, base } = makeRunInputForTest({
      weekCount: 1, attemptsPerWeek: 2, tokensPerAttempt: { input: 4000, output: 1500 },
    })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })
    expect(jobs[0].totalInputTokens).toBe(8000)
    expect(jobs[0].totalOutputTokens).toBe(3000)
    // (8000/1e6*3) + (3000/1e6*15) = 0.024 + 0.045 = 0.069
    expect(jobs[0].estimatedCostUsd).toBeCloseTo(0.069, 6)
  })

  it('nulls cost when a billable attempt reports no usage', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 1, omitUsage: true })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })
    expect(jobs[0].estimatedCostUsd).toBeNull()
  })

  it('reports partial when some weeks fail without budget exhaustion', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 2, someWeekFails: true })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })
    expect(jobs[0].outcome).toBe('partial')
  })

  it('reports budget_exhausted even when some weeks succeeded', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 4, budgetExhaust: true })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })
    expect(jobs[0].outcome).toBe('budget_exhausted')
    expect(jobs[0].weekCountSucceeded).toBeGreaterThan(0)
  })

  it('reports failed when every week errors', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 2, failAllWeeks: true })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })
    expect(jobs[0].outcome).toBe('failed')
  })

  it('marks cancelled and leaves plan_complete_ms null (weeks pending)', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 2, cancelAfterFirstWeek: true })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })
    expect(jobs[0].outcome).toBe('cancelled')
    expect(jobs[0].planCompleteMs).toBeNull()
  })

  it('emits a failed job when the run throws, then rethrows', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 1 })
    const throwing: AsyncPlanGenerationWriter = {
      ...base,
      async putWeek() { throw new Error('writer exploded') },
    }
    const { writer, jobs } = collecting(throwing)
    await expect(runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })).rejects.toThrow('writer exploded')
    expect(jobs).toHaveLength(1)
    expect(jobs[0].outcome).toBe('failed')
  })

  it('does not throw out of the run when putJob rejects', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 1 })
    const { writer } = collecting(base, { rejectPutJob: true })
    await expect(runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })).resolves.toBeDefined()
  })

  it('does not throw when the writer has no putJob', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 1 })
    const noJob: AsyncPlanGenerationWriter = { ...base }
    delete (noJob as { putJob?: unknown }).putJob
    await expect(runAsyncPlanGeneration({ ...input, writer: noJob, variant: VARIANT })).resolves.toBeDefined()
  })
})
