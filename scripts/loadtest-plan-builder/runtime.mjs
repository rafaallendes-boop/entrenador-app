import { createServer } from 'vite'

/**
 * Writer en memoria: el loadtest NO toca Dexie ni Supabase, así que sus
 * corridas no contaminan `plan_generation_jobs` de producción.
 */
export function createMemoryWriter(now = Date.now) {
  const state = { plan: null, weeks: [], attempts: [], job: null, weekWrites: [] }

  const writer = {
    async getPlan() {
      return state.plan
    },
    async putPlan(plan) {
      state.plan = plan
    },
    async putWeek(week) {
      state.weekWrites.push({
        weekIndex: week.weekIndex,
        status: week.status,
        at: now(),
      })
      const index = state.weeks.findIndex(
        (candidate) => candidate.weekIndex === week.weekIndex,
      )
      if (index >= 0) state.weeks[index] = week
      else state.weeks.push(week)
    },
    async putAttempt(attempt) {
      state.attempts.push(attempt)
    },
    async putJob(job) {
      state.job = job
    },
  }

  return {
    writer,
    snapshot: () => ({
      plan: state.plan,
      weeks: [...state.weeks],
      attempts: [...state.attempts],
      job: state.job,
      weekWrites: [...state.weekWrites],
    }),
  }
}

/**
 * Envuelve `callLLM` para medir tamaños de entrada y salida por semana sin
 * retener contenido. El loop usa traceIds `${jobId}-week-${weekIndex}` y añade
 * `-attempt-N` en los reintentos.
 */
export function instrumentCallLLM(callLLM) {
  const sizesByWeek = new Map()

  const wrapped = async (request) => {
    const traceMatch = typeof request.traceId === 'string'
      ? /-week-(\d+)(?:-attempt-\d+)?$/.exec(request.traceId)
      : null
    if (!traceMatch) {
      throw new Error('traceId inválido: se esperaba el sufijo -week-(N)[-attempt-(N)].')
    }
    const weekIndex = Number(traceMatch[1])
    if (!Number.isSafeInteger(weekIndex)) {
      throw new Error('traceId inválido: el índice de semana no es un entero seguro.')
    }
    const promptChars = JSON.stringify(request).length
    const entry = sizesByWeek.get(weekIndex) ?? {
      promptChars: 0,
      responseChars: 0,
    }

    // La entrada se contabiliza antes de esperar: un timeout, 429, 5xx o fallo
    // de red también es un intento real, aunque no produzca respuesta.
    entry.promptChars += promptChars
    sizesByWeek.set(weekIndex, entry)

    const response = await callLLM(request)
    entry.responseChars += (response?.text ?? '').length
    return response
  }

  return {
    wrapped,
    sizesFor: (weekIndex) => sizesByWeek.get(weekIndex) ?? null,
  }
}

/**
 * Poller en memoria que imita al cliente: consulta primero y duerme después.
 * Mide descubrimiento, no visibilidad en UI.
 */
export function createDetectionPoller(input) {
  const now = input.now ?? Date.now
  let detectedAt = null
  let stopped = false
  let pending = Promise.resolve()

  const check = () => {
    if (detectedAt !== null) return
    const weeks = input.snapshot().weeks ?? []
    if (weeks.some((week) => input.isReadyWeek(week))) detectedAt = now()
  }

  const loop = async () => {
    while (!stopped) {
      check()
      if (detectedAt !== null) return
      await new Promise((resolve) => setTimeout(resolve, input.intervalMs))
    }
  }

  return {
    start() {
      pending = loop()
    },
    stop() {
      stopped = true
    },
    async waitForNextCheck() {
      await new Promise((resolve) => setTimeout(resolve, input.intervalMs))
      check()
    },
    async settle() {
      stopped = true
      await pending
      check()
    },
    result() {
      return {
        firstWeekDetectedMs: detectedAt === null
          ? null
          : detectedAt - input.workerStartedAt,
      }
    },
  }
}

/**
 * Carga el TypeScript de `src/` y `netlify/` mediante Vite en middleware mode,
 * igual que los otros drivers standalone del repositorio.
 */
export async function loadRuntime(createServerFactory = createServer) {
  const vite = await createServerFactory({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })

  try {
    const [
      loopModule,
      callerModule,
      runConfigModule,
      versionsModule,
      qualityModule,
      weekUtilsModule,
      pollingModule,
    ] = await Promise.all([
      vite.ssrLoadModule('/src/services/planBuilder/asyncGenerationLoop.ts'),
      vite.ssrLoadModule('/netlify/functions/_shared/anthropicCaller.ts'),
      vite.ssrLoadModule('/netlify/functions/_shared/planBuilderRunConfig.ts'),
      vite.ssrLoadModule('/src/services/planBuilder/telemetryVersions.ts'),
      vite.ssrLoadModule('/src/services/planBuilder/qualityReview.ts'),
      vite.ssrLoadModule('/src/services/planBuilder/weekUtils.ts'),
      vite.ssrLoadModule('/src/services/planBuilder/pollingConfig.ts'),
    ])

    return {
      vite,
      runAsyncPlanGeneration: loopModule.runAsyncPlanGeneration,
      callAnthropicForWeek: callerModule.callAnthropicForWeek,
      resolveEffectivePlanBuilderConfig:
        runConfigModule.resolveEffectivePlanBuilderConfig,
      buildVariantId: versionsModule.buildVariantId,
      countRepairsV2: qualityModule.countRepairsV2,
      reviewPlanQuality: qualityModule.reviewPlanQuality,
      isReadyWeek: weekUtilsModule.isReadyWeek,
      pollIntervalMs: pollingModule.PLAN_GENERATION_POLL_INTERVAL_MS,
      close: () => vite.close(),
    }
  } catch (error) {
    try {
      await vite.close()
    } catch {
      // El fallo de cierre es secundario: conservar la causa de carga.
    }
    throw error
  }
}
