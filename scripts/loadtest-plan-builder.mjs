/**
 * Driver de loadtest del Plan Builder (spec §3.1). Corre el proveedor REAL y
 * cuesta dinero: exige `LOADTEST_PLAN_BUILDER=1` y `CLAUDE_API_KEY`.
 *
 *   npm run loadtest:plan-builder                       # corrida pagada
 *   npm run loadtest:plan-builder -- --report <ruta>    # solo lee un artefacto
 *
 * El modo `--report` es puro: no llama al proveedor ni exige credenciales.
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  buildManifest,
  buildPlanFixture,
} from './loadtest-plan-builder/manifest.mjs'
import {
  buildArtifact,
  evaluateAcceptance,
  toPlanRow,
  toWeekRow,
} from './loadtest-plan-builder/artifact.mjs'
import {
  buildReport,
  renderReport,
} from './loadtest-plan-builder/report.mjs'
import {
  createDetectionPoller,
  createMemoryWriter,
  instrumentCallLLM,
  loadRuntime,
} from './loadtest-plan-builder/runtime.mjs'

const USAGE = 'Uso: loadtest-plan-builder.mjs | loadtest-plan-builder.mjs --report <ruta-al-artefacto>'
const KNOWN_ERROR_CLASSES = new Set([
  'AbortError',
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'TimeoutError',
  'local_plan_fallback',
  'local_plan_fallback_quality',
  'misconfigured',
  'network_error',
  'parse_error',
  'post_generation_failed',
  'quality_gate',
  'rate_limit',
  'server_error',
  'timeout',
  'truncated',
  'unauthorized',
  'unknown',
  'validation',
])

export function parseArgs(argv) {
  if (Array.isArray(argv) && argv.length === 0) {
    return { mode: 'run', artifactPath: null }
  }
  if (
    Array.isArray(argv)
    && argv.length === 2
    && argv[0] === '--report'
    && typeof argv[1] === 'string'
    && argv[1].trim().length > 0
  ) {
    return { mode: 'report', artifactPath: argv[1] }
  }
  throw new Error(USAGE)
}

export function assertRunGuards(env) {
  if (env.LOADTEST_PLAN_BUILDER !== '1') {
    throw new Error('Corrida pagada bloqueada: exporta LOADTEST_PLAN_BUILDER=1 para confirmar.')
  }
  if (typeof env.CLAUDE_API_KEY !== 'string' || env.CLAUDE_API_KEY.trim().length === 0) {
    throw new Error('CLAUDE_API_KEY no configurada; el loadtest usa el proveedor real.')
  }
}

export function defaultArtifactPath(now) {
  return `loadtest-results/plan-builder-${now.toISOString().replace(/[:.]/g, '-')}.json`
}

/**
 * Solo admite identificadores de taxonomía acotados. Nunca conserva mensajes:
 * el proveedor podría incluir contenido generado o credenciales en ellos.
 */
export function classifyError(error) {
  if (!error || typeof error !== 'object') return 'run_threw'
  for (const candidate of [error.code, error.name]) {
    if (typeof candidate === 'string' && KNOWN_ERROR_CLASSES.has(candidate)) {
      return candidate
    }
  }
  return 'run_threw'
}

function sumNumeric(rows, key) {
  const values = rows
    .map((row) => row[key])
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0)
}

/**
 * Proyección pura de las semanas finales. Ordena por índice y agrega todos los
 * intentos de cada semana; no depende del orden en que el writer entregó filas.
 */
