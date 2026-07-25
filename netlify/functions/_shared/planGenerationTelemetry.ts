import type { PlanGenerationAttemptTelemetry } from '../../../src/services/planBuilder/asyncGenerationLoop'

interface AttemptInsertClient {
  from(table: string): {
    upsert(
      row: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ): PromiseLike<{ error: { code?: string } | null }>
  }
}

export function planGenerationAttemptToRow(
  attempt: PlanGenerationAttemptTelemetry,
  userId: string,
): Record<string, unknown> {
  return {
    user_id: userId,
    athlete_id: attempt.athleteId,
    plan_id: attempt.planId,
    job_id: attempt.jobId,
    week_index: attempt.weekIndex,
    attempt: attempt.attempt,
    trace_id: attempt.traceId,
    provider: attempt.provider,
    model: attempt.model ?? null,
    input_tokens: attempt.promptTokens ?? null,
    output_tokens: attempt.completionTokens ?? null,
    cache_creation_input_tokens: attempt.cacheCreationInputTokens ?? null,
    cache_read_input_tokens: attempt.cacheReadInputTokens ?? null,
    duration_ms: attempt.durationMs ?? null,
    stop_reason: attempt.finishReason ?? null,
    outcome: attempt.outcome,
    error_class: attempt.errorClass ?? null,
    retry_used: attempt.retryUsed,
    max_tokens: attempt.maxTokens,
    worker_concurrency: attempt.workerConcurrency,
    raw_session_count: attempt.rawSessionCount ?? null,
    valid_session_count: attempt.validSessionCount ?? null,
    dropped_session_count: attempt.droppedSessionCount ?? null,
    repaired_session_count: attempt.repairedSessionCount ?? null,
    added_fallback_count: attempt.addedFallbackCount ?? null,
    quality_score: attempt.qualityScore ?? null,
    quality_grade: attempt.qualityGrade ?? null,
    quality_critical_issue_count: attempt.qualityCriticalIssueCount ?? null,
    quality_warning_count: attempt.qualityWarningCount ?? null,
    variant_id: attempt.variantId ?? null,
    effort: attempt.effort ?? null,
    thinking_mode: attempt.thinkingMode ?? null,
    prompt_version: attempt.promptVersion ?? null,
    schema_version: attempt.schemaVersion ?? null,
    quality_version: attempt.qualityVersion ?? null,
    repair_taxonomy_version: attempt.repairTaxonomyVersion ?? null,
    corrective_action_count: attempt.correctiveActionCount ?? null,
    structural_action_count: attempt.structuralActionCount ?? null,
    hydration_action_count: attempt.hydrationActionCount ?? null,
    moved_session_count: attempt.movedSessionCount ?? null,
    filtered_sport_count: attempt.filteredSportCount ?? null,
    hydrated_sessions_affected: attempt.hydratedSessionsAffected ?? null,
    corrected_sessions_affected: attempt.correctedSessionsAffected ?? null,
    structurally_repaired_sessions_affected: attempt.structurallyRepairedSessionsAffected ?? null,
    created_at: new Date(attempt.createdAt).toISOString(),
  }
}

/** Insert append-only telemetry, ignoring only the durable replay identity. */
export async function insertPlanGenerationAttempt(
  client: AttemptInsertClient,
  attempt: PlanGenerationAttemptTelemetry,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from('plan_generation_attempts')
    .upsert(planGenerationAttemptToRow(attempt, userId), {
      onConflict: 'job_id,week_index,attempt',
      ignoreDuplicates: true,
    })
  if (!error) return
  throw Object.assign(new Error('plan generation telemetry insert failed'), { code: error.code })
}
