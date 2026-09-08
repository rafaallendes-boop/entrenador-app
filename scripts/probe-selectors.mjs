#!/usr/bin/env node
/**
 * Probe de selección deportiva — Entrega E0 del plan
 * `docs/superpowers/plans/2026-09-07-squash-running-selection.md`.
 *
 * Ejecuta los selectores, el compositor de squash y la reparación de semana
 * sobre casos dirigidos y congela el resultado normalizado. Es
 * **caracterización**: describe el comportamiento actual, incluido el que el
 * audit considera defectuoso. No afirma que ese comportamiento sea correcto.
 *
 * No llama al proveedor de IA, no toca Dexie ni Supabase, no lee el reloj y no
 * abre la red. Cuesta US$0.
 *
 *   node scripts/probe-selectors.mjs           # regenera el artefacto
 *   node scripts/probe-selectors.mjs --check   # falla si el artefacto cambió
 *
 * Un hash acredita integridad, no corrección: que el artefacto no cambie sólo
 * significa que el comportamiento no se movió.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CHAT_CASES,
  PROBE_TODAY,
  REPAIR_RUNNING_CASES,
  RUNNING_SLOT,
  SQUASH_SLOT,
  WEEK_SESSIONS_PER_WEEK,
  WEEK_TRAINING_DAYS,
  baseWeekProposals,
  REPAIR_SQUASH_CASES,
  RUNNING_HISTORY_CASES,
  RUNNING_SELECTION_CASES,
  SQUASH_HISTORY_CASES,
  SQUASH_HYDRATION_CASES,
  SQUASH_SELECTION_CASES,
} from './probe-selectors/cases.mjs'
import {
  analysePaceRoles,
  compareDuration,
  detectTextualRecoveries,
  sha256Of,
  stableStringify,
  summarizeCoverage,
  summarizeDose,
} from './probe-selectors/normalize.mjs'
import { installNetworkGuard, loadRuntime } from './probe-selectors/runtime.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stage = process.argv.find(arg => arg.startsWith('--stage='))?.split('=')[1] ?? 'e0'
if (!['e0', 'e1', 'e3'].includes(stage)) throw new Error('stage debe ser e0, e1 o e3')
const FIXTURE_DIR = resolve(ROOT, 'docs/reviews/fixtures/squash-running-selection', stage === 'e0' ? '.' : stage)
const OUTPUT_PATH = resolve(FIXTURE_DIR, 'probe-output.json')
const RUN_PATH = resolve(FIXTURE_DIR, 'probe-run.json')

// ─── Inventario ──────────────────────────────────────────────────────────────

function buildInventory(runtime) {
  const squashByKind = {}
  const squashByExecution = {}
  const squashByIntensity = {}
  const squashByFamily = {}

  for (const drill of runtime.SQUASH_DRILL_LIBRARY) {
    const kind = runtime.resolveSquashDrillKind(drill)
    squashByKind[kind] = (squashByKind[kind] ?? 0) + 1
    const execution = drill.executionMode ?? 'unset'
    squashByExecution[execution] = (squashByExecution[execution] ?? 0) + 1
    squashByIntensity[drill.intensity] = (squashByIntensity[drill.intensity] ?? 0) + 1
    const family = runtime.getSquashDrillFamily(drill)
    ;(squashByFamily[family] ??= []).push(drill.id)
  }
  for (const ids of Object.values(squashByFamily)) ids.sort()

  const runningByFamily = {}
  const runningByIntensity = {}
  for (const session of runtime.RUNNING_SESSION_LIBRARY) {
    runningByFamily[session.family] = (runningByFamily[session.family] ?? 0) + 1
    runningByIntensity[session.intensity] = (runningByIntensity[session.intensity] ?? 0) + 1
  }

  return {
    squashDrillCount: runtime.SQUASH_DRILL_LIBRARY.length,
    squashByKind,
    squashByExecution,
    squashByIntensity,
    squashByFamily,
    runningTemplateCount: runtime.RUNNING_SESSION_LIBRARY.length,
    runningByFamily,
    runningByIntensity,
  }
}

// ─── Squash: composición por duración ────────────────────────────────────────

function probeSquashHydration(runtime) {
  return SQUASH_HYDRATION_CASES.map((testCase) => {
    const result = runtime.hydrateSquashSession(testCase.input)
    const drills = result.details.drills ?? []
    const dose = summarizeDose(drills)
    return {
      name: testCase.name,
      covers: testCase.covers,
      requestedDurationMin: testCase.input.durationMin,
      resolvedKind: result.details.sessionKind,
      subtype: result.subtype,
      fallback: result.fallback ?? null,
      drills: drills.map((drill) => ({
        name: drill.name,
        durationMin: drill.durationMin ?? null,
        executionMode: drill.executionMode ?? null,
      })),
      blocks: (result.details.blocks ?? []).map((block) => ({
        kind: block.kind,
        durationMin: block.durationMin ?? null,
        drillCount: block.drills.length,
      })),
      duration: compareDuration(testCase.input.durationMin, dose),
      warnings: result.warnings.map((warning) => warning.code),
    }
  })
}

// ─── Squash: selección, fase y ejecución ─────────────────────────────────────

function probeSquashSelection(runtime) {
  return SQUASH_SELECTION_CASES.map((testCase) => {
    const result = runtime.selectSquashDrills(testCase.input)
    const definitions = result.drills
      .map((drill) => runtime.findSquashDrillByName(drill.name))
      .filter(Boolean)

    // Se reevalúan los filtros duros sobre la salida: si un drill seleccionado
    // no sobrevive al filtro que supuestamente lo condicionaba, entró por un
    // fallback que relajó una restricción sin declararlo.
    const phaseAllowed = new Set(
      runtime.filterByPhase(definitions, testCase.input).map((drill) => drill.id),
    )
    const executionAllowed = new Set(
      runtime
        .filterByExecutionMode(definitions, testCase.input.partnerAvailability)
        .map((drill) => drill.id),
    )

    return {
      name: testCase.name,
      covers: testCase.covers,
      desiredKind: testCase.input.desiredKind ?? null,
      partnerAvailability: testCase.input.partnerAvailability ?? null,
      sessionKind: result.sessionKind,
      trainingFocus: result.trainingFocus,
      selectionNote: result.selectionNote ?? null,
      selected: definitions.map((drill) => ({
        id: drill.id,
        kind: runtime.resolveSquashDrillKind(drill),
        family: runtime.getSquashDrillFamily(drill),
        intensity: drill.intensity,
      })),
      phaseViolations: definitions.filter((d) => !phaseAllowed.has(d.id)).map((d) => d.id),
      executionViolations: definitions.filter((d) => !executionAllowed.has(d.id)).map((d) => d.id),
      duration: compareDuration(0, summarizeDose(result.drills)),
    }
  })
}

// ─── Squash: historial y progresión ──────────────────────────────────────────

function probeSquashHistory(runtime) {
  const baseContext = {
    fatigueLevel: 4,
    phase: 'build',
    recentDrills: [],
    goal: 'mejorar squash',
    competitionSoon: false,
  }

  return SQUASH_HISTORY_CASES.map((testCase) => {
    const context = { ...baseContext, historicalSessions: testCase.sessions }
    const state = runtime.deriveSquashProgressionState(context)
    return {
      name: testCase.name,
      covers: testCase.covers,
      inputStatuses: testCase.sessions.map((session) => session.status),
      inputDates: testCase.sessions.map((session) => session.date),
      recommendation: state.recommendation,
      targetFamily: state.targetFamily ?? null,
      targetFocus: state.targetFocus ?? null,
      families: Object.values(state.families)
        .map((entry) => ({ family: entry.family, frequency: entry.frequency, lastLevel: entry.lastLevel, lastDate: entry.lastDate }))
        .sort((a, b) => a.family.localeCompare(b.family)),
      recentDrills: runtime.extractRecentSquashDrills(testCase.sessions),
      recentKinds: runtime.extractRecentSquashKinds(testCase.sessions),
    }
  })
}

function probeSquashWeekPlan(runtime) {
  const phases = ['base', 'build', 'peak', 'taper']
  return phases.flatMap((phase) =>
    [2, 3].map((sessionSlots) => {
      const plan = runtime.planSquashWeek({
        sessionSlots,
        phase,
        daysToNextCompetition: phase === 'taper' ? 3 : undefined,
        recentKinds: [],
        fatigueLevel: 4,
      })
      return {
        name: `planSquashWeek/${phase}/${sessionSlots}`,
        covers: ['S7'],
        slots: plan.slots.map((slot) => ({ kind: slot.kind, reason: slot.reason ?? null })),
        note: plan.note ?? null,
      }
    }),
  )
}

// ─── Running: contexto declarado vs efectivo ─────────────────────────────────

function probeRunningSelection(runtime) {
  return RUNNING_SELECTION_CASES.map((testCase) => {
    const result = runtime.selectRunningSession(testCase.input)
    const state = runtime.deriveRunningProgressionState(testCase.input)
    return {
      name: testCase.name,
      covers: testCase.covers,
      declaredInputs: {
        sessionDurationMin: testCase.input.sessionDurationMin ?? null,
        experienceLevel: testCase.input.experienceLevel ?? null,
        weeklyRunCount: testCase.input.weeklyRunCount ?? null,
        primarySport: testCase.input.primarySport ?? null,
        recentSessions: testCase.input.recentSessions,
      },
      selectedName: result.session?.name ?? null,
      selectedFamily: result.session?.family ?? null,
      selectedIntensity: result.session?.intensity ?? null,
      runningType: result.session?.runningType ?? null,
      structure: result.session?.structure ?? null,
      templateRef: result.session?.templateRef ?? null,
      durationMin: result.session?.durationMin ?? null,
      rejectionReason: result.rejectionReason ?? null,
      blocks: result.session?.intervalStructure?.blocks ?? [],
      exposesTemplateId: Boolean(result.session && Object.prototype.hasOwnProperty.call(result.session, 'id')),
      focus: result.focus,
      progressionIntent: state.intent,
      progressionSummary: result.progressionSummary ?? null,
    }
  })
}

function probeRunningEligibility(runtime) {
  const context = {
    fatigueLevel: 4,
    phase: 'build',
    recentSessions: [],
    goal: 'base aeróbica para squash',
    sportProfile: 'sport_support',
    primarySport: 'squash',
    competitionSoon: false,
  }
  const eligible = runtime.filterByProfile(runtime.RUNNING_SESSION_LIBRARY, context)
  return {
    covers: ['R3'],
    profile: 'sport_support',
    eligibleIds: eligible.map((session) => session.id).sort(),
    eligibleAboveModerate: eligible
      .filter((session) => session.intensity === 'high' || session.intensity === 'moderate-high')
      .map((session) => ({ id: session.id, family: session.family, intensity: session.intensity }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  }
}

function probeRunningHistory(runtime) {
  return RUNNING_HISTORY_CASES.map((testCase) => ({
    name: testCase.name,
    covers: testCase.covers,
    inputStatuses: testCase.sessions.map((session) => session.status),
    inputTitles: testCase.sessions.map((session) => session.title),
    derivedFamilies: runtime.extractRecentRunningSessions(testCase.sessions),
  }))
}

// ─── Ruta: repairGeneratedWeek ───────────────────────────────────────────────

export function buildRepairContext(partnerAvailability, phase = 'build') {
  const wizardConfig = {
    goalEventId: 'probe-event',
    trainingDays: WEEK_TRAINING_DAYS,
    sessionsPerWeek: WEEK_SESSIONS_PER_WEEK,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    partnerAvailability,
    complementarySports: ['running'],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    createdAt: '',
    updatedAt: '',
  }
  const plan = {
    id: 'probe-plan',
    athleteId: 'probe-athlete',
    goalEventId: 'probe-event',
    status: 'draft',
    generationState: 'shell',
    title: 'Probe',
    startDate: '2026-06-01',
    endDate: '2026-06-07',
    totalWeeks: 1,
    phases: [{ phase, startWeekIndex: 0, endWeekIndex: 0, blockFocus: '', intentBySport: {} }],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'probe-event',
      goalEventDate: '2026-06-28',
      currentPhase: phase,
      weeksRemaining: 4,
      blockFocus: '',
      headline: '',
      timeline: [],
      sportDetails: [
        { sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' },
      ],
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 0,
    updatedAt: 0,
  }
  const week = {
    id: 'probe-week',
    planId: 'probe-plan',
    weekIndex: 0,
    weekStartDate: '2026-06-01',
    phase,
    status: 'pending',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: { squash: 100 },
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 0,
    updatedAt: 0,
  }
  const profile = {
    id: 'probe-athlete',
    updatedAt: 0,
    sportContext: { primarySport: 'squash' },
    mainGoal: 'Squash competitivo',
  }
  return { plan, week, profile, wizardConfig, planWeekDescriptors: [{ weekIndex: 0, phase }] }
}

/** Semana completa con la sesión bajo estudio ocupando su slot. */
function weekWithProbeSession(slot, session) {
  const proposal = { ...slot, ...session }
  const rest = baseWeekProposals().filter(
    (item) => !(item.date === slot.date && item.timeBlock === slot.timeBlock),
  )
  return { proposal, proposals: [...rest, proposal].sort((a, b) => `${a.date}|${a.timeBlock}`.localeCompare(`${b.date}|${b.timeBlock}`)) }
}

