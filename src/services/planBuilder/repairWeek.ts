import type { Session } from '../../types'
import { resolveRunningSupportPolicy, hasNeighboringHardSession, runningExposureInWeek } from '../training/runningPolicy'
import { runningTargets } from '../training/runningSessionMaterializer'
import { finalizeSessionDose } from '../training/sessionDoseFinalizer'
import { decideLoadDirective, type ExecutionSignals } from '../training/loadDirectivePolicy'
import type {
  AthleteProfile,
  CoachExerciseProposal,
  CoachSessionProposal,
  DayOfWeek,
  GoalEventLevel,
  PlanWizardConfig,
  SquashDetails,
  SquashDrill,
  SquashSessionBlock,
  SquashSessionBlockKind,
  SquashSessionKind,
  SquashTrainingFocus,
  SupportedSport,
  TimeBlock,
  WizardFatigueLevel,
} from '../../types'
import type {
  StrengthAllocatorMetrics,
  StrengthSafetyBlockedSlot,
  TrainingPlan,
  TrainingPlanWeek,
} from '../../types/planBuilder'
import { prepareStrengthSession } from '../training/strengthSafetyFinalizer'
import { getExpectedSessionsForPlanWeek, getPlanWeekDateRange, isDateInsidePlanWeekRange } from './dateRange'
import {
  selectSquashDrillReplacement,
  selectSquashDrills,
  type SquashRelaxationLevel,
  type SquashSelectionDesiredKind,
  type SquashSelectionPhase,
} from '../training/drillSelector'
import { hydrateSquashSession } from '../training/squashSessionHydrator'
import { findSquashDrillByName, isControlDrill, isShadowsDrill, isSquashMatchDrill, normalizeSquashDrillKey, orderSquashBlocksForSession, resolveDrillExecutionMode, resolveSquashDrillKey, resolveSquashDrillKind, toSquashDrill } from '../training/drillLibrary'
import {
  hasSquashCompetitiveExposureContent,
  isCompetitiveMatchDrill,
  isFinisherMatchDrill,
  resolveSquashMatchRole,
  SQUASH_FINISHER_MATCH_IDS,
} from '../training/squashMatchRole'
import { selectRunningSession, type RunningPhase, type RunningSportProfile } from '../training/runningSelector'
import {
  getTargetExerciseDensity,
  selectStrengthSession,
  buildStrengthReplacementById,
  getStrengthReplacementPool,
  type StrengthContext,
  type StrengthPhase,
  type StrengthSportProfile,
} from '../training/strengthSelector'
import { getStrengthBlockTemplateCycleLength } from '../training/strengthBlocks'
import {
  enhanceStrengthSessionExercises,
  getMinimumStrengthWorkCount,
  isFoundationCore,
  isStrengthWorkExercise,
} from '../training/strengthSessionStructure'
import { planSupersetGroups, shouldApplySupersetPolicy } from '../training/supersetPolicy'
import { getExerciseById, resolveStrengthExercise } from '../training/exerciseLibrary'
import { captureSources, deriveSlotContext, type ReferenceSlot, type SourceCapture } from '../training/slotContext'
import {
  resolveStrengthAthleteContext,
  toStrengthContextAthleteFields,
  type StrengthAthleteContext,
} from '../training/strengthAthleteContext'
import { getStrengthExerciseKey, toStrengthProposal } from '../training/strengthExerciseProposal'
import { selectMobilitySession, type MobilityPhase } from '../training/mobilitySelector'
import { selectCyclingSession, type CyclingPhase, type CyclingSportProfile } from '../training/cyclingSelector'
import { normalizeMobilityDetails, type MobilitySportContext } from '../training/mobilitySessionLibrary'
import type { CyclingRole } from '../training/cyclingSessionLibrary'
import { normalizeSport } from '../../utils/athlete'
import { buildAthleteParameters } from './profileAdapter'
import { resolveBlockPositions, type PlanWeekDescriptor } from './blockIdentity'
import {
  isCountableRole,
} from './strengthRoleContract'
import {
  allocateStrengthBlock,
  type AllocationDegradationReason,
  type AllocatorResult,
} from './strengthBlockAllocator'
import {
  captureStrengthTemplateSnapshot,
  computeTemplateSignature,
  strengthTemplateSessionKey,
  type StrengthTemplateSlot,
  type StrengthTemplateSnapshot,
} from './strengthTemplateSnapshot'
import {
  INJECTED_CORE_ROTATION,
  projectStructuralCoreSlot,
  type StructuralCoreProjection,
} from './strengthStructuralCore'
import { isReadyWeek } from './weekUtils'
import {
  resolveSquashWeeklyExposurePolicy,
  type SquashWeeklyExposureDecision,
  type SquashWeeklyMatchFormat,
} from './squashWeeklyExposurePolicy'
import {
  createRepairTaxonomyMeta,
  recordRepairAction,
  type RepairActionCategory,
  type RepairTaxonomyMeta,
} from './repairTaxonomy'
import {
  EVENT_WINDOW_SUPPORT_CAPS,
  MAX_EVENT_WINDOW_SUPPORTS_PER_WEEK,
  isPlanEventAnchorDate,
  isDeclaredSquashMatchSession,
  isWithinPlanEventWindow,
  planWeekContainsEventAnchor,
  resolveEventWindowSupportKind,
  resolvePlanEventWindow,
} from './eventWindowRules'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RepairContext {
  plan: TrainingPlan
  week: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  previousWeek?: TrainingPlanWeek
  historicalSessions?: Session[]
  executionSignals?: ExecutionSignals
  /** Descriptores ordenados de todas las semanas. El fallback unitario conserva compatibilidad de repair aislado. */
  planWeekDescriptors?: readonly PlanWeekDescriptor[]
  /** Captura B2 de la operación. Los campos de atleta de fuerza se resuelven desde acá (B1). */
  sourceCapture?: SourceCapture
  /**
   * T8: el hidratador del Week Creator instala su propia resolución por slot.
   * Efímero — no serializar en el payload del Plan Builder. Plan Builder no lo
   * instala y conserva I8 (resolución propia vía `resolveStrengthAthleteContext`).
   */
  strengthAthleteForSlot?: (slot: ReferenceSlot) => StrengthAthleteContext
}

export interface RepairWarning {
  code: string
  message: string
  sessionDate?: string
}

export interface RepairMeta {
  rawSessionCount: number
  repairedSessionCount: number
  movedSessionCount: number
  addedFallbackCount: number
  droppedSessionCount: number
  filteredSportCount: number
  /** Tombstones prevent later fallback/primary repair from recreating a blocked slot. */
  strengthSafetyBlocked?: StrengthSafetyBlockedSlot[]
  safetyDegraded?: boolean
  /** Política determinista de accesorios; undefined significa no aplicable. */
  strengthAccessoryRotationActionCount?: number
  strengthAccessoryRotationSessionsAffected?: number
  strengthAllocator?: StrengthAllocatorMetrics
  squashDrillRotationActionCount?: number
  squashDrillRotationSessionsAffected?: number
  squashDrillRotationOmittedCount?: number
  /**
   * Observacionales de modalidad de squash. No entran en `countRepairsV2`.
   *
   * `squashKindFallback*` mide incumplimiento del contrato: el proveedor debía
   * declarar `squashKind`. Se separan las dos causas porque significan cosas
   * distintas — un `subtype` heredado todavía es señal estructural del modelo,
   * mientras que el default es ausencia total de señal.
   */
  squashKindFallbackLegacySubtypeCount?: number
  squashKindFallbackDefaultCount?: number
  squashKindConflictCount?: number
  /** La modalidad pedida no tenía contenido elegible en la fase. Ver A2.5. */
  squashKindDegradedCount?: number
  squashPoolInsufficientCount?: number
  /** Observacionales: no entran en `countRepairsV2` ni en la taxonomía. */
  squashFinisherProposedCount?: number
  squashFinisherPreservedCount?: number
  squashStandaloneMatchCount?: number
  /**
   * Aditivo. `repairedSessionCount` conserva su semántica exacta porque
   * WeekCreatorEngine ramifica sobre él.
   */
  taxonomy: RepairTaxonomyMeta
  warnings: RepairWarning[]
}

export interface RepairResult {
  sessions: CoachSessionProposal[]
  meta: RepairMeta
  failure?: RepairFailure
}

/**
 * Proyección completa y transitoria del bloque de fuerza. Cada worker la
 * reconstruye desde el mismo template y consume sólo su columna local; nunca
 * cruza una frontera de serialización ni se persiste en la semana.
 */
export interface StrengthBlockAllocation {
  snapshot: StrengthTemplateSnapshot
  templateSignature: string
  matrix: AllocatorResult['matrix']
  degradedCells: AllocatorResult['degradedCells']
  searchExhausted: boolean
  /** Columna local dentro del grupo que comparte el mismo template. */
  localWeek: number
  /** Índice real dentro del bloque de fase; no siempre coincide con la columna. */
  localBlockWeek: number
  /** Índices reales del bloque representados por las columnas de `matrix`. */
  blockWeekIndices: ReadonlyArray<number>
  /** Distingue el esqueleto productivo hidratado de una plantilla provista. */
  selectorHydrated: boolean
  /** Core estructural por columna virtual, indexado por identidad de sesión. */
  structuralCoreByWeek: ReadonlyArray<ReadonlyMap<string, StructuralCoreProjection>>
  /** Slots mínimos derivados que el allocator asigna, anclados a su sesión. */
  densitySlotSessionKeys: ReadonlyMap<string, string>
}

export interface RepairFailure {
  errorClass: 'quality.squash.signature_uniqueness_unresolved' | 'quality.strength.safety_blocked' | 'quality.session.dose_infeasible'
  message: string
}

export function isSafetyBlockedSlot(
  meta: Pick<RepairMeta, 'strengthSafetyBlocked'>,
  date: string,
  timeBlock: TimeBlock,
): boolean {
  return meta.strengthSafetyBlocked?.some((slot) => slot.date === date && slot.timeBlock === timeBlock) ?? false
}

export function createRepairMeta(rawSessionCount: number): RepairMeta {
  return {
    rawSessionCount,
    repairedSessionCount: 0,
    movedSessionCount: 0,
    addedFallbackCount: 0,
    droppedSessionCount: 0,
    filteredSportCount: 0,
    taxonomy: createRepairTaxonomyMeta(),
    warnings: [],
  }
}

function sessionKeyOf(session: { date?: string; timeBlock?: string }): string {
  return strengthTemplateSessionKey(session)
}

/** Incrementa el contador legacy Y la taxonomía. Usar donde hoy se incrementa `repairedSessionCount`. */
function recordRepair(
  meta: RepairMeta,
  category: RepairActionCategory,
  sessionKey?: string,
): void {
  meta.repairedSessionCount++
  recordRepairAction(meta.taxonomy, category, sessionKey)
}

/**
 * Incrementa SOLO la taxonomía. Para sitios que hoy no tocan
 * `repairedSessionCount`: promoverlos a `recordRepair` cambiaría la semántica
 * y la telemetría legacy, incluso si otro contador ya bloquea el early return.
 */
