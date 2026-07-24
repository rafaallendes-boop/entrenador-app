import { describe, expect, it } from 'vitest'

import type { PlanGenerationJobTelemetry } from '../../../../src/services/planBuilder/asyncGenerationLoop'
import { planGenerationJobToRow } from '../planGenerationJobTelemetry'

const JOB: PlanGenerationJobTelemetry = {
  jobId: 'job-1', athleteId: 'athlete-1', planId: 'plan-1',
  enqueuedAt: 1_000, workerStartedAt: 3_000,
  weekCountRequested: 4, weekCountSucceeded: 4, weekCountFailed: 0, workerConcurrency: 3,
  firstWeekReadyMs: 8_000, firstWeekReadyE2eMs: 10_000, planCompleteMs: 40_000, terminalMs: 40_000,
  previousWeekContextSource: 'ready',
  totalInputTokens: 12_000, totalOutputTokens: 4_000, totalCacheReadTokens: 0, totalCacheCreationTokens: 0,
  estimatedCostUsd: 0.096, outcome: 'succeeded',
  variant: {
    provider: 'claude', model: 'claude-sonnet-4-6', effort: 'omitted', thinkingMode: 'omitted',
    temperature: 0.25, maxTokens: 5000, promptVersion: 'v', schemaVersion: 'v',
    qualityVersion: 1, concurrency: 3, variantId: 's46-q1-abcd1234',
  },
  createdAt: 43_000,
}

describe('planGenerationJobToRow', () => {
  it('maps provider claude and every field to a snake_case column', () => {
    const row = planGenerationJobToRow(JOB, 'user-1')
    expect(row['provider']).toBe('claude')
    expect(row).toEqual({
      job_id: 'job-1', user_id: 'user-1', athlete_id: 'athlete-1', plan_id: 'plan-1',
      enqueued_at: new Date(1_000).toISOString(), worker_started_at: new Date(3_000).toISOString(),
      week_count_requested: 4, week_count_succeeded: 4, week_count_failed: 0, worker_concurrency: 3,
      first_week_ready_ms: 8_000, first_week_ready_e2e_ms: 10_000, plan_complete_ms: 40_000, terminal_ms: 40_000,
      first_week_discoverable_estimated_ms: null,
      previous_week_context_source: 'ready',
      provider: 'claude', model: 'claude-sonnet-4-6', effort: 'omitted', thinking_mode: 'omitted',
      temperature: 0.25, max_tokens: 5000, prompt_version: 'v', schema_version: 'v',
      quality_version: 1, variant_id: 's46-q1-abcd1234',
      total_input_tokens: 12_000, total_output_tokens: 4_000, total_cache_read_tokens: 0, total_cache_creation_tokens: 0,
      estimated_cost_usd: 0.096, outcome: 'succeeded', created_at: new Date(43_000).toISOString(),
    })
  })

  it('nulls timings and cost that were not observed', () => {
    const row = planGenerationJobToRow(
      { ...JOB, firstWeekReadyMs: null, firstWeekReadyE2eMs: null, planCompleteMs: null, estimatedCostUsd: null },
      'user-1',
    )
    expect(row['first_week_ready_ms']).toBeNull()
    expect(row['plan_complete_ms']).toBeNull()
    expect(row['estimated_cost_usd']).toBeNull()
  })
})
