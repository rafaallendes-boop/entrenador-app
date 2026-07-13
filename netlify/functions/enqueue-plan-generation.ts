import type { Handler, HandlerEvent } from '@netlify/functions'
import type { TrainingPlan } from '../../src/types/planBuilder'
import { shouldDedupeActiveGeneration } from '../../src/services/planBuilder/activeGeneration'
import {
  createJobId,
  createSupabaseWriter,
  isGeneratePlanPayload,
  json,
  resolveAuthContext,
  resolveSelfBaseUrl,
  withTimeout,
  type GeneratePlanPayload,
} from './_shared/planGenerationShared'
import { corsPreflight } from './_shared/cors'

const BACKGROUND_FUNCTION = '/.netlify/functions/generate-plan-background'
const BACKGROUND_INVOKE_TIMEOUT_MS = 10_000

async function invokeBackground(event: HandlerEvent, payload: GeneratePlanPayload, token: string): Promise<void> {
  const base = resolveSelfBaseUrl(event)
  const response = await withTimeout(
    fetch(`${base}${BACKGROUND_FUNCTION}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    }),
    BACKGROUND_INVOKE_TIMEOUT_MS,
    'invokeBackground',
  )
  // Netlify replies 202 for background functions; anything >= 300 means the
  // worker was not accepted.
  if (response.status >= 300) {
    throw new Error(`El worker background respondió ${response.status}.`)
  }
}

/**
 * Synchronous enqueue/ack endpoint for Plan Builder generation.
 *
 * Unlike the background function (which always returns an empty 202 and hides
 * handler errors), this validates auth + payload, writes a durable jobId, and
 * only then kicks off the background worker — returning a real result so the
 * client can surface genuine failures instead of waiting for a stalled poll.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight()
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

  let durableWrite: { writer: ReturnType<typeof createSupabaseWriter>; plan: TrainingPlan } | null = null
  try {
    const auth = await resolveAuthContext(event)
    const writer = createSupabaseWriter(auth.userId, auth.token)
    const now = Date.now()
    const planId = body.plan.id
    const jobId = createJobId(planId)

    const existingPlan = await writer.getPlan(planId)
    if (shouldDedupeActiveGeneration(existingPlan, jobId, now)) {
      const existingJobId = existingPlan?.generationSummary?.jobId
      console.log(`[enqueue-plan] dedupe active planId=${planId} jobId=${existingJobId ?? 'unknown'}`)
      return json(200, { ok: true, deduped: true, jobId: existingJobId })
    }

    // Durable write BEFORE kicking off the worker: even if the background
    // invocation response is lost, the plan carries a jobId the client can
    // confirm against.
    const plan: TrainingPlan = {
      ...body.plan,
      generationState: 'generating',
      updatedAt: now,
      generationSummary: {
        startedAt: now,
        jobId,
        strategy: 'single',
        completedWeeks: 0,
        failedWeeks: [],
        totalAttempts: 0,
        heartbeatAt: now,
      },
    }
    await writer.putPlan(plan)
    await Promise.all(body.weeks.map((week) => writer.putWeek(week)))
    durableWrite = { writer, plan }
    console.log(`[enqueue-plan] enqueued planId=${planId} weeks=${body.weeks.length} jobId=${jobId}`)

    await invokeBackground(event, { ...body, jobId }, auth.token)

    return json(200, { ok: true, jobId })
  } catch (error) {
    const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[enqueue-plan] error planId=${(body as { plan?: { id?: string } })?.plan?.id ?? 'unknown'}: ${message}`)

    // If we already wrote the durable 'generating' state but failed to start the
    // worker, mark the plan as failed so the client gets a clean, retryable
    // error instead of polling until the 5-minute stalled timeout.
    if (durableWrite) {
      const failedPlan: TrainingPlan = {
        ...durableWrite.plan,
        generationState: 'failed',
        updatedAt: Date.now(),
        generationSummary: {
          ...durableWrite.plan.generationSummary!,
          completedAt: Date.now(),
        },
      }
      await durableWrite.writer.putPlan(failedPlan).catch((cleanupError) => {
        console.error(`[enqueue-plan] cleanup failed planId=${failedPlan.id}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
      })
      const invokeStatus = statusCode === 500 ? 502 : statusCode
      return json(invokeStatus, { error: `No se pudo iniciar el worker de generación: ${message}` })
    }

    return json(statusCode, { error: message })
  }
}
