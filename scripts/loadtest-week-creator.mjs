#!/usr/bin/env node
/**
 * Load test for the complete week_creator flow.
 *
 *   npm run dev          # in another terminal
 *   npm run loadtest:week-creator
 *
 * The harness injects an HTTP provider into the real WeekCreatorEngine. Each
 * sample therefore includes both logical attempts, local repair/validation and
 * the deterministic fallback. Provider responses are never printed.
 */

import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const ENDPOINT = process.env.COACH_ENDPOINT ?? 'http://localhost:5173/.netlify/functions/coach'
const N = Number(process.env.LOADTEST_N ?? 10)
const AUTH_TOKEN = process.env.COACH_AUTH_TOKEN
const P95_TARGET_MS = Number(process.env.LOADTEST_P95_TARGET_MS ?? 10_000)
const SUCCESS_TARGET = Number(process.env.LOADTEST_SUCCESS_TARGET ?? 0.95)
const FALLBACK_TARGET = Number(process.env.LOADTEST_FALLBACK_TARGET ?? 0.02)
const DRY_RUN = process.env.LOADTEST_DRY_RUN === 'true'

const TARGET = nextMonday()

const PROFILE = {
  id: 'week-creator-loadtest',
  updatedAt: 0,
  name: 'Atleta de prueba',
  sportContext: {
    enabledSports: ['squash', 'running', 'strength', 'mobility'],
    primarySport: 'squash',
    secondarySports: ['running', 'strength', 'mobility'],
    trainingPriority: 'performance',
  },
  planWizardConfig: {
    goalEventId: 'loadtest-goal',
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    sessionsPerWeek: 5,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['running', 'strength', 'mobility'],
    currentFitnessLevel: 'fit',
    currentFatigue: 'normal',
    injuryNotes: 'Sin restricciones activas para este escenario sintético.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  goalEvents: [{
    id: 'loadtest-goal',
    title: 'Evento de prueba',
    date: '2026-12-01',
    sport: 'squash',
    priority: 'primary',
    competitiveLevel: 'competitive',
  }],
}

const CONTEXT = {
  athleteProfile: PROFILE,
  recentSessions: [],
  plannedSessions: [],
  historicalSessions: [],
  weekDayLogs: [],
  recentMessages: [],
}

async function loadRuntime() {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  const [engineModule, debugStoreModule, policyModule] = await Promise.all([
    vite.ssrLoadModule('/src/services/weekCreator/WeekCreatorEngine.ts'),
    vite.ssrLoadModule('/src/store/useAIDebugStore.ts'),
    vite.ssrLoadModule('/src/services/ai/requestPolicy.ts'),
  ])
  return {
    vite,
    engine: engineModule.WeekCreatorEngine,
    debugStore: debugStoreModule.useAIDebugStore,
    policy: policyModule.getAIRequestPolicy('week_creator'),
  }
}

function nextMonday() {
  const d = new Date()
  const offset = (8 - d.getDay()) % 7 || 7
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

/** Conservative nearest-rank percentile for small baseline samples. */
export function pXX(arr, p) {
  if (!arr.length) return 0
  const sorted = arr.slice().sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length + 1) * p) - 1))
  return sorted[idx]
}

function numeric(rows, key) {
  return rows.map((row) => row[key]).filter(Number.isFinite)
}

function sumMetric(rows, key) {
  const values = numeric(rows, key)
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : undefined
}

function makeProviderAttempt(input, data, roundTripMs, requestMetrics) {
  return {
    ...requestMetrics,
    ok: true,
    traceId: input.traceId,
    provider: data.provider,
    model: data.model,
    roundTripMs,
    serverDurationMs: data.serverDurationMs,
    authDurationMs: data.authDurationMs,
    responseChars: typeof data.text === 'string' ? data.text.length : 0,
    promptTokens: data.promptTokens,
    completionTokens: data.completionTokens,
    reasoningTokens: data.reasoningTokens,
    cacheReadInputTokens: data.cacheReadInputTokens,
    finishReason: data.finishReason,
  }
}