/**
 * La sesión enviada se identifica por `date|timeBlock`, no por posición ni por
 * tipo: el repair puede **agregar** sesiones (p. ej. el partido duro semanal) y
 * un `find` por `sessionType` devolvía esa otra sesión. Lo agregado se reporta
 * aparte porque es evidencia de ruta, no ruido.
 */
function splitRepairResult(result, proposal) {
  const key = (session) => `${session.date}|${session.timeBlock}`
  const target = result.sessions.find((session) => key(session) === key(proposal)) ?? null
  const added = result.sessions
    .filter((session) => key(session) !== key(proposal))
    .map((session) => ({
      date: session.date,
      timeBlock: session.timeBlock,
      sessionType: session.sessionType,
      squashKind: session.squashKind ?? null,
      durationMin: session.durationMin ?? null,
    }))
    .sort((a, b) => `${a.date}|${a.timeBlock}`.localeCompare(`${b.date}|${b.timeBlock}`))
  return { target, added, returnedCount: result.sessions.length }
}

/**
 * Se cruza con la fase a propósito. `normalizeSquashSupportAerobicLoad` fuerza
 * `z2` y recorta duración en build/peak/taper cuando el deporte principal es
 * squash, así que en esas fases la materialización de tempo/series **no se
 * alcanza**. `base` es la única fase del plan donde el camino que R6 y R7
 * describen llega a ejecutarse.
 */