function recordTaxonomyOnly(
  meta: RepairMeta,
  category: RepairActionCategory,
  sessionKey?: string,
): void {
  recordRepairAction(meta.taxonomy, category, sessionKey)
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function repairGeneratedWeek(
  rawSessions: CoachSessionProposal[],
  context: RepairContext,
): RepairResult {
  const meta = createRepairMeta(rawSessions.length)
  meta.squashFinisherProposedCount = rawSessions.filter(
    (session) => session.sessionType === 'squash'
      && resolveSquashMatchRole(session.squashDetails) === 'finisher',
  ).length

  const mustMaterializeRaceAnchor = context.week.phase === 'race'
    && getPrimarySport(context) === 'squash'
    && hasSquashGoalEvent(context)
    && planWeekContainsEventAnchor(context.plan, context.week)
  if (rawSessions.length === 0 && !mustMaterializeRaceAnchor) {
    measureSquashMatchRoles([], meta)
    return { sessions: [], meta }
  }

  let sessions = rawSessions.map((s) => ({ ...s }))

  // 1. Drop invalid dates
  const validDateSessions: CoachSessionProposal[] = []
  for (const s of sessions) {
    if (isStrictISODate(s.date)) {
      validDateSessions.push(s)
    } else {
      meta.droppedSessionCount++
      meta.warnings.push({ code: 'invalid_date', message: `Sesión "${s.title}" eliminada: fecha inválida (${s.date}).`, sessionDate: s.date })
    }
  }
  sessions = validDateSessions

  // 2. Move sessions outside the week range
  sessions = moveOutOfWeekSessions(sessions, context, meta)

  // 3. Move sessions on disallowed days
  sessions = moveOutOfAllowedDaySessions(sessions, context, meta)

  // 4. Resolve date+timeBlock collisions
  sessions = resolveCollisions(sessions, context, meta)

  // 4b. A day may be a valid training day but still not allow AM+PM work.
  sessions = enforceDoubleSessionDayConstraints(sessions, context, meta)

  // 5. Filter disallowed sports
  sessions = filterDisallowedSports(sessions, context, meta)

  // 5b. Dos duras de deportes distintos el mismo día.
  //
  // Va ANTES del paso 6 a propósito, y esto no es negociable: el allocator de
  // fuerza que se resuelve más abajo indexa `structuralCoreByWeek` y los ids
  // comprometidos por `sessionKeyOf` = `date|timeBlock`, y
  // `finalizeStrengthSafetySessions` (paso 14) vuelve a leerlos con esa clave.
  // Cambiar la fecha de una sesión de fuerza después del paso 6 dejaría al
  // finalizador sin su proyección de core, en silencio.
  //
  // Los pasos 12/13/13b pueden reintroducir un choque al agregar sesiones; ese
  // residuo lo detecta el gate `quality.load.same_day_hard_cross_sport`.
  sessions = separateSameDayHardCrossSportSessions(sessions, context, meta)

  // 6. El contrato productivo entrega esqueletos sin `exercises`. Materializa
  // primero la selección determinista y captura ese template ANTES de core y
  // densidad. Cada paso posterior consume esta proyección; ninguno vuelve a
  // derivar el dominio desde una lista ya mutada.
  const prehydratedStrengthSessions = hydrateStrengthTemplatesBeforeAllocation(sessions, context)
  const strengthSessionsForAllocation = sessions.filter((session) => session.sessionType === 'strength')
  // El dominio sólo se considera selector-owned si TODAS las sesiones de
  // fuerza lo son. Un payload mixto no sigue un ciclo A/B/C reconstruible.
  const selectorHydrated = strengthSessionsForAllocation.length > 0
    && strengthSessionsForAllocation.every(
      (session) => prehydratedStrengthSessions.has(session)
        || session.metadata?.planBuilderStrengthRotation?.templateSource === 'selector',
    )
  const strengthAllocation = resolveStrengthBlockAllocation(
    strengthSessionsForAllocation,
    context,
    { selectorHydrated },
  )
  recordDivergentStrengthTemplateWarning(meta, context, strengthAllocation)

  // 7. Complete sport details (best-effort)
  completeSportDetails(
    sessions,
    context,
    meta,
    strengthAllocation,
    prehydratedStrengthSessions,
  )
  sanitizeSquashDrillSets(sessions, context, meta)
  normalizeSquashSemanticMetadata(sessions, meta, context)
  normalizeLateTaperSquashMatchPlay(sessions, context, meta)
  sessions = ensureSquashCompetitionMatchExposure(sessions, context, meta)
  sessions = normalizeSquashEventWindow(sessions, context, meta)

  // 8. Keep squash drill/block timing aligned with the session duration.
  normalizeSquashDurationConsistency(sessions, meta)

  // 9. Keep taper/race weeks fresh even when model output is too voluminous.
  sessions = normalizeCompetitionTaperLoad(sessions, context, meta)

  // 10. Taper caps can shorten sessions, so re-fit nested squash blocks after caps.
  normalizeSquashDurationConsistency(sessions, meta)

  // 11. Keep aerobic support non-interfering when squash is the primary target.
  sessions = normalizeSquashSupportAerobicLoad(sessions, context, meta)

  // 11b. If the macro allocated running load, it must exist as running, not as
  // an aerobic-looking squash drill.
  sessions = ensureTargetRunningSupportSession(sessions, context, meta)

  // 12. Balance session count
  sessions = balanceSessionCount(sessions, context, meta)

  // 13. Preserve primary-sport minimums after fallback/trim decisions
  sessions = ensurePrimarySportMinimum(sessions, context, meta)

  // 13b. In build/peak the primary sport must outweigh accessory work
  sessions = ensurePrimarySportDominance(sessions, context, meta)

  // 14. Alinear metadatos antes de proyectar una única asignación canónica.
  normalizeSquashSemanticMetadata(sessions, meta, context)
  normalizeLateTaperSquashMatchPlay(sessions, context, meta)
  sessions = ensureSquashCompetitionMatchExposure(sessions, context, meta)
  sessions = normalizeSquashEventWindow(sessions, context, meta)

  // 14b. Política de rotación y corrección de firmas comparten una sola pasada.
  const squashNormalization = normalizeSquashSessionContent(sessions, context, meta)
  if (squashNormalization.failure) {
    measureSquashMatchRoles(sessions, meta)
    return { sessions: [], meta, failure: squashNormalization.failure }
  }
  ensureSquashDrillGuidance(sessions)
  normalizeSquashDurationConsistency(sessions, meta)

  // 15. Una única proyección canónica de fuerza evita que dos mutadores se
  // deshagan entre sí y mantiene la segunda pasada como punto fijo.
  // La reserva de densidad se construye recién aquí, después de balancear y
  // convertir sesiones, para no reservar cupo I1 a slots que ya no existen.
  const strengthDensityOverlapGuard = createStrengthDensityOverlapGuard(
    strengthAllocation,
    context,
    sessions.filter((session) => session.sessionType === 'strength'),
  )
  const strengthMaterialization = normalizeStrengthSessions(
    sessions,
    context,
    meta,
    strengthAllocation,
    strengthDensityOverlapGuard,
  )
  recordStrengthAllocatorMetrics(meta, strengthAllocation, strengthMaterialization)

  // This is deliberately terminal: no subsequent Plan Builder mutator may
  // change strength exercises after the finalizer has written its seal.
  sessions = finalizeStrengthSafetySessions(sessions, context, meta, strengthAllocation)

  // 15. Check double session utilization
  sessions = enforceDoubleSessionDayConstraints(sessions, context, meta)
  sessions = checkDoubleSessionUtilization(sessions, context, meta)

  // El presupuesto semanal de running se acumula en orden de calendario. Ir por
  // el orden del array hacía que cuál sesión se clampea —o se rechaza con
  // `dose_infeasible`, que no es elegible para fallback— dependiera de cómo
  // emitió el modelo y no del día en que cae.
  const doseOrder = sessions.map((_, index) => index).sort((a, b) =>
    sessions[a].date.localeCompare(sessions[b].date)
    || (sessions[a].timeBlock ?? '').localeCompare(sessions[b].timeBlock ?? '')
    || a - b)
  const dosed: CoachSessionProposal[] = []
  for (const i of doseOrder) {
    const proposal = sessions[i]
    const neighborRows = sessions.filter((_, index) => index !== i).map(s => ({ date: s.date, type: s.sessionType, status: 'planned' as const, rpe: s.rpe, subtype: s.subtype, runningDetails: s.runningType ? { runningType: s.runningType } : undefined }))
    const result = finalizeSessionDose(proposal, context.profile, {
      phase: mapPhase(context.week.phase) as RunningPhase, fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
      primarySport: getPrimarySport(context), historicalSessions: context.historicalSessions,
      neighboringHardSession: hasNeighboringHardSession(neighborRows, proposal.date),
      ...runningExposureInWeek(dosed.map(s => ({ date: s.date, type: s.sessionType, status: 'planned' as const, durationMin: s.durationMin })), proposal.date),
    })
    if (!result.ok) return { sessions: [], meta, failure: { errorClass: 'quality.session.dose_infeasible', message: result.message } }
    sessions[i] = result.session
    dosed.push(result.session)
    if (sessions[i].metadata?.planBuilderSquashRotation) sessions[i].metadata!.planBuilderSquashRotation!.signature = canonicalSquashSignature(sessions[i])
  }
  measureSquashMatchRoles(sessions, meta)
  return { sessions, meta }
}

function finalizeStrengthSafetySessions(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
  allocation: StrengthBlockAllocation,
): CoachSessionProposal[] {
  const recentExercises = extractRecentStrengthExercises(context.previousWeek)
  const athleteParameters = buildAthleteParameters(context.profile, context.wizardConfig)
  const committedStrengthIds = getCommittedStrengthIds(
    allocation,
    new Set(sessions.filter((session) => session.sessionType === 'strength').map(sessionKeyOf)),
  )
  const finalized: CoachSessionProposal[] = []

  for (const session of sessions) {
    if (session.sessionType !== 'strength') {
      finalized.push(session)
      continue
    }

    const structuralCore = allocation.structuralCoreByWeek[allocation.localWeek]?.get(sessionKeyOf(session))
    const supersetMode = shouldApplySupersetPolicy({
      phase: context.week.phase,
      sportProfile: deriveStrengthSportProfile(context),
      sessionDurationMin: session.durationMin,
    })
    const result = prepareStrengthSession(session, {
      constraints: athleteParameters.safetyConstraints,
      userMessageConstraints: [],
      userMessage: '',
      selectionContext: buildPlanBuilderStrengthSelectionContext(session, context, recentExercises),
      structureOptions: {
        durationMin: session.durationMin,
        strengthProfile: context.profile.strengthProfile,
        weekIndexInBlock: allocation.localBlockWeek,
        availableEquipment: athleteParameters.availableEquipment,
        structuralCoreId: structuralCore?.coreId,
        protectedExerciseIds: committedStrengthIds,
      },
      supersetMode,
      // La densidad ya se proyectó para todo el bloque con el guard I1. El
      // finalizador conserva esa columna; rellenarla otra vez aquí podría
      // reintroducir ejercicios compartidos que el allocator había evitado.
      densityCompletion: 'preserve',
      sealLocation: 'metadata',
    })

    if (result.status === 'blocked') {
      meta.safetyDegraded = true
      const tombstone: StrengthSafetyBlockedSlot = {
        date: session.date,
        timeBlock: session.timeBlock,
        reason: result.reason,
      }
      if (!isSafetyBlockedSlot(meta, tombstone.date, tombstone.timeBlock)) {
        meta.strengthSafetyBlocked = [...(meta.strengthSafetyBlocked ?? []), tombstone]
      }
      meta.droppedSessionCount++
      meta.warnings.push({
        code: 'strength.safety_blocked',
        message: `Sesión de fuerza eliminada por seguridad (${result.reason}).`,
        sessionDate: session.date,
      })
      continue
    }

    finalized.push(result.session)
    recentExercises.push(...(result.session.exercises ?? []).map(getStrengthExerciseKey))
  }

  return finalized
}

function measureSquashMatchRoles(sessions: CoachSessionProposal[], meta: RepairMeta): void {
  meta.squashFinisherPreservedCount = sessions.filter(
    (session) => session.sessionType === 'squash'
      && resolveSquashMatchRole(session.squashDetails) === 'finisher',
  ).length
  meta.squashStandaloneMatchCount = sessions.filter(
    (session) => session.sessionType === 'squash'
      && resolveSquashMatchRole(session.squashDetails) === 'standalone',
  ).length
}

// ─── 1. Date validation ──────────────────────────────────────────────────────

function isStrictISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

// ─── 2. Move out-of-week sessions ───────────────────────────────────────────

function moveOutOfWeekSessions(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const allowedDates = getAllowedDatesInWeek(context)

  return sessions.map((s) => {
    if (isDateInsidePlanWeekRange(s.date, context.plan, context.week)) return s

    const available = findNearestAvailableDate(allowedDates, sessions, s.timeBlock, undefined, context.wizardConfig)
    if (available) {
      meta.movedSessionCount++
      meta.warnings.push({ code: 'moved_into_week', message: `Sesión "${s.title}" movida de ${s.date} a ${available.date} (fuera del rango válido de la semana).`, sessionDate: s.date })
      return { ...s, date: available.date, timeBlock: available.timeBlock }
    }

    meta.droppedSessionCount++
    meta.warnings.push({ code: 'drop_out_of_week', message: `Sesión "${s.title}" eliminada: fuera de semana y sin espacio disponible.`, sessionDate: s.date })
    return null
  }).filter((s): s is CoachSessionProposal => s !== null)
}

// ─── 3. Move sessions on disallowed days ────────────────────────────────────

function moveOutOfAllowedDaySessions(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const allowedDays = new Set(context.wizardConfig.trainingDays)
  const allowedDates = getAllowedDatesInWeek(context)

  return sessions.map((s) => {
    const dayOfWeek = isoDateToDayOfWeek(s.date)
    if (dayOfWeek && allowedDays.has(dayOfWeek)) return s
    if (isSquashRaceEventAnchorCandidate(s, context)) return s

    const available = findNearestAvailableDate(allowedDates, sessions, s.timeBlock, s.date, context.wizardConfig)
    if (available) {
      meta.movedSessionCount++
      meta.warnings.push({ code: 'moved_allowed_day', message: `Sesión "${s.title}" movida de ${s.date} a ${available.date} (día no permitido).`, sessionDate: s.date })
      return { ...s, date: available.date, timeBlock: available.timeBlock }
    }
    return s // keep it; validator will flag it
  })
}

// ─── 4. Resolve collisions ──────────────────────────────────────────────────

function resolveCollisions(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const occupied = new Set<string>()
  const result: CoachSessionProposal[] = []
  const allowDoubleSession = context.wizardConfig.allowDoubleSession

  for (const s of sessions) {
    const key = `${s.date}|${s.timeBlock}`
    if (!occupied.has(key)) {
      occupied.add(key)
      result.push(s)
      continue
    }

    // Try opposite timeBlock on the same date
    const oppositeBlock = s.timeBlock === 'AM' ? 'PM' : 'AM'
    const oppositeKey = `${s.date}|${oppositeBlock}`
    if (allowDoubleSession && canUseDoubleSessionOnDate(s.date, context.wizardConfig) && !occupied.has(oppositeKey)) {
      occupied.add(oppositeKey)
      meta.movedSessionCount++
      meta.warnings.push({ code: 'collision_resolved', message: `Sesión "${s.title}" movida a ${s.date} ${oppositeBlock} (colisión).`, sessionDate: s.date })
      result.push({ ...s, timeBlock: oppositeBlock })
      continue
    }

    // Try a different allowed date
    const allowedDates = getAllowedDatesInWeek(context)
    const available = findNearestAvailableDate(allowedDates, [...sessions, ...result], s.timeBlock, s.date, context.wizardConfig)
    if (available) {
      const newKey = `${available.date}|${available.timeBlock}`
      occupied.add(newKey)
      meta.movedSessionCount++
      meta.warnings.push({ code: 'collision_resolved', message: `Sesión "${s.title}" movida a ${available.date} ${available.timeBlock} (colisión).`, sessionDate: s.date })
      result.push({ ...s, date: available.date, timeBlock: available.timeBlock })
      continue
    }

    meta.droppedSessionCount++
    meta.warnings.push({ code: 'collision_drop', message: `Sesión "${s.title}" eliminada: colisión sin espacio disponible.`, sessionDate: s.date })
  }

  return result
}

function enforceDoubleSessionDayConstraints(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  if (sessions.length < 2) return sessions

  const allowedDates = getAllowedDatesInWeek(context)
  let result = [...sessions]
  const sessionsByDate = new Map<string, CoachSessionProposal[]>()

  for (const session of result) {
    const onDate = sessionsByDate.get(session.date) ?? []
    onDate.push(session)
    sessionsByDate.set(session.date, onDate)
  }

  for (const [date, onDate] of sessionsByDate.entries()) {
    if (onDate.length <= 1) continue
    if (canUseDoubleSessionOnDate(date, context.wizardConfig)) continue

    const sorted = [...onDate].sort((a, b) => {
      const priorityDiff = getSessionKeepPriority(context, b) - getSessionKeepPriority(context, a)
      if (priorityDiff !== 0) return priorityDiff
      return a.timeBlock.localeCompare(b.timeBlock)
    })
    const extras = sorted.slice(1)

    for (const extra of extras) {
      result = result.filter((session) => session !== extra)
      const available = findNearestAvailableDate(
        allowedDates,
        result,
        extra.timeBlock,
        extra.date,
        context.wizardConfig,
        meta.strengthSafetyBlocked,
      )

      if (!available) {
        meta.droppedSessionCount++
        meta.warnings.push({
          code: 'double_session_day_dropped',
          message: `Sesión "${extra.title}" eliminada: ${extra.date} no permite doble sesión y no había otro cupo válido.`,
          sessionDate: extra.date,
        })
        continue
      }

      result.push({ ...extra, date: available.date, timeBlock: available.timeBlock })
      meta.movedSessionCount++
      meta.warnings.push({
        code: 'double_session_day_repaired',
        message: `Sesión "${extra.title}" movida de ${extra.date} a ${available.date} ${available.timeBlock}: el día original no permite doble sesión.`,
        sessionDate: extra.date,
      })
    }
  }

  return result.sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

function getSessionKeepPriority(context: RepairContext, session: CoachSessionProposal): number {
  const primarySport = getPrimarySport(context)
  let priority = 0
  if (isSquashRaceEventAnchorCandidate(session, context)) priority += 1000
  if (session.sessionType === primarySport) priority += 100
  if (session.sessionType === 'squash' && (session.subtype === 'competitive' || session.subtype === 'match' || isSquashMatchIntent(session))) priority += 35
  if (session.sessionType === 'strength') priority += 20
  if (session.sessionType === 'running' || session.sessionType === 'cycling') priority += 10
  priority += (session.rpe ?? 5) * 2
  priority += Math.min(session.durationMin ?? 0, 90) / 30
  if (session.timeBlock === 'AM') priority += 0.5
  return priority
}

// ─── 5. Filter disallowed sports ────────────────────────────────────────────

function filterDisallowedSports(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const allowed = getAllowedSports(context)

  return sessions.filter((s) => {
    if (allowed.has(s.sessionType as SupportedSport) && isPhaseAllowedSessionType(s, context)) return true
    meta.filteredSportCount++
    meta.droppedSessionCount++
    meta.warnings.push({ code: 'sport_not_allowed', message: `Sesión "${s.title}" eliminada: deporte ${s.sessionType} no permitido para esta fase.`, sessionDate: s.date })
    return false
  })
}

function isPhaseAllowedSessionType(session: CoachSessionProposal, context: RepairContext): boolean {
  if (getPrimarySport(context) !== 'squash') return true

  if (context.week.phase === 'race') {
    // Race week: no aerobic cross-training — only squash, strength (minimal), mobility/recovery.
    return session.sessionType !== 'running' && session.sessionType !== 'cycling'
  }

  if (context.week.phase === 'taper') {
    // Taper: cycling is dropped entirely; running is allowed only if it can be a short Z2 recovery.
    // normalizeSquashSupportAerobicLoad (step 10) will cap it to ≤25 min / RPE ≤3 / Z2.
    if (session.sessionType === 'cycling') return false
    return true
  }

  return true
}

// ─── 6. Complete sport details ──────────────────────────────────────────────

/**
 * El prompt estructurado de Plan Builder prohíbe `exercises`: una sesión de
 * fuerza productiva llega como esqueleto y su primer template real lo produce
 * `selectStrengthSession`. Debe existir antes de resolver la matriz; de lo
 * contrario el allocator recibe cero slots y desaparecen también sus métricas.
 *
 * El Set conserva la semántica de telemetría del repair: estas sesiones se
 * siguen contando como `hydration`, aunque core y densidad se apliquen en la
 * pasada deportiva inmediatamente posterior.
 */
function hydrateStrengthTemplatesBeforeAllocation(
  sessions: CoachSessionProposal[],
  context: RepairContext,
): ReadonlySet<CoachSessionProposal> {
  const hydrated = new Set<CoachSessionProposal>()
  // La entrada del selector debe depender sólo del payload del worker actual.
  // `previousWeek` puede variar según qué hermana concurrente aterrizó primero
  // y queda reservado para densidad/enriquecimiento posteriores al allocator.
  const recentExercises: string[] = []

  for (const session of sessions) {
    if (session.sessionType !== 'strength') continue
    if (!session.exercises || session.exercises.length === 0) {
      try {
        hydrateStrengthExerciseTemplate(session, context, recentExercises)
        if (session.exercises && session.exercises.length > 0) hydrated.add(session)
      } catch {
        // `completeSportDetails` conserva el segundo intento dentro de su
        // frontera best-effort y emite el warning histórico `repair_failed`.
      }
    }
    recentExercises.push(...(session.exercises ?? []).map((exercise) => exercise.name))
  }

  return hydrated
}

function completeSportDetails(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
  strengthAllocation: StrengthBlockAllocation,
  prehydratedStrengthSessions: ReadonlySet<CoachSessionProposal>,
): void {
  const currentWeekSquashDrills = extractRecentSquashDrills(context.previousWeek)
  const currentWeekStrengthExercises = extractRecentStrengthExercises(context.previousWeek)
  const committedStrengthIds = getCommittedStrengthIds(strengthAllocation)

  for (const session of sessions) {
    try {
      switch (session.sessionType) {
        case 'squash':
          recordSquashIntentTelemetry(session, meta)
          if (!hasValidSquashDetails(session) || hasSquashKindConflict(session, meta)) {
            completeSquashDetails(session, context, currentWeekSquashDrills, meta)
            recordRepair(meta, 'hydration', sessionKeyOf(session))
          } else if (hasUnresolvedSquashDrills(session)) {
            repairUnresolvedSquashDrills(session, context, currentWeekSquashDrills)
            recordRepair(meta, 'corrective', sessionKeyOf(session))
            meta.warnings.push({ code: 'squash_unknown_drills_mapped', message: `Sesión "${session.title}" conservada: se mapearon/completaron drills fuera de catálogo.`, sessionDate: session.date })
          } else if (densifySparseSquashDetails(session, context, currentWeekSquashDrills)) {
            recordRepair(meta, 'corrective', sessionKeyOf(session))
            meta.warnings.push({ code: 'squash_sparse_drills_repaired', message: `Sesión "${session.title}" densificada: tenía pocos drills para su duración.`, sessionDate: session.date })
          }
          currentWeekSquashDrills.push(...extractSquashDrillNames(session))
          break
        case 'running':
          if (completeRunningDetails(session, context)) {
            recordRepair(meta, 'hydration', sessionKeyOf(session))
          }
          break
        case 'strength': {
          const structuralCore = strengthAllocation.structuralCoreByWeek[strengthAllocation.localWeek]
            ?.get(sessionKeyOf(session))
          if (prehydratedStrengthSessions.has(session)) {
            enhanceStrengthSessionDetails(
              session,
              context,
              currentWeekStrengthExercises,
              structuralCore,
              committedStrengthIds,
              undefined,
              false,
            )
            recordRepair(meta, 'hydration', sessionKeyOf(session))
          } else if (!session.exercises || session.exercises.length === 0) {
            completeStrengthExercises(
              session,
              context,
              currentWeekStrengthExercises,
              structuralCore,
              committedStrengthIds,
              undefined,
              false,
            )
            recordRepair(meta, 'hydration', sessionKeyOf(session))
          } else if (enhanceStrengthSessionDetails(
            session,
            context,
            currentWeekStrengthExercises,
            structuralCore,
            committedStrengthIds,
            undefined,
            false,
          )) {
            recordRepair(meta, 'corrective', sessionKeyOf(session))
          }
          currentWeekStrengthExercises.push(...(session.exercises ?? []).map((exercise) => exercise.name))
          break
        }
        case 'mobility':
          if (!session.mobilityDetails) {
            completeMobilityDetails(session, context)
            recordRepair(meta, 'hydration', sessionKeyOf(session))
          } else {
            const before = JSON.stringify(session.mobilityDetails)
            session.mobilityDetails = normalizeMobilityDetails(session.mobilityDetails)
            if (before !== JSON.stringify(session.mobilityDetails)) {
              recordRepair(meta, 'corrective', sessionKeyOf(session))
            }
          }
          break
        case 'cycling':
          if (!session.cyclingDetails) {
            completeCyclingDetails(session, context)
            recordRepair(meta, 'hydration', sessionKeyOf(session))
          }
          break
      }
    } catch {
      meta.warnings.push({ code: 'repair_failed', message: `No se pudo completar detalles para "${session.title}" (${session.sessionType}).`, sessionDate: session.date })
    }
  }
}

/**
 * Registra de dónde salió la modalidad. Sólo `declared` cumple el contrato: el
 * prompt exige `squashKind` en toda sesión de squash. Una tasa alta de estos
 * contadores es un defecto de prompt o de proveedor, no un modo de operación.
 */
function recordSquashIntentTelemetry(session: CoachSessionProposal, meta: RepairMeta): void {
  const { source } = resolveSquashIntent(session)
  if (source === 'declared') return

  if (source === 'legacy_subtype') {
    meta.squashKindFallbackLegacySubtypeCount = (meta.squashKindFallbackLegacySubtypeCount ?? 0) + 1
  } else {
    meta.squashKindFallbackDefaultCount = (meta.squashKindFallbackDefaultCount ?? 0) + 1
  }
  meta.warnings.push({
    code: 'squash_kind_fallback',
    message: source === 'legacy_subtype'
      ? `"${session.title}" no declaró squashKind; se dedujo del subtype heredado.`
      : `"${session.title}" no declaró squashKind ni subtype útil; se usó el default determinista.`,
    sessionDate: session.date,
  })
}

/**
 * Detecta que los detalles ya hidratados contradigan la modalidad declarada.
 *
 * Sin esto, una propuesta detallada y bien formada evitaba la reconstrucción por
 * completo: `squashKind` decía `technical` y la sesión conservaba drills en
 * solitario porque `hasValidSquashDetails` sólo mira que los campos existan, no
 * que digan lo mismo que la intención.
 *
 * La intención estructural gana: se reconstruyen los detalles y se registra.
 */
function hasSquashKindConflict(session: CoachSessionProposal, meta: RepairMeta): boolean {
  if (!session.squashKind) return false
  const details = session.squashDetails
  if (!details || !Array.isArray(details.drills) || details.drills.length === 0) return false

  const declared = session.squashKind
  const contentKinds = new Set(
    details.drills
      .map((drill) => findSquashDrillByName(drill.name))
      .filter((definition): definition is NonNullable<typeof definition> => definition != null)
      .map((definition) => resolveSquashDrillKind(definition)),
  )
  if (contentKinds.size === 0) return false

  // Las sombras son accesorio admitido de cualquier modalidad principal, así que
  // su presencia no constituye contradicción.
  contentKinds.delete('shadows')
  if (contentKinds.size === 0) return false
  if (contentKinds.size === 1 && contentKinds.has(declared)) return false

  meta.squashKindConflictCount = (meta.squashKindConflictCount ?? 0) + 1
  meta.warnings.push({
    code: 'squash_kind_conflict',
    message: `"${session.title}" declaró squashKind=${declared} pero traía contenido `
      + `${[...contentKinds].join('/')}; se reconstruyen los detalles desde la intención.`,
    sessionDate: session.date,
  })
  return true
}

function hasValidSquashDetails(session: CoachSessionProposal): boolean {
  const d = session.squashDetails
  if (!d) return false
  return Boolean(d.trainingFocus) && Array.isArray(d.drills) && d.drills.length > 0 && Boolean(d.sessionKind)
}

function hasUnresolvedSquashDrills(session: CoachSessionProposal): boolean {
  const names = extractSquashDrillNames(session)
  if (names.length === 0) return false
  return names.some((name) => findSquashDrillByName(name) == null)
}

function completeSquashDetails(
  session: CoachSessionProposal,
  context: RepairContext,
  recentDrills = extractRecentSquashDrills(context.previousWeek),
  meta?: RepairMeta,
): void {
  // Una sesión que explícitamente es partido conserva la proyección standalone
  // histórica. El repair no crea finishers a partir de un esqueleto incompleto.
  if (
    (session.subtype === 'match' || session.subtype === 'competitive')
    && context.wizardConfig.partnerAvailability !== 'solo'
  ) {
    applySquashMatchDetails(session, contextlessSquashMatchMode(session))
    return
  }

  const phase = mapPhase(context.week.phase) as SquashSelectionPhase
  const intentKind = resolveSquashIntentKind(session)

  // A2.5 posee la escasez de match en base/taper. Si la semana debe asegurar
  // exposición y la fecha es segura, materializa el formato semanal explícito
  // antes de consultar el pool de fase del hidratador. Así el contador de
  // degradación cae realmente a cero: no se degrada a técnica para convertirla
  // de vuelta a partido unos pasos después.
  if (intentKind === 'match') {
    const weeklyPolicy = resolveSquashWeeklyExposureDecision(context)
    if (
      weeklyPolicy.ensure
      && isSafeSquashCompetitionExposureDate(
        session.date,
        context,
        weeklyPolicy.minimumDaysBeforeEvent,
      )
    ) {
      applySquashWeeklyExposureDetails(session, weeklyPolicy, context.week.weekIndex)
      return
    }

    // En race el evento real cuenta como exposición. Una sesión de match ya
    // declarada exactamente en el día del evento es el evento, no un partido
    // adicional de entrenamiento, y debe conservarse como tal.
    if (context.week.phase === 'race' && session.date === getSquashEventAnchorDate(context)) {
      applySquashMatchDetails(session, 'competition_match')
      return
    }
  }

  // Materialización por el hidratador compartido: la misma intención produce la
  // misma sesión acá, en Crear semana, en el chat y en el formulario.
  const hydration = hydrateSquashSession({
    availability: session.squashDetails?.availability,
    technicalIntent: session.squashDetails?.technicalIntent,
    referenceDate: session.date,
    historicalSessions: context.historicalSessions,
    kind: intentKind === 'match' ? 'match' : intentKind as SquashSessionBlockKind,
    durationMin: session.durationMin,
    phase,
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    goal: buildLevelAwareGoal(context, context.profile.mainGoal ?? ''),
    recentDrills,
    competitionSoon: false,
    competitiveLevel: deriveCompetitiveLevel(context),
    partnerAvailability: context.wizardConfig.partnerAvailability ?? 'either',
    competitive: session.subtype === 'competitive',
  })

  if (meta && hydration.warnings.some((warning) => warning.code === 'pool_insufficient')) {
    meta.squashPoolInsufficientCount = (meta.squashPoolInsufficientCount ?? 0) + 1
    meta.warnings.push({
      code: 'squash_pool_insufficient',
      message: `No hay suficientes drills de ${intentKind} para "${session.title}": se entrega corto en vez de mezclar modalidad.`,
      sessionDate: session.date,
    })
  }

  // El repair habilita y preserva finishers propuestos; no los compone. Si la
  // hidratación trajo contenido competitivo para una sesión que no es partido
  // dedicado, se retira antes de persistir.
  const details = intentKind === 'match'
    ? hydration.details
    : withoutCompetitiveSquashContent(hydration.details)

  if (details.drills.length > 0) {
    session.subtype = hydration.subtype
    setSquashDrillsAndBlocks(details, details.drills)
    session.squashDetails = details
    return
  }

  // Sin contenido utilizable en la modalidad pedida, se completa con técnica
  // antes que inventar un finisher o dejar la sesión vacía.
  //
  // Esto NO compensa la escasez de contenido: la registra. Hoy el caso real es
  // `match` en base y en taper, donde el catálogo tiene 0 drills elegibles (ver
  // A2.5). Degradar en silencio hacía que una sesión declarada como partido
  // apareciera como técnica sin que nada lo dijera.
  if (meta) {
    meta.squashKindDegradedCount = (meta.squashKindDegradedCount ?? 0) + 1
    meta.warnings.push({
      code: 'squash_kind_degraded',
      message: `"${session.title}" pidió ${intentKind} pero no hay contenido elegible en fase ${phase}; `
        + 'se entrega trabajo técnico y queda registrado.',
      sessionDate: session.date,
    })
  }

  applySquashSelection(session, withoutCompetitiveMatchContent(selectSquashDrills({
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    phase,
    recentDrills,
    goal: buildLevelAwareGoal(context, context.profile.mainGoal ?? ''),
    competitionSoon: false,
    competitiveLevel: deriveCompetitiveLevel(context),
    partnerAvailability: context.wizardConfig.partnerAvailability ?? 'either',
    desiredKind: 'technical',
  })))
}

function withoutCompetitiveSquashContent(details: SquashDetails): SquashDetails {
  const drills = details.drills.filter((drill) => !isCompetitiveMatchDrill(drill))
  if (drills.length === details.drills.length) return details
  const next: SquashDetails = { ...details, drills, blocks: [] }
  setSquashDrillsAndBlocks(next, drills)
  return next
}

/** El repair habilita y preserva finishers propuestos; no los compone. */
function withoutCompetitiveMatchContent(
  result: ReturnType<typeof selectSquashDrills>,
): ReturnType<typeof selectSquashDrills> {
  const drills = result.drills.filter((drill) => !isCompetitiveMatchDrill(drill))
  if (drills.length === result.drills.length) return result

  const blocks = buildSquashBlocksFromDrills(drills)
  return {
    ...result,
    drills: blocks.flatMap((block) => block.drills ?? []),
    blocks,
    sessionKind: blocks.length === 0
      ? 'technical'
      : blocks.length === 1 ? blocks[0]!.kind : 'mixed',
  }
}

function applySquashSelection(
  session: CoachSessionProposal,
  result: ReturnType<typeof selectSquashDrills>,
): void {
  const details: NonNullable<CoachSessionProposal['squashDetails']> = {
    trainingFocus: result.trainingFocus,
    drills: result.drills,
    sessionMode: session.subtype === 'competitive'
      ? 'competition_match'
      : session.subtype === 'match'
        ? 'practice_match'
        : 'drill_session',
    sessionKind: result.sessionKind,
    blocks: result.blocks,
  }
  // Aunque el selector normalmente ya entrega este orden, el repair es quien
  // fija el contrato definitivo entre ambos campos.
  setSquashDrillsAndBlocks(details, result.drills)
  session.squashDetails = details
}

function repairUnresolvedSquashDrills(
  session: CoachSessionProposal,
  context: RepairContext,
  recentDrills: string[],
): void {
  const details = session.squashDetails
  if (!details) {
    completeSquashDetails(session, context, recentDrills)
    return
  }

  const mappedDrills = (details.drills ?? [])
    .map((drill) => {
      const definition = findSquashDrillByName(drill.name)
      return definition
        ? toSquashDrill(definition, drill.durationMin, drill.notes)
        : null
    })
    .filter((drill): drill is SquashDrill => drill !== null)

  if (mappedDrills.length === 0) {
    completeSquashDetails(session, context, recentDrills)
    return
  }

  const selection = selectContextualSquashCompletion(session, context, [
    ...recentDrills,
    ...mappedDrills.map((drill) => drill.name),
  ])
  const targetCount = Math.max(
    getMinimumSquashDrillCount(session),
    Math.min(details.drills?.length ?? 0, 5),
  )
  const completedDrills = completeSquashDrillSet(
    mappedDrills,
    selection.drills.filter((drill) => !isCompetitiveMatchDrill(drill)),
    targetCount,
  )
  details.trainingFocus = details.trainingFocus ?? selection.trainingFocus
  details.sessionKind = details.sessionKind ?? selection.sessionKind
  setSquashDrillsAndBlocks(details, completedDrills)
}

function densifySparseSquashDetails(
  session: CoachSessionProposal,
  context: RepairContext,
  recentDrills: string[],
): boolean {
  const details = session.squashDetails
  if (!details?.drills) return false

  const targetCount = getMinimumSquashDrillCount(session)
  if (details.drills.length >= targetCount) return false

  const role = resolveSquashMatchRole(details)
  const selection = selectContextualSquashCompletion(session, context, [
    ...recentDrills,
    ...details.drills.map((drill) => drill.name),
  ])
  // Nunca agregar contenido competitivo al densificar: convertiría un finisher
  // en no canónico o crearía un partido que nadie pidió.
  const candidates = selection.drills.filter((drill) => !isCompetitiveMatchDrill(drill))

  if (role === 'finisher') {
    const finisher = details.drills[details.drills.length - 1]!
    const lead = details.drills.slice(0, -1)
    const nextLead = completeSquashDrillSet(lead, candidates, targetCount - 1)
    if (nextLead.length === lead.length) return false

    setSquashDrillsAndBlocks(details, [...nextLead, finisher])
    return true
  }

  const nextDrills = completeSquashDrillSet(details.drills, candidates, targetCount)
  if (nextDrills.length === details.drills.length) return false

  setSquashDrillsAndBlocks(details, nextDrills)
  return true
}

function getMinimumSquashDrillCount(session: CoachSessionProposal): number {
  const marker = session.metadata?.planBuilderSquashRotation
  if (marker && marker.signature === canonicalSquashSignature(session)) return session.squashDetails?.drills.length ?? 1
  // Un partido standalone es una sola actividad; entrada en calor y peloteo
  // pertenecen al protocolo, no a una densificación artificial del contenido.
  if (resolveSquashMatchRole(session.squashDetails) === 'standalone') return 1
  if (session.durationMin >= 60) return 4
  if (session.durationMin >= 45) return session.squashDetails?.sessionKind === 'match' ? 2 : 3
  if (session.durationMin >= 30) return 2
  return 1
}

function selectContextualSquashCompletion(
  session: CoachSessionProposal,
  context: RepairContext,
  recentDrills: string[],
): ReturnType<typeof selectSquashDrills> {
  const selectionContext = {
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    phase: mapPhase(context.week.phase) as SquashSelectionPhase,
    recentDrills,
    goal: buildLevelAwareGoal(context, `${session.objective ?? context.profile.mainGoal ?? ''} ${session.title}`),
    competitionSoon: context.week.phase === 'taper' || context.week.phase === 'race',
    competitiveLevel: deriveCompetitiveLevel(context),
    partnerAvailability: context.wizardConfig.partnerAvailability ?? 'either',
    desiredKind: resolveSquashIntentKind(session),
  }
  const selection = selectSquashDrills(selectionContext)
  if (selection.drills.some((drill) => !isCompetitiveMatchDrill(drill))) return selection

  // Completar o sanear una sesión no es la vía para componer un finisher.
  return selectSquashDrills({ ...selectionContext, desiredKind: 'technical' })
}

function completeSquashDrillSet(
  current: SquashDrill[],
  candidates: SquashDrill[],
  targetCount: number,
): SquashDrill[] {
  const next = [...current]
  const keys = new Set(next.map((drill) => findSquashDrillByName(drill.name)?.id ?? normalizeSquashDrillKey(drill.name)))

  for (const candidate of candidates) {
    if (next.length >= targetCount) break
    const key = findSquashDrillByName(candidate.name)?.id ?? normalizeSquashDrillKey(candidate.name)
    if (keys.has(key)) continue
    next.push(candidate)
    keys.add(key)
  }

  return next
}

function buildSquashBlocksFromDrills(drills: SquashDrill[]): SquashSessionBlock[] {
  const blockMap = new Map<SquashSessionBlockKind, SquashDrill[]>()

  for (const drill of drills) {
    const definition = findSquashDrillByName(drill.name)
    const kind = definition ? resolveSquashDrillKind(definition) : 'technical'
    const existing = blockMap.get(kind) ?? []
    existing.push(drill)
    blockMap.set(kind, existing)
  }

  return orderSquashBlocksForSession(
    [...blockMap.entries()].map(([kind, blockDrills]) => ({
      kind,
      drills: blockDrills,
      durationMin: blockDrills.reduce((sum, drill) => sum + (drill.durationMin ?? 0), 0) || undefined,
    })),
  )
}

/** Mantiene el invariante de rol: `drills` es el flatten exacto de `blocks`. */
function setSquashDrillsAndBlocks(
  details: NonNullable<CoachSessionProposal['squashDetails']>,
  drills: SquashDrill[],
): void {
  details.blocks = buildSquashBlocksFromDrills(drills)
  details.drills = details.blocks.flatMap((block) => block.drills ?? [])
}

function sanitizeSquashDrillSets(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): void {
  const recentDrills = extractRecentSquashDrills(context.previousWeek)

  for (const session of sessions) {
    if (session.sessionType !== 'squash' || !session.squashDetails) continue

    const details = session.squashDetails
    const originalDrills = details.drills ?? []
    const withoutGenericAerobic = originalDrills.filter((drill) => !isGenericAerobicSquashDrill(drill.name))
    const removedGenericAerobic = withoutGenericAerobic.length !== originalDrills.length
    const dedupedDrills = dedupeSquashDrillsByName(withoutGenericAerobic)
    const removedDuplicates = dedupedDrills.length !== withoutGenericAerobic.length

    if (!removedGenericAerobic && !removedDuplicates) {
      recentDrills.push(...extractSquashDrillNames(session))
      continue
    }

    const selection = selectContextualSquashCompletion(session, context, [
      ...recentDrills,
      ...dedupedDrills.map((drill) => drill.name),
    ])
    const targetCount = Math.max(getMinimumSquashDrillCount(session), dedupedDrills.length)
    const completedDrills = completeSquashDrillSet(
      dedupedDrills,
      selection.drills.filter((drill) => !isCompetitiveMatchDrill(drill)),
      targetCount,
    )

    setSquashDrillsAndBlocks(details, completedDrills)
    details.trainingFocus = inferTrainingFocusFromSquashDrills(completedDrills, details.trainingFocus)
    details.sessionKind = inferSquashKindFromProposalDetails(session)
    recordRepair(meta, 'corrective', sessionKeyOf(session))

    if (removedDuplicates) {
      meta.warnings.push({
        code: 'squash_duplicate_drills_deduped',
        message: `Se eliminaron drills duplicados dentro de "${session.title}".`,
        sessionDate: session.date,
      })
    }

    if (removedGenericAerobic) {
      meta.warnings.push({
        code: 'squash_generic_aerobic_drills_removed',
        message: `Se quitaron drills aeróbicos genéricos de squash en "${session.title}"; el soporte aeróbico debe programarse como running/cycling real.`,
        sessionDate: session.date,
      })
    }

    recentDrills.push(...extractSquashDrillNames(session))
  }
}

function dedupeSquashDrillsByName(drills: SquashDrill[]): SquashDrill[] {
  const seen = new Set<string>()
  const result: SquashDrill[] = []

  for (const drill of drills) {
    const key = findSquashDrillByName(drill.name)?.id ?? normalizeSquashDrillKey(drill.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(drill)
  }

  return result
}

function isGenericAerobicSquashDrill(name: string): boolean {
  // Un drill reconocido del catálogo de squash es contenido válido aunque su
  // nombre suene aeróbico (p.ej. "Intervalos aeróbicos en cancha" es movimiento
  // específico desde la T, no running). Solo tratamos como genérico-aeróbico lo
  // que NO resuelve en el catálogo.
  if (findSquashDrillByName(name)) return false
  const normalized = normalizeText(name)
  return (
    /\b(intervalos?|rodaje|z2|carrera|trote|fartlek|tempo|aerobic[oa]s?)\b/.test(normalized)
    && !/\b(partido|match|puntos?|juego condicionado)\b/.test(normalized)
  )
}

function inferTrainingFocusFromSquashDrills(
  drills: SquashDrill[],
  fallback: SquashTrainingFocus | undefined,
): SquashTrainingFocus {
  const definitions = drills
    .map((drill) => findSquashDrillByName(drill.name))
    .filter((definition): definition is NonNullable<ReturnType<typeof findSquashDrillByName>> => definition != null)
  if (definitions.some((definition) => isSquashMatchDrill(definition))) return 'conditioned_games'
  if (definitions.some((definition) => isShadowsDrill(definition))) return 'physical'
  if (definitions.some((definition) => definition.category === 'tactical')) return 'tactical'
  return fallback ?? 'technical'
}

function normalizeSquashSemanticMetadata(
  sessions: CoachSessionProposal[],
  meta: RepairMeta,
  context?: RepairContext,
): void {
  const squashSessions = sessions.filter((candidate) => candidate.sessionType === 'squash')
  for (const [sessionIdx, session] of sessions.entries()) {
    if (session.sessionType !== 'squash' || !session.squashDetails) continue

    const details = session.squashDetails
    const blockKinds = [...new Set((details.blocks ?? []).map((block) => block.kind))]
    const hasBlocks = blockKinds.length > 0
    const hasMatchBlock = blockKinds.includes('match')
    const role = resolveSquashMatchRole(details)
    const hasCompetitiveContent = (details.drills ?? []).some(isCompetitiveMatchDrill)
    const contentSaysMatch = role === 'standalone'
      || (role !== 'finisher'
        && hasCompetitiveContent
        && isSquashMatchIntent(session)
        && !(context?.wizardConfig.partnerAvailability === 'solo' && !hasMatchBlock))
    const inferredKind = role === 'finisher'
      ? 'mixed'
      : contentSaysMatch
        ? 'match'
        : hasBlocks
          ? blockKinds.length > 1 ? 'mixed' : blockKinds[0]
          : inferSquashKindFromProposalDetails(session)
    // Un finisher nunca es un partido dedicado; una sesión mixta no canónica
    // tampoco puede convertirse en match por palabras del título u objetivo.
    const dedicatedMatchContent = role === 'finisher'
      ? false
      : role === 'standalone'
        ? true
        : hasCompetitiveContent
          && (contentSaysMatch || (hasBlocks ? blockKinds.length === 1 && hasMatchBlock : inferredKind === 'match'))
    const onlyCompetitiveContent = hasCompetitiveContent
      && (details.drills ?? []).every(isCompetitiveMatchDrill)

    // Spec §2.1: el contenido enteramente competitivo pero no canónico se
    // proyecta al único standalone. Las activaciones no llegan aquí porque no
    // son contenido competitivo por enumeración.
    if (role === 'none' && onlyCompetitiveContent) {
      applySquashMatchDetails(
        session,
        contextlessSquashMatchMode(session),
        (context?.week.weekIndex ?? sessionIdx) + Math.max(0, squashSessions.indexOf(session)),
      )
      recordRepair(meta, 'corrective', sessionKeyOf(session))
      meta.warnings.push({
        code: 'squash_match_format_aligned',
        message: `Se dejó "${session.title}" como un único partido al mejor de 5 juegos.`,
        sessionDate: session.date,
      })
      continue
    }

    // Spec §2.1: una mezcla no canónica nunca se proyecta a un partido entero
    // por el texto del título. Conserva los drills no competitivos y pierde la
    // carga competitiva que no puede contar como exposición.
    if (role === 'none' && hasCompetitiveContent) {
      const kept = (details.drills ?? []).filter((drill) => !isCompetitiveMatchDrill(drill))
      if (kept.length > 0) {
        setSquashDrillsAndBlocks(details, kept)
        const keptKinds = [...new Set((details.blocks ?? []).map((block) => block.kind))]
        const keptKind = keptKinds.length > 1 ? 'mixed' : keptKinds[0] ?? 'technical'
        details.sessionKind = keptKind
        details.sessionMode = 'drill_session'
        realignSquashSessionIdentity(session, keptKind)
        recordRepair(meta, 'corrective', sessionKeyOf(session))
        meta.warnings.push({
          code: 'squash_non_canonical_match_removed',
          message: `Se retiró contenido de partido no canónico de "${session.title}"; la sesión queda como trabajo de drills.`,
          sessionDate: session.date,
        })
        continue
      }
    }

    if (contentSaysMatch && !hasMatchBlock) {
      // Offsetting by the session's position among the week's squash sessions
      // keeps two match sessions in the same week on different drill variants;
      // keying on `weekIndex` alone gave both the identical pair.
      applySquashMatchDetails(
        session,
        contextlessSquashMatchMode(session),
        (context?.week.weekIndex ?? sessionIdx) + Math.max(0, squashSessions.indexOf(session)),
      )
      recordRepair(meta, 'structural', sessionKeyOf(session))
      meta.warnings.push({
        code: 'squash_match_mode_repaired',
        message: `Se alineó "${session.title}" como sesión real de partido por su título/objetivo.`,
        sessionDate: session.date,
      })
    }

    if (
      dedicatedMatchContent &&
      (details.sessionMode === 'practice_match' || details.sessionMode === 'competition_match') &&
      !isCanonicalMatchContent(session)
    ) {
      applySquashMatchDetails(
        session,
        details.sessionMode,
        (context?.week.weekIndex ?? sessionIdx) + Math.max(0, squashSessions.indexOf(session)),
      )
      recordRepair(meta, 'corrective', sessionKeyOf(session))
      meta.warnings.push({
        code: 'squash_match_format_aligned',
        message: `Se dejó "${session.title}" como un único partido al mejor de 5 juegos.`,
        sessionDate: session.date,
      })
    }

    if (inferredKind && details.sessionKind !== inferredKind) {
      details.sessionKind = inferredKind
      recordRepair(meta, 'corrective', sessionKeyOf(session))
      meta.warnings.push({
        code: 'squash_kind_aligned',
        message: `Se alineó el tipo de sesión squash con sus bloques reales (${inferredKind}).`,
        sessionDate: session.date,
      })
    }

    if (details.sessionMode !== 'drill_session' && !dedicatedMatchContent) {
      // `sessionMode` es opcional en el contrato, así que ausente no es
      // match-play mal declarado: completarlo es default, no corrección.
      // Contarlo inflaría `repairedSessionCount` y `countRepairsV2` en toda
      // sesión de drills que el modelo devuelva sin el campo.
      const declaredMatchMode = details.sessionMode != null
      details.sessionMode = 'drill_session'
      if (declaredMatchMode) {
        recordRepair(meta, 'corrective', sessionKeyOf(session))
        meta.warnings.push({
          code: 'squash_mode_aligned',
          message: 'Se cambió match-play por sesión de drills porque los bloques no son un partido dedicado.',
          sessionDate: session.date,
        })
      }
    }

    const alignedSubtype = resolveSquashSubtypeFromKind(inferredKind, session.subtype)
    if (alignedSubtype && session.subtype !== alignedSubtype && shouldAlignSquashSubtype(session.subtype)) {
      session.subtype = alignedSubtype
      recordRepair(meta, 'corrective', sessionKeyOf(session))
      meta.warnings.push({
        code: 'squash_subtype_aligned',
        message: `Se alineó el subtipo squash con el contenido real (${alignedSubtype}).`,
        sessionDate: session.date,
      })
    }

    const alignedTitle = buildSquashTitleFromKind(inferredKind, blockKinds)
    if (role !== 'finisher' && alignedTitle && shouldAlignSquashTitle(session.title, inferredKind, blockKinds)) {
      session.title = alignedTitle
      recordRepair(meta, 'corrective', sessionKeyOf(session))
      meta.warnings.push({
        code: 'squash_title_aligned',
        message: `Se alineó el título squash con sus bloques reales (${alignedTitle}).`,
        sessionDate: session.date,
      })
    }
  }
}

function ensureSquashCompetitionMatchExposure(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const policy = resolveSquashWeeklyExposureDecision(context)
  if (!policy.ensure) return sessions

  const targetCount = policy.declaredMatchCount ?? 1
  let working = sessions
  for (let attempt = 0; attempt < targetCount; attempt++) {
    const next = ensureOneSquashCompetitionMatchExposure(working, context, meta, policy, targetCount)
    if (next === working) break
    working = next
  }
  return working
}

function ensureOneSquashCompetitionMatchExposure(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
  policy: Extract<SquashWeeklyExposureDecision, { ensure: true }>,
  targetCount: number,
): CoachSessionProposal[] {
  const squashSessions = sessions.filter((session) => session.sessionType === 'squash')
  if (squashSessions.length === 0) return sessions
  const meetsTarget = (session: CoachSessionProposal) => hasCompetitiveExposureContent(session)
    && (!policy.declaredMatchCount || policy.targetRpe < 8 || (session.rpe ?? 6) >= 8)
    && isSafeSquashCompetitionExposureDate(session.date, context, policy.minimumDaysBeforeEvent)
  if (squashSessions.filter(meetsTarget).length >= targetCount) return sessions

  const safeSquashSessions = squashSessions.filter((session) =>
    isSafeSquashCompetitionExposureDate(session.date, context, policy.minimumDaysBeforeEvent)
  )
  if (context.week.phase === 'taper' && safeSquashSessions.length === 0) return sessions

  // Preferir AGREGAR una sesión de match si la semana tiene cupo, para no
  // descartar una sesión de squash diseñada (p.ej. pressure drills) reescribiéndola.
  const expected = getExpectedSessionsForPlanWeek(context.plan, context.week)
  if (sessions.length < expected) {
    const next = [...sessions]
    const candidateDates = getAllowedDatesInWeek(context).filter((date) =>
      isSafeSquashCompetitionExposureDate(date, context, policy.minimumDaysBeforeEvent)
    )
    const available = findNearestAvailableDate(candidateDates, next, 'PM', undefined, context.wizardConfig)
    if (available) {
      const added = buildSquashCompetitionMatchSession(available.date, available.timeBlock, context, policy)
      next.push(added)
      meta.addedFallbackCount++
      recordRepair(meta, 'structural', sessionKeyOf(added))
      meta.warnings.push({
        code: 'squash_competition_match_added',
        message: `Se agregó exposición competitiva real de squash en fase ${context.week.phase}.`,
        sessionDate: added.date,
      })
      return next.sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
    }
  }

  // Sin cupo: convertir, priorizando una sesión que ya apunta a match antes de
  // tocar la sesión específica de mayor RPE.
  const candidates = safeSquashSessions.filter((session) => !meetsTarget(session))
  const candidate = candidates.find(isSquashMatchIntent)
    ?? candidates.find((session) => session.squashDetails?.sessionKind === 'match')
    ?? [...candidates].sort((a, b) => (b.rpe ?? 6) - (a.rpe ?? 6))[0]

  if (!candidate) return sessions

  applySquashWeeklyExposureDetails(
    candidate,
    policy,
    context.week.weekIndex + Math.max(0, squashSessions.indexOf(candidate)),
  )
  recordRepair(meta, 'structural', sessionKeyOf(candidate))
  meta.warnings.push({
    code: 'squash_competition_match_added',
    message: `Se aseguró exposición competitiva real de squash en fase ${context.week.phase}.`,
    sessionDate: candidate.date,
  })
  return [...sessions]
}

/** Envoltorio local del predicado único de exposición para proposals del repair. */
function hasCompetitiveExposureContent(session: CoachSessionProposal): boolean {
  return session.sessionType === 'squash'
    && hasSquashCompetitiveExposureContent(session.squashDetails)
}

function buildSquashCompetitionMatchSession(
  date: string,
  timeBlock: 'AM' | 'PM',
  context: RepairContext,
  policy: Extract<SquashWeeklyExposureDecision, { ensure: true }>,
): CoachSessionProposal {
  const session: CoachSessionProposal = {
    date,
    timeBlock,
    sessionType: 'squash',
    subtype: 'competitive',
    title: 'Squash - Match Play Competitivo',
    durationMin: Math.min(context.wizardConfig.sessionDurationMins, policy.durationCapMin),
    rpe: policy.targetRpe,
    objective: 'Competir con marcador real, presión de cierre y rutinas entre puntos.',
  }
  applySquashWeeklyExposureDetails(session, policy, context.week.weekIndex)
  return session
}

function hasActiveSquashMedicalRestriction(context: RepairContext): boolean {
  return [
    context.wizardConfig.injuryNotes,
    context.profile.recoveryProfile?.currentInjuries,
    context.profile.recoveryProfile?.restrictions,
  ].some((value) => Boolean(value?.trim()))
}

function hasSquashGoalEvent(context: RepairContext): boolean {
  const event = context.profile.goalEvents?.find((item) => item.id === context.wizardConfig.goalEventId)
    ?? context.profile.goalEvents?.find((item) => item.priority === 'primary')
  if (event) return normalizeSport(event.sport) === 'squash'
  // Week Creator needs a bounded plan to run the shared repair pipeline, so
  // it creates a synthetic `week-creator` event at the end of the requested
  // week. It is scheduling scaffolding, not evidence of a real competition.
  // A2.5 must only add match exposure when the plan points at an actual event.
  if (context.plan.goalEventId === 'week-creator') return false
  return Boolean(
    context.plan.goalEventId
      && context.plan.macroSnapshot?.goalEventDate
      && getPrimarySport(context) === 'squash',
  )
}

function resolveSquashWeeklyExposureDecision(context: RepairContext): SquashWeeklyExposureDecision {
  return resolveSquashWeeklyExposurePolicy({
    primarySport: getPrimarySport(context) as SupportedSport | undefined,
    hasSquashGoalEvent: hasSquashGoalEvent(context),
    phase: context.week.phase,
    currentFatigue: context.wizardConfig.currentFatigue,
    partnerAvailability: context.wizardConfig.partnerAvailability,
    hasMedicalRestriction: hasActiveSquashMedicalRestriction(context),
    sessionsPerWeek: getExpectedSessionsForPlanWeek(context.plan, context.week),
    targetHardPrimaryMatches: context.wizardConfig.targetHardPrimaryMatches,
    executionVerdict: decideLoadDirective(context.executionSignals ?? {}).verdict,
  })
}

// El countdown de taper siempre apunta al INICIO de la ventana. El ancla puede
// ser posterior y no debe retrasar la descarga previa al campeonato.
function getSquashEventDate(context: RepairContext): string {
  // `macroSnapshot` no está garantizado —`hasSquashGoalEvent` lo lee con `?.`—,
  // así que se conserva el fallback al término del plan.
  if (!context.plan.macroSnapshot?.goalEventDate) return context.plan.endDate
  return resolvePlanEventWindow(context.plan).startDate
}

function getSquashEventAnchorDate(context: RepairContext): string {
  return resolvePlanEventWindow(context.plan).anchorDate
}

function isSquashRaceEventAnchorCandidate(
  session: CoachSessionProposal,
  context: RepairContext,
): boolean {
  return context.week.phase === 'race'
    && getPrimarySport(context) === 'squash'
    && hasSquashGoalEvent(context)
    && planWeekContainsEventAnchor(context.plan, context.week)
    && isPlanEventAnchorDate(context.plan, session.date)
}

function isSafeSquashCompetitionExposureDate(
  date: string,
  context: RepairContext,
  minimumDaysBeforeEvent: number,
): boolean {
  if (minimumDaysBeforeEvent <= 0) return true
  return daysBetween(date, getSquashEventDate(context)) >= minimumDaysBeforeEvent
}

function normalizeLateTaperSquashMatchPlay(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): void {
  if (context.week.phase !== 'taper' && context.week.phase !== 'race') return

  const eventDate = getSquashEventDate(context)
  const anchorDate = getSquashEventAnchorDate(context)
  for (const session of sessions) {
    if (session.sessionType !== 'squash') continue
    // The event day itself IS the competition — never down-grade that session to
    // activation/control; the validator (squash.race_day) expects a match there.
    if (context.week.phase === 'race' && session.date === anchorDate) continue
    if (context.week.phase === 'taper' && daysBetween(session.date, eventDate) > 2) continue
    const role = resolveSquashMatchRole(session.squashDetails)

    if (role === 'finisher') {
      // Retirar solo el bloque competitivo final conserva el trabajo mixto.
      const details = session.squashDetails!
      const blocks = (details.blocks ?? []).slice(0, -1)
      const drills = blocks.flatMap((block) => block.drills ?? [])
      if (drills.length === 0) continue

      details.blocks = blocks
      details.drills = drills
      details.sessionKind = blocks.length > 1 ? 'mixed' : blocks[0]!.kind
      // La segunda pasada de taper no debe releer el antiguo título de partido y
      // convertir el trabajo previo (ya seguro) en una activación distinta.
      realignSquashSessionIdentity(session, details.sessionKind)
      session.durationMin = Math.min(session.durationMin, 35)
      session.rpe = Math.min(session.rpe ?? 4, 4)
      recordRepair(meta, 'corrective', sessionKeyOf(session))
      meta.warnings.push({
        code: 'late_taper_match_controlled',
        message: `Se retiró el cierre competitivo de "${session.title}": está demasiado cerca del evento.`,
        sessionDate: session.date,
      })
      continue
    }

    if (role !== 'standalone'
      && !isSquashMatchIntent(session)
      && session.squashDetails?.sessionMode !== 'competition_match') continue

    const previousTitle = session.title
    applyPreEventSquashActivationDetails(session, context)
    recordRepair(meta, 'corrective', sessionKeyOf(session))
    meta.warnings.push({
      code: 'late_taper_match_controlled',
      message: `Se cambió "${previousTitle}" a activación/control: está demasiado cerca del evento para match-play.`,
      sessionDate: session.date,
    })
  }
}

function applyPreEventSquashActivationDetails(
  session: CoachSessionProposal,
  context: RepairContext,
): void {
  const selection = selectSquashDrills({
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    phase: 'taper',
    recentDrills: extractRecentSquashDrills(context.previousWeek),
    goal: buildLevelAwareGoal(context, `${session.objective ?? context.profile.mainGoal ?? ''} activación control pre torneo`),
    competitionSoon: true,
    competitiveLevel: deriveCompetitiveLevel(context),
    partnerAvailability: context.wizardConfig.partnerAvailability ?? 'either',
    desiredKind: 'control',
  })
  const safeDrills = selection.drills.filter((drill) => {
    const definition = findSquashDrillByName(drill.name)
    return !definition || !isSquashMatchDrill(definition)
  })
  const drills = safeDrills.length > 0 ? safeDrills : selection.drills

  session.subtype = 'control'
  session.squashKind = 'control'
  session.title = 'Squash - Activación y Control Pre-Torneo'
  session.objective = 'Último toque de cancha: timing, longitud, precisión y confianza sin puntos largos ni fatiga residual.'
  session.durationMin = Math.min(session.durationMin, 35)
  session.rpe = Math.min(session.rpe ?? 4, 4)
  const details: NonNullable<CoachSessionProposal['squashDetails']> = {
    trainingFocus: selection.trainingFocus,
    sessionMode: 'drill_session',
    sessionKind: 'control',
    drills,
    blocks: [],
  }
  setSquashDrillsAndBlocks(details, drills)
  session.squashDetails = details
}

/**
 * Proyección cerrada de una semana que intersecta el campeonato de squash:
 * una sola ancla global y únicamente apoyos compatibles alrededor de ella.
 */
function normalizeSquashEventWindow(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  if (
    context.week.phase !== 'race'
    || getPrimarySport(context) !== 'squash'
    || !hasSquashGoalEvent(context)
  ) return sessions

  const anchorDate = getSquashEventAnchorDate(context)
  const anchorInsideWeek = planWeekContainsEventAnchor(context.plan, context.week)
  let result = [...sessions]
  let anchor: CoachSessionProposal | undefined

  if (anchorInsideWeek) {
    const onAnchorDate = result.filter((session) => session.date === anchorDate)
    anchor = onAnchorDate.find((session) => session.sessionType === 'squash' && isDeclaredSquashMatchSession(session))
      ?? onAnchorDate.find((session) => session.sessionType === 'squash')
      ?? result.find((session) => isDeclaredSquashMatchSession(session))
      ?? onAnchorDate[0]

    if (!anchor) {
      // Con cupo completo se reutiliza el apoyo de menor prioridad para no
      // superar la cantidad efectiva. Si hay cupo, el ancla se agrega.
      const expected = getExpectedSessionsForPlanWeek(context.plan, context.week)
      anchor = result.length >= expected && result.length > 0
        ? [...result].sort((left, right) =>
            getSessionKeepPriority(context, left) - getSessionKeepPriority(context, right))[0]
        : undefined

      if (!anchor) {
        anchor = {
          date: anchorDate,
          timeBlock: 'PM',
          sessionType: 'squash',
          title: 'Squash - Competencia Objetivo',
          objective: 'Representar la única ancla del campeonato y reservar su carga competitiva.',
          durationMin: context.wizardConfig.sessionDurationMins,
          rpe: 8,
          subtype: 'competitive',
          squashKind: 'match',
        }
        result.push(anchor)
        meta.addedFallbackCount++
        recordTaxonomyOnly(meta, 'structural', sessionKeyOf(anchor))
        meta.warnings.push({
          code: 'event_window_anchor_added',
          message: `Se agregó la única ancla competitiva del campeonato el ${anchorDate}.`,
          sessionDate: anchorDate,
        })
      }
    }

    const anchorBefore = JSON.stringify(anchor)
    projectSquashEventAnchor(anchor, anchorDate)
    if (JSON.stringify(anchor) !== anchorBefore) {
      recordRepair(meta, 'structural', sessionKeyOf(anchor))
      meta.warnings.push({
        code: 'event_window_anchor_aligned',
        message: `Se alineó la competencia objetivo con su ancla única (${anchorDate}).`,
        sessionDate: anchorDate,
      })
    }

    const extrasOnAnchor = result.filter((session) => session !== anchor && session.date === anchorDate)
    if (extrasOnAnchor.length > 0) {
      result = result.filter((session) => !extrasOnAnchor.includes(session))
      meta.droppedSessionCount += extrasOnAnchor.length
      meta.warnings.push({
        code: 'event_window_anchor_extra_dropped',
        message: `Se retiraron ${extrasOnAnchor.length} sesiones extra del día clave ${anchorDate}.`,
        sessionDate: anchorDate,
      })
    }
  }

  const normalized: CoachSessionProposal[] = []
  for (const session of result) {
    if (session === anchor) {
      normalized.push(session)
      continue
    }
    // Fuera de los días del evento manda el taper que ya existía: convertir la
    // carga de toda la semana `race` vaciaba días que no son del campeonato.
    if (!isWithinPlanEventWindow(context.plan, session.date)) {
      normalized.push(session)
      continue
    }

    let support = session
    if (isDeclaredSquashMatchSession(support)) {
      const previousTitle = support.title
      const before = JSON.stringify(support)
      applyPreEventSquashActivationDetails(support, context)
      if (JSON.stringify(support) !== before) {
        recordRepair(meta, 'corrective', sessionKeyOf(support))
        meta.warnings.push({
          code: 'event_window_extra_match_removed',
          message: `Se cambió "${previousTitle}" a activación: la ventana admite una sola ancla y ningún match-play extra.`,
          sessionDate: support.date,
        })
      }
    } else if (
      support.sessionType === 'strength'
      || support.sessionType === 'running'
      || support.sessionType === 'cycling'
      || support.sessionType === 'nutrition'
    ) {
      support = buildEventWindowRecoverySession(support, context)
      recordRepair(meta, 'corrective', sessionKeyOf(support))
      meta.warnings.push({
        code: 'event_window_incompatible_load_replaced',
        message: `Se reemplazó carga incompatible por recuperación durante el campeonato (${support.date}).`,
        sessionDate: support.date,
      })
    }

    if (
      support.sessionType === 'squash'
      && context.wizardConfig.partnerAvailability === 'solo'
      && resolveEventWindowSupportKind(support) === 'technical_touch'
    ) {
      const previousPartnerTitle = support.title
      const before = JSON.stringify(support)
      applyPreEventSquashActivationDetails(support, context)
      if (JSON.stringify(support) !== before) {
        recordRepair(meta, 'corrective', sessionKeyOf(support))
        meta.warnings.push({
          code: 'event_window_partner_support_replaced',
          message: `Se cambió "${previousPartnerTitle}" a control porque el atleta no tiene partner disponible.`,
          sessionDate: support.date,
        })
      }
    }

    const supportKind = resolveEventWindowSupportKind(support)
    if (!supportKind) {
      const previousType = support.sessionType
      support = buildEventWindowRecoverySession(support, context)
      recordRepair(meta, 'corrective', sessionKeyOf(support))
      meta.warnings.push({
        code: 'event_window_unknown_support_replaced',
        message: `Se reemplazó el apoyo ${previousType} por recuperación compatible con el campeonato.`,
        sessionDate: support.date,
      })
    }

    const resolvedKind = resolveEventWindowSupportKind(support) ?? 'recovery'
    const caps = EVENT_WINDOW_SUPPORT_CAPS[resolvedKind]
    const durationMin = Math.max(caps.minDurationMin, Math.min(support.durationMin, caps.maxDurationMin))
    // Completar un `rpe` ausente es hidratación, no corrección: contarlo como
    // reparación infla `countRepairsV2`, que es justo lo que penaliza
    // `quality_version = 2`. Mismo defecto ya corregido para `sessionMode`.
    const rpeWasDeclared = support.rpe != null
    const defaultRpe = Math.round((caps.minRpe + caps.maxRpe) / 2)
    const rpe = rpeWasDeclared
      ? Math.max(caps.minRpe, Math.min(support.rpe!, caps.maxRpe))
      : defaultRpe
    const durationChanged = durationMin !== support.durationMin
    const rpeChanged = rpeWasDeclared && rpe !== support.rpe
    if (durationChanged || rpeChanged) {
      support = { ...support, durationMin, rpe }
      recordRepair(meta, 'corrective', sessionKeyOf(support))
      meta.warnings.push({
        code: 'event_window_support_capped',
        message: `Se limitó ${support.title} a ${durationMin}min / RPE ${rpe} en la semana del campeonato.`,
        sessionDate: support.date,
      })
    }
    else if (!rpeWasDeclared) {
      support = { ...support, durationMin, rpe }
    }
    normalized.push(support)
  }

  const supports = normalized
    .filter((session) => session !== anchor)
    .sort((left, right) => left.date.localeCompare(right.date) || left.timeBlock.localeCompare(right.timeBlock))
  // El tope de apoyos pertenece a la ventana: los días de la semana que quedan
  // fuera del campeonato conservan sus sesiones de taper.
  const insideSupports = supports.filter((session) =>
    isWithinPlanEventWindow(context.plan, session.date))
  const outsideSupports = supports.filter((session) =>
    !isWithinPlanEventWindow(context.plan, session.date))
  const keptInside = insideSupports.slice(0, MAX_EVENT_WINDOW_SUPPORTS_PER_WEEK)
  const droppedSupportCount = insideSupports.length - keptInside.length
  if (droppedSupportCount > 0) {
    meta.droppedSessionCount += droppedSupportCount
    meta.warnings.push({
      code: 'event_window_support_limit',
      message: `Se recortaron ${droppedSupportCount} apoyos: durante el campeonato se permiten máximo ${MAX_EVENT_WINDOW_SUPPORTS_PER_WEEK} por semana.`,
    })
  }

  return [...(anchor ? [anchor] : []), ...outsideSupports, ...keptInside]
    .sort((left, right) => left.date.localeCompare(right.date) || left.timeBlock.localeCompare(right.timeBlock))
}

function projectSquashEventAnchor(session: CoachSessionProposal, anchorDate: string): void {
  session.date = anchorDate
  session.timeBlock = 'PM'
  session.sessionType = 'squash'
  session.durationMin = Math.max(session.durationMin || 0, 45)
  session.rpe = Math.max(session.rpe ?? 8, 7)
  session.squashKind = 'match'
  session.subtype = 'competitive'
  session.exercises = undefined
  session.runningType = undefined
  session.intervalStructure = undefined
  session.runningTemplateRef = undefined
  session.runningSelectionReason = undefined
  session.cyclingDetails = undefined
  session.mobilityDetails = undefined
  applySquashMatchDetails(session, 'competition_match')
  session.title = 'Squash - Competencia Objetivo'
  session.objective = 'Representar la única ancla del campeonato y reservar su carga competitiva en el calendario.'
}

function buildEventWindowRecoverySession(
  session: CoachSessionProposal,
  context: RepairContext,
): CoachSessionProposal {
  const recovery: CoachSessionProposal = {
    date: session.date,
    timeBlock: session.timeBlock,
    sessionType: 'mobility',
    title: 'Movilidad y Recuperación de Campeonato',
    objective: 'Facilitar recuperación entre jornadas sin agregar fatiga residual.',
    durationMin: Math.max(
      EVENT_WINDOW_SUPPORT_CAPS.recovery.minDurationMin,
      Math.min(session.durationMin, EVENT_WINDOW_SUPPORT_CAPS.recovery.maxDurationMin),
    ),
    rpe: Math.max(
      EVENT_WINDOW_SUPPORT_CAPS.recovery.minRpe,
      Math.min(session.rpe ?? 3, EVENT_WINDOW_SUPPORT_CAPS.recovery.maxRpe),
    ),
    metadata: session.metadata,
  }
  try {
    completeMobilityDetails(recovery, context)
  } catch {
    // La propuesta base sigue siendo ejecutable; el validator informará si
    // faltan detalles de movilidad.
  }
  return recovery
}

function contextlessSquashMatchMode(session: CoachSessionProposal): 'practice_match' | 'competition_match' {
  const text = normalizeText(`${session.title ?? ''} ${session.objective ?? ''}`)
  if (
    session.subtype === 'competitive'
    || text.includes('competitivo')
    || text.includes('competencia')
    || text.includes('torneo')
  ) {
    return 'competition_match'
  }
  return 'practice_match'
}

function applySquashMatchDetails(
  session: CoachSessionProposal,
  mode: 'practice_match' | 'competition_match',
  variantIndex = 0,
  format: SquashWeeklyMatchFormat = 'best_of_5',
): void {
  const drills = buildSquashMatchDrills(session, mode, variantIndex, format)
  const durationMin = sumDurations(drills) || Math.min(session.durationMin, mode === 'competition_match' ? 55 : 45)
  session.squashKind = 'match'
  session.subtype = mode === 'competition_match' ? 'competitive' : 'match'
  session.title = mode === 'competition_match'
    ? 'Squash - Match Play Competitivo'
    : 'Squash - Match Play Controlado'
  session.objective = mode === 'competition_match'
    ? 'Competir con marcador real, presión de cierre y rutinas entre puntos.'
    : 'Practicar decisiones y ritmo de partido con marcador controlado.'
  const details: NonNullable<CoachSessionProposal['squashDetails']> = session.squashDetails ?? {
    trainingFocus: 'conditioned_games',
    drills: [],
  }
  details.trainingFocus = 'conditioned_games'
  details.sessionMode = mode
  details.sessionKind = 'match'
  details.drills = drills
  details.blocks = [{
    kind: 'match',
    drills,
    durationMin,
  }]
  session.squashDetails = details
}

const COMPETITION_MATCH_VARIANTS: string[][] = [
  ['Partido de entrenamiento al mejor de 5 juegos'],
]
const PRACTICE_MATCH_VARIANTS: string[][] = [
  ['Partido de entrenamiento al mejor de 5 juegos'],
]

function applySquashWeeklyExposureDetails(
  session: CoachSessionProposal,
  policy: Extract<SquashWeeklyExposureDecision, { ensure: true }>,
  variantIndex: number,
): void {
  session.durationMin = Math.min(session.durationMin, policy.durationCapMin)
  session.rpe = policy.targetRpe
  applySquashMatchDetails(session, 'competition_match', variantIndex, policy.format)
}

export function buildSquashMatchDrills(
  session: CoachSessionProposal,
  mode: 'practice_match' | 'competition_match',
  variantIndex = 0,
  format: SquashWeeklyMatchFormat = 'best_of_5',
): SquashDrill[] {
  const variants = mode === 'competition_match' ? COMPETITION_MATCH_VARIANTS : PRACTICE_MATCH_VARIANTS
  const names = format === 'best_of_3'
    ? ['Partido de entrenamiento al mejor de 3 juegos']
    : variants[variantIndex % variants.length]
  const targetDuration = Math.min(session.durationMin, 60)
  const drills = names
    .map((name, index) => {
      const definition = findSquashDrillByName(name)
      return definition ? toSquashDrill(definition, index === 0 ? targetDuration : undefined) : null
    })
    .filter((drill): drill is SquashDrill => drill !== null)

  if (drills.length > 0) return drills
  return [{ name: names[0], durationMin: Math.min(session.durationMin, 40) }]
}

/** Chequeo de idempotencia de la normalización semántica, generalizado al rol. */
function isCanonicalMatchContent(session: CoachSessionProposal): boolean {
  return resolveSquashMatchRole(session.squashDetails) !== 'none'
}

function normalizeSquashDurationConsistency(sessions: CoachSessionProposal[], meta: RepairMeta): void {
  for (const session of sessions) {
    if (session.sessionType !== 'squash' || !session.squashDetails || session.durationMin <= 0) continue

    const details = session.squashDetails
    const drillTotal = sumDurations(details.drills)
    const blockTotal = sumDurations(details.blocks)
    const total = Math.max(drillTotal, blockTotal)
    if (total <= session.durationMin) continue

    const factor = session.durationMin / total
    const scaledDrills = scaleDurations(details.drills, factor, session.durationMin)
    // Escalar una sola representación y reconstruir la otra. Escalarlas por
    // separado aplicaba dos redondeos distintos: el último drill podía quedar
    // con 13 min en `drills[]` y 14 min dentro de `blocks[]`.
    setSquashDrillsAndBlocks(details, scaledDrills)
    recordRepair(meta, 'corrective', sessionKeyOf(session))
    meta.warnings.push({
      code: 'squash_duration_aligned',
      message: `Se ajustaron los bloques de "${session.title}" para calzar con ${session.durationMin}min.`,
      sessionDate: session.date,
    })
  }
}

function sumDurations(items: Array<{ durationMin?: number }> | undefined): number {
  return (items ?? []).reduce((total, item) => total + (item.durationMin ?? 0), 0)
}

function scaleDurations<T extends { durationMin?: number }>(
  items: T[] | undefined,
  factor: number,
  targetTotal: number,
): T[] {
  if (!items || items.length === 0) return []

  const scaled = items.map((item) => ({
    ...item,
    durationMin: Math.max(3, Math.round(((item.durationMin ?? 0) * factor) / 2) * 2),
  }))

  let overflow = sumDurations(scaled) - targetTotal
  for (let i = scaled.length - 1; i >= 0 && overflow > 0; i--) {
    const current = scaled[i]!.durationMin ?? 0
    const reduction = Math.min(overflow, Math.max(0, current - 3))
    scaled[i] = { ...scaled[i]!, durationMin: current - reduction }
    overflow -= reduction
  }

  return scaled
}

function shouldAlignSquashSubtype(subtype: CoachSessionProposal['subtype']): boolean {
  return subtype === 'match' || subtype === 'competitive'
}

function resolveSquashSubtypeFromKind(
  kind: SquashSessionKind,
  currentSubtype: CoachSessionProposal['subtype'],
): CoachSessionProposal['subtype'] {
  if (kind === 'match' && currentSubtype === 'competitive') return 'competitive'
  if (kind === 'match') return 'match'
  if (kind === 'control') return 'control'
  if (currentSubtype === 'light') return 'light'
  return 'training'
}

function buildSquashTitleFromKind(kind: SquashSessionKind, blockKinds: Array<string>): string {
  if (kind === 'match') return 'Squash - Juego Condicionado'
  if (kind === 'control') return 'Squash - Control y Precisión'
  if (kind === 'shadows') return 'Squash - Sombras y Salidas'
  if (kind === 'technical') return 'Squash - Técnica Aplicada'

  const has = (blockKind: string) => blockKinds.includes(blockKind)
  if (has('shadows') && has('control') && !has('match')) return 'Squash - Sombras y Control'
  if (has('technical') && has('match')) return 'Squash - Técnica y Juego Condicionado'
  if (has('control') && has('match')) return 'Squash - Control y Puntos'
  return 'Squash - Sesión Mixta'
}

function shouldAlignSquashTitle(title: string, kind: SquashSessionKind, blockKinds: Array<string>): boolean {
  const normalized = normalizeText(title)
  const has = (blockKind: string) => blockKinds.includes(blockKind)
  const saysMatch = normalized.includes('match') || normalized.includes('partido') || normalized.includes('juego condicionado')
  const saysShadows = normalized.includes('sombra') || normalized.includes('salida')
  const saysControl = normalized.includes('control') || normalized.includes('patron') || normalized.includes('precision')
  const saysTechnical = normalized.includes('tecnica') || normalized.includes('aplicacion tactica') || normalized.includes('activacion')

  if (saysMatch && kind !== 'match' && !has('match')) return true
  if (saysShadows && !has('shadows')) return true
  if (saysControl && kind !== 'control' && !has('control')) return true
  if (saysTechnical && kind === 'match') return true
  if (kind === 'mixed' && saysMatch && !has('match')) return true
  if (kind === 'mixed' && has('shadows') && has('control') && !saysControl) return true
  if (kind === 'mixed' && has('technical') && has('match') && !saysMatch) return true
  if (kind === 'mixed' && has('control') && has('match') && !saysMatch) return true
  return false
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

const SQUASH_MATCH_TEXT_PATTERN = /\b(partido|match|match play|match-play|simulacion|marcador|mejor de [35]|puntos? de partido)\b/

function isSquashMatchIntent(session: CoachSessionProposal): boolean {
  if (session.sessionType !== 'squash') return false
  const details = session.squashDetails
  const blockKinds = [...new Set((details?.blocks ?? []).map((block) => block.kind))]
  if (blockKinds.length > 0) {
    if (blockKinds.every((kind) => kind === 'match')) return true
    const titleObjective = normalizeText([session.title, session.objective].filter(Boolean).join(' '))
    return SQUASH_MATCH_TEXT_PATTERN.test(titleObjective)
  }

  if (session.subtype === 'match' || session.subtype === 'competitive') return true
  if (details?.sessionKind === 'match' || details?.sessionMode === 'practice_match' || details?.sessionMode === 'competition_match') return true

  const text = normalizeText([
    session.title,
    session.objective,
    ...(details?.drills ?? []).map((drill) => drill.name),
    ...((details?.blocks ?? []).flatMap((block) => block.drills.map((drill) => drill.name))),
  ].filter(Boolean).join(' '))

  return SQUASH_MATCH_TEXT_PATTERN.test(text)
}

function inferSquashKindFromProposalDetails(session: CoachSessionProposal): SquashSessionKind {
  const details = session.squashDetails
  if (!details) return session.subtype === 'match' || session.subtype === 'competitive' ? 'match' : 'technical'
  if (details.sessionKind && details.sessionKind !== 'match') return details.sessionKind

  const counts = new Map<SquashSessionKind, number>()
  for (const drill of details.drills ?? []) {
    const definition = findSquashDrillByName(drill.name)
    const kind = definition
      ? isSquashMatchDrill(definition)
        ? 'match'
        : isShadowsDrill(definition)
          ? 'shadows'
          : isControlDrill(definition)
            ? 'control'
            : 'technical'
      : /\b(match|partido)\b/i.test(drill.name)
        ? 'match'
        : 'technical'
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }

  if (counts.size === 0) return details.sessionKind ?? (session.subtype === 'match' || session.subtype === 'competitive' ? 'match' : 'technical')
  const sortedKinds = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const [topKind, topCount] = sortedKinds[0]!
  const tiedTop = sortedKinds.filter(([, count]) => count === topCount)
  if (topKind === 'match' && sortedKinds.length > 1) return 'mixed'
  if (tiedTop.length > 1) return 'mixed'
  return topKind
}

/**
 * Resuelve la matriz completa desde el template intacto. Es deliberadamente
 * pura: los workers concurrentes de una misma familia de template no coordinan
 * por estado compartido, cada uno calcula las mismas columnas y sólo
 * materializa la propia.
 */
export function resolveStrengthBlockAllocation(
  strengthSessions: ReadonlyArray<CoachSessionProposal>,
  context: RepairContext,
  options: { selectorHydrated?: boolean } = {},
): StrengthBlockAllocation {
  const snapshot = captureStrengthTemplateSnapshot(strengthSessions)
  const positions = resolveBlockPositions(getPlanPhaseDescriptors(context), getPlanWeekDescriptors(context))
  const currentPosition = positions.get(context.week.weekIndex)
  const blockId = currentPosition?.blockId ?? `${context.week.phase}:${context.week.weekIndex}:${context.week.weekIndex}`
  const localBlockWeek = currentPosition?.indexInBlock ?? 0
  const blockWeekCount = Math.max(
    1,
    localBlockWeek + 1,
    [...positions.values()].filter((position) => position.blockId === blockId).length,
  )
  const cycleLength = options.selectorHydrated
    ? getStrengthBlockTemplateCycleLength(mapStrengthPhase(context.week.phase) as StrengthPhase)
    : 1
  const selectorTemplateOffset = localBlockWeek % cycleLength
  const blockWeekIndices = Array.from({ length: blockWeekCount }, (_, index) => index)
    .filter((index) => !options.selectorHydrated || index % cycleLength === selectorTemplateOffset)
  const localWeek = Math.max(0, blockWeekIndices.indexOf(localBlockWeek))
  const allocatorBlockId = options.selectorHydrated
    ? `${blockId}|selector-template:${selectorTemplateOffset}`
    : blockId
  const weekCount = blockWeekIndices.length

  const athleteParameters = buildAthleteParameters(context.profile, context.wizardConfig)
  const availableEquipment = athleteParameters.availableEquipment
  const structuralCoreByWeek = blockWeekIndices.map((weekIndex) => {
    const projections = new Map<string, StructuralCoreProjection>()
    strengthSessions.forEach((session) => {
      // El enriquecedor histórico sólo inserta core desde 45 minutos. Mantener
      // ese límite evita que la proyección agregue una estructura nueva a una
      // sesión corta que hoy no la recibe.
      if (session.durationMin < 45) return
      const projection = projectStructuralCoreSlot(
        session.exercises ?? [], weekIndex, availableEquipment, athleteParameters.safetyConstraints,
      )
      if (projection) projections.set(sessionKeyOf(session), projection)
    })
    return projections
  })

  const isStructuralCoreSlot = (slot: StrengthTemplateSlot): boolean =>
    structuralCoreByWeek[0]?.get(slot.sessionKey)?.slotIndex === slot.positionInSession
  // Un id del ciclo estructural sólo puede ocupar el slot estructural
  // proyectado. Si apareciera como reemplazo de otro core, una segunda pasada
  // vería dos foundations y perdería la identidad de la proyección.
  const structuralCoreIds = new Set<string>(INJECTED_CORE_ROTATION)
  const strengthOverlapGroup = (sessionOrdinal: number): string => `session:${sessionOrdinal}`

  const allocatorSlots = snapshot.slots
    .filter((slot) => isCountableRole(slot.role) && !isStructuralCoreSlot(slot))
    .map((slot) => {
      const session = strengthSessions[slot.sessionOrdinal]!
      const selectionContext = buildPlanBuilderStrengthSelectionContext(session, context, [])
      return {
        slotKey: slot.slotKey,
        canonicalId: canonicalSnapshotSlotId(slot),
        overlapGroup: strengthOverlapGroup(slot.sessionOrdinal),
        candidateIds: getStrengthReplacementPool(
          { name: slot.name, libraryRef: slot.libraryRef },
          selectionContext,
        ).filter((candidateId) => !structuralCoreIds.has(candidateId)),
      }
    })

  const densitySlotSessionKeys = new Map<string, string>()
  const densityAllocatorSlots: Array<{
    slotKey: string
    canonicalId: string
    candidateIds: string[]
    overlapGroup: string
  }> = []
  const reservedDensityCanonicalIds = new Set(
    snapshot.slots
      .map((slot) => slot.canonicalId)
      .filter((id): id is string => id != null),
  )
  for (const projections of structuralCoreByWeek) {
    for (const projection of projections.values()) reservedDensityCanonicalIds.add(projection.coreId)
  }
  const canonicalDensityWeekIndex = context.week.weekIndex - localBlockWeek + (blockWeekIndices[0] ?? 0)
  const canonicalDensityContext: RepairContext = {
    ...context,
    week: { ...context.week, weekIndex: canonicalDensityWeekIndex },
  }
  for (const [sessionOrdinal, session] of strengthSessions.entries()) {
    const sessionKey = sessionKeyOf(session)
    const sourceExercises = session.exercises ?? []
    const projection = structuralCoreByWeek[0]?.get(sessionKey)
    const projectedLength = sourceExercises.length + (projection?.slotIndex == null && projection ? 1 : 0)
    const selectionContext = buildPlanBuilderStrengthSelectionContext(session, canonicalDensityContext, [])
    const densityDeficit = Math.max(
      0,
      getTargetExerciseDensity(selectionContext).min - projectedLength,
      getMinimumStrengthWorkCount(session.durationMin) - sourceExercises.filter(isStrengthWorkExercise).length,
    )
    if (densityDeficit === 0) continue

    const densityCandidates = selectStrengthDensityCandidates(
      selectionContext,
      reservedDensityCanonicalIds,
      projection != null || sourceExercises.some(isFoundationCore),
    )
      .filter(isStrengthWorkExercise)
      .map(getStrengthExerciseKey)
      .filter((id) => !structuralCoreIds.has(id))

    for (let densityIndex = 0; densityIndex < densityDeficit; densityIndex++) {
      const canonicalId = densityCandidates.find((id) => !reservedDensityCanonicalIds.has(id))
      if (!canonicalId) break
      const slotKey = `density:${sessionOrdinal}:${densityIndex}`
      densitySlotSessionKeys.set(slotKey, sessionKey)
      densityAllocatorSlots.push({
        slotKey,
        canonicalId,
        candidateIds: densityCandidates,
        overlapGroup: strengthOverlapGroup(sessionOrdinal),
      })
      reservedDensityCanonicalIds.add(canonicalId)
    }
  }

  const fixedIdsByWeek = structuralCoreByWeek.map((projections) => {
    const groups = strengthSessions.map((session, sessionOrdinal) => {
      const mainLiftIds = snapshot.slots
        .filter((slot) => slot.sessionOrdinal === sessionOrdinal && !isCountableRole(slot.role))
        .map(canonicalSnapshotSlotId)
      const coreId = projections.get(sessionKeyOf(session))?.coreId
      const coreIds = coreId ? [coreId] : []
      return {
        groupKey: strengthOverlapGroup(sessionOrdinal),
        // I1 es direccional: el main lift sólo vive en `all`, mientras que el
        // core estructural es contable y debe entrar en ambas proyecciones.
        all: [...mainLiftIds, ...coreIds],
        countable: coreIds,
      }
    })
    return {
      // I2 sigue viendo la unión semanal completa, aun cuando I1 se mida por
      // ordinal de sesión.
      all: groups.flatMap((group) => group.all),
      countable: groups.flatMap((group) => group.countable),
      groups,
    }
  })

  const allocator = allocateStrengthBlock({
    slots: [...allocatorSlots, ...densityAllocatorSlots],
    blockId: allocatorBlockId,
    weekCount,
    fixedIdsByWeek,
    ...(densityAllocatorSlots.length > 0 ? { maxNodes: 200_000 } : {}),
  })
  return {
    snapshot,
    templateSignature: computeTemplateSignature(snapshot),
    matrix: allocator.matrix,
    degradedCells: allocator.degradedCells,
    searchExhausted: allocator.searchExhausted,
    localWeek,
    localBlockWeek,
    blockWeekIndices,
    selectorHydrated: options.selectorHydrated === true,
    structuralCoreByWeek,
    densitySlotSessionKeys,
  }
}

/** Emite sólo la columna local; las restantes son cálculo virtual del worker. */
function recordStrengthAllocatorMetrics(
  meta: RepairMeta,
  allocation: StrengthBlockAllocation,
  materialization: StrengthAllocationMaterialization,
): void {
  const localMatrix = allocation.matrix[allocation.localWeek]
  if (!localMatrix || localMatrix.size === 0) return

  const localDegraded = allocation.degradedCells
    .filter((cell) => cell.week === allocation.localWeek)
  const countBy = (reason: AllocationDegradationReason): number =>
    localDegraded.filter((cell) => cell.reason === reason).length

  meta.strengthAllocator = {
    slotCount: localMatrix.size,
    // La columna 0 es referencia, no una sustitución. En las restantes el
    // contador acredita sólo una celda que realmente se pudo materializar.
    assignedCount: materialization.assignedSlotKeys.size,
    infeasibleIntraWeekCount: countBy('infeasible_intra_week'),
    insufficientPoolCount: countBy('insufficient_pool'),
    unresolvedIdentityCount: countBy('unresolved_identity'),
    searchExhaustedCount: countBy('search_exhausted'),
    unmaterializedCount: materialization.unmaterializedSlotKeys.size,
  }
}

/**
 * Las semanas en vuelo no sirven de referencia: sólo una hermana lista ya
 * persistió una firma pre-rotación con la que sea seguro comparar.
 */
function recordDivergentStrengthTemplateWarning(
  meta: RepairMeta,
  context: RepairContext,
  allocation: StrengthBlockAllocation,
): void {
  const previous = context.previousWeek
  if (!previous || !isReadyWeek(previous) || !isPreviousWeekInSameBlock(context)) return
  // Los esqueletos productivos alternan subtemplates A/B/C (A/B en taper).
  // Una hermana adyacente de otra familia es divergencia esperada, no drift.
  if (!allocation.blockWeekIndices.includes(allocation.localBlockWeek - 1)) return

  const previousSignatures = new Set(
    previous.sessions
      .filter((session) => session.sessionType === 'strength')
      .map((session) => session.metadata?.planBuilderStrengthRotation?.templateSignature)
      .filter((signature): signature is string => typeof signature === 'string' && signature.length > 0),
  )
  if (previousSignatures.size === 0 || previousSignatures.has(allocation.templateSignature)) return

  meta.warnings.push({
    code: 'allocator.divergent_template',
    message: 'La semana anterior lista usó un template de fuerza distinto; la asignación coordinada es best-effort.',
    sessionDate: context.week.weekStartDate,
  })
}

interface StrengthAllocationMaterialization {
  assignedSlotKeys: ReadonlySet<string>
  unmaterializedSlotKeys: ReadonlySet<string>
}

/** Aplica exclusivamente la columna local sobre la sesión ya enriquecida. */
function normalizeStrengthSessions(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
  allocation: StrengthBlockAllocation,
  densityOverlapGuard: StrengthDensityOverlapGuard,
): StrengthAllocationMaterialization {
  const strengthSessions = sessions.filter((session) => session.sessionType === 'strength')
  const assignedSlotKeys = new Set<string>()
  const unmaterializedSlotKeys = new Set<string>()
  if (strengthSessions.length === 0) {
    for (const slot of allocation.snapshot.slots) {
      const assignedId = allocation.matrix[allocation.localWeek]?.get(slot.slotKey)
      if (allocation.localWeek > 0 && assignedId && assignedId !== canonicalSnapshotSlotId(slot)) {
        unmaterializedSlotKeys.add(slot.slotKey)
      }
    }
    return { assignedSlotKeys, unmaterializedSlotKeys }
  }

  const localMatrix = allocation.matrix[allocation.localWeek]
  const committedStrengthIds = getCommittedStrengthIds(
    allocation,
    new Set(strengthSessions.map(sessionKeyOf)),
  )
  const currentBlockId = resolveBlockPositions(getPlanPhaseDescriptors(context), getPlanWeekDescriptors(context))
    .get(context.week.weekIndex)?.blockId
  const applyPolicy = allocation.localWeek > 0
  const alreadyCanonicalSessions = new Set(
    strengthSessions
      .filter((session) => currentBlockId != null && hasCanonicalStrengthRotation(session, currentBlockId))
      .map(sessionKeyOf),
  )
  // Se calcula antes de sustituir cualquier slot: para [A, A] ambos índices
  // viven todavía en la lista original y la segunda celda no se pierde al
  // dejar de encontrar el primer A después de reemplazarlo.
  const liveTargets = resolveLiveSnapshotSlotTargets(strengthSessions, allocation.snapshot)

  let policyActions = 0
  const policySessions = new Set<string>()
  for (const slot of allocation.snapshot.slots) {
    const assignedId = localMatrix?.get(slot.slotKey)
    if (!assignedId || assignedId === canonicalSnapshotSlotId(slot)) continue
    if (!applyPolicy || alreadyCanonicalSessions.has(slot.sessionKey)) continue

    const target = liveTargets.get(slot.slotKey)
    if (!target) {
      unmaterializedSlotKeys.add(slot.slotKey)
      continue
    }

    const replacement = buildStrengthReplacementById(
      assignedId,
      buildPlanBuilderStrengthSelectionContext(target.session, context, []),
      target.index,
    )
    if (!replacement) {
      unmaterializedSlotKeys.add(slot.slotKey)
      continue
    }

    target.session.exercises![target.index] = toStrengthProposal(replacement)
    assignedSlotKeys.add(slot.slotKey)
    policyActions++
    policySessions.add(sessionKeyOf(target.session))
  }

  // Los slots mínimos de densidad forman parte de la misma matriz I1, pero no
  // tienen una posición en el snapshot original: se anexan a su sesión por la
  // clave estable antes del enriquecimiento y del sello terminal.
  const sessionsByKey = new Map(strengthSessions.map((session) => [sessionKeyOf(session), session]))
  for (const [slotKey, sessionKey] of allocation.densitySlotSessionKeys) {
    const assignedId = localMatrix?.get(slotKey)
    const session = sessionsByKey.get(sessionKey)
    if (!assignedId || !session) {
      if (assignedId) unmaterializedSlotKeys.add(slotKey)
      continue
    }
    const existingIds = new Set((session.exercises ?? []).map(getStrengthExerciseKey))
    if (existingIds.has(assignedId)) continue
    const addition = buildStrengthReplacementById(
      assignedId,
      buildPlanBuilderStrengthSelectionContext(session, context, []),
      session.exercises?.length ?? 0,
    )
    if (!addition) {
      unmaterializedSlotKeys.add(slotKey)
      continue
    }
    session.exercises = [...(session.exercises ?? []), toStrengthProposal(addition)]
    assignedSlotKeys.add(slotKey)
  }

  // Segunda pasada: conserva el core proyectado y no permite que `ensureCore`
  // reemplace una identidad comprometida por la matriz.
  for (const session of strengthSessions) {
    const structuralCore = allocation.structuralCoreByWeek[allocation.localWeek]?.get(sessionKeyOf(session))
    session.exercises = enhanceStrengthSessionExercises(session.exercises, {
      durationMin: session.durationMin,
      strengthProfile: context.profile.strengthProfile,
      weekIndexInBlock: allocation.localBlockWeek,
      availableEquipment: buildAthleteParameters(context.profile, context.wizardConfig).availableEquipment,
      structuralCoreId: structuralCore?.coreId,
      protectedExerciseIds: committedStrengthIds,
      safetyConstraints: buildAthleteParameters(context.profile, context.wizardConfig).safetyConstraints,
    })
    session.exercises = completeStrengthExerciseDensity(
      session,
      context,
      extractRecentStrengthExercises(context.previousWeek),
      session.exercises,
      committedStrengthIds,
      structuralCore,
      densityOverlapGuard,
    )
    if (session.exercises) {
      const mode = shouldApplySupersetPolicy({
        phase: context.week.phase,
        sportProfile: deriveStrengthSportProfile(context),
        sessionDurationMin: session.durationMin,
      })
      session.exercises = planSupersetGroups(session.exercises, mode).exercises
    }
    if (currentBlockId != null) {
      const sessionKey = sessionKeyOf(session)
      const previousMarker = session.metadata?.planBuilderStrengthRotation
      const preserveCanonicalMarker = alreadyCanonicalSessions.has(sessionKey)
      session.metadata = {
        ...(session.metadata ?? {}),
        planBuilderStrengthRotation: {
          blockId: currentBlockId,
          signature: canonicalStrengthSignature(session),
          templateSignature: preserveCanonicalMarker
            ? previousMarker?.templateSignature
            : allocation.templateSignature,
          templateSource: preserveCanonicalMarker
            ? previousMarker?.templateSource ?? (allocation.selectorHydrated ? 'selector' : 'provided')
            : allocation.selectorHydrated ? 'selector' : 'provided',
        },
      }
    }
  }

  if (applyPolicy) {
    meta.strengthAccessoryRotationActionCount = (meta.strengthAccessoryRotationActionCount ?? 0) + policyActions
    meta.strengthAccessoryRotationSessionsAffected =
      (meta.strengthAccessoryRotationSessionsAffected ?? 0) + policySessions.size
  }
  return { assignedSlotKeys, unmaterializedSlotKeys }
}

function canonicalSnapshotSlotId(slot: StrengthTemplateSlot): string {
  return slot.canonicalId ?? `unresolved:${slot.name}`
}

function getCommittedStrengthIds(
  allocation: StrengthBlockAllocation,
  activeSessionKeys?: ReadonlySet<string>,
): Set<string> {
  const activeSlots = activeSessionKeys
    ? allocation.snapshot.slots.filter((slot) => activeSessionKeys.has(slot.sessionKey))
    : allocation.snapshot.slots
  const activeSlotKeys = new Set(activeSlots.map((slot) => slot.slotKey))
  for (const [slotKey, sessionKey] of allocation.densitySlotSessionKeys) {
    if (!activeSessionKeys || activeSessionKeys.has(sessionKey)) activeSlotKeys.add(slotKey)
  }
  const ids = new Set(
    [...(allocation.matrix[allocation.localWeek]?.entries() ?? [])]
      .filter(([slotKey]) => activeSlotKeys.has(slotKey))
      .map(([, id]) => id),
  )
  // Un slot que rotó no puede reaparecer como «extra» de densidad en otra
  // sesión de la misma semana: eso desharía silenciosamente la asignación.
  for (const slot of activeSlots) {
    const structuralCore = allocation.structuralCoreByWeek[allocation.localWeek]?.get(slot.sessionKey)
    // El core canónico del snapshot sí debe poder ser sustituido por la
    // proyección semanal; protegerlo aquí fijaba `dead_bug` en todo el bloque
    // y hacía que el presupuesto I1 modelara un core distinto del persistido.
    if (structuralCore?.slotIndex === slot.positionInSession) continue
    if (slot.canonicalId) ids.add(slot.canonicalId)
  }
  for (const [sessionKey, projection] of allocation.structuralCoreByWeek[allocation.localWeek]?.entries() ?? []) {
    if (!activeSessionKeys || activeSessionKeys.has(sessionKey)) ids.add(projection.coreId)
  }
  return ids
}

interface StrengthDensityOverlapGuard {
  /** No deja que un extra local lleve algún par virtual por encima de I1. */
  canAdd(id: string, sessionKey: string): boolean
  /** Confirma un extra que sí entró para que el siguiente vea la misma columna final. */
  commit(id: string, sessionKey: string): void
}

/**
 * El allocator no decide el relleno, pero el relleno tampoco puede gastar el
 * margen I1 que la matriz dejó exacto. Cada worker reconstruye un plan global
 * y determinista de extras desde el mismo template, y materializa únicamente
 * su columna. Así el guard ve también los extras de las semanas hermanas, sin
 * la reserva FNV que dejaba 11/12 candidatos fuera de cada semana.
 */
function createStrengthDensityOverlapGuard(
  allocation: StrengthBlockAllocation,
  context: RepairContext,
  strengthSessions: ReadonlyArray<CoachSessionProposal>,
): StrengthDensityOverlapGuard {
  const activeSessionKeys = new Set(strengthSessions.map(sessionKeyOf))
  const activeSlots = allocation.snapshot.slots
    .filter((slot) => activeSessionKeys.has(slot.sessionKey))
  const activeSlotKeys = new Set(activeSlots.map((slot) => slot.slotKey))
  for (const [slotKey, sessionKey] of allocation.densitySlotSessionKeys) {
    if (activeSessionKeys.has(sessionKey)) activeSlotKeys.add(slotKey)
  }
  const allByWeek = allocation.matrix.map((column, week) => {
    const ids = new Set(
      [...column.entries()]
        .filter(([slotKey]) => activeSlotKeys.has(slotKey))
        .map(([, id]) => id),
    )
    for (const slot of activeSlots) {
      if (!isCountableRole(slot.role)) ids.add(canonicalSnapshotSlotId(slot))
    }
    for (const [sessionKey, projection] of allocation.structuralCoreByWeek[week]?.entries() ?? []) {
      if (activeSessionKeys.has(sessionKey)) ids.add(projection.coreId)
    }
    return ids
  })
  const countableByWeek = allocation.matrix.map((column, week) => {
    const ids = new Set(
      [...column.entries()]
        .filter(([slotKey]) => activeSlotKeys.has(slotKey))
        .map(([, id]) => id),
    )
    for (const [sessionKey, projection] of allocation.structuralCoreByWeek[week]?.entries() ?? []) {
      if (activeSessionKeys.has(sessionKey)) ids.add(projection.coreId)
    }
    return ids
  })
  const baseIdsByWeek = allByWeek.map((ids) => new Set(ids))
  const templateIds = new Set(
    activeSlots
      .map((slot) => slot.canonicalId)
      .filter((id): id is string => id != null),
  )

  const pairStaysWithinBudget = (): boolean => {
    for (let earlier = 0; earlier < allByWeek.length; earlier++) {
      for (let later = earlier + 1; later < allByWeek.length; later++) {
        let shared = 0
        for (const id of countableByWeek[later]!) {
          if (allByWeek[earlier]!.has(id)) shared++
        }
        if (shared > 2) return false
      }
    }
    return true
  }

  const allowedByPlan = new Map<string, Set<string>>()
  const positions = resolveBlockPositions(getPlanPhaseDescriptors(context), getPlanWeekDescriptors(context))
  const currentBlockId = positions.get(context.week.weekIndex)?.blockId
  const blockWeeks = [...positions.entries()]
    .filter(([, position]) => position.blockId === currentBlockId)
    .sort((left, right) => left[1].indexInBlock - right[1].indexInBlock)
  const virtualWeeks = allocation.blockWeekIndices
    .map((blockWeekIndex, matrixWeek) => {
      const descriptor = blockWeeks.find(([, position]) => position.indexInBlock === blockWeekIndex)
      return descriptor ? { matrixWeek, absoluteWeekIndex: descriptor[0] } : undefined
    })
    .filter((entry): entry is { matrixWeek: number; absoluteWeekIndex: number } => entry != null)

  const reserve = (week: number, sessionKey: string, id: string): boolean => {
    if (allByWeek[week]?.has(id)) return false
    allByWeek[week]?.add(id)
    countableByWeek[week]?.add(id)
    const allowed = pairStaysWithinBudget()
    if (allowed) {
      allowedByPlan.get(`${week}|${sessionKey}`)?.add(id)
    } else {
      allByWeek[week]?.delete(id)
      countableByWeek[week]?.delete(id)
    }
    return allowed
  }

  interface DensityPlan {
    week: number
    sessionKey: string
    baseLength: number
    target: number
    candidates: CoachExerciseProposal[]
    strengthDeficit: number
    minimumRequired: number
    additions: number
    minimumReserved: string[]
  }

  /**
   * Reconstruye la sesión que realmente verá una columna virtual. El snapshot
   * conserva la pertenencia de cada slot y la matriz su identidad asignada;
   * calcular el déficit desde el template local ignoraba justamente esas
   * sustituciones y podía reservar trabajo para la sesión equivocada.
   */
  const projectSessionIds = (week: number, sessionKey: string): string[] => {
    const projection = allocation.structuralCoreByWeek[week]?.get(sessionKey)
    const column = allocation.matrix[week]
    const ids = allocation.snapshot.slots
      .filter((slot) => slot.sessionKey === sessionKey)
      .map((slot) => {
        if (projection?.slotIndex === slot.positionInSession) return projection.coreId
        return isCountableRole(slot.role)
          ? column?.get(slot.slotKey) ?? canonicalSnapshotSlotId(slot)
          : canonicalSnapshotSlotId(slot)
      })
    for (const [slotKey, ownerSessionKey] of allocation.densitySlotSessionKeys) {
      if (ownerSessionKey !== sessionKey) continue
      const assignedId = column?.get(slotKey)
      if (assignedId) ids.push(assignedId)
    }
    if (projection?.slotIndex == null && projection) ids.unshift(projection.coreId)
    return ids
  }

  const isStrengthWorkId = (id: string): boolean => {
    const definition = getExerciseById(id)
    if (!definition) return false
    return isStrengthWorkExercise({
      name: definition.name,
      sets: 1,
      reps: 1,
      libraryRef: { source: 'strength_exercise', id: definition.id },
    })
  }

  const plans: DensityPlan[] = []
  const recentExercises = extractRecentStrengthExercises(context.previousWeek)
  for (const { matrixWeek: week, absoluteWeekIndex } of virtualWeeks) {
    if (week >= allByWeek.length) continue
    const virtualContext: RepairContext = {
      ...context,
      week: { ...context.week, weekIndex: absoluteWeekIndex },
    }
    for (const session of strengthSessions) {
      const sourceExercises = session.exercises ?? []
      if (sourceExercises.length === 0) continue

      const selectionContext = buildPlanBuilderStrengthSelectionContext(session, virtualContext, recentExercises)
      const density = getTargetExerciseDensity(selectionContext)
      const sessionKey = sessionKeyOf(session)
      const projectedIds = projectSessionIds(week, sessionKey)
      const hasStructuralCore = allocation.structuralCoreByWeek[week]?.has(sessionKey) === true
        || sourceExercises.some(isFoundationCore)
      const baseLength = projectedIds.length
      const strengthDeficit = Math.max(
        0,
        getMinimumStrengthWorkCount(session.durationMin) - projectedIds.filter(isStrengthWorkId).length,
      )
      if (baseLength >= density.target && strengthDeficit === 0) continue

      // Los originales rotados no cuentan en I1, pero tampoco pueden volver a
      // entrar como relleno y deshacer la rotación de su propia columna.
      const existingKeys = new Set([...baseIdsByWeek[week]!, ...templateIds])
      const candidates = selectStrengthDensityCandidates(selectionContext, existingKeys, hasStructuralCore)
      allowedByPlan.set(`${week}|${sessionKey}`, new Set())
      plans.push({
        week,
        sessionKey,
        baseLength,
        target: density.target,
        candidates,
        strengthDeficit,
        // Reserve real-strength replacements even when the total template is
        // already dense (notably the race activation template).
        minimumRequired: Math.max(
          strengthDeficit,
          Math.max(0, density.min - baseLength),
        ),
        additions: 0,
        minimumReserved: [],
      })
    }
  }

  const reserveFromPlan = (plan: DensityPlan, limit: number): void => {
    const ordered = [
      ...plan.candidates.filter(isStrengthWorkExercise),
      ...plan.candidates.filter((candidate) => !isStrengthWorkExercise(candidate)),
    ]
    for (const candidate of ordered) {
      if (plan.additions >= limit || plan.baseLength + plan.additions >= plan.target) break
      const id = getStrengthExerciseKey(candidate)
      if (allByWeek[plan.week]!.has(id)) continue
      if (reserve(plan.week, plan.sessionKey, id)) plan.additions++
    }
  }

  // Primero se reparte el mínimo operativo entre TODAS las columnas. Llenar la
  // semana 0 hasta el target antes de mirar la 11 sería determinista, pero
  // volvería a dejar semanas cortas aunque existiera una solución factible.
  const minimumRequests = plans.flatMap((plan, planIndex) =>
    Array.from({ length: plan.minimumRequired }, (_, requestIndex) => ({
      planIndex,
      strengthOnly: requestIndex < plan.strengthDeficit,
    })),
  )
  const baselineFrequency = (week: number, id: string): number =>
    allByWeek.reduce((count, ids, otherWeek) =>
      count + (otherWeek !== week && ids.has(id) ? 1 : 0), 0)
  const orderedCandidates = (
    plan: DensityPlan,
    strengthOnly = false,
  ): CoachExerciseProposal[] => plan.candidates
    .filter((candidate) => !strengthOnly || isStrengthWorkExercise(candidate))
    .slice()
    .sort((left, right) => {
      const leftId = getStrengthExerciseKey(left)
      const rightId = getStrengthExerciseKey(right)
      return baselineFrequency(plan.week, leftId) - baselineFrequency(plan.week, rightId)
        || leftId.localeCompare(rightId)
    })
  let minimumNodes = 0
  const MAX_MINIMUM_NODES = 100_000
  const reserveMinimum = (requestIndex: number): boolean => {
    if (requestIndex === minimumRequests.length) return true
    if (++minimumNodes > MAX_MINIMUM_NODES) return false
    const request = minimumRequests[requestIndex]!
    const plan = plans[request.planIndex]!
    for (const candidate of orderedCandidates(plan, request.strengthOnly)) {
      const id = getStrengthExerciseKey(candidate)
      if (allByWeek[plan.week]!.has(id)) continue
      allByWeek[plan.week]!.add(id)
      countableByWeek[plan.week]!.add(id)
      if (pairStaysWithinBudget()) {
        plan.minimumReserved.push(id)
        if (reserveMinimum(requestIndex + 1)) return true
        plan.minimumReserved.pop()
      }
      allByWeek[plan.week]!.delete(id)
      countableByWeek[plan.week]!.delete(id)
    }
    return false
  }

  const minimumSolved = reserveMinimum(0)
  if (minimumSolved) {
    for (const plan of plans) {
      for (const id of plan.minimumReserved) allowedByPlan.get(`${plan.week}|${plan.sessionKey}`)!.add(id)
      plan.additions = plan.minimumReserved.length
    }
  } else {
    // La densidad es best-effort: si un template realmente no tiene una
    // cobertura factible, conserva la búsqueda lineal y no bloquea el repair.
    for (const plan of plans) {
      reserveFromPlan(plan, plan.minimumRequired)
    }
  }
  // Recién con ese suelo reservado se aprovecha el resto de la densidad.
  for (const plan of plans) reserveFromPlan(plan, plan.target - plan.baseLength)

  const localWeek = allocation.localWeek
  const committedByPlan = new Map<string, Set<string>>()
  for (const plan of plans.filter((plan) => plan.week === localWeek)) {
    committedByPlan.set(`${plan.week}|${plan.sessionKey}`, new Set(baseIdsByWeek[localWeek] ?? []))
  }
  return {
    canAdd(id: string, sessionKey: string): boolean {
      const key = `${localWeek}|${sessionKey}`
      return allowedByPlan.get(key)?.has(id) === true && !committedByPlan.get(key)?.has(id)
    },
    commit(id: string, sessionKey: string): void {
      const key = `${localWeek}|${sessionKey}`
      committedByPlan.get(key)?.add(id)
    },
  }
}

/**
 * Ancla slots a `date|timeBlock` y resuelve todas las ocurrencias antes de
 * mutar. Los ordinales sólo sirven para la matriz virtual; nunca para volver a
 * encontrar una sesión que el repair pudo reordenar o eliminar.
 */
function resolveLiveSnapshotSlotTargets(
  strengthSessions: ReadonlyArray<CoachSessionProposal>,
  snapshot: StrengthTemplateSnapshot,
): Map<string, { session: CoachSessionProposal; index: number }> {
  const sessionsByKey = new Map(strengthSessions.map((session) => [sessionKeyOf(session), session]))
  const targets = new Map<string, { session: CoachSessionProposal; index: number }>()
  const slotsBySession = new Map<string, StrengthTemplateSlot[]>()
  for (const slot of snapshot.slots) {
    slotsBySession.set(slot.sessionKey, [...(slotsBySession.get(slot.sessionKey) ?? []), slot])
  }

  for (const [sessionKey, slots] of slotsBySession) {
    const session = sessionsByKey.get(sessionKey)
    if (!session?.exercises) continue
    const indexesByIdentity = new Map<string, number[]>()
    for (const [index, exercise] of session.exercises.entries()) {
      const identity = resolveStrengthExercise(exercise)?.definition?.id ?? `unresolved:${exercise.name}`
      indexesByIdentity.set(identity, [...(indexesByIdentity.get(identity) ?? []), index])
    }
    const nextOccurrence = new Map<string, number>()
    for (const slot of [...slots].sort((left, right) => left.positionInSession - right.positionInSession)) {
      const identity = canonicalSnapshotSlotId(slot)
      const occurrence = nextOccurrence.get(identity) ?? 0
      nextOccurrence.set(identity, occurrence + 1)
      const index = indexesByIdentity.get(identity)?.[occurrence]
      if (index != null) targets.set(slot.slotKey, { session, index })
    }
  }
  return targets
}

function canonicalStrengthSignature(session: CoachSessionProposal): string {
  return (session.exercises ?? [])
    .map(getStrengthExerciseKey)
    .sort((left, right) => left.localeCompare(right))
    .join('|')
}

function hasCanonicalStrengthRotation(session: CoachSessionProposal, blockId: string): boolean {
  const marker = session.metadata?.planBuilderStrengthRotation
  return marker?.blockId === blockId && marker.signature === canonicalStrengthSignature(session)
}

function isPreviousWeekInSameBlock(context: RepairContext): boolean {
  const previous = context.previousWeek
  if (!previous) return false
  const positions = resolveBlockPositions(getPlanPhaseDescriptors(context), getPlanWeekDescriptors(context))
  return positions.get(context.week.weekIndex)?.blockId === positions.get(previous.weekIndex)?.blockId
}

const MAX_CORRECTIVE_ASSIGNMENTS = 512

interface SquashNormalizationResult {
  failure?: RepairFailure
}

/**
 * Rotación de contenido de squash con una sola dueña del estado final. La
 * política es una proyección estricta; las firmas duplicadas se corrigen por
 * sesión y fallan cerradamente si no hay una asignación segura.
 */
function normalizeSquashSessionContent(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): SquashNormalizationResult {
  const allSquashSessions = sessions.filter((session) => session.sessionType === 'squash')
  // Dos partidos standalone comparten formato, no una prescripción repetida de
  // drills. Incluirlos haría irresoluble cualquier semana con dos partidos.
  const squashSessions = allSquashSessions.filter(
    (session) => resolveSquashMatchRole(session.squashDetails) !== 'standalone',
  )
  if (squashSessions.length === 0) return {}

  const weekIndexInBlock = getWeekIndexInBlock(context)
  const currentBlockId = resolveBlockPositions(getPlanPhaseDescriptors(context), getPlanWeekDescriptors(context))
    .get(context.week.weekIndex)?.blockId
  const signatures = squashSessions.map(buildSquashDrillSignature)
  const seenOriginal = new Set<string>()
  const correctiveSessions = new Set<CoachSessionProposal>()
  squashSessions.forEach((session, index) => {
    const signature = signatures[index]
    if (!signature || !seenOriginal.has(signature)) {
      if (signature) seenOriginal.add(signature)
      return
    }
    correctiveSessions.add(session)
  })
  const policySessions = weekIndexInBlock > 0
    ? squashSessions.filter((session) =>
      !correctiveSessions.has(session)
      && !(currentBlockId != null && hasCanonicalSquashRotation(session, currentBlockId)),
    )
    : []

  const previous = context.previousWeek
  const previousKeys = previous && isReadyWeek(previous) && isPreviousWeekInSameBlock(context)
    ? collectSquashDrillKeys(previous.sessions)
    : new Set<string>()
  const assignedKeys = new Set<string>()
  for (const session of squashSessions) {
    if (policySessions.includes(session)) continue
    for (const key of getSquashSessionDrillKeys(session)) assignedKeys.add(key)
  }

  let policyActions = 0
  const policyTouched = new Set<string>()
  let omitted = 0
  let correctiveSessionsResolved = 0
  for (const [sessionOrdinal, session] of squashSessions.entries()) {
    if (!policySessions.includes(session)) continue
    const drills = session.squashDetails?.drills ?? []
    const sessionRole = resolveSquashMatchRole(session.squashDetails)
    for (const [drillOrdinal, drill] of drills.entries()) {
      const isFinisherSlot = sessionRole === 'finisher' && isFinisherMatchDrill(drill)
      const replacement = selectSquashDrillReplacement({
        originalName: drill.name,
        context: buildSquashRotationSelectionContext(session, context),
        excludedKeys: new Set([...assignedKeys, ...previousKeys]),
        rotationIndex: weekIndexInBlock * 131 + sessionOrdinal * 17 + drillOrdinal,
        relaxation: 'strict',
        allowedIds: isFinisherSlot
          ? new Set<string>(SQUASH_FINISHER_MATCH_IDS)
          : undefined,
      })
      if (!replacement) {
        omitted++
        assignedKeys.add(squashDrillKey(drill.name))
        continue
      }
      assignedKeys.add(squashDrillKey(replacement.id))
      if (squashDrillKey(replacement.id) === squashDrillKey(drill.name)) continue
      replaceSquashDrill(session, drillOrdinal, replacement)
      policyActions++
      policyTouched.add(sessionKeyOf(session))
    }
  }

  const seen = new Set<string>()
  for (const session of squashSessions) {
    if (correctiveSessions.has(session)) continue
    const signature = buildSquashDrillSignature(session)
    if (signature) seen.add(signature)
  }

  for (const [sessionOrdinal, session] of squashSessions.entries()) {
    if (!correctiveSessions.has(session)) continue
    const candidate = findUniqueSquashSessionCandidate(
      sessions,
      session,
      sessionOrdinal,
      context,
      new Set([...assignedKeys, ...previousKeys]),
      seen,
    )
    if (!candidate) {
      return {
        failure: {
          errorClass: 'quality.squash.signature_uniqueness_unresolved',
          message: `No se pudo diferenciar la firma de la sesión de squash del ${session.date}.`,
        },
      }
    }
    Object.assign(session, candidate)
    const signature = buildSquashDrillSignature(session)
    if (signature) seen.add(signature)
    for (const key of getSquashSessionDrillKeys(session)) assignedKeys.add(key)
    recordRepair(meta, 'corrective', sessionKeyOf(session))
    correctiveSessionsResolved++
  }

  if (weekIndexInBlock > 0) {
    meta.squashDrillRotationActionCount = (meta.squashDrillRotationActionCount ?? 0) + policyActions
    meta.squashDrillRotationSessionsAffected = (meta.squashDrillRotationSessionsAffected ?? 0) + policyTouched.size
    meta.squashDrillRotationOmittedCount = (meta.squashDrillRotationOmittedCount ?? 0) + omitted
  }
  if (correctiveSessionsResolved > 0) {
    meta.warnings.push({
      code: 'squash_duplicate_drills_repaired',
      message: `Se regeneraron ${correctiveSessionsResolved} sesiones de squash para evitar repetir los mismos drills.`,
    })
  }
  if (currentBlockId != null) {
    for (const session of squashSessions) {
      session.metadata = {
        ...(session.metadata ?? {}),
        planBuilderSquashRotation: {
          blockId: currentBlockId,
          signature: canonicalSquashSignature(session),
        },
      }
    }
  }
  return {}
}

function findUniqueSquashSessionCandidate(
  sessions: CoachSessionProposal[],
  original: CoachSessionProposal,
  sessionOrdinal: number,
  context: RepairContext,
  excludedKeys: ReadonlySet<string>,
  seenSignatures: ReadonlySet<string>,
): CoachSessionProposal | undefined {
  const slots = (original.squashDetails?.drills ?? []).map((drill, drillOrdinal) => ({ drill, drillOrdinal }))
  if (slots.length === 0) return undefined
  const levels: SquashRelaxationLevel[] = ['strict', 'same_kind', 'same_category', 'any']
  for (const relaxation of levels) {
    const candidateLists = slots.map(({ drill, drillOrdinal }) => {
      const candidates = getSquashCandidatesForSlot({
        drill,
        session: original,
        context,
        sessionOrdinal,
        drillOrdinal,
        excludedKeys,
        relaxation,
      })
      if (candidates.length > 0) return candidates
      // Un slot sin recambio no puede anular el nivel entero: el finisher de
      // base/taper no tiene par (ningún partido lleva esos tags de fase, y el
      // rol debe preservarse), pero la firma se diferencia con los demás slots.
      const pinned = findSquashDrillByName(drill.name)
      return pinned ? [pinned] : []
    })
    if (candidateLists.some((list) => list.length === 0)) continue
    const tuple = new Array(candidateLists.length).fill(0)
    for (let attempts = 0; attempts < MAX_CORRECTIVE_ASSIGNMENTS; attempts++) {
      const replacementDefinitions = tuple.map((index, slotIndex) => candidateLists[slotIndex]![index]!)
      const keys = replacementDefinitions.map((candidate) => squashDrillKey(candidate.id))
      if (new Set(keys).size === keys.length) {
        const candidate = cloneSquashSessionWithReplacements(original, replacementDefinitions)
        const signature = buildSquashDrillSignature(candidate)
        const rolePreserved = resolveSquashMatchRole(candidate.squashDetails)
          === resolveSquashMatchRole(original.squashDetails)
        if (
          rolePreserved
          && signature
          && !seenSignatures.has(signature)
          && preservesCompetitiveExposure(sessions, original, candidate, context)
        ) {
          return candidate
        }
      }
      let carry = true
      for (let index = tuple.length - 1; index >= 0 && carry; index--) {
        tuple[index]!++
        if (tuple[index]! < candidateLists[index]!.length) carry = false
        else tuple[index] = 0
      }
      if (carry) break
    }
  }
  return undefined
}

function getSquashCandidatesForSlot(input: {
  drill: SquashDrill
  session: CoachSessionProposal
  context: RepairContext
  sessionOrdinal: number
  drillOrdinal: number
  excludedKeys: ReadonlySet<string>
  relaxation: SquashRelaxationLevel
}): ReturnType<typeof findSquashDrillByName>[] {
  const values: NonNullable<ReturnType<typeof findSquashDrillByName>>[] = []
  const seen = new Set<string>()
  const rotationIndex = getWeekIndexInBlock(input.context) * 131 + input.sessionOrdinal * 17 + input.drillOrdinal
  const selectionContext = buildSquashRotationSelectionContext(input.session, input.context)
  const finisherSlot = resolveSquashMatchRole(input.session.squashDetails) === 'finisher'
    && isFinisherMatchDrill(input.drill)
  for (let offset = 0; offset < 128; offset++) {
    const candidate = selectSquashDrillReplacement({
      originalName: input.drill.name,
      context: selectionContext,
      excludedKeys: input.excludedKeys,
      rotationIndex: rotationIndex + offset,
      relaxation: input.relaxation,
      allowedIds: finisherSlot ? new Set<string>(SQUASH_FINISHER_MATCH_IDS) : undefined,
    })
    if (!candidate || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    values.push(candidate)
  }
  return values
}

function cloneSquashSessionWithReplacements(
  original: CoachSessionProposal,
  replacements: NonNullable<ReturnType<typeof findSquashDrillByName>>[],
): CoachSessionProposal {
  const candidate: CoachSessionProposal = {
    ...original,
    squashDetails: original.squashDetails
      ? {
          ...original.squashDetails,
          drills: original.squashDetails.drills.map((drill, index) => toReplacementSquashDrill(drill, replacements[index]!)),
        }
      : undefined,
  }
  if (!candidate.squashDetails) return candidate
  setSquashDrillsAndBlocks(candidate.squashDetails, candidate.squashDetails.drills)
  const kind = inferSquashKindFromProposalDetails(candidate)
  candidate.squashDetails.sessionKind = kind
  candidate.squashDetails.sessionMode = kind === 'match'
    ? candidate.subtype === 'competitive' ? 'competition_match' : 'practice_match'
    : 'drill_session'
  realignSquashSessionIdentity(candidate, kind)
  return candidate
}

function replaceSquashDrill(
  session: CoachSessionProposal,
  drillOrdinal: number,
  replacement: NonNullable<ReturnType<typeof findSquashDrillByName>>,
): void {
  const details = session.squashDetails
  if (!details?.drills[drillOrdinal]) return
  details.drills[drillOrdinal] = toReplacementSquashDrill(details.drills[drillOrdinal]!, replacement)
  setSquashDrillsAndBlocks(details, details.drills)
}

function toReplacementSquashDrill(
  original: SquashDrill,
  replacement: NonNullable<ReturnType<typeof findSquashDrillByName>>,
): SquashDrill {
  // Guidance from the old drill belongs to a different movement. Rehydrate the
  // replacement from the canonical library so every rendered drill remains
  // executable, not just named.
  return toSquashDrill(replacement, original.durationMin)
}

function ensureSquashDrillGuidance(
  sessions: CoachSessionProposal[],
): void {
  for (const session of sessions) {
    const details = session.squashDetails
    if (session.sessionType !== 'squash' || !details) continue

    let changed = false
    const drills = details.drills.map((drill) => {
      const definition = findSquashDrillByName(drill.name)
      if (!definition) return drill

      const notes = drill.notes?.trim() ? drill.notes : definition.description
      // El catálogo es la autoridad de modalidad, no la copia persistida en la
      // fila. Preferir `drill.executionMode` dejaba que un `either` heredado
      // —o un valor emitido por el modelo— sobreviviera para siempre por encima
      // de la definición corregida.
      const executionMode = resolveDrillExecutionMode(definition)
      if (notes === drill.notes && executionMode === drill.executionMode) return drill

      changed = true
      return { ...drill, notes, executionMode }
    })

    if (!changed) continue
    setSquashDrillsAndBlocks(details, drills)
  }
}

function buildSquashRotationSelectionContext(session: CoachSessionProposal, context: RepairContext) {
  return {
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    phase: mapPhase(context.week.phase) as SquashSelectionPhase,
    recentDrills: [],
    goal: buildLevelAwareGoal(context, `${session.objective ?? context.profile.mainGoal ?? ''} ${session.title}`),
    competitionSoon: context.week.phase === 'taper' || context.week.phase === 'race',
    competitiveLevel: deriveCompetitiveLevel(context),
    partnerAvailability: context.wizardConfig.partnerAvailability ?? 'either',
    desiredKind: resolveSquashIntentKind(session),
  }
}

function preservesCompetitiveExposure(
  sessions: CoachSessionProposal[],
  original: CoachSessionProposal,
  candidate: CoachSessionProposal,
  context: RepairContext,
): boolean {
  const policy = resolveSquashWeeklyExposureDecision(context)
  if (!policy.ensure) return true
  return sessions.some((session) => {
    const evaluated = session === original ? candidate : session
    return evaluated.sessionType === 'squash'
      && hasSquashCompetitiveExposureContent(evaluated.squashDetails)
      && isSafeSquashCompetitionExposureDate(evaluated.date, context, policy.minimumDaysBeforeEvent)
  })
}

// Delega en el catálogo: una sola definición de identidad de drill.
const squashDrillKey = resolveSquashDrillKey

function canonicalSquashSignature(session: CoachSessionProposal): string {
  return getSquashSessionDrillKeys(session)
    .sort((left, right) => left.localeCompare(right))
    .join('|')
}

function hasCanonicalSquashRotation(session: CoachSessionProposal, blockId: string): boolean {
  const marker = session.metadata?.planBuilderSquashRotation
  return marker?.blockId === blockId && marker.signature === canonicalSquashSignature(session)
}

function getSquashSessionDrillKeys(session: CoachSessionProposal): string[] {
  return extractSquashDrillNames(session).map(squashDrillKey).filter(Boolean)
}

function collectSquashDrillKeys(sessions: CoachSessionProposal[]): Set<string> {
  return new Set(sessions.flatMap(getSquashSessionDrillKeys))
}

// `diversifyDuplicateSquashSessions` rewrites a session's drills but leaves its
// title/objective describing whatever it used to be. The
// `normalizeSquashSemanticMetadata` pass that runs right after re-reads that
// stale text via `isSquashMatchIntent`, so a diversified match session gets
// rebuilt as a match again and the diversification is silently undone. Keeping
// the identity in sync with the new content is what makes the two passes agree.
/**
 * Títulos que produce el propio sistema. Se derivan de `buildSquashTitleFromKind`
 * en vez de repetirse acá, para que agregar una variante no deje afuera a este
 * conjunto en silencio.
 */
const GENERIC_SQUASH_TITLES: ReadonlySet<string> = new Set(
  (['match', 'control', 'shadows', 'technical', 'mixed'] as SquashSessionKind[])
    .flatMap((kind) => [
      [],
      ['shadows', 'control'],
      ['technical', 'match'],
      ['control', 'match'],
    ].map((blockKinds) => normalizeText(buildSquashTitleFromKind(kind, blockKinds)))),
)

function realignSquashSessionIdentity(session: CoachSessionProposal, kind: SquashSessionKind): void {
  if (kind === 'match') return
  const blockKinds = [...new Set((session.squashDetails?.blocks ?? []).map((block) => block.kind))]
  session.subtype = resolveSquashSubtypeFromKind(kind, session.subtype)

  // Una realineación genérica puede reemplazar una identidad genérica que quedó
  // obsoleta, pero no puede pisar una identidad contextual que sigue siendo
  // compatible con el contenido: "Activación y Control Pre-Torneo" dice algo que
  // "Control y Precisión" no dice, y se pierde para siempre si se sobreescribe.
  // El mismo criterio que ya aplica la otra ruta de alineación de títulos.
  const currentTitle = session.title ?? ''
  const isGeneric = GENERIC_SQUASH_TITLES.has(normalizeText(currentTitle))
  if (!currentTitle || isGeneric || shouldAlignSquashTitle(currentTitle, kind, blockKinds)) {
    session.title = buildSquashTitleFromKind(kind, blockKinds)
  }

  if (session.objective && SQUASH_MATCH_TEXT_PATTERN.test(normalizeText(session.objective))) {
    session.objective = buildSquashObjectiveFromKind(kind)
  }
}

function buildSquashObjectiveFromKind(kind: SquashSessionKind): string {
  if (kind === 'control') return 'Sostener precisión y profundidad en patrones de control.'
  if (kind === 'shadows') return 'Mejorar salidas, primer paso y desplazamiento sin pelota.'
  if (kind === 'technical') return 'Afinar ejecución técnica en situaciones controladas.'
  return 'Combinar movimiento y precisión en cancha sin marcador.'
}

function buildSquashDrillSignature(session: CoachSessionProposal): string | undefined {
  const drillNames = extractSquashDrillNames(session)
  if (drillNames.length === 0) return undefined
  return drillNames
    .map((name) => findSquashDrillByName(name)?.id ?? normalizeSquashDrillKey(name))
    .sort()
    .join('|')
}

function completeRunningDetails(session: CoachSessionProposal, context: RepairContext): boolean {
  let changed = false
  const phase = mapPhase(context.week.phase) as RunningPhase
  const recentSessions = extractRecentRunningSessions(context.previousWeek)
  const sportProfile = deriveRunningSportProfile(context)
  const result = selectRunningSession({
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    phase,
    recentSessions,
    sessionDurationMin: session.durationMin,
    requestedRunningType: session.runningType,
    runningProfile: context.profile.runningProfile,
    experienceLevel: context.profile.runningProfile?.experienceLevel,
    referenceDate: session.date,
    historicalSessions: context.historicalSessions,
    goal: session.objective ?? context.profile.mainGoal ?? '',
    sportProfile,
    primarySport: context.profile.sportContext?.primarySport,
  })
  if (!result.session) return changed
  if (!session.runningType) {
    session.runningType = result.session.runningType
    changed = true
  }

  const runningType = session.runningType ?? result.session.runningType
  const targets = runningTargets(runningType, context.profile.runningProfile)
  for (const key of ['targetPaceMin', 'targetPaceMax'] as const) {
    if (!session[key] && targets[key]) { session[key] = targets[key]; changed = true }
  }
  if (!session.intervalStructure?.blocks.length) {
    session.durationMin = result.session.durationMin
    session.intervalStructure = result.session.intervalStructure
    session.runningTemplateRef = result.session.templateRef
    session.runningSelectionReason = result.session.notes
    changed = true
  }
  return changed
}

function completeStrengthExercises(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises = extractRecentStrengthExercises(context.previousWeek),
  structuralCore?: StructuralCoreProjection,
  committedStrengthIds?: ReadonlySet<string>,
  densityOverlapGuard?: StrengthDensityOverlapGuard,
  completeDensity = true,
): void {
  hydrateStrengthExerciseTemplate(session, context, recentExercises)
  enhanceStrengthSessionDetails(
    session,
    context,
    recentExercises,
    structuralCore,
    committedStrengthIds,
    densityOverlapGuard,
    completeDensity,
  )
}

/**
 * Materializa solamente la salida del selector, sin core estructural ni
 * densidad. Es el primer contenido real disponible en el camino productivo y,
 * por lo tanto, el template que debe observar el allocator.
 */
function hydrateStrengthExerciseTemplate(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises: string[],
): void {
  const result = selectStrengthSession(buildPlanBuilderStrengthSelectionContext(session, context, recentExercises))
  session.exercises = result.exercises.map(toStrengthProposal)
  if (result.starLift) {
    session.metadata = {
      ...(session.metadata ?? {}),
      starLift: result.starLift,
    }
  }
}

function enhanceStrengthSessionDetails(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises = extractRecentStrengthExercises(context.previousWeek),
  structuralCore?: StructuralCoreProjection,
  committedStrengthIds?: ReadonlySet<string>,
  densityOverlapGuard?: StrengthDensityOverlapGuard,
  completeDensity = true,
): boolean {
  const before = JSON.stringify(session.exercises ?? [])
  const enhanced = enhanceStrengthSessionExercises(session.exercises, {
    durationMin: session.durationMin,
    strengthProfile: context.profile.strengthProfile,
    weekIndexInBlock: getWeekIndexInBlock(context),
    availableEquipment: buildAthleteParameters(context.profile, context.wizardConfig).availableEquipment,
    structuralCoreId: structuralCore?.coreId,
    protectedExerciseIds: committedStrengthIds,
    safetyConstraints: buildAthleteParameters(context.profile, context.wizardConfig).safetyConstraints,
  })
  session.exercises = completeDensity
    ? completeStrengthExerciseDensity(
        session,
        context,
        recentExercises,
        enhanced,
        committedStrengthIds,
        structuralCore,
        densityOverlapGuard,
      )
    : enhanced
  return before !== JSON.stringify(session.exercises ?? [])
}

export function buildPlanBuilderStrengthSelectionContext(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises: string[],
): StrengthContext {
  const athleteParameters = buildAthleteParameters(context.profile, context.wizardConfig)
  const athlete = resolvePlanBuilderStrengthAthlete(session, context)

  return {
    phase: mapStrengthPhase(context.week.phase) as StrengthPhase,
    goal: buildLevelAwareGoal(context, session.objective ?? context.profile.mainGoal ?? ''),
    sportProfile: deriveStrengthSportProfile(context),
    primarySport: context.profile.sportContext?.primarySport,
    sessionDurationMin: session.durationMin,
    weekIndexInBlock: getWeekIndexInBlock(context),
    safetyConstraints: athleteParameters.safetyConstraints,
    ...toStrengthContextAthleteFields(athlete),
    // I10: la progresión viene del historial capturado. La acumulación
    // intra-semana del llamador (y, en densidad, `previousWeek`) va detrás y se
    // conserva hasta C6: el orden congelado del repair no cambia.
    recentExercises: [...athlete.recentExercises, ...recentExercises],
  }
}

function resolvePlanBuilderStrengthAthlete(session: CoachSessionProposal, context: RepairContext): StrengthAthleteContext {
  // Repair aislado (tests, regeneración local sin payload): captura mínima y
  // determinista anclada a la semana, sin leer el reloj.
  const capture = context.sourceCapture ?? captureSources({
    scope: { athleteId: context.plan.athleteId ?? null, epoch: 0, requestId: context.plan.id },
    now: Date.parse(`${context.week.weekStartDate}T12:00:00.000Z`),
    profile: context.profile,
    sessions: context.historicalSessions ?? [],
    dayLogs: [],
  })
  const slot = { date: session.date, timeBlock: session.timeBlock }
  // T8: el hidratador del Week Creator aporta su resolución por slot.
  // Plan Builder no instala este callback: conserva I8.
  if (context.strengthAthleteForSlot) return context.strengthAthleteForSlot(slot)
  return resolveStrengthAthleteContext({
    slotContext: deriveSlotContext(capture, slot),
    executionSignals: context.executionSignals ?? {},
    // I6/I7: la vigencia de fatiga y retorno sale de la fecha de declaración del wizard.
    declaration: context.wizardConfig,
  })
}

function completeStrengthExerciseDensity(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises: string[],
  exercises: CoachExerciseProposal[] | undefined,
  committedStrengthIds?: ReadonlySet<string>,
  structuralCore?: StructuralCoreProjection,
  densityOverlapGuard?: StrengthDensityOverlapGuard,
): CoachExerciseProposal[] | undefined {
  if (!exercises || exercises.length === 0) return exercises

  const selectionContext = buildPlanBuilderStrengthSelectionContext(session, context, recentExercises)
  const density = getTargetExerciseDensity(selectionContext)

  const hasStructuralCore = exercises.some(isFoundationCore)
  const completed = [...exercises]
  const existingKeys = new Set([
    ...(committedStrengthIds ?? []),
    ...exercises.map(getStrengthExerciseKey),
  ])
  const additions: CoachExerciseProposal[] = []
  const minimumStrengthWork = getMinimumStrengthWorkCount(session.durationMin)
  let strengthWorkCount = exercises.filter(isStrengthWorkExercise).length

  const candidates = selectStrengthDensityCandidates(selectionContext, existingKeys, hasStructuralCore)
  const densitySessionKey = sessionKeyOf(session)

  const appendOrReplaceStrengthWork = (candidate: CoachExerciseProposal): boolean => {
    const key = getStrengthExerciseKey(candidate)
    if (existingKeys.has(key)) return false
    if (densityOverlapGuard && !densityOverlapGuard.canAdd(key, densitySessionKey)) return false

    if (completed.length + additions.length >= density.target) {
      // El template race puede llegar ya lleno de core/activación. Sustituir
      // sólo un accesorio no estructural mantiene su densidad y permite que la
      // pasada final cumpla el mínimo de fuerza real sin inventar ejercicios.
      const replaceIndex = completed.findIndex((exercise) => {
        if (isStrengthWorkExercise(exercise)) return false
        const id = resolveStrengthExercise(exercise)?.definition?.id
        return id == null || id !== structuralCore?.coreId
      })
      if (replaceIndex < 0) return false
      completed[replaceIndex] = candidate
    } else {
      additions.push(candidate)
    }

    existingKeys.add(key)
    densityOverlapGuard?.commit(key, densitySessionKey)
    strengthWorkCount++
    return true
  }

  // El mínimo de trabajo real es anterior a la meta de densidad total. Si un
  // selector llenó temprano con core, reemplazamos accesorios no estructurales
  // en lugar de devolver una sesión que el finalizador debe bloquear.
  for (const candidate of candidates) {
    if (!isStrengthWorkExercise(candidate)) continue
    appendOrReplaceStrengthWork(candidate)
    if (strengthWorkCount >= minimumStrengthWork) break
  }

  for (const candidate of candidates) {
    if (completed.length + additions.length >= density.target) break
    const key = getStrengthExerciseKey(candidate)
    if (existingKeys.has(key)) continue
    if (densityOverlapGuard && !densityOverlapGuard.canAdd(key, densitySessionKey)) continue
    additions.push(candidate)
    existingKeys.add(key)
    densityOverlapGuard?.commit(key, densitySessionKey)
  }

  if (additions.length === 0 && completed.every((exercise, index) => exercise === exercises[index])) return exercises

  const dense = enhanceStrengthSessionExercises([...completed, ...additions], {
    durationMin: session.durationMin,
    strengthProfile: context.profile.strengthProfile,
    weekIndexInBlock: getWeekIndexInBlock(context),
    availableEquipment: buildAthleteParameters(context.profile, context.wizardConfig).availableEquipment,
    structuralCoreId: structuralCore?.coreId,
    protectedExerciseIds: committedStrengthIds,
    safetyConstraints: buildAthleteParameters(context.profile, context.wizardConfig).safetyConstraints,
  })
  return dense
}

/**
 * El selector entrega una primera sesión compacta, pero si el allocator dejó
 * sin margen a esos ids necesitamos alternativas elegibles, no abandonar la
 * densidad ni inventar ejercicios. Repetir el selector marcando el lote previo
 * como reciente conserva fase/equipo/prescripción y abre candidatos reales.
 */
function selectStrengthDensityCandidates(
  context: StrengthContext,
  existingKeys: ReadonlySet<string>,
  hasStructuralCore: boolean,
): CoachExerciseProposal[] {
  const candidates: CoachExerciseProposal[] = []
  const seen = new Set(existingKeys)
  let recentExercises = [...context.recentExercises]

  const maxRotationPasses = 12
  for (let pass = 0; pass < maxRotationPasses; pass++) {
    const selected = selectStrengthSession({ ...context, recentExercises }).exercises
    let found = false
    for (const selection of selected) {
      const exercise = toStrengthProposal(selection)
      const key = getStrengthExerciseKey(exercise)
      if (seen.has(key) || (hasStructuralCore && isFoundationCore(exercise))) continue
      seen.add(key)
      candidates.push(exercise)
      found = true
    }
    recentExercises = [...recentExercises, ...selected.map(getStrengthExerciseKey)]
    // La primera plantilla puede estar completamente presente en `seen`.
    // Aun así avanzamos la rotación para abrir su siguiente familia real; de
    // otro modo un race template lleno de core jamás ofrece fuerza sustituta.
    if (!found && pass === maxRotationPasses - 1) break
  }

  return candidates
}

function completeMobilityDetails(session: CoachSessionProposal, context: RepairContext): void {
  const primarySport = (context.profile.sportContext?.primarySport ?? 'general') as MobilitySportContext
  const phase = mapPhase(context.week.phase) as MobilityPhase
  const result = selectMobilitySession({
    primarySport,
    phase,
    recentSessionIds: [],
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
  })
  session.mobilityDetails = normalizeMobilityDetails({
    focusAreas: result.recommendedFocus,
    context: 'full_body' as const,
    targetStructure: result.session.typicalStructure,
  })
}

function completeCyclingDetails(session: CoachSessionProposal, context: RepairContext): void {
  const phase = mapPhase(context.week.phase) as CyclingPhase
  const role = deriveCyclingRole(context)
  const sportProfile = deriveCyclingSportProfile(context)
  const result = selectCyclingSession({
    phase,
    role,
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    sportProfile,
    recentSessionIds: [],
  })
  session.cyclingDetails = {
    sessionCategory: result.session.category,
    sessionFamily: result.session.family,
    targetStructure: result.session.structure,
    intensityReference: result.session.intensity,
    executionNotes: result.session.notes,
  }
}

function normalizeCompetitionTaperLoad(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  if (context.week.phase !== 'taper' && context.week.phase !== 'race') return sessions

  const cappedSessions = sessions.map((session) => {
    if (isSquashRaceEventAnchorCandidate(session, context) && isDeclaredSquashMatchSession(session)) {
      return session
    }
    const daysToEvent = daysBetween(session.date, context.plan.endDate)
    const finalWeek = daysToEvent <= 6
    const caps = getTaperSessionCaps(session.sessionType, finalWeek)
    const durationMin = Math.min(session.durationMin, caps.durationMin)
    const rpe = session.rpe == null ? caps.rpe : Math.min(session.rpe, caps.rpe)

    const TAPER_LOAD_CAP = 70
    let exercises = session.exercises
    let loadCapped = false

    if (session.sessionType === 'strength' && session.exercises && session.exercises.length > 0) {
      const cappedExercises = session.exercises.map((ex) => {
        if (ex.targetPercent1RM != null && ex.targetPercent1RM > TAPER_LOAD_CAP) {
          const newWeight =
            ex.weight != null
              ? Math.round((ex.weight * TAPER_LOAD_CAP / ex.targetPercent1RM) / 2.5) * 2.5
              : ex.weight
          loadCapped = true
          return { ...ex, targetPercent1RM: TAPER_LOAD_CAP, weight: newWeight }
        }
        return ex
      })
      if (loadCapped) exercises = cappedExercises
    }

    if (durationMin === session.durationMin && rpe === session.rpe && !loadCapped) return session

    recordRepair(meta, 'corrective', sessionKeyOf(session))

    if (durationMin !== session.durationMin || rpe !== session.rpe) {
      meta.warnings.push({
        code: 'taper_load_reduced',
        message: `Se redujo carga de "${session.title}" para proteger frescura en taper.`,
        sessionDate: session.date,
      })
    }

    if (loadCapped) {
      meta.warnings.push({
        code: 'taper_load_capped',
        message: `Se limitó la intensidad de ejercicios de fuerza en "${session.title}" al 70% para proteger frescura en taper.`,
        sessionDate: session.date,
      })
    }

    return { ...session, durationMin, rpe, exercises }
  })

  if (context.week.phase !== 'taper' || !context.previousWeek || context.previousWeek.sessions.length === 0) {
    return cappedSessions
  }

  const previousLoad = calculateWeekLoad(context.previousWeek.sessions)
  const currentLoad = calculateWeekLoad(cappedSessions)
  const weeklyCap = previousLoad * 0.85
  if (previousLoad <= 0 || currentLoad <= weeklyCap) return cappedSessions

  const factor = weeklyCap / currentLoad
  recordRepair(meta, 'corrective')
  meta.warnings.push({
    code: 'taper_week_load_reduced',
    message: `Se redujo carga semanal taper para quedar bajo 85% de la semana previa.`,
  })

  return cappedSessions.map((session) => scaleSessionLoad(session, factor))
}

function calculateWeekLoad(sessions: CoachSessionProposal[]): number {
  return sessions.reduce((total, session) => total + session.durationMin * (session.rpe ?? 6), 0)
}

function scaleSessionLoad(session: CoachSessionProposal, factor: number): CoachSessionProposal {
  const minDuration = getMinimumSessionDuration(session.sessionType)
  const scaledDuration = Math.max(minDuration, Math.round((session.durationMin * factor) / 5) * 5)
  const scaledRpe = session.rpe == null
    ? session.rpe
    : Math.max(getMinimumSessionRpe(session.sessionType), Math.min(session.rpe, Math.round(session.rpe * Math.sqrt(factor))))

  return {
    ...session,
    durationMin: scaledDuration,
    rpe: scaledRpe,
  }
}

function getMinimumSessionDuration(sessionType: CoachSessionProposal['sessionType']): number {
  switch (sessionType) {
    case 'squash': return 25
    case 'strength': return 25
    case 'mobility':
    case 'recovery': return 20
    default: return 20
  }
}

function getMinimumSessionRpe(sessionType: CoachSessionProposal['sessionType']): number {
  switch (sessionType) {
    case 'squash': return 3
    case 'strength': return 3
    case 'mobility':
    case 'recovery': return 2
    default: return 2
  }
}

function getTaperSessionCaps(
  sessionType: CoachSessionProposal['sessionType'],
  finalWeek: boolean,
): { durationMin: number; rpe: number } {
  switch (sessionType) {
    case 'squash':
      return finalWeek ? { durationMin: 40, rpe: 5 } : { durationMin: 50, rpe: 6 }
    case 'strength':
      return finalWeek ? { durationMin: 30, rpe: 4 } : { durationMin: 40, rpe: 5 }
    case 'running':
    case 'cycling':
      return finalWeek ? { durationMin: 25, rpe: 3 } : { durationMin: 35, rpe: 4 }
    case 'mobility':
    case 'recovery':
      return finalWeek ? { durationMin: 25, rpe: 2 } : { durationMin: 30, rpe: 3 }
    default:
      return finalWeek ? { durationMin: 25, rpe: 3 } : { durationMin: 35, rpe: 4 }
  }
}

function normalizeSquashSupportAerobicLoad(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  if (getPrimarySport(context) !== 'squash') return sessions
  const phase = context.week.phase
  if (phase !== 'build' && phase !== 'peak' && phase !== 'taper') return sessions

  // Taper running is allowed but strictly capped: ≤25 min, RPE ≤3, always Z2.
  // Build/peak running is softened to ≤40 min, RPE ≤4, Z2.
  const isTaper = phase === 'taper'

  return sessions.map((session) => {
    if (session.sessionType !== 'running' && session.sessionType !== 'cycling') return session

    const policy = resolveRunningSupportPolicy({ primarySport: getPrimarySport(context), phase })
    const durationMin = Math.min(session.durationMin, policy.durationCap)
    const rpe = Math.min(session.rpe ?? (isTaper ? 3 : 4), isTaper ? 3 : 4)

    if (session.sessionType === 'running') {
      const needsRepair = session.runningType !== 'z2'
        || session.durationMin !== durationMin
        || session.rpe !== rpe
        || session.intervalStructure == null
      if (!needsRepair) return session

      recordRepair(meta, 'corrective', sessionKeyOf(session))
      meta.warnings.push({
        code: 'squash_support_running_softened',
        message: isTaper
          ? `Se ajustó "${session.title}" a Z2 muy corto (taper): ≤25 min, RPE ≤3.`
          : `Se transformó "${session.title}" en Z2 corto para evitar interferencia con squash.`,
        sessionDate: session.date,
      })

      const taperTitle = 'Activación Aeróbica - Recuperación Taper'
      const buildTitle = 'Rodaje Z2 - Soporte Squash'
      const needsTitleChange = isTaper || /tempo|interval|largo|long/i.test(session.title)
      const newTitle = needsTitleChange ? (isTaper ? taperTitle : buildTitle) : session.title

      return {
        ...session,
        title: newTitle,
        objective: isTaper
          ? 'Activación aeróbica muy suave para mantener la circulación sin generar fatiga antes de la competencia.'
          : 'Sumar soporte aeróbico suave sin interferir con la calidad específica de squash.',
        durationMin,
        rpe,
        runningType: 'z2',
        targetPaceMin: undefined,
        targetPaceMax: undefined,
        targetHrMin: undefined,
        targetHrMax: undefined,
        intervalStructure: undefined, runningTemplateRef: undefined, runningSelectionReason: undefined,
      }
    }

    if (session.durationMin === durationMin && session.rpe === rpe) return session

    recordRepair(meta, 'corrective', sessionKeyOf(session))
    meta.warnings.push({
      code: 'squash_support_cycling_softened',
      message: `Se redujo "${session.title}" para que el ciclismo sea soporte y no carga principal.`,
      sessionDate: session.date,
    })

    return {
      ...session,
      durationMin,
      rpe,
      objective: 'Soporte aeróbico de baja interferencia para sostener frescura en squash.',
      cyclingDetails: session.cyclingDetails
        ? {
            ...session.cyclingDetails,
            intensityReference: 'low',
            executionNotes: 'Mantener sensación conversacional; no cerrar fuerte ni buscar adaptación principal.',
          }
        : session.cyclingDetails,
    }
  })
}

function ensureTargetRunningSupportSession(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const runningLoad = context.week.targetLoadBySport.running ?? 0
  if (runningLoad <= 0) return sessions
  if (!getAllowedSports(context).has('running')) return sessions
  if (context.week.phase === 'race' || context.week.phase === 'transition') return sessions
  if (sessions.some((session) => session.sessionType === 'running')) return sessions

  const expected = getExpectedSessionsForPlanWeek(context.plan, context.week)
  const allowedDates = getAllowedDatesInWeek(context)
  const next = [...sessions]

  if (next.length < expected) {
    const available = findNearestAvailableDate(allowedDates, next, 'AM', undefined, context.wizardConfig)
    if (!available) return sessions
    const running = buildSupportRunningSession(available.date, available.timeBlock, context)
    next.push(running)
    meta.addedFallbackCount++
    recordRepair(meta, 'structural', sessionKeyOf(running))
    meta.warnings.push({
      code: 'running_support_materialized',
      message: `Se agregó running real porque la semana tenía carga objetivo running=${runningLoad}.`,
      sessionDate: running.date,
    })
    return next.sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
  }

  const replacementIndex = findRunningSupportReplacementIndex(next, context)
  if (replacementIndex === -1) return sessions

  const replaced = next[replacementIndex]!
  next[replacementIndex] = buildSupportRunningSession(replaced.date, replaced.timeBlock, context, replaced.durationMin)
  recordRepair(meta, 'structural', sessionKeyOf(next[replacementIndex]))
  meta.warnings.push({
    code: 'running_support_materialized',
    message: `Se reemplazó "${replaced.title}" por running real porque la semana tenía carga objetivo running=${runningLoad}.`,
    sessionDate: replaced.date,
  })

  return next.sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

function findRunningSupportReplacementIndex(
  sessions: CoachSessionProposal[],
  context: RepairContext,
): number {
  // En taper, movilidad y recovery son contenido intencional (la regla de taper
  // las prioriza); no las sacrificamos para materializar running de soporte.
  const accessoryOrder = context.week.phase === 'taper'
    ? ['cycling', 'nutrition']
    : ['recovery', 'nutrition', 'mobility', 'cycling']
  for (const sport of accessoryOrder) {
    const index = sessions.findIndex((session) => session.sessionType === sport)
    if (index !== -1) return index
  }

  const primarySport = getPrimarySport(context)
  const primaryCount = sessions.filter((session) => session.sessionType === primarySport).length
  const minimumPrimary = minimumPrimarySessionsForWeek(context)
  if (primarySport === 'squash' && primaryCount > minimumPrimary) {
    const aerobicSquash = sessions.findIndex((session) =>
      session.sessionType === 'squash'
      && (session.squashDetails?.drills ?? []).some((drill) => isGenericAerobicSquashDrill(drill.name)),
    )
    if (aerobicSquash !== -1) return aerobicSquash

    return sessions.findIndex((session) => session.sessionType === 'squash')
  }

  // En taper, si no hay accesorio sacrificable preferimos no materializar running
  // antes que romper movilidad/recovery; el soporte aeróbico ya es opcional aquí.
  if (context.week.phase === 'taper') return -1

  return sessions.findIndex((session) => session.sessionType !== primarySport && session.sessionType !== 'strength')
}

function buildSupportRunningSession(
  date: string,
  timeBlock: 'AM' | 'PM',
  context: RepairContext,
  replacedDurationMin?: number,
): CoachSessionProposal {
  const isTaper = context.week.phase === 'taper'
  const durationMin = Math.min(replacedDurationMin ?? context.wizardConfig.sessionDurationMins, isTaper ? 25 : 40)
  const session: CoachSessionProposal = {
    date,
    timeBlock,
    sessionType: 'running',
    title: isTaper ? 'Activación Aeróbica - Recuperación Taper' : 'Rodaje Z2 - Soporte Squash',
    durationMin,
    rpe: isTaper ? 3 : 4,
    objective: isTaper
      ? 'Activación aeróbica muy suave para mantener circulación sin fatiga residual.'
      : 'Materializar el soporte aeróbico objetivo con baja interferencia para squash.',
    runningType: 'z2',
    intervalStructure: undefined, runningTemplateRef: undefined, runningSelectionReason: undefined,
  }

  try {
    completeRunningDetails(session, context)
  } catch {
    // La estructura Z2 mínima ya queda cargada arriba.
  }

  return session
}

function daysBetween(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00.000Z`).getTime()
  const to = new Date(`${toDate}T00:00:00.000Z`).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.POSITIVE_INFINITY
  return Math.round((to - from) / (24 * 60 * 60 * 1000))
}

// ─── 7. Balance session count ───────────────────────────────────────────────

function balanceSessionCount(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const expected = getExpectedSessionsForPlanWeek(context.plan, context.week)
  let result = [...sessions]

  // Trim excess: remove least important first (recovery > mobility > complementary)
  if (result.length > expected) {
    const trimPriority = getTrimPriority(context)
    const primarySport = getPrimarySport(context)
    result.sort((a, b) => {
      const anchorDifference = Number(isSquashRaceEventAnchorCandidate(a, context))
        - Number(isSquashRaceEventAnchorCandidate(b, context))
      if (anchorDifference !== 0) return anchorDifference
      const pa = trimPriority[a.sessionType] ?? (a.sessionType === primarySport ? 10 : 5)
      const pb = trimPriority[b.sessionType] ?? (b.sessionType === primarySport ? 10 : 5)
      return pa - pb
    })
    const trimmed = result.length - expected
    result = result.slice(trimmed)
    meta.droppedSessionCount += trimmed
    meta.warnings.push({ code: 'trimmed_excess', message: `Se recortaron ${trimmed} sesiones excedentes.` })
    // Re-sort by date+timeBlock
    result.sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
  }

  // Add fallback sessions (max 2)
  if (result.length < expected) {
    const diff = expected - result.length
    const maxFallback = Math.min(diff, 2)
    const allowedDates = getAllowedDatesInWeek(context)
    const primarySport = getPrimarySport(context)
    const primaryCount = result.filter((s) => s.sessionType === primarySport).length
    const minimumPrimary = minimumPrimarySessionsForWeek(context)

    for (let i = 0; i < maxFallback; i++) {
      const available = findNearestAvailableDate(allowedDates, result, 'AM', undefined, context.wizardConfig)
      if (!available) break

      const needPrimary = i === 0 && primarySport && primaryCount < minimumPrimary
      const fallback = needPrimary
        ? buildPrimaryFallbackSession(primarySport, available.date, context, result)
        : buildMobilityFallbackSession(available.date, context)

      fallback.timeBlock = available.timeBlock

      result.push(fallback)
      meta.addedFallbackCount++
      // Taxonomía solamente: este sitio nunca incrementó repairedSessionCount,
      // y hacerlo ahora cambiaría la semántica y telemetría legacy.
      recordTaxonomyOnly(meta, 'structural', sessionKeyOf(fallback))
    }

    if (meta.addedFallbackCount > 0) {
      meta.warnings.push({ code: 'added_fallback', message: `Se agregaron ${meta.addedFallbackCount} sesiones fallback para completar la semana.` })
    }

    result.sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
  }

  return result
}

function getTrimPriority(context: RepairContext): Record<string, number> {
  if (context.week.phase === 'taper' || context.week.phase === 'race') {
    return {
      running: 0,
      cycling: 0,
      recovery: 1,
      nutrition: 2,
      mobility: 3,
      strength: 4,
    }
  }

  return {
    recovery: 0,
    nutrition: 1,
    mobility: 2,
  }
}

function buildMobilityFallbackSession(date: string, context: RepairContext): CoachSessionProposal {
  const session: CoachSessionProposal = {
    date,
    timeBlock: 'AM',
    sessionType: 'mobility',
    title: 'Movilidad de recuperación',
    durationMin: 30,
    rpe: 3,
    objective: 'Mantener rango de movimiento y facilitar recuperación.',
  }
  try {
    completeMobilityDetails(session, context)
  } catch { /* leave without details; validator will flag */ }
  return session
}

function buildPrimaryFallbackSession(
  sport: string,
  date: string,
  context: RepairContext,
  currentSessions: CoachSessionProposal[] = [],
): CoachSessionProposal {
  const session: CoachSessionProposal = {
    date,
    timeBlock: 'AM',
    sessionType: sport as CoachSessionProposal['sessionType'],
    title: `${sport.charAt(0).toUpperCase() + sport.slice(1)} técnico ligero`,
    durationMin: 45,
    rpe: 4,
    objective: `Sesión técnica ligera de ${sport} para mantener presencia del deporte principal.`,
    subtype: sport === 'squash' ? 'light' : undefined,
  }
  try {
    switch (sport) {
      case 'squash': completeSquashDetails(session, context, currentSessions.flatMap(extractSquashDrillNames)); break
      case 'running': completeRunningDetails(session, context); break
      case 'strength': completeStrengthExercises(session, context); break
      case 'cycling': completeCyclingDetails(session, context); break
    }
  } catch { /* leave without details */ }
  return session
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function minimumPrimarySessionsForWeek(context: RepairContext): number {
  const primarySport = getPrimarySport(context)
  const expected = getExpectedSessionsForPlanWeek(context.plan, context.week)
  if (!primarySport || expected <= 0 || context.week.phase === 'transition') return 0
  if (primarySport === 'squash' && (context.week.phase === 'build' || context.week.phase === 'peak')) {
    const loadedSupportSports = (['running', 'strength', 'cycling', 'mobility'] as SupportedSport[])
      .filter((sport) => (context.week.targetLoadBySport[sport] ?? 0) > 0)
      .length
    if (loadedSupportSports >= 2 && expected >= 4) {
      return Math.max(2, Math.floor(expected / 2))
    }
    return expected >= 4
      ? Math.min(expected, Math.floor(expected / 2) + 1)
      : Math.min(expected, 2)
  }
  if (primarySport === 'squash' && (context.week.phase === 'taper' || context.week.phase === 'race')) {
    return expected >= 4 ? 2 : Math.min(expected, 1)
  }
  return Math.min(expected, 1)
}

function ensurePrimarySportMinimum(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const primarySport = getPrimarySport(context)
  const minimum = minimumPrimarySessionsForWeek(context)
  if (!primarySport || minimum <= 0) return sessions

  let primaryCount = sessions.filter((session) => session.sessionType === primarySport).length
  if (primaryCount >= minimum) return sessions

  const next = [...sessions]
  const replacementOrder = ['mobility', 'recovery', 'nutrition', 'strength', 'running', 'cycling']

  for (const sport of replacementOrder) {
    for (let i = 0; i < next.length && primaryCount < minimum; i++) {
      if (next[i].sessionType === primarySport || next[i].sessionType !== sport) continue
      const replacement = buildPrimaryFallbackSession(primarySport, next[i].date, context, next)
      replacement.timeBlock = next[i].timeBlock
      next[i] = {
        ...replacement,
        title: replacement.title,
        durationMin: Math.max(30, Math.min(next[i].durationMin, replacement.durationMin)),
      }
      primaryCount++
      recordRepair(meta, 'structural', sessionKeyOf(next[i]))
    }
  }

  if (primaryCount >= minimum) {
    meta.warnings.push({
      code: 'primary_sport_minimum_repaired',
      message: `Se ajustaron sesiones accesorias para cumplir el mínimo de ${primarySport}.`,
    })
  }

  return next
}

// In build/peak, the primary sport should have strictly more sessions than the
// accessory work combined. `ensurePrimarySportMinimum` only guarantees a floor,
// which can tie with support and trip `week.primary_sport.underweighted`. Here we
// convert the lowest-value accessory sessions into primary work until the primary
// dominates, mirroring the validator rule. If no accessory is convertible, we leave
// the week as-is and let the warning stand.
function ensurePrimarySportDominance(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  if (context.week.phase !== 'build' && context.week.phase !== 'peak') return sessions
  const primarySport = getPrimarySport(context)
  if (!primarySport) return sessions

  const next = [...sessions]
  const primaryCount = () => next.filter((session) => session.sessionType === primarySport).length
  const supportCount = () => next.length - primaryCount()

  // Don't fabricate dominance out of a week with no primary sessions — that case is
  // handled by ensurePrimarySportMinimum / the missing-sport validation.
  if (primaryCount() === 0) return sessions
  if (primaryCount() > supportCount()) return sessions

  const replacementOrder = ['mobility', 'recovery', 'nutrition', 'strength', 'running', 'cycling']
  let converted = 0

  for (const sport of replacementOrder) {
    for (let i = 0; i < next.length && primaryCount() <= supportCount(); i++) {
      if (next[i].sessionType !== sport) continue
      const replacement = buildPrimaryFallbackSession(primarySport, next[i].date, context, next)
      replacement.timeBlock = next[i].timeBlock
      next[i] = {
        ...replacement,
        durationMin: Math.max(30, Math.min(next[i].durationMin, replacement.durationMin)),
      }
      recordRepair(meta, 'structural', sessionKeyOf(next[i]))
      converted++
    }
    if (primaryCount() > supportCount()) break
  }

  if (converted > 0) {
    meta.warnings.push({
      code: 'primary_sport_dominance_repaired',
      message: `Se reconvirtieron ${converted} sesión(es) accesoria(s) en ${primarySport} para que domine la fase ${context.week.phase}.`,
    })
  }

  return next
}

// ─── 12. Double session utilization ─────────────────────────────────────────

function checkDoubleSessionUtilization(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  if (!context.wizardConfig.allowDoubleSession) return sessions
  if (context.week.phase === 'taper' || context.week.phase === 'race' || context.week.phase === 'transition') return sessions
  const doubleDays = context.wizardConfig.doubleSessionDays
  if (!doubleDays || doubleDays.length < 2) return sessions

  const allowedDates = getAllowedDatesInWeek(context)
  const doubleDayDates = allowedDates.filter((d) => canUseDoubleSessionOnDate(d, context.wizardConfig))
  if (doubleDayDates.length === 0) return sessions

  // Build date → sessions map
  const sessionsByDate = new Map<string, CoachSessionProposal[]>()
  for (const s of sessions) {
    const list = sessionsByDate.get(s.date) ?? []
    list.push(s)
    sessionsByDate.set(s.date, list)
  }

  const actualDoubles = doubleDayDates.filter((d) => (sessionsByDate.get(d)?.length ?? 0) >= 2).length
  // Real need: only the sessions that do not fit one-per-day force a double.
  // `allowedDates` (not `trainingDays`) is the right denominator — it accounts for
  // partial weeks and is the same set `doubleDayDates` is derived from.
  const expectedSessions = sessions.length
  const deficit = expectedSessions - allowedDates.length
  // Double days are permissions, not a target. Require them only when the final
  // session count cannot fit one-per-day, and never beyond eligible capacity.
  const requiredDoubles = Math.min(doubleDayDates.length, Math.max(0, deficit))
  if (requiredDoubles === 0) return sessions
  if (actualDoubles >= requiredDoubles) return sessions

  // Underutilized: best-effort relocation
  const result = [...sessions]
  let relocated = 0

  // Compute non-double training days so we can protect full-spread schedules
  const nonDoubleDayDates = allowedDates.filter((d) => !canUseDoubleSessionOnDate(d, context.wizardConfig))

  for (const doubleDayDate of doubleDayDates) {
    const onDoubleDay = sessionsByDate.get(doubleDayDate) ?? []
    if (onDoubleDay.length >= 2) continue // already a double

    const targetBlock: 'AM' | 'PM' = onDoubleDay.length === 0 ? 'AM' : 'PM'
    if (result.some((s) => s.date === doubleDayDate && s.timeBlock === targetBlock)) continue
    if (isSafetyBlockedSlot(meta, doubleDayDate, targetBlock)) continue

    // Guard: if every non-double training day already has a session, relocating
    // would create a gap — skip to avoid breaking a well-spread schedule.
    const allNonDoubleDaysCovered = nonDoubleDayDates.every((d) => (sessionsByDate.get(d)?.length ?? 0) >= 1)
    if (allNonDoubleDaysCovered) continue

    // Find a moveable session: on a non-double day, only session on that date
    const candidateIndex = result.findIndex((s) => {
      if (s.date === doubleDayDate) return false
      if (canUseDoubleSessionOnDate(s.date, context.wizardConfig)) return false // already on a double day
      const siblings = sessionsByDate.get(s.date) ?? []
      return siblings.length === 1 // sole session on that date — safe to move
    })
    if (candidateIndex === -1) continue

    const candidate = result[candidateIndex]!
    const moved = { ...candidate, date: doubleDayDate, timeBlock: targetBlock }
    result[candidateIndex] = moved

    // Update map
    sessionsByDate.delete(candidate.date)
    sessionsByDate.set(doubleDayDate, [...onDoubleDay, moved])
    relocated++
    meta.movedSessionCount++
  }

  meta.warnings.push({
    code: 'double_session_underutilized',
    message: `Solo ${actualDoubles}/${requiredDoubles} días dobles requeridos se usaron${relocated > 0 ? ` — se reubicaron ${relocated} sesión(es)` : ''}.`,
  })

  return result.sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

const HARD_SESSION_RPE_THRESHOLD = 8

/**
 * Dos sesiones duras de deportes DISTINTOS el mismo día son un error de
 * programación real: suman carga sistémica sin el estímulo específico que
 * justificaría un doble. Dos duras del MISMO deporte no entran acá —un doble
 * de squash AM/PM es una decisión deportiva legítima y la cubre la política de
 * dobles, no esta regla.
 *
 * Que `ordered.slice(1)` no toque sesiones del mismo deporte depende de una
 * invariante del paso 4: `date|timeBlock` es único, así que un día llega a 5b
 * con dos sesiones como máximo. Con `sports.size >= 2` sobre dos sesiones, son
 * de deportes distintos por construcción y se mueve exactamente una. Está
 * fijada por `sameDayHardSessions.test.ts`; si el paso 4 llegara a admitir tres
 * sesiones en un día, este filtro tendría que volverse explícito por deporte.
 *
 * Se repara moviendo la sesión de MENOR carga objetivo (o, a igualdad, la que
 * no es del deporte principal), para no desarmar el estímulo principal del día.
 * Si no hay hueco, se conserva la sesión y se emite un warning distinto: perder
 * una sesión sería peor que dejar el conflicto, y el gate de calidad de la
 * Tarea 3 lo bloquea después.
 */
function separateSameDayHardCrossSportSessions(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const isHard = (session: CoachSessionProposal) => (session.rpe ?? 6) >= HARD_SESSION_RPE_THRESHOLD

  const byDate = new Map<string, CoachSessionProposal[]>()
  for (const session of sessions) {
    if (!isHard(session)) continue
    byDate.set(session.date, [...(byDate.get(session.date) ?? []), session])
  }

  const primarySport = getPrimarySport(context)
  const allowedDates = getAllowedDatesInWeek(context)
  let working = [...sessions]

  for (const [date, hardOnDate] of byDate) {
    const sports = new Set(hardOnDate.map((session) => session.sessionType))
    if (sports.size < 2) continue

    // Conserva la más importante del día; mueve el resto.
    const ordered = [...hardOnDate].sort((a, b) => {
      const aPrimary = a.sessionType === primarySport ? 1 : 0
      const bPrimary = b.sessionType === primarySport ? 1 : 0
      if (aPrimary !== bPrimary) return bPrimary - aPrimary
      return (b.durationMin ?? 0) - (a.durationMin ?? 0)
    })

    for (const session of ordered.slice(1)) {
      const others = working.filter((candidate) => candidate !== session)
      const slot = findNearestAvailableDate(
        allowedDates.filter((candidate) => candidate !== date && !others.some((other) =>
          other.date === candidate && isHard(other) && other.sessionType !== session.sessionType,
        )),
        others,
        session.timeBlock === 'PM' ? 'PM' : 'AM',
        date,
        context.wizardConfig,
      )
      if (!slot) {
        meta.warnings.push({
          code: 'same_day_hard_cross_sport_unresolved',
          message: `No hay día libre para separar dos sesiones duras de deportes distintos el ${date}; se conservan ambas.`,
          sessionDate: date,
        })
        continue
      }
      const targetHasHard = working.some(
        (candidate) => candidate !== session && candidate.date === slot.date && isHard(candidate)
          && candidate.sessionType !== session.sessionType,
      )
      if (targetHasHard) {
        meta.warnings.push({
          code: 'same_day_hard_cross_sport_unresolved',
          message: `No hay día libre sin otra dura para separar el ${date}; se conservan ambas.`,
          sessionDate: date,
        })
        continue
      }
      working = working.map((candidate) =>
        candidate === session
          ? { ...candidate, date: slot.date, timeBlock: slot.timeBlock }
          : candidate,
      )
      meta.movedSessionCount++
      recordRepair(meta, 'corrective', `${slot.date}|${slot.timeBlock}`)
      meta.warnings.push({
        code: 'same_day_hard_cross_sport',
        message: `Sesión dura de ${session.sessionType} movida de ${date} a ${slot.date}: ya había otra sesión dura de un deporte distinto ese día.`,
        sessionDate: slot.date,
      })
    }
  }

  return working
}

function getAllowedDatesInWeek(context: RepairContext): string[] {
  const weekStart = new Date(`${context.week.weekStartDate}T00:00:00.000Z`)
  const validRange = getPlanWeekDateRange(context.plan, context.week)
  const allowedDays = new Set(context.wizardConfig.trainingDays)
  const dayMapping: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000)
    const iso = d.toISOString().slice(0, 10)
    if (iso < validRange.startDate || iso > validRange.endDate) continue
    const dayOfWeek = dayMapping[d.getUTCDay()]
    if (allowedDays.has(dayOfWeek)) {
      dates.push(iso)
    }
  }
  return dates
}

function findNearestAvailableDate(
  allowedDates: string[],
  currentSessions: CoachSessionProposal[],
  preferredBlock: 'AM' | 'PM',
  referenceDate?: string,
  wizardConfig?: PlanWizardConfig,
  blockedSlots?: readonly StrengthSafetyBlockedSlot[],
): { date: string; timeBlock: 'AM' | 'PM' } | null {
  const occupied = new Set(currentSessions.map((s) => `${s.date}|${s.timeBlock}`))
  const occupiedDates = new Set(currentSessions.map((s) => s.date))
  const allowDoubleSession = wizardConfig?.allowDoubleSession ?? true
  // Sort by proximity to referenceDate if provided
  const sorted = referenceDate
    ? [...allowedDates].sort((a, b) => Math.abs(new Date(a).getTime() - new Date(referenceDate).getTime()) - Math.abs(new Date(b).getTime() - new Date(referenceDate).getTime()))
    : allowedDates

  for (const date of sorted) {
    const dateAlreadyOccupied = occupiedDates.has(date)
    const canDouble = allowDoubleSession && canUseDoubleSessionOnDate(date, wizardConfig)
    if (dateAlreadyOccupied && !canDouble) continue
    if (!occupied.has(`${date}|${preferredBlock}`)
      && !blockedSlots?.some((slot) => slot.date === date && slot.timeBlock === preferredBlock)) {
      return { date, timeBlock: preferredBlock }
    }
    const opposite = preferredBlock === 'AM' ? 'PM' : 'AM'
    if (canDouble && !occupied.has(`${date}|${opposite}`)
      && !blockedSlots?.some((slot) => slot.date === date && slot.timeBlock === opposite)) {
      return { date, timeBlock: opposite }
    }
  }
  return null
}

function canUseDoubleSessionOnDate(date: string, wizardConfig?: PlanWizardConfig): boolean {
  if (!wizardConfig?.allowDoubleSession) return false
  const doubleDays = wizardConfig.doubleSessionDays
  if (!doubleDays || doubleDays.length === 0) return true
  const day = isoDateToDayOfWeek(date)
  return Boolean(day && doubleDays.includes(day))
}

function isoDateToDayOfWeek(date: string): DayOfWeek | null {
  if (!isStrictISODate(date)) return null
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  const mapping: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return mapping[weekday] ?? null
}

function getAllowedSports(context: RepairContext): Set<string> {
  const fromMacro = context.plan.macroSnapshot.sportDetails.map((d) => d.sport) as string[]
  const fromWizard = context.wizardConfig.complementarySports as string[]
  // Always allow mobility and recovery
  return new Set([...fromMacro, ...fromWizard, 'mobility', 'recovery', 'nutrition'])
}

function getPrimarySport(context: RepairContext): string | undefined {
  return context.plan.macroSnapshot.sportDetails.find((d) => d.role === 'primary')?.sport
}

function fatigueToNumber(level: WizardFatigueLevel): number {
  const map: Record<WizardFatigueLevel, number> = { fresh: 2, normal: 5, loaded: 7, overloaded: 9 }
  return map[level] ?? 5
}

function mapPhase(phase: string): string {
  if (phase === 'race') return 'taper'
  if (phase === 'transition') return 'base'
  return phase
}

function mapStrengthPhase(phase: string): string {
  if (phase === 'transition') return 'base'
  return phase
}

/** @deprecated Usar `getWeekIndexInBlock` con los descriptores completos del plan. */
export function computeWeekIndexInBlock(input: {
  planPhases?: Array<{ startWeekIndex: number; endWeekIndex: number }>
  weekIndex: number
}): number {
  const containingPhase = input.planPhases?.find((phase) =>
    input.weekIndex >= phase.startWeekIndex && input.weekIndex <= phase.endWeekIndex,
  )

  if (!containingPhase) return 0
  return Math.max(0, input.weekIndex - containingPhase.startWeekIndex)
}

function getWeekIndexInBlock(context: RepairContext): number {
  const positions = resolveBlockPositions(getPlanPhaseDescriptors(context), getPlanWeekDescriptors(context))
  return positions.get(context.week.weekIndex)?.indexInBlock ?? 0
}

function getPlanWeekDescriptors(context: RepairContext): readonly PlanWeekDescriptor[] {
  return context.planWeekDescriptors?.length
    ? context.planWeekDescriptors
    : [
        { weekIndex: context.week.weekIndex, phase: context.week.phase },
        ...(context.previousWeek && context.previousWeek.weekIndex !== context.week.weekIndex
          ? [{ weekIndex: context.previousWeek.weekIndex, phase: context.previousWeek.phase }]
          : []),
      ]
}

function getPlanPhaseDescriptors(context: RepairContext): TrainingPlan['phases'] {
  return context.plan.phases ?? []
}

/**
 * Default cuando la sesión no declara modalidad ni trae un subtype que la
 * implique. `technical` es el tipo más frecuente de sesión de squash.
 *
 * Que este default se use es señal de un contrato incumplido, no un camino
 * normal: el prompt exige `squashKind` para toda sesión de squash. Una tasa
 * alta de `squash_kind_fallback` en telemetría es un bug de prompt o de
 * proveedor, y se investiga como tal.
 */
const DEFAULT_SQUASH_INTENT_KIND = 'technical' as const

function mapSubtypeToDesiredKind(subtype?: string) {
  if (!subtype) return undefined
  if (subtype === 'match' || subtype === 'competitive') return 'match' as const
  if (subtype === 'control') return 'control' as const
  if (subtype === 'training') return undefined // let selector decide
  return undefined
}

/**
 * Cascada de modalidad. Ningún paso lee `title`, `objective` ni `focusKey`.
 *
 * Reemplaza a `inferSquashDesiredKind`, que buscaba las subcadenas "control" y
 * "precision" en el texto visible: un objetivo que dijera "control de longitud"
 * convertía una sesión de partner en volumen en solitario.
 *
 * `subtype=training` no intenta adivinar: cae en el default determinista.
 */
function resolveSquashIntentKind(session: CoachSessionProposal): SquashSelectionDesiredKind {
  return resolveSquashIntent(session).kind
}

export type SquashIntentSource = 'declared' | 'legacy_subtype' | 'engine_default'

/**
 * Igual que `resolveSquashIntentKind`, pero informa de dónde salió la modalidad.
 * La fuente es lo que permite distinguir un contrato cumplido de uno incumplido:
 * `declared` es el camino esperado, y las otras dos son grados de degradación.
 */
function resolveSquashIntent(
  session: CoachSessionProposal,
): { kind: SquashSelectionDesiredKind; source: SquashIntentSource } {
  if (session.squashKind) return { kind: session.squashKind, source: 'declared' }
  const legacy = mapSubtypeToDesiredKind(session.subtype)
  if (legacy) return { kind: legacy, source: 'legacy_subtype' }
  return { kind: DEFAULT_SQUASH_INTENT_KIND, source: 'engine_default' }
}

function deriveRunningSportProfile(context: RepairContext): RunningSportProfile {
  const primary = context.profile.sportContext?.primarySport
  if (primary === 'running') return 'running_primary'
  if (primary) return 'sport_support'
  return 'hybrid'
}

function deriveStrengthSportProfile(context: RepairContext): StrengthSportProfile {
  const primary = context.profile.sportContext?.primarySport
  if (primary === 'strength') return 'strength_primary'
  if (primary) return 'sport_support'
  return 'hybrid'
}

function deriveCompetitiveLevel(context: RepairContext): GoalEventLevel | undefined {
  const goalEventId = context.wizardConfig.goalEventId
  const event = context.profile.goalEvents?.find((item) => item.id === goalEventId)
    ?? context.profile.goalEvents?.find((item) => item.priority === 'primary')
    ?? context.profile.goalEvents?.[0]
  return event?.competitiveLevel
}

function buildLevelAwareGoal(context: RepairContext, goal: string): string {
  const competitiveLevel = deriveCompetitiveLevel(context)
  const fitness = context.wizardConfig.currentFitnessLevel
  const parts = [goal]
  if (competitiveLevel) parts.push(`nivel competitivo ${competitiveLevel}`)
  parts.push(`fitness ${fitness}`)
  if (competitiveLevel === 'elite' || competitiveLevel === 'masters') {
    parts.push('priorizar transferencia competitiva, presion, tactica y especificidad')
  }
  if (fitness === 'low' || fitness === 'returning') {
    parts.push('priorizar retorno seguro, control tecnico y baja complejidad')
  }
  return parts.filter(Boolean).join(' · ')
}

function deriveCyclingRole(context: RepairContext): CyclingRole {
  const primary = context.profile.sportContext?.primarySport
  return primary === 'cycling' ? 'primary' : 'support'
}

function deriveCyclingSportProfile(context: RepairContext): CyclingSportProfile {
  const primary = context.profile.sportContext?.primarySport
  if (primary === 'cycling') return 'cycling_primary'
  if (primary) return 'sport_support'
  return 'hybrid'
}

function extractRecentSquashDrills(previousWeek?: TrainingPlanWeek): string[] {
  if (!previousWeek) return []
  return previousWeek.sessions
    .filter((s) => s.sessionType === 'squash' && s.squashDetails?.drills)
    .flatMap((s) => s.squashDetails!.drills.map((d) => d.name))
}

function extractSquashDrillNames(session: CoachSessionProposal): string[] {
  const details = session.squashDetails
  if (!details) return []
  return [
    ...(details.drills ?? []).map((drill) => drill.name),
    ...((details.blocks ?? []).flatMap((block) => block.drills.map((drill) => drill.name))),
  ]
}

function extractRecentRunningSessions(previousWeek?: TrainingPlanWeek): string[] {
  if (!previousWeek) return []
  return previousWeek.sessions
    .filter((s) => s.sessionType === 'running')
    .map((s) => s.runningType ?? 'easy_aerobic')
}

function extractRecentStrengthExercises(previousWeek?: TrainingPlanWeek): string[] {
  if (!previousWeek) return []
  return previousWeek.sessions
    .filter((s) => s.sessionType === 'strength' && s.exercises)
    .flatMap((s) => s.exercises!.map(getStrengthExerciseKey))
}
