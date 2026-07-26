import type { Handler } from '@netlify/functions'
import type { TrainingPlan } from '../../src/types/planBuilder'
import { shouldDedupeActiveGeneration } from '../../src/services/planBuilder/activeGeneration'
import type { PlanGenerationJobVariant } from '../../src/services/planBuilder/asyncGenerationLoop'
import { emitUnstartedJobTelemetry, runAsyncPlanGeneration } from '../../src/services/planBuilder/asyncGenerationLoop'
import {
  PRODUCTIVE_QUALITY_VERSION,
  resolveEffectiveRunQualityVersion,
} from '../../src/services/planBuilder/qualityReview'
import { buildVariantId } from '../../src/services/planBuilder/telemetryVersions'
import { callAnthropicForWeek } from './_shared/anthropicCaller'
import { resolveEffectivePlanBuilderConfig } from './_shared/planBuilderRunConfig'
import {
  createJobId,
  createSupabaseWriter,
  isGeneratePlanPayload,
  json,
  resolveAuthContext,
} from './_shared/planGenerationShared'

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  let body: unknown
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  if (!isGeneratePlanPayload(body)) {
    return json(400, { error: 'Payload inválido para generar plan.' })
  }

  // Fallback de telemetría para los checkpoints previos al loop: mientras esto
  // no sea null, la corrida no tiene dueño de su fila de job y este handler es
  // responsable de emitirla si algo falla.
  let emitUnstartedJob: (() => Promise<void>) | null = null
  try {
    const auth = await resolveAuthContext(event)
    const writer = createSupabaseWriter(auth.userId, auth.token)
    const startedAt = Date.now()
    const planId = body.plan.id
    const weekCount = body.weeks.length
    // Adopt the durable jobId written by the enqueue endpoint; only mint a new one
    // when invoked directly (e.g. legacy path / local tooling).
    const jobId = typeof body.jobId === 'string' && body.jobId ? body.jobId : createJobId(planId)
    // La versión efectiva se resuelve ANTES del descriptor: `buildVariantId`
    // embebe `qualityVersion`, así que resolverla después dejaría un variantId
    // q2 sobre una corrida puntuada con v1.
    const effectiveQualityVersion = resolveEffectiveRunQualityVersion({
      weeks: body.weeks,
      targetWeekIndexes: body.targetWeekIndexes,
      productiveVersion: PRODUCTIVE_QUALITY_VERSION,
    })
    const effectiveConfig = resolveEffectivePlanBuilderConfig(
      process.env,
      effectiveQualityVersion,
    )
    const variant: PlanGenerationJobVariant = {
      ...effectiveConfig,
      variantId: buildVariantId(effectiveConfig),
    }
    // Solo adoptar el startedAt previo si pertenece a ESTE job; si no, es otra
    // corrida (o un plan ya completado) y usamos el worker start. Arranca en el
    // worker start para que el fallback pueda emitir aunque `getPlan` falle.
    let enqueuedAt = startedAt
    emitUnstartedJob = () => emitUnstartedJobTelemetry({
      jobId,
      athleteId: body.plan.athleteId,
      planId,
      enqueuedAt,
      workerStartedAt: startedAt,
      weekCountRequested: body.targetWeekIndexes?.length ? body.targetWeekIndexes.length : weekCount,
      workerConcurrency: effectiveConfig.concurrency,
      variant,
      writer,
    })

    const existingPlan = await writer.getPlan(planId)
    if (existingPlan?.generationSummary?.jobId === jobId) {
      enqueuedAt = existingPlan.generationSummary.startedAt
    }
    if (shouldDedupeActiveGeneration(existingPlan, jobId, startedAt)) {
      // No hubo corrida propia: la fila del job la emite quien esté generando.
      emitUnstartedJob = null
      const existingJobId = existingPlan?.generationSummary?.jobId
      console.log(`[generate-plan] dedupe active planId=${planId} jobId=${existingJobId ?? 'unknown'}`)
      return json(202, { ok: true, deduped: true, jobId: existingJobId })
    }

    const targetsLabel = body.targetWeekIndexes?.length ? body.targetWeekIndexes.join(',') : 'all'
    console.log(`[generate-plan] start planId=${planId} weeks=${weekCount} targets=${targetsLabel} jobId=${jobId}`)

    const plan: TrainingPlan = {
      ...body.plan,
      generationState: 'generating',
      updatedAt: startedAt,
      generationSummary: {
        startedAt,
        jobId,
        strategy: 'single',
        completedWeeks: 0,
        failedWeeks: [],
        totalAttempts: 0,
        heartbeatAt: startedAt,
      },
    }

    await writer.putPlan(plan)
    await Promise.all(body.weeks.map((week) => writer.putWeek(week)))
    console.log(`[generate-plan] initial writes ok planId=${planId}`)

    const result = await runAsyncPlanGeneration({
      plan,
      weeks: body.weeks,
      profile: body.profile,
      wizardConfig: body.wizardConfig,
      recentContext: body.recentContext,
      targetWeekIndexes: body.targetWeekIndexes,
      repairInstructions: body.repairInstructions,
      jobId,
      writer,
      callLLM: callAnthropicForWeek,
      concurrency: effectiveConfig.concurrency,
      enqueuedAt,
      variant,
      // El loop avisa cuando su `finalizeJob` ya está armado; recién ahí este
      // handler suelta el fallback. Antes de eso el preámbulo del loop todavía
      // puede lanzar (el payload validado no garantiza semanas bien formadas).
      onJobFinalizerArmed: () => {
        emitUnstartedJob = null
      },
    })

    const finalState = result.plan.generationState
    const completed = result.plan.generationSummary?.completedWeeks ?? 0
    const failed = result.plan.generationSummary?.failedWeeks?.length ?? 0
    const durationMs = Date.now() - startedAt
    const failedErrors = result.weeks
      .filter((w) => w.status === 'error')
      .map((w) => `w${w.weekIndex}:${w.generationMeta.lastError ?? 'unknown'}`)
    console.log(`[generate-plan] done planId=${planId} state=${finalState} completed=${completed} failed=${failed} durationMs=${durationMs}`)
    if (failedErrors.length > 0) {
      console.error(`[generate-plan] week errors planId=${planId}: ${failedErrors.join(' | ')}`)
    }

    return json(202, { ok: true, jobId })
  } catch (error) {
    if (emitUnstartedJob) await emitUnstartedJob()
    const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[generate-plan] error planId=${(body as { plan?: { id?: string } })?.plan?.id ?? 'unknown'}: ${message}`)
    return json(statusCode, { error: message })
  }
}
