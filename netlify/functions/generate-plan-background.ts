import type { Handler } from '@netlify/functions'
import type { TrainingPlan } from '../../src/types/planBuilder'
import type { AIRawResponse, AIRequest } from '../../src/services/ai/types'
import { shouldDedupeActiveGeneration } from '../../src/services/planBuilder/activeGeneration'
import type {
  AsyncPlanGenerationWriter,
  PlanGenerationJobVariant,
} from '../../src/services/planBuilder/asyncGenerationLoop'
import { emitUnstartedJobTelemetry, runAsyncPlanGeneration } from '../../src/services/planBuilder/asyncGenerationLoop'
import {
  PRODUCTIVE_QUALITY_VERSION,
  resolveEffectiveRunQualityVersion,
} from '../../src/services/planBuilder/qualityReview'
import { buildVariantId } from '../../src/services/planBuilder/telemetryVersions'
import { estimateCostUsd } from '../../src/services/planBuilder/pricing'
import { callAnthropicForWeek } from './_shared/anthropicCaller'
import {
  resolveEffectivePlanBuilderConfig,
  resolvePlanBuilderModel,
  resolvePlanBuilderRequestDirectives,
} from './_shared/planBuilderRunConfig'
import {
  assertUsageGate,
  isKillSwitchActive,
  makeKillSwitchError,
  recordUsageCost,
  type UsageGateHttpError,
} from './_shared/usageGate'
import { translateUsageGateError } from './_shared/translateUsageGateError'
import {
  createJobId,
  createSupabaseWriter,
  getBearerToken,
  isGeneratePlanPayload,
  json,
  resolveAuthContext,
} from './_shared/planGenerationShared'
import {
  assertPlanGenerationEntitlement,
  isEntitlementEnforcementEnabled,
  resolveEntitlementTier,
} from './_shared/resolveEntitlement'

type RejectedJobWriter = Pick<AsyncPlanGenerationWriter, 'getPlan' | 'putPlan'>

/**
 * Terminaliza un job ya encolado cuando el worker rechaza por entitlement.
 *
 * El enqueue deja el plan en `generating` antes de invocar este worker. Un
 * rechazo posterior debe cerrar ese job, pero sólo si el payload todavía
 * identifica la misma corrida y el plan sigue en curso: una respuesta tardía
 * nunca puede degradar un plan ya completado ni tocar una corrida posterior.
 */
export async function terminalizeRejectedJob(
  writer: RejectedJobWriter,
  planId: string,
  jobId: string | undefined,
): Promise<'marked' | 'skipped'> {
  if (!jobId) return 'skipped'

  try {
    const existing = await writer.getPlan(planId)
    if (!existing?.generationSummary) return 'skipped'
    if (existing.generationSummary.jobId !== jobId) return 'skipped'
    if (existing.generationState !== 'generating') return 'skipped'

    const now = Date.now()
    await writer.putPlan({
      ...existing,
      generationState: 'failed',
      updatedAt: now,
      generationSummary: {
        ...existing.generationSummary,
        completedAt: now,
      },
    })
    return 'marked'
  } catch (error) {
    console.error(`[generate-plan] entitlement cleanup failed planId=${planId}: ${error instanceof Error ? error.message : String(error)}`)
    return 'skipped'
  }
}

/**
 * Igual que `recordCostIfKnown` en `coach.ts` (Task 5) — duplicada a
 * propósito, no compartida vía módulo: es una decisión revisada del plan.
 * `promptTokens`/`completionTokens` distinguen "no reportó usage" de "cero
 * real": un `?? 0` colapsaría ambos casos y perdería la advertencia
 * operacional que exige el spec para usage o precio ausente.
 * `cacheReadTokens`/`cacheCreationTokens` sí usan `?? 0` porque muchos
 * proveedores nunca los reportan cuando no aplica caching — eso sí es cero
 * genuino.
 *
 * Función de módulo, fuera del handler: recibe todo por parámetro y no
 * depende de clausura, así que no hay razón para redefinirla en cada
 * request.
 */
