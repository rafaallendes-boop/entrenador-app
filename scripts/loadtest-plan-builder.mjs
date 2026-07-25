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
const SAFE_ERROR_CLASS = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

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
    if (
      typeof candidate === 'string'
      && candidate !== 'Error'
      && SAFE_ERROR_CLASS.test(candidate)
    ) {
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
  } catch (error) {
    errorClass = classifyError(error)
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

function failedPlanRow(manifestCase, error) {
  return toPlanRow({
    caseId: manifestCase.caseId,
    scenarioKey: manifestCase.scenarioKey,
    weekCount: manifestCase.weekCount,
    outcome: 'failed',
    weekCountSucceeded: 0,
    weekCountFailed: manifestCase.weekCount,
    errorClass: classifyError(error),
    weeks: [],
  })
}

const PAID_DEFAULTS = {
  env: process.env,
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
}

/**
 * Orquestador inyectable del camino pagado. `main` hace los guards antes de
 * entrar acá; esta función se concentra en checkpoints y lifecycle del runtime.
 */
export async function runPaid(overrides = {}) {
  const deps = { ...PAID_DEFAULTS, ...overrides }
  assertRunGuards(deps.env)
  const artifactPath = deps.artifactPath ?? defaultArtifactPath(deps.now())
  const plans = []
  let runtime = null
  let primaryError = null

  try {
    runtime = await deps.loadRuntime()
    const effectiveConfig = runtime.resolveEffectivePlanBuilderConfig(deps.env)
    const variant = {
      ...effectiveConfig,
      variantId: runtime.buildVariantId(effectiveConfig),
    }
    const manifest = deps.buildManifest()
    const git = deps.readGit()
    let artifact = null

    // Los planes son secuenciales; la concurrencia interna queda productiva.
    for (const [index, manifestCase] of manifest.entries()) {
      deps.log(`[${index + 1}/${manifest.length}] ${manifestCase.caseId}`)
      let planRow
      try {
        planRow = await deps.runCase(runtime, manifestCase, variant)
      } catch (error) {
        planRow = failedPlanRow(manifestCase, error)
        deps.error(`${manifestCase.caseId}: ${planRow.errorClass}`)
      }
      plans.push(planRow)

      // Checkpoint pagado después de CADA caso, mediante reemplazo atómico.
      artifact = deps.buildArtifact({ plans, variant, git })
      await deps.writeArtifactAtomic(artifactPath, artifact)
      deps.log(`${planRow.outcome} terminalMs=${planRow.terminalMs ?? '—'}`)
    }

    // El manifest productivo nunca está vacío; mantener la función total ayuda
    // a los tests y evita devolver `null` ante una configuración inválida.
    if (artifact === null) {
      artifact = deps.buildArtifact({ plans, variant, git })
      await deps.writeArtifactAtomic(artifactPath, artifact)
    }

    const report = deps.buildReport(artifact)
    const renderedReport = deps.renderReport(report)
    deps.log(`Artefacto: ${artifactPath}`)
    deps.log(renderedReport)

    const verdict = deps.evaluateAcceptance(artifact)
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
  const result = await runPaid()
  return result.verdict.accepted ? 0 : 1
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