function probeRepairRunning(runtime) {
  return REPAIR_RUNNING_CASES.flatMap((testCase) => ['base', 'build'].map((phase) => {
    const { proposal, proposals } = weekWithProbeSession(RUNNING_SLOT, testCase.session)
    const result = runtime.repairGeneratedWeek(proposals, buildRepairContext(undefined, phase))
    const { target: session, added, returnedCount } = splitRepairResult(result, proposal)
    const blocks = session?.intervalStructure?.blocks ?? []
    const dose = summarizeDose(blocks)
    return {
      name: `${testCase.name} · fase ${phase}`,
      covers: testCase.covers,
      phase,
      requestedDurationMin: testCase.session.durationMin,
      declaredRunningType: testCase.session.runningType ?? null,
      returnedSessionCount: returnedCount,
      addedByRepair: added,
      targetPresent: session != null,
      resolvedRunningType: session?.runningType ?? null,
      resolvedDurationMin: session?.durationMin ?? null,
      blocks: blocks.map((block) => ({
        label: block.label,
        durationMin: block.durationMin ?? null,
        repetitions: block.repetitions ?? null,
        distanceKm: block.distanceKm ?? null,
        targetPace: block.targetPace ?? null,
        notes: block.notes ?? null,
        // E1 representa las recuperaciones como bloques separados.
        declaresRecovery: /^Recuperación/.test(block.label),
      })),
      duration: compareDuration(testCase.session.durationMin, dose),
      pace: analysePaceRoles(blocks),
      textualRecoveries: detectTextualRecoveries(blocks),
      warnings: result.meta.warnings.map((warning) => warning.code).sort(),
    }
  }))
}

