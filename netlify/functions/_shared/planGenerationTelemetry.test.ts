import { describe, expect, it, vi } from 'vitest'
import { insertPlanGenerationAttempt, planGenerationAttemptToRow } from './planGenerationTelemetry'

describe('planGenerationAttemptToRow', () => {
  it('maps operational metrics and never adds prompt or response content', () => {
    const row = planGenerationAttemptToRow({
      athleteId: 'ath-1',
      planId: 'plan-1',
      jobId: 'job-1',
      weekIndex: 2,
      attempt: 1,
      traceId: 'job-1-week-2',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      promptTokens: 1200,
      completionTokens: 340,
      cacheCreationInputTokens: 900,
      cacheReadInputTokens: 250,
      durationMs: 4321,
      finishReason: 'end_turn',
      outcome: 'succeeded',
      retryUsed: false,
      maxTokens: 5000,
      workerConcurrency: 3,
      rawSessionCount: 5,
      validSessionCount: 4,
      droppedSessionCount: 1,
      repairedSessionCount: 2,
      addedFallbackCount: 0,
      qualityScore: 86,
      qualityGrade: 'good',
      qualityCriticalIssueCount: 0,
      qualityWarningCount: 2,
      createdAt: Date.parse('2026-07-12T12:00:00.000Z'),
    }, 'user-1')

    expect(row).toMatchObject({
      user_id: 'user-1',
      athlete_id: 'ath-1',
      plan_id: 'plan-1',
      job_id: 'job-1',
      week_index: 2,
      attempt: 1,
      input_tokens: 1200,
      output_tokens: 340,
      cache_creation_input_tokens: 900,
      cache_read_input_tokens: 250,
      duration_ms: 4321,
      outcome: 'succeeded',
      max_tokens: 5000,
      worker_concurrency: 3,
      raw_session_count: 5,
      valid_session_count: 4,
      dropped_session_count: 1,
      repaired_session_count: 2,
      added_fallback_count: 0,
      quality_score: 86,
      quality_grade: 'good',
      quality_critical_issue_count: 0,
      quality_warning_count: 2,
      created_at: '2026-07-12T12:00:00.000Z',
    })
    expect(row).not.toHaveProperty('prompt')
    expect(row).not.toHaveProperty('response')
    expect(row).not.toHaveProperty('sessions')
  })

  it('writes absent optional metrics as null for stable database rows', () => {
    const row = planGenerationAttemptToRow({
      athleteId: 'ath-1',
      planId: 'plan-1',
      jobId: 'job-1',
      weekIndex: 0,
      attempt: 2,
      traceId: 'trace-2',
      provider: 'claude',
      outcome: 'provider_failed',
      retryUsed: true,
      maxTokens: 12000,
      workerConcurrency: 2,
      createdAt: 0,
    }, 'user-1')

    expect(row.model).toBeNull()
    expect(row.input_tokens).toBeNull()
    expect(row.error_class).toBeNull()
    expect(row.retry_used).toBe(true)
  })

  it('scopes idempotent replays to job/week/attempt instead of traceId', async () => {
    const upsert = vi.fn(async () => ({ error: null }))
    const client = { from: () => ({ upsert }) }
    await expect(insertPlanGenerationAttempt(client, {
      athleteId: 'ath-1', planId: 'plan-1', jobId: 'job-1', weekIndex: 0,
      attempt: 1, traceId: 'trace-1', provider: 'claude', outcome: 'succeeded',
      retryUsed: false, maxTokens: 5000, workerConcurrency: 3, createdAt: 0,
    }, 'user-1')).resolves.toBeUndefined()
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ trace_id: 'trace-1' }), {
      onConflict: 'job_id,week_index,attempt',
      ignoreDuplicates: true,
    })
  })

  it('rejects non-idempotent database errors without exposing their message', async () => {
    const client = { from: () => ({ upsert: async () => ({ error: { code: '42501' } }) }) }
    await expect(insertPlanGenerationAttempt(client, {
      athleteId: 'ath-1', planId: 'plan-1', jobId: 'job-1', weekIndex: 0,
      attempt: 1, traceId: 'trace-1', provider: 'claude', outcome: 'provider_failed',
      retryUsed: false, maxTokens: 5000, workerConcurrency: 3, createdAt: 0,
    }, 'user-1')).rejects.toMatchObject({ code: '42501' })
  })
})
