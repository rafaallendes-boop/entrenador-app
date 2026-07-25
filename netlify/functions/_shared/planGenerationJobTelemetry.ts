import type { PlanGenerationJobTelemetry } from '../../../src/services/planBuilder/asyncGenerationLoop'

interface JobInsertClient {
  from(table: string): {
    upsert(
      row: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ): PromiseLike<{ error: { code?: string } | null }>
  }
}

export function planGenerationJobToRow(
  job: PlanGenerationJobTelemetry,
  userId: string,
): Record<string, unknown> {
  return {
    job_id: job.jobId,
    user_id: userId,
    athlete_id: job.athleteId,
    plan_id: job.planId,
    enqueued_at: new Date(job.enqueuedAt).toISOString(),
    worker_started_at: new Date(job.workerStartedAt).toISOString(),
    week_count_requested: job.weekCountRequested,
    week_count_succeeded: job.weekCountSucceeded,
    week_count_failed: job.weekCountFailed,
    worker_concurrency: job.workerConcurrency,
    first_week_ready_ms: job.firstWeekReadyMs,
    first_week_ready_e2e_ms: job.firstWeekReadyE2eMs,
    plan_complete_ms: job.planCompleteMs,
    terminal_ms: job.terminalMs,
    first_week_discoverable_estimated_ms: null,
    previous_week_context_source: job.previousWeekContextSource,
    provider: job.variant.provider,
    model: job.variant.model,
    effort: job.variant.effort,
    thinking_mode: job.variant.thinkingMode,
    temperature: job.variant.temperature,
    max_tokens: job.variant.maxTokens,
    prompt_version: job.variant.promptVersion,
    schema_version: job.variant.schemaVersion,
    quality_version: job.variant.qualityVersion,
    variant_id: job.variant.variantId,
    total_input_tokens: job.totalInputTokens,
    total_output_tokens: job.totalOutputTokens,
    total_cache_read_tokens: job.totalCacheReadTokens,
    total_cache_creation_tokens: job.totalCacheCreationTokens,
    estimated_cost_usd: job.estimatedCostUsd,
    outcome: job.outcome,
    created_at: new Date(job.createdAt).toISOString(),
  }
}

export async function upsertPlanGenerationJob(
  client: JobInsertClient,
  job: PlanGenerationJobTelemetry,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from('plan_generation_jobs')
    .upsert(planGenerationJobToRow(job, userId), { onConflict: 'job_id', ignoreDuplicates: true })
  if (!error) return
  throw Object.assign(new Error('plan generation job telemetry insert failed'), { code: error.code })
}
