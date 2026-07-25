import { describe, expect, it, vi } from 'vitest'
import type { PlanGenerationAttemptTelemetry } from '../../../src/services/planBuilder/asyncGenerationLoop'
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

const RICH: PlanGenerationAttemptTelemetry = {
  athleteId: 'a', planId: 'p', jobId: 'j', weekIndex: 0, attempt: 1,
  traceId: 't', provider: 'claude', outcome: 'succeeded',
  retryUsed: false, maxTokens: 5000, workerConcurrency: 3, createdAt: 1,
  variantId: 's46-q1-abcd1234',
  effort: 'omitted',
  thinkingMode: 'omitted',
  promptVersion: '2026-07-week-v1',
  schemaVersion: '2026-07-week-v1',
  qualityVersion: 1,
  repairTaxonomyVersion: 2,
  correctiveActionCount: 2,
  structuralActionCount: 1,
  hydrationActionCount: 9,
  movedSessionCount: 0,
  filteredSportCount: 0,
  hydratedSessionsAffected: 7,
  correctedSessionsAffected: 2,
  structurallyRepairedSessionsAffected: 1,
}

describe('planGenerationAttemptToRow variant + taxonomy', () => {
  it('maps variant and full taxonomy (incl. affected-session counters)', () => {
    const row = planGenerationAttemptToRow(RICH, 'user-1')
    expect(row['variant_id']).toBe('s46-q1-abcd1234')
    expect(row['effort']).toBe('omitted')
    expect(row['prompt_version']).toBe('2026-07-week-v1')
    expect(row['quality_version']).toBe(1)
    expect(row['repair_taxonomy_version']).toBe(2)
    expect(row['corrective_action_count']).toBe(2)
    expect(row['structural_action_count']).toBe(1)
    expect(row['hydration_action_count']).toBe(9)
    expect(row['moved_session_count']).toBe(0)
    expect(row['filtered_sport_count']).toBe(0)
    expect(row['hydrated_sessions_affected']).toBe(7)
    expect(row['corrected_sessions_affected']).toBe(2)
    expect(row['structurally_repaired_sessions_affected']).toBe(1)
  })

  it('nulls the new fields for a legacy attempt', () => {
    const legacy: PlanGenerationAttemptTelemetry = {
      athleteId: 'a', planId: 'p', jobId: 'j', weekIndex: 0, attempt: 1,
      traceId: 't', provider: 'claude', outcome: 'succeeded',
      retryUsed: false, maxTokens: 5000, workerConcurrency: 3, createdAt: 1,
    }
    const row = planGenerationAttemptToRow(legacy, 'user-1')
    expect(row['variant_id']).toBeNull()
    expect(row['repair_taxonomy_version']).toBeNull()
    expect(row['hydrated_sessions_affected']).toBeNull()
  })
})
