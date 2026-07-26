import { describe, expect, it, vi } from 'vitest'

import { resolveEffectivePlanBuilderConfig } from '../../../../netlify/functions/_shared/planBuilderRunConfig'
import {
  runAsyncPlanGeneration,
  type PlanGenerationAttemptTelemetry,
  type PlanGenerationJobTelemetry,
  type PlanGenerationJobVariant,
} from '../asyncGenerationLoop'
import { buildVariantId } from '../telemetryVersions'
import { makeRunInputForTest } from './helpers/asyncLoopTestFixtures'

vi.mock('../qualityReview', async (importActual) => {
  const actual = await importActual<typeof import('../qualityReview')>()
  return { ...actual, PRODUCTIVE_QUALITY_VERSION: 2 as const }
})

const LEGACY_VARIANT: PlanGenerationJobVariant = {
  provider: 'claude',
  model: 'claude-sonnet-4-6',
  effort: 'omitted',
  thinkingMode: 'omitted',
  temperature: 0.25,
  maxTokens: 5000,
  promptVersion: 'p',
  schemaVersion: 's',
  qualityVersion: 1,
  concurrency: 3,
  variantId: 's46-q1-test',
}

describe('quality version stamping', () => {
  it('stamps the effective run version on every generated week', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 2 })
    const written: { weekIndex: number, qualityVersion?: 1 | 2 }[] = []
    const writer = {
      ...base,
      async putWeek(week: {
        weekIndex: number
        generationMeta: { qualityVersion?: 1 | 2 }
        status: string
      }) {
        if (week.status === 'draft') {
          written.push({
            weekIndex: week.weekIndex,
            qualityVersion: week.generationMeta.qualityVersion,
          })
        }
      },
    }

    await runAsyncPlanGeneration({ ...input, writer: writer as never })

    expect(written).toHaveLength(2)
    for (const week of written) expect(week.qualityVersion).toBe(2)
  })

  it('uses a supplied descriptor as the authority for weeks, attempts and the job', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 1 })
    const weeks: Array<1 | 2 | undefined> = []
    const attempts: PlanGenerationAttemptTelemetry[] = []
    const jobs: PlanGenerationJobTelemetry[] = []
    const writer = {
      ...base,
      async putWeek(week: {
        generationMeta: { qualityVersion?: 1 | 2 }
        status: string
      }) {
        if (week.status === 'draft') weeks.push(week.generationMeta.qualityVersion)
      },
      async putAttempt(attempt: PlanGenerationAttemptTelemetry) {
        attempts.push(attempt)
      },
      async putJob(job: PlanGenerationJobTelemetry) {
        jobs.push(job)
      },
    }

    await runAsyncPlanGeneration({
      ...input,
      writer: writer as never,
      variant: LEGACY_VARIANT,
    })

    const canonicalVariantId = buildVariantId(LEGACY_VARIANT)
    expect(weeks).toEqual([1])
    expect(attempts).toHaveLength(1)
    expect(attempts[0].qualityVersion).toBe(1)
    expect(attempts[0].variantId).toBe(canonicalVariantId)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].variant.qualityVersion).toBe(1)
    expect(jobs[0].variant.variantId).toBe(canonicalVariantId)
  })

  it('lets the handler config carry an explicitly resolved run version', () => {
    expect(resolveEffectivePlanBuilderConfig({} as NodeJS.ProcessEnv, 1).qualityVersion).toBe(1)
  })
})