function probeRepairSquash(runtime) {
  return REPAIR_SQUASH_CASES.map((testCase) => {
    const { proposal, proposals } = weekWithProbeSession(SQUASH_SLOT, testCase.session)
    const result = runtime.repairGeneratedWeek(
      proposals,
      buildRepairContext(testCase.partnerAvailability),
    )
    const { target: session, added, returnedCount } = splitRepairResult(result, proposal)
    const drills = session?.squashDetails?.drills ?? []
    const dose = summarizeDose(drills)
    return {
      name: testCase.name,
      covers: testCase.covers,
      requestedDurationMin: testCase.session.durationMin,
      returnedSessionCount: returnedCount,
      addedByRepair: added,
      targetPresent: session != null,
      partnerAvailability: testCase.partnerAvailability ?? null,
      declaredKind: testCase.session.squashKind ?? null,
      resolvedKind: session?.squashDetails?.sessionKind ?? null,
      drills: drills.map((drill) => ({
        name: drill.name,
        durationMin: drill.durationMin ?? null,
        executionMode: drill.executionMode ?? null,
      })),
      duration: compareDuration(testCase.session.durationMin, dose),
      warnings: result.meta.warnings.map((warning) => warning.code).sort(),
    }
  })
}

// ─── Ruta: chat ──────────────────────────────────────────────────────────────