async function recordCostIfKnown(input: {
  userId: string
  reservation: { bucketId: string; usageDate: string }
  result: {
    // `AIRawResponse.model` es opcional (otros proveedores pueden omitirlo);
    // `callAnthropicForWeek` siempre lo resuelve en la práctica
    // (`anthropicCaller.ts`: `model: data.model ?? model`), pero el tipo no
    // lo garantiza — se guarda como "costo no estimable" en vez de forzar
    // el tipo con un cast.
    model?: string
    serviceTier?: string
    promptTokens?: number
    completionTokens?: number
    cacheReadInputTokens?: number
    cacheCreationInputTokens?: number
  }
}): Promise<void> {
  const { model, promptTokens, completionTokens } = input.result
  if (!model) {
    console.warn('[usage-gate] costo no estimable: el proveedor no reportó modelo')
    return
  }
  if (promptTokens == null || completionTokens == null) {
    console.warn(`[usage-gate] costo no estimable: el proveedor no reportó usage (model=${model})`)
    return
  }
  const costUsd = estimateCostUsd({
    model,
    at: Date.now(),
    serviceTier: input.result.serviceTier,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    cacheReadTokens: input.result.cacheReadInputTokens ?? 0,
    cacheCreationTokens: input.result.cacheCreationInputTokens ?? 0,
  })
  if (costUsd == null) {
    console.warn(`[usage-gate] costo no estimable: sin precio cargado para model=${input.result.model} serviceTier=${input.result.serviceTier ?? '(default)'}`)
    return
  }
  // await, no `void`: en serverless una llamada disparada-y-olvidada puede
  // quedar cortada si la función retorna antes de que termine el fetch.
  await recordUsageCost({
    userId: input.userId,
    bucketId: input.reservation.bucketId,
    usageDate: input.reservation.usageDate,
    costUsd,
  })
}

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
    const bearer = getBearerToken(event)
    const gateEnabled = isEntitlementEnforcementEnabled()
    const [auth, gateTier] = await Promise.all([
      resolveAuthContext(event),
      gateEnabled && bearer
        ? resolveEntitlementTier(bearer)
        : Promise.resolve('free' as const),
    ])

    // Kill switch DESPUÉS de auth, ANTES de entitlement — mismo orden que
    // coach.ts y enqueue-plan-generation.ts, para que las 3 funciones gateen
    // en el mismo punto relativo del flujo. Incondicional (no depende de
    // `gateEnabled`): igual que en coach.ts, el kill switch corta la
    // generación completa, no solo el camino de entitlement.
    if (isKillSwitchActive()) {
      // Mismo tratamiento de limpieza que el rechazo de entitlement de abajo:
      // esta función admite llamadas autenticadas directas y puede acuñar su
      // propio jobId, así que un job ya encolado (enqueue lo dejó en
      // `generating`) necesita terminalizarse igual que ante un rechazo de
      // plan. El writer sólo se crea si hay un job durable que intentar
      // limpiar.
      const rejectedJobId = typeof body.jobId === 'string' && body.jobId
        ? body.jobId
        : undefined
      const cleanupOutcome = rejectedJobId
        ? await terminalizeRejectedJob(
            createSupabaseWriter(auth.userId, auth.token),
            body.plan.id,
            rejectedJobId,
          )
        : 'skipped'
      console.warn(`[generate-plan] kill switch active planId=${body.plan.id} cleanup=${cleanupOutcome}`)
      throw makeKillSwitchError()
    }

    let decision: ReturnType<typeof assertPlanGenerationEntitlement>
    try {
      // Igual que enqueue: con entitlement apagado la decisión Advanced es
      // neutral para autorización, pero deja una única fuente de tier/bucket/
      // dueño para el usage gate durante un rollout intermedio.
      decision = assertPlanGenerationEntitlement(
        gateEnabled ? gateTier : 'advanced',
        auth.userId,
      )
    } catch (error) {
      // Esta función admite llamadas autenticadas directas y puede acuñar su
      // propio jobId. El gate es obligatorio aquí, no sólo en el enqueue.
      // El writer sólo se crea si hay un job durable que intentar limpiar.
      const rejectedJobId = typeof body.jobId === 'string' && body.jobId
        ? body.jobId
        : undefined
      const cleanupOutcome = rejectedJobId
        ? await terminalizeRejectedJob(
            createSupabaseWriter(auth.userId, auth.token),
            body.plan.id,
            rejectedJobId,
          )
        : 'skipped'
      console.warn(`[generate-plan] entitlement denied tier=${gateTier} planId=${body.plan.id} cleanup=${cleanupOutcome}`)
      throw error
    }

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

    const gatedCallLLM = async (request: AIRequest): Promise<AIRawResponse> => {
      // Config primero (síncrono, sin I/O): una config inválida no debe
      // consumir cuota. `callAnthropicForWeek` vuelve a resolver
      // model/directivas internamente (`anthropicCaller.ts:83-86`);
      // redundante pero inofensivo, no se le cambia la firma pública. A
      // diferencia de `coach.ts`, acá no hace falta reordenar ningún
      // timeout: `callAnthropicForWeek` arma el suyo (`AbortController`)
      // dentro de su propio cuerpo, invocado recién DESPUÉS de que el gate
      // ya haya resuelto.
      const apiKey = process.env['CLAUDE_API_KEY']
      if (!apiKey) throw new Error('CLAUDE_API_KEY no configurada.')
      const model = resolvePlanBuilderModel(process.env)
      // Valida; el resultado se descarta a propósito — `callAnthropicForWeek`
      // lo vuelve a resolver.
      resolvePlanBuilderRequestDirectives(process.env, model)

      let reservation: Awaited<ReturnType<typeof assertUsageGate>>
      try {
        reservation = await assertUsageGate({
          decision,
        })
      } catch (error) {
        // Server-shaped (`UsageGateHttpError`) → client-shaped
        // (`QuotaExceededError`/etc): el loop async reconoce el rechazo por
        // `instanceof` sobre las clases de `usageGateError.ts`, no por el
        // shape HTTP. Ver `translateUsageGateError.ts`.
        throw translateUsageGateError(error as UsageGateHttpError)
      }
      const result = await callAnthropicForWeek(request)
      if (reservation) {
        await recordCostIfKnown({ userId: decision.quotaOwnerUserId, reservation, result })
      }
      return result
    }

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
      callLLM: gatedCallLLM,
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
    const errorCode = (error as { errorCode?: string }).errorCode
    const detail = (error as { detail?: unknown }).detail
    return json(statusCode, {
      error: message,
      ...(errorCode ? { errorCode } : {}),
      ...(detail !== undefined ? { detail } : {}),
    })
  }
}