export function buildWeekRows(input) {
  const reviewByWeek = new Map(
    (input.review?.weeks ?? []).map((entry) => [entry.weekIndex, entry]),
  )
  const qualityVersion = input.review?.qualityVersion
    ?? input.variant?.qualityVersion
    ?? null

  return [...input.weeks]
    .sort((a, b) => a.weekIndex - b.weekIndex)
    .map((week) => {
      const attempts = input.attempts.filter(
        (attempt) => attempt.weekIndex === week.weekIndex,
      )
      const writeTimes = input.weekWrites
        .filter((entry) => entry.weekIndex === week.weekIndex)
        .map((entry) => entry.at)
        .filter((at) => typeof at === 'number' && Number.isFinite(at))
        .sort((a, b) => a - b)
      const sizes = input.sizesFor(week.weekIndex)
      const reviewedWeek = reviewByWeek.get(week.weekIndex)

      return toWeekRow(week, {
        scenarioKey: input.scenarioKey,
        countRepairsV2: input.countRepairsV2(week),
        qualityVersion,
        promptChars: sizes?.promptChars ?? null,
        responseChars: sizes?.responseChars ?? null,
        promptTokens: sumNumeric(attempts, 'promptTokens'),
        completionTokens: sumNumeric(attempts, 'completionTokens'),
        durationMs: sumNumeric(attempts, 'durationMs'),
        wallClockMs: writeTimes.length > 1
          ? writeTimes[writeTimes.length - 1] - writeTimes[0]
          : null,
        score: reviewedWeek?.score ?? null,
        grade: reviewedWeek?.grade ?? null,
      })
    })
}

export function hasFallbackUsed(weeks) {
  return weeks.some((week) => {
    const meta = week.generationMeta ?? {}
    return meta.fallbackUsed === true || (meta.addedFallbackCount ?? 0) > 0
  })
}

function readGit() {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  const status = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
  }).trim()
  return { sha, dirty: status.length > 0 }
}

/**
 * Conserva el SHA inicial que identifica la corrida y vuelve la suciedad
 * monotónica. Cambiar de commit durante el control también invalida el árbol.
 */
export function mergeGitState(initial, current) {
  const initialSha = initial?.sha ?? null
  const currentSha = current?.sha ?? null
  return {
    sha: initialSha,
    dirty: initial?.dirty === true
      || current?.dirty === true
      || (initialSha !== null && currentSha !== null && initialSha !== currentSha),
  }
}

/**
 * Instala listeners `once`: la primera señal pide detenerse entre casos; una
 * segunda señal del mismo tipo ya no tiene listener y conserva el default del
 * proceso. `target` es inyectable para no emitir señales reales en tests.
 */
export function installGracefulSignalHandlers(target = process) {
  let stopped = false
  const requestStop = () => {
    stopped = true
  }
  target.once('SIGINT', requestStop)
  target.once('SIGTERM', requestStop)

  return {
    shouldStop: () => stopped,
    cleanup: () => {
      target.removeListener('SIGINT', requestStop)
      target.removeListener('SIGTERM', requestStop)
    },
  }
}

/**
 * Escribe un sibling temporal y solo después reemplaza el checkpoint visible.
 * Un crash durante `writeFile` nunca deja JSON truncado en `artifactPath`.
 */