function probeChat(runtime) {
  const context = {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    athleteProfile: {
      id: 'probe-athlete',
      updatedAt: 0,
      sportContext: { primarySport: 'squash' },
      mainGoal: 'Squash competitivo',
    },
  }

  return CHAT_CASES.map((testCase) => {
    const response = {
      message: '',
      actions: [testCase.action],
      filteredCreateWeek: false,
      provider: 'gemini',
      timestamp: 0,
      traceId: 'probe',
      requestClass: 'chat_action',
    }
    const processed = runtime.postProcessCoachActions(response, context, testCase.userMessage)
    const action = processed.actions?.[0] ?? null
    const blocks = action?.intervalStructure?.blocks ?? []
    const drills = action?.squashDetails?.drills ?? []
    const dose = blocks.length > 0 ? summarizeDose(blocks) : summarizeDose(drills)
    return {
      name: testCase.name,
      covers: testCase.covers,
      requestedDurationMin: testCase.action.durationMin,
      resolvedDurationMin: action?.durationMin ?? null,
      resolvedRunningType: action?.runningType ?? null,
      resolvedSquashKind: action?.squashDetails?.sessionKind ?? null,
      blocks: blocks.map((block) => ({
        label: block.label,
        durationMin: block.durationMin ?? null,
        targetPace: block.targetPace ?? null,
      })),
      drills: drills.map((drill) => ({ name: drill.name, durationMin: drill.durationMin ?? null })),
      duration: compareDuration(testCase.action.durationMin, dose),
      pace: analysePaceRoles(blocks),
    }
  })
}

// ─── Artefacto ───────────────────────────────────────────────────────────────

export function buildOutputs(runtime) {
  const sections = {
    squashHydration: probeSquashHydration(runtime),
    squashSelection: probeSquashSelection(runtime),
    squashHistory: probeSquashHistory(runtime),
    squashWeekPlan: probeSquashWeekPlan(runtime),
    runningSelection: probeRunningSelection(runtime),
    runningHistory: probeRunningHistory(runtime),
    repairRunning: probeRepairRunning(runtime),
    repairSquash: probeRepairSquash(runtime),
    chat: probeChat(runtime),
  }

  return {
    probeToday: PROBE_TODAY,
    inventory: buildInventory(runtime),
    runningEligibility: probeRunningEligibility(runtime),
    ...sections,
    coverage: summarizeCoverage(sections),
  }
}