function measureProviderRequest(input, logicalAttempt, schemaCharCache) {
  let responseSchemaChars = 0
  if (input.responseSchema != null) {
    if (typeof input.responseSchema === 'object' && schemaCharCache.has(input.responseSchema)) {
      responseSchemaChars = schemaCharCache.get(input.responseSchema)
    } else {
      responseSchemaChars = JSON.stringify(input.responseSchema).length
      if (typeof input.responseSchema === 'object') {
        schemaCharCache.set(input.responseSchema, responseSchemaChars)
      }
    }
  }
  const systemPromptChars = input.systemPrompt.length
  const userPromptChars = input.userMessage.length
  return {
    logicalAttempt,
    systemPromptChars,
    userPromptChars,
    responseSchemaChars,
    inputChars: systemPromptChars + userPromptChars + responseSchemaChars,
  }
}

function createHttpProvider(runtime, providerAttempts) {
  const schemaCharCache = new WeakMap()
  return {
    name: 'openai',
    async call(input) {
      const startedAt = Date.now()
      const requestMetrics = measureProviderRequest(input, providerAttempts.length + 1, schemaCharCache)
      const headers = { 'Content-Type': 'application/json' }
      if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`
      const controller = new AbortController()
      let timedOut = false
      const abortFromCaller = () => controller.abort()
      input.signal?.addEventListener('abort', abortFromCaller, { once: true })
      const timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, runtime.policy.timeoutMs + 2_000)
      let recorded = false

      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            systemPrompt: input.systemPrompt,
            userMessage: input.userMessage,
            requestClass: input.requestClass,
            traceId: input.traceId,
            generationId: input.generationId,
            maxTokens: input.maxTokens,
            temperature: input.temperature,
            responseMimeType: input.responseMimeType,
            responseSchema: input.responseSchema,
            allowFallback: input.allowFallback,
            stream: false,
          }),
        })
        const data = await res.json().catch(() => ({}))
        const roundTripMs = Date.now() - startedAt
        if (!res.ok || typeof data.text !== 'string' || data.text.length === 0) {
          const errorClass = data.errorCode ?? (res.ok ? 'empty_response' : `http_${res.status}`)
          providerAttempts.push({
            ...requestMetrics,
            ok: false,
            traceId: input.traceId,
            roundTripMs,
            errorClass,
            serverDurationMs: data.serverDurationMs,
            authDurationMs: data.authDurationMs,
          })
          recorded = true
          const error = new Error(data.error ?? `Provider request failed (${errorClass}).`)
          error.name = 'LoadtestProviderError'
          throw error
        }

        providerAttempts.push(makeProviderAttempt(input, data, roundTripMs, requestMetrics))
        recorded = true
        return {
          text: data.text,
          provider: data.provider ?? 'openai',
          model: data.model,
          durationMs: data.durationMs ?? roundTripMs,
          traceId: data.traceId ?? input.traceId,
          generationId: data.generationId ?? input.generationId,
          requestClass: 'week_creator',
          retryUsed: data.retryUsed,
          fallbackUsed: data.fallbackUsed,
          finishReason: data.finishReason,
          promptTokens: data.promptTokens,
          completionTokens: data.completionTokens,
          reasoningTokens: data.reasoningTokens,
          cacheCreationInputTokens: data.cacheCreationInputTokens,
          cacheReadInputTokens: data.cacheReadInputTokens,
          serverDurationMs: data.serverDurationMs,
          authDurationMs: data.authDurationMs,
        }
      } catch (error) {
        if (!recorded) {
          providerAttempts.push({
            ...requestMetrics,
            ok: false,
            traceId: input.traceId,
            roundTripMs: Date.now() - startedAt,
            errorClass: timedOut ? 'timeout' : 'network_error',
          })
        }
        if (input.signal?.aborted) throw error
        const normalized = new Error(timedOut ? 'Provider request timed out.' : (error instanceof Error ? error.message : String(error)))
        normalized.name = timedOut ? 'LoadtestProviderTimeout' : 'LoadtestProviderError'
        throw normalized
      } finally {
        clearTimeout(timeoutId)
        input.signal?.removeEventListener('abort', abortFromCaller)
      }
    },
  }
}

async function runOne(i, runtime) {
  const startedAt = Date.now()
  const generationId = `loadtest-generation-${Date.now()}-${i}`
  const providerAttempts = []
  runtime.debugStore.getState().clear()

  try {
    const response = await runtime.engine.sendWeekCreate(
      'Créame una semana priorizando squash',
      CONTEXT,
      {
        targetWeekStart: TARGET,
        surface: 'chat',
        weekObjectives: ['Priorizar squash', 'Mantener fuerza y movilidad de soporte'],
        generationId,
        provider: createHttpProvider(runtime, providerAttempts),
      },
    )
    const durationMs = Date.now() - startedAt
    const action = response.actions?.find((item) => item.type === 'create_week')
    const debugRows = runtime.debugStore.getState().requests.filter((row) => row.generationId === generationId)
    const localPipelineMs = debugRows
      .flatMap((row) => row.stageTimings ?? [])
      .filter((stage) => stage.stage !== 'provider_call')
      .reduce((sum, stage) => sum + stage.durationMs, 0)
    const localFallbackUsed = debugRows.some((row) => row.model === 'local-week-fallback' && row.fallbackUsed)
    const providerFallbackUsed = debugRows.some((row) => row.model !== 'local-week-fallback' && row.fallbackUsed)

    return {
      ok: Boolean(action && Array.isArray(action.sessions) && action.sessions.length > 0),
      durationMs,
      generationId,
      providerAttempts,
      logicalAttemptCount: providerAttempts.length,
      retryUsed: providerAttempts.length > 1,
      fallbackUsed: localFallbackUsed,
      providerFallbackUsed,
      providerRoundTripMs: sumMetric(providerAttempts, 'roundTripMs'),
      serverDurationMs: sumMetric(providerAttempts, 'serverDurationMs'),
      authDurationMs: sumMetric(providerAttempts, 'authDurationMs'),
      localPipelineMs,
      promptTokens: sumMetric(providerAttempts, 'promptTokens'),
      completionTokens: sumMetric(providerAttempts, 'completionTokens'),
      reasoningTokens: sumMetric(providerAttempts, 'reasoningTokens'),
      cacheReadInputTokens: sumMetric(providerAttempts, 'cacheReadInputTokens'),
      expectedSessionCount: debugRows[0]?.expectedSessionCount,
      partialWeek: debugRows[0]?.partialWeek,
      activeRestrictionsPresent: debugRows[0]?.activeRestrictionsPresent,
      errorClass: action ? null : 'invalid_final_response',
    }
  } catch (error) {
    const debugRows = runtime.debugStore.getState().requests.filter((row) => row.generationId === generationId)
    const localPipelineMs = debugRows
      .flatMap((row) => row.stageTimings ?? [])
      .filter((stage) => stage.stage !== 'provider_call')
      .reduce((sum, stage) => sum + stage.durationMs, 0)
    const localFallbackUsed = debugRows.some((row) => row.model === 'local-week-fallback' && row.fallbackUsed)
    const providerFallbackUsed = debugRows.some((row) => row.model !== 'local-week-fallback' && row.fallbackUsed)
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      generationId,
      providerAttempts,
      logicalAttemptCount: providerAttempts.length,
      retryUsed: providerAttempts.length > 1,
      fallbackUsed: localFallbackUsed,
      providerFallbackUsed,
      providerRoundTripMs: sumMetric(providerAttempts, 'roundTripMs'),
      serverDurationMs: sumMetric(providerAttempts, 'serverDurationMs'),
      authDurationMs: sumMetric(providerAttempts, 'authDurationMs'),
      localPipelineMs,
      promptTokens: sumMetric(providerAttempts, 'promptTokens'),
      completionTokens: sumMetric(providerAttempts, 'completionTokens'),
      reasoningTokens: sumMetric(providerAttempts, 'reasoningTokens'),
      errorClass: 'terminal_generation_error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export function summarizeResults(results) {
  const successful = results.filter((result) => result.ok)
  const modelGenerated = successful.filter((result) => !result.fallbackUsed)
  const providerAttempts = results.flatMap((result) => result.providerAttempts ?? [])
  const successfulProviderAttempts = providerAttempts.filter((attempt) => attempt.ok)
  const errorBreakdown = results
    .filter((result) => !result.ok)
    .reduce((acc, result) => {
      const key = result.errorClass ?? 'unknown'
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
  const providerErrorBreakdown = providerAttempts
    .filter((attempt) => !attempt.ok)
    .reduce((acc, attempt) => {
      const key = attempt.errorClass ?? 'unknown'
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
  const providerModels = successfulProviderAttempts.reduce((acc, attempt) => {
    const key = `${attempt.provider ?? 'unknown'}/${attempt.model ?? 'unknown'}`
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  const successRateValue = results.length > 0 ? successful.length / results.length : 0
  const fallbackCount = results.filter((result) => result.fallbackUsed).length
  const fallbackRateValue = results.length > 0 ? fallbackCount / results.length : 0
  const modelGenerationRateValue = results.length > 0 ? modelGenerated.length / results.length : 0
  const promptSizesByLogicalAttempt = Object.fromEntries(
    [...new Set(providerAttempts.map((attempt) => attempt.logicalAttempt).filter(Number.isFinite))]
      .sort((a, b) => a - b)
      .map((logicalAttempt) => {
        const attempts = providerAttempts.filter((attempt) => attempt.logicalAttempt === logicalAttempt)
        return [String(logicalAttempt), {
          count: attempts.length,
          inputCharsP50: pXX(numeric(attempts, 'inputChars'), 0.5),
          inputCharsP95: pXX(numeric(attempts, 'inputChars'), 0.95),
        }]
      }),
  )

  return {
    n: results.length,
    successRateValue,
    successRate: `${(successRateValue * 100).toFixed(1)}%`,
    modelGeneratedWeeks: modelGenerated.length,
    modelGenerationRateValue,
    modelGenerationRate: `${(modelGenerationRateValue * 100).toFixed(1)}%`,
    p50ms: pXX(numeric(results, 'durationMs'), 0.5),
    p95ms: pXX(numeric(results, 'durationMs'), 0.95),
    successfulP95ms: pXX(numeric(successful, 'durationMs'), 0.95),
    maxMs: Math.max(0, ...numeric(results, 'durationMs')),
    serverP95ms: pXX(numeric(results, 'serverDurationMs'), 0.95),
    providerRoundTripP95ms: pXX(numeric(results, 'providerRoundTripMs'), 0.95),
    authP95ms: pXX(numeric(results, 'authDurationMs'), 0.95),
    localPipelineP95ms: pXX(numeric(results, 'localPipelineMs'), 0.95),
    providerAttemptSystemPromptCharsP50: pXX(numeric(providerAttempts, 'systemPromptChars'), 0.5),
    providerAttemptSystemPromptCharsP95: pXX(numeric(providerAttempts, 'systemPromptChars'), 0.95),
    providerAttemptUserPromptCharsP50: pXX(numeric(providerAttempts, 'userPromptChars'), 0.5),
    providerAttemptUserPromptCharsP95: pXX(numeric(providerAttempts, 'userPromptChars'), 0.95),
    providerAttemptResponseSchemaCharsP50: pXX(numeric(providerAttempts, 'responseSchemaChars'), 0.5),
    providerAttemptResponseSchemaCharsP95: pXX(numeric(providerAttempts, 'responseSchemaChars'), 0.95),
    providerAttemptInputCharsP50: pXX(numeric(providerAttempts, 'inputChars'), 0.5),
    providerAttemptInputCharsP95: pXX(numeric(providerAttempts, 'inputChars'), 0.95),
    promptSizesByLogicalAttempt,
    providerAttemptResponseCharsP95: pXX(numeric(successfulProviderAttempts, 'responseChars'), 0.95),
    providerAttemptPromptTokensP95: pXX(numeric(successfulProviderAttempts, 'promptTokens'), 0.95),
    providerAttemptCompletionTokensP95: pXX(numeric(successfulProviderAttempts, 'completionTokens'), 0.95),
    providerAttemptReasoningTokensP95: pXX(numeric(successfulProviderAttempts, 'reasoningTokens'), 0.95),
    logicalPromptTokensP95: pXX(numeric(results, 'promptTokens'), 0.95),
    logicalCompletionTokensP95: pXX(numeric(results, 'completionTokens'), 0.95),
    logicalReasoningTokensP95: pXX(numeric(results, 'reasoningTokens'), 0.95),
    logicalRetriesUsed: results.filter((result) => result.retryUsed).length,
    providerFallbacksUsed: results.filter((result) => result.providerFallbackUsed).length,
    fallbacksUsed: fallbackCount,
    fallbackRateValue,
    fallbackRate: `${(fallbackRateValue * 100).toFixed(1)}%`,
    providerAttemptCount: providerAttempts.length,
    providerModels,
    errorBreakdown,
    providerErrorBreakdown,
  }
}

export function evaluateAcceptance(summary, targets = {}) {
  const successTarget = targets.successTarget ?? SUCCESS_TARGET
  const p95TargetMs = targets.p95TargetMs ?? P95_TARGET_MS
  const fallbackTarget = targets.fallbackTarget ?? FALLBACK_TARGET
  const checks = {
    success: summary.successRateValue >= successTarget,
    latency: summary.p95ms < p95TargetMs,
    fallback: summary.fallbackRateValue <= fallbackTarget,
  }
  return {
    passed: checks.success && checks.latency && checks.fallback,
    checks,
    targets: { successTarget, p95TargetMs, fallbackTarget },
  }
}

async function main() {
  if (!Number.isInteger(N) || N < 1) {
    throw new Error('LOADTEST_N must be a positive integer.')
  }
  if (![SUCCESS_TARGET, FALLBACK_TARGET].every((target) => Number.isFinite(target) && target >= 0 && target <= 1)) {
    throw new Error('LOADTEST_SUCCESS_TARGET and LOADTEST_FALLBACK_TARGET must be numbers between 0 and 1.')
  }
  if (!Number.isFinite(P95_TARGET_MS) || P95_TARGET_MS <= 0) {
    throw new Error('LOADTEST_P95_TARGET_MS must be a positive number.')
  }
  const runtime = await loadRuntime()
  console.log(`Loadtest: ${N} sequential logical generations against ${ENDPOINT}`)
  console.log(`Target week start: ${TARGET}`)
  console.log(`Acceptance target: success >= ${(SUCCESS_TARGET * 100).toFixed(1)}%, all-sample p95 < ${P95_TARGET_MS}ms, fallback <= ${(FALLBACK_TARGET * 100).toFixed(1)}%`)
  if (N < 20) {
    console.log('Warning: fewer than 20 samples is useful for smoke testing, not for a stable p95 baseline.')
  }
  if (!AUTH_TOKEN && ENDPOINT.includes(':8888')) {
    console.log('No COACH_AUTH_TOKEN set — Netlify function auth may return 401 unless dev auth is disabled.')
  }

  try {
    if (DRY_RUN) {
      console.log('Dry run complete: the real engine loaded without calling the provider. Prompt sizes are reported only from actual provider attempts.')
      return
    }

    const results = []
    for (let i = 0; i < N; i++) {
      process.stdout.write(`[${i + 1}/${N}] `)
      const result = await runOne(i, runtime)
      results.push(result)
      process.stdout.write(
        `${result.ok ? 'ok' : 'fail'} ${result.durationMs}ms attempts=${result.logicalAttemptCount}`
        + `${result.fallbackUsed ? ' fallback=local' : ''}`
        + `${result.errorClass ? ` (${result.errorClass})` : ''}\n`,
      )
    }

    const summary = summarizeResults(results)
    const acceptance = evaluateAcceptance(summary)
    console.log('\n=== Summary ===')
    console.log(JSON.stringify({ ...summary, acceptance }, null, 2))

    process.exitCode = acceptance.passed ? 0 : 1
  } finally {
    await runtime.vite.close()
  }
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  main().catch((error) => {
    console.error(error)
    process.exit(2)
  })
}