export async function writeArtifactAtomic(artifactPath, artifact, operations = {}) {
  const fs = {
    mkdir,
    writeFile,
    rename,
    unlink,
    ...operations,
  }
  const temporaryPath = `${artifactPath}.tmp-${process.pid}-${randomUUID()}`

  await fs.mkdir(dirname(artifactPath), { recursive: true })
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`)
    await fs.rename(temporaryPath, artifactPath)
  } catch (error) {
    try {
      await fs.unlink(temporaryPath)
    } catch {
      // El temporal puede no haber llegado a existir. Preservar el error raíz.
    }
    throw error
  }
}

export async function runCase(runtime, manifestCase, variant) {
  const { plan, weeks, profile, wizardConfig } = buildPlanFixture(manifestCase)
  const { writer, snapshot } = createMemoryWriter()
  const { wrapped: callLLM, sizesFor } = instrumentCallLLM(
    runtime.callAnthropicForWeek,
  )
  const workerStartedAt = Date.now()
  const jobId = `loadtest-job-${manifestCase.caseId}`

  const seededPlan = {
    ...plan,
    generationState: 'generating',
    generationSummary: {
      startedAt: workerStartedAt,
      jobId,
      strategy: 'single',
      completedWeeks: 0,
      failedWeeks: [],
      totalAttempts: 0,
      heartbeatAt: workerStartedAt,
    },
  }

  // Arranca antes del loop para no subestimar el lag de descubrimiento.
  const poller = createDetectionPoller({
    snapshot,
    isReadyWeek: runtime.isReadyWeek,
    workerStartedAt,
    intervalMs: runtime.pollIntervalMs,
  })
  poller.start()

  let errorClass = null
  try {
    await runtime.runAsyncPlanGeneration({
      plan: seededPlan,
      weeks,
      profile,
      wizardConfig,
      jobId,
      writer,
      callLLM,
      concurrency: variant.concurrency,
      enqueuedAt: workerStartedAt,
      variant,
    })
  } catch {
    // El loop productivo normaliza fallos del proveedor en su estado. Si
    // escapa un throw, falló el harness y el control completo no es aceptable.
    errorClass = 'harness_failure'
  } finally {
    await poller.settle()
  }

  const state = snapshot()
  const job = state.job ?? {}
  const detection = poller.result()
  const review = state.plan
    ? runtime.reviewPlanQuality(state.plan, state.weeks, { profile })
    : null
  const weekRows = buildWeekRows({
    weeks: state.weeks,
    attempts: state.attempts,
    weekWrites: state.weekWrites,
    sizesFor,
    scenarioKey: manifestCase.scenarioKey,
    countRepairsV2: runtime.countRepairsV2,
    review,
    variant,
  })

  return toPlanRow({
    caseId: manifestCase.caseId,
    scenarioKey: manifestCase.scenarioKey,
    weekCount: manifestCase.weekCount,
    outcome: job.outcome ?? 'failed',
    weekCountSucceeded: job.weekCountSucceeded ?? 0,
    weekCountFailed: job.weekCountFailed ?? 0,
    firstWeekReadyMs: job.firstWeekReadyMs ?? null,
    firstWeekReadyE2eMs: job.firstWeekReadyE2eMs ?? null,
    firstWeekDetectedMs: detection.firstWeekDetectedMs,
    firstWeekDetectionLagMs:
      detection.firstWeekDetectedMs === null || job.firstWeekReadyMs == null
        ? null
        : detection.firstWeekDetectedMs - job.firstWeekReadyMs,
    planCompleteMs: job.planCompleteMs ?? null,
    terminalMs: job.terminalMs ?? null,
    totalInputTokens: job.totalInputTokens ?? 0,
    totalOutputTokens: job.totalOutputTokens ?? 0,
    totalCacheReadTokens: job.totalCacheReadTokens ?? 0,
    totalCacheCreationTokens: job.totalCacheCreationTokens ?? 0,
    estimatedCostUsd: job.estimatedCostUsd ?? null,
    retryCount: state.attempts.filter((attempt) => attempt.retryUsed).length,
    fallbackUsed: hasFallbackUsed(state.weeks),
    observedModels: [
      ...new Set(state.attempts.map((attempt) => attempt.model).filter(Boolean)),
    ],
    qualityVersion: review?.qualityVersion ?? variant.qualityVersion ?? null,
    planScore: review?.score ?? null,
    planGrade: review?.grade ?? null,
    issueCodes: review
      ? [...new Set(review.issues.map((issue) => issue.code))]
      : [],
    errorClass,
    promptChars: sumNumeric(weekRows, 'promptChars'),
    responseChars: sumNumeric(weekRows, 'responseChars'),
    weeks: weekRows,
  })
}

function failedPlanRow(manifestCase) {
  return toPlanRow({
    caseId: manifestCase.caseId,
    scenarioKey: manifestCase.scenarioKey,
    weekCount: manifestCase.weekCount,
    outcome: 'failed',
    // El throw puede ocurrir antes o después de progreso parcial. No inventar
    // conteos que el harness no alcanzó a observar.
    weekCountSucceeded: null,
    weekCountFailed: null,
    errorClass: 'harness_failure',
    weeks: [],
  })
}

const PAID_DEFAULTS = {
  loadRuntime,
  buildManifest,
  readGit,
  runCase,
  buildArtifact,
  writeArtifactAtomic,
  buildReport,
  renderReport,
  evaluateAcceptance,
  now: () => new Date(),
  log: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  shouldStop: () => false,
}

function enforceOperationalFailureVerdict(verdict, artifact, interrupted) {
  const harnessCases = artifact.plans
    .filter((plan) => plan.errorClass === 'harness_failure')
    .map((plan) => plan.caseId)
  const reasons = Array.isArray(verdict?.reasons) ? [...verdict.reasons] : []
  if (harnessCases.length > 0) {
    const reason = `fallos del harness: ${harnessCases.join(', ')}`
    if (!reasons.includes(reason)) reasons.push(reason)
  }
  if (interrupted) {
    const reason = 'corrida detenida por señal antes de completar el manifest'
    if (!reasons.includes(reason)) reasons.push(reason)
  }
  if (harnessCases.length === 0 && !interrupted) return verdict

  return {
    ...verdict,
    accepted: false,
    reasons,
  }
}

/**
 * Orquestador inyectable del camino pagado. `main` hace los guards antes de
 * entrar acá; esta función se concentra en checkpoints y lifecycle del runtime.
 */
export async function runPaid(overrides = {}) {
  const deps = { ...PAID_DEFAULTS, ...overrides }
  // El camino productivo siempre se protege con el entorno real del proceso.
  // No debe existir una inyección capaz de desacoplar el guard del caller real.
  assertRunGuards(process.env)
  const artifactPath = deps.artifactPath ?? defaultArtifactPath(deps.now())
  const plans = []
  let runtime = null
  let primaryError = null
  let interrupted = false

  try {
    runtime = await deps.loadRuntime()
    const effectiveConfig = runtime.resolveEffectivePlanBuilderConfig(process.env)
    const variant = {
      ...effectiveConfig,
      variantId: runtime.buildVariantId(effectiveConfig),
    }
    const manifest = deps.buildManifest()
    let git = deps.readGit()
    let artifact = null

    // Los planes son secuenciales; la concurrencia interna queda productiva.
    for (const [index, manifestCase] of manifest.entries()) {
      if (deps.shouldStop()) {
        interrupted = true
        break
      }
      deps.log(`[${index + 1}/${manifest.length}] ${manifestCase.caseId}`)
      let planRow
      try {
        planRow = await deps.runCase(runtime, manifestCase, variant)
      } catch {
        planRow = failedPlanRow(manifestCase)
        deps.error(`${manifestCase.caseId}: ${planRow.errorClass}`)
      }
      plans.push(planRow)

      // Checkpoint pagado después de CADA caso, mediante reemplazo atómico.
      git = mergeGitState(git, deps.readGit())
      artifact = deps.buildArtifact({ plans, variant, git })
      await deps.writeArtifactAtomic(artifactPath, artifact)
      deps.log(`${planRow.outcome} terminalMs=${planRow.terminalMs ?? '—'}`)
    }

    // Relee Git y persiste siempre un checkpoint final, incluso si una señal
    // detuvo la corrida antes del siguiente caso o el manifest está vacío.
    git = mergeGitState(git, deps.readGit())
    artifact = deps.buildArtifact({ plans, variant, git })
    await deps.writeArtifactAtomic(artifactPath, artifact)

    const report = deps.buildReport(artifact)
    const renderedReport = deps.renderReport(report)
    deps.log(`Artefacto: ${artifactPath}`)
    deps.log(renderedReport)

    interrupted = interrupted || deps.shouldStop()
    const verdict = enforceOperationalFailureVerdict(
      deps.evaluateAcceptance(artifact),
      artifact,
      interrupted,
    )
    if (verdict.accepted) {
      deps.log('Control aceptable para calibración.')
    } else {
      deps.error('Control NO aceptable:')
      for (const reason of verdict.reasons) deps.error(`  - ${reason}`)
    }

    return { artifactPath, artifact, report, verdict }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (runtime !== null) {
      try {
        await runtime.close()
      } catch (closeError) {
        if (primaryError === null) throw closeError
        // El cierre es secundario. Nunca reemplaza config/persist/report.
        try {
          deps.error(`runtime.close falló: ${classifyError(closeError)}`)
        } catch {
          // Incluso un logger defectuoso debe preservar el error primario.
        }
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  // El reporte se enruta antes de los guards y no carga Vite.
  if (args.mode === 'report') {
    const artifact = JSON.parse(await readFile(args.artifactPath, 'utf8'))
    console.log(renderReport(buildReport(artifact)))
    return 0
  }

  // Los guards ocurren antes de `runPaid`, cuyo primer efecto es loadRuntime.
  assertRunGuards(process.env)
  const signals = installGracefulSignalHandlers()
  try {
    const result = await runPaid({ shouldStop: signals.shouldStop })
    return result.verdict.accepted ? 0 : 1
  } finally {
    signals.cleanup()
  }
}

const invokedDirectly = Boolean(process.argv[1])
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