function readGitState() {
  const run = (args) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trimEnd()
    } catch {
      return null
    }
  }
  const status = run(['status', '--porcelain'])
  return {
    revision: run(['rev-parse', 'HEAD']),
    branch: run(['rev-parse', '--abbrev-ref', 'HEAD']),
    // Cambios locales: el artefacto no acredita `main` limpio si el árbol no lo está.
    dirtyPaths: status ? status.split('\n').map((line) => line.slice(3).trim()).sort() : [],
  }
}

async function readSourceHashes() {
  const paths = [
    'scripts/probe-selectors.mjs',
    ...['cases', 'normalize', 'runtime'].map(name => `scripts/probe-selectors/${name}.mjs`),
    ...['drillLibrary', 'drillSelector', 'squashSessionHydrator', 'squashWeekPlanner',
      'runningSessionLibrary', 'runningSelector', 'sessionTimeBudget', 'squashSessionDose',
      'runningSessionMaterializer', 'sessionDoseFinalizer', 'coachActionDose', 'executedSessions',
      'runningTemplateMaterializer', 'runningPrescriptions', 'runningPolicy', 'squashCatalogExpansion']
      .map(name => `src/services/training/${name}.ts`),
    'src/services/planBuilder/repairWeek.ts',
    'src/services/ai/actionPostProcessor.ts',
  ]
  return Object.fromEntries(await Promise.all(paths.map(async path => [path,
    createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex'),
  ])))
}

async function main() {
  const check = process.argv.includes('--check')
  const guard = installNetworkGuard()
  let runtime = null
  let primaryError = null

  try {
    runtime = await loadRuntime()

    // Acreditación de determinismo: la misma entrada, dos veces, en la misma
    // corrida. Si difiere, el artefacto no sirve como baseline y hay que
    // arreglar el probe antes que cualquier entrega.
    const first = buildOutputs(runtime)
    const second = buildOutputs(runtime)
    const outputsSha = sha256Of(first)
    const deterministic = outputsSha === sha256Of(second)
    if (guard.attempts.length) throw new Error('probe-selectors: hubo intentos de red, incluso si el módulo capturó el error')
    if (!deterministic) {
      throw new Error('probe-selectors: dos corridas de la misma entrada difieren; el baseline no es válido')
    }

    const serialized = `${stableStringify(first)}\n`

    if (check) {
      const existing = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
      if (existing === null) {
        console.error(`No existe el artefacto ${OUTPUT_PATH}. Corré el probe sin --check.`)
        process.exitCode = 1
        return
      }
      if (existing !== serialized) {
        console.error('El comportamiento cambió respecto del artefacto congelado.')
        console.error(`  esperado sha256: ${sha256Of(JSON.parse(existing))}`)
        console.error(`  obtenido sha256: ${outputsSha}`)
        process.exitCode = 1
        return
      }
      console.log(`Sin deriva. sha256=${outputsSha}`)
      return
    }

    await mkdir(FIXTURE_DIR, { recursive: true })
    await writeFile(OUTPUT_PATH, serialized, 'utf8')
    await writeFile(
      RUN_PATH,
      `${stableStringify({
        probe: 'squash-running-selection',
        outputsSha256: outputsSha,
        deterministic,
        networkAttempts: guard.attempts,
        node: process.version,
        git: readGitState(),
        sourceSha256: await readSourceHashes(),
        note: 'Caracterización del comportamiento actual, no contrato deseado. Un hash acredita integridad, no corrección.',
      })}\n`,
      'utf8',
    )

    console.log(`Artefacto: ${OUTPUT_PATH}`)
    console.log(`Corrida:   ${RUN_PATH}`)
    console.log(`sha256=${outputsSha} determinista=${deterministic} red=${guard.attempts.length}`)
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    guard.restore()
    if (runtime !== null) {
      try {
        await runtime.close()
      } catch (closeError) {
        if (primaryError === null) throw closeError
        console.error(`runtime.close falló: ${closeError?.message ?? closeError}`)
      }
    }
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error?.stack ?? String(error))
    process.exitCode = 1
  })
}
