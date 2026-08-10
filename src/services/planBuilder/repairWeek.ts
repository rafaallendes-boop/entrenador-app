import type {
  AthleteProfile,
  CoachExerciseProposal,
  CoachSessionProposal,
  DayOfWeek,
  GoalEventLevel,
  PlanWizardConfig,
  RunningIntervalStructure,
  RunningType,
  SquashDrill,
  SquashSessionBlock,
  SquashSessionBlockKind,
  SquashSessionKind,
  SquashTrainingFocus,
  SupportedSport,
  WizardFatigueLevel,
} from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'
import { getExpectedSessionsForPlanWeek, getPlanWeekDateRange, isDateInsidePlanWeekRange } from './dateRange'
import {
  selectSquashDrillReplacement,
  selectSquashDrills,
  type SquashRelaxationLevel,
  type SquashSelectionPhase,
} from '../training/drillSelector'
import { findSquashDrillByName, isControlDrill, isShadowsDrill, isSquashMatchDrill, normalizeSquashDrillKey, orderSquashBlocksForSession, resolveDrillExecutionMode, resolveSquashDrillKind, toSquashDrill } from '../training/drillLibrary'
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
  selectStrengthReplacement,
  selectStrengthSession,
  type StrengthContext,
  type StrengthPhase,
  type StrengthSelectionExercise,
  type StrengthSportProfile,
} from '../training/strengthSelector'
import { enhanceStrengthSessionExercises, resolveStrengthExerciseBlock } from '../training/strengthSessionStructure'
import { planSupersetGroups, shouldApplySupersetPolicy } from '../training/supersetPolicy'
import { type ExperienceLevel } from '../training/exerciseLibrary'
import { getStrengthExerciseKey, toStrengthProposal } from '../training/strengthExerciseProposal'
import { selectMobilitySession, type MobilityPhase } from '../training/mobilitySelector'
import { selectCyclingSession, type CyclingPhase, type CyclingSportProfile } from '../training/cyclingSelector'
import { normalizeMobilityDetails, type MobilitySportContext } from '../training/mobilitySessionLibrary'
import type { CyclingRole } from '../training/cyclingSessionLibrary'
import { buildAthleteParameters } from './profileAdapter'
import { resolveBlockPositions, type PlanWeekDescriptor } from './blockIdentity'
import {
  collectAllStrengthKeys,
  collectCountableKeys,
  isCountableRole,
  resolveSessionStrengthRoles,
} from './strengthRoleContract'
import { isReadyWeek } from './weekUtils'
import {
  createRepairTaxonomyMeta,
  recordRepairAction,
  type RepairActionCategory,
  type RepairTaxonomyMeta,
} from './repairTaxonomy'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RepairContext {
  plan: TrainingPlan
  week: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  previousWeek?: TrainingPlanWeek
  /** Descriptores ordenados de todas las semanas. El fallback unitario conserva compatibilidad de repair aislado. */
  planWeekDescriptors?: readonly PlanWeekDescriptor[]
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
  /** Política determinista de accesorios; undefined significa no aplicable. */
  strengthAccessoryRotationActionCount?: number
  strengthAccessoryRotationSessionsAffected?: number
  squashDrillRotationActionCount?: number
  squashDrillRotationSessionsAffected?: number
  squashDrillRotationOmittedCount?: number
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

export interface RepairFailure {
  errorClass: 'quality.squash.signature_uniqueness_unresolved'
  message: string
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
  return `${session.date ?? '?'}|${session.timeBlock ?? '?'}`
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

  if (rawSessions.length === 0) {
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

  // 6. Complete sport details (best-effort)
  completeSportDetails(sessions, context, meta)
  sanitizeSquashDrillSets(sessions, context, meta)
  normalizeSquashSemanticMetadata(sessions, meta, context)
  normalizeLateTaperSquashMatchPlay(sessions, context, meta)
  sessions = ensureSquashCompetitionMatchExposure(sessions, context, meta)

  // 7. Keep squash drill/block timing aligned with the session duration.
  normalizeSquashDurationConsistency(sessions, meta)

  // 8. Keep taper/race weeks fresh even when model output is too voluminous.
  sessions = normalizeCompetitionTaperLoad(sessions, context, meta)

  // 9. Taper caps can shorten sessions, so re-fit nested squash blocks after caps.
  normalizeSquashDurationConsistency(sessions, meta)

  // 10. Keep aerobic support non-interfering when squash is the primary target.
  sessions = normalizeSquashSupportAerobicLoad(sessions, context, meta)

  // 10b. If the macro allocated running load, it must exist as running, not as
  // an aerobic-looking squash drill.
  sessions = ensureTargetRunningSupportSession(sessions, context, meta)

  // 11. Balance session count
  sessions = balanceSessionCount(sessions, context, meta)

  // 12. Preserve primary-sport minimums after fallback/trim decisions
  sessions = ensurePrimarySportMinimum(sessions, context, meta)

  // 12b. In build/peak the primary sport must outweigh accessory work
  sessions = ensurePrimarySportDominance(sessions, context, meta)

  // 13. Alinear metadatos antes de proyectar una única asignación canónica.
  normalizeSquashSemanticMetadata(sessions, meta, context)
  normalizeLateTaperSquashMatchPlay(sessions, context, meta)
  sessions = ensureSquashCompetitionMatchExposure(sessions, context, meta)

  // 13b. Política de rotación y corrección de firmas comparten una sola pasada.
  const squashNormalization = normalizeSquashSessionContent(sessions, context, meta)
  if (squashNormalization.failure) {
    measureSquashMatchRoles(sessions, meta)
    return { sessions: [], meta, failure: squashNormalization.failure }
  }
  ensureSquashDrillGuidance(sessions)
  normalizeSquashDurationConsistency(sessions, meta)

  // 14. Una única proyección canónica de fuerza evita que dos mutadores se
  // deshagan entre sí y mantiene la segunda pasada como punto fijo.
  normalizeStrengthSessions(sessions, context, meta)

  // 15. Check double session utilization
  sessions = enforceDoubleSessionDayConstraints(sessions, context, meta)
  sessions = checkDoubleSessionUtilization(sessions, context, meta)

  measureSquashMatchRoles(sessions, meta)
  return { sessions, meta }
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

function completeSportDetails(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): void {
  const currentWeekSquashDrills = extractRecentSquashDrills(context.previousWeek)
  const currentWeekStrengthExercises = extractRecentStrengthExercises(context.previousWeek)

  for (const session of sessions) {
    try {
      switch (session.sessionType) {
        case 'squash':
          if (!hasValidSquashDetails(session)) {
            completeSquashDetails(session, context, currentWeekSquashDrills)
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
        case 'strength':
          if (!session.exercises || session.exercises.length === 0) {
            completeStrengthExercises(session, context, currentWeekStrengthExercises)
            recordRepair(meta, 'hydration', sessionKeyOf(session))
          } else if (enhanceStrengthSessionDetails(session, context, currentWeekStrengthExercises)) {
            recordRepair(meta, 'corrective', sessionKeyOf(session))
          }
          currentWeekStrengthExercises.push(...(session.exercises ?? []).map((exercise) => exercise.name))
          break
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
  const selectionContext = {
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    phase,
    recentDrills,
    goal: buildLevelAwareGoal(context, context.profile.mainGoal ?? ''),
    competitionSoon: false,
    competitiveLevel: deriveCompetitiveLevel(context),
    partnerAvailability: context.wizardConfig.partnerAvailability ?? 'either',
    desiredKind: mapSubtypeToDesiredKind(session.subtype) ?? inferSquashDesiredKind(session, recentDrills),
  }
  const selection = withoutCompetitiveMatchContent(selectSquashDrills(selectionContext))
  if (selection.drills.length > 0) {
    applySquashSelection(session, selection)
    return
  }

  // Si el selector solo devolvió match drills para una sesión no dedicada,
  // completar con técnica antes que inventar un finisher.
  applySquashSelection(session, withoutCompetitiveMatchContent(selectSquashDrills({
    ...selectionContext,
    desiredKind: 'technical',
  })))
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
    desiredKind: mapSubtypeToDesiredKind(session.subtype) ?? inferSquashDesiredKind(session, recentDrills),
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
  if (!shouldEnsureSquashCompetitionMatch(context)) return sessions
  const squashSessions = sessions.filter((session) => session.sessionType === 'squash')
  if (squashSessions.length === 0) return sessions
  if (squashSessions.some((session) =>
    hasCompetitiveExposureContent(session) && isSafeSquashCompetitionExposureDate(session.date, context)
  )) return sessions

  const safeSquashSessions = squashSessions.filter((session) => isSafeSquashCompetitionExposureDate(session.date, context))
  if (context.week.phase === 'taper' && safeSquashSessions.length === 0) return sessions

  // Preferir AGREGAR una sesión de match si la semana tiene cupo, para no
  // descartar una sesión de squash diseñada (p.ej. pressure drills) reescribiéndola.
  const expected = getExpectedSessionsForPlanWeek(context.plan, context.week)
  if (sessions.length < expected) {
    const next = [...sessions]
    const candidateDates = getAllowedDatesInWeek(context).filter((date) => isSafeSquashCompetitionExposureDate(date, context))
    const available = findNearestAvailableDate(candidateDates, next, 'PM', undefined, context.wizardConfig)
    if (available) {
      const added = buildSquashCompetitionMatchSession(available.date, available.timeBlock, context)
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
  const candidate = safeSquashSessions.find(isSquashMatchIntent)
    ?? safeSquashSessions.find((session) => session.squashDetails?.sessionKind === 'match')
    ?? [...safeSquashSessions].sort((a, b) => (b.rpe ?? 6) - (a.rpe ?? 6))[0]

  if (!candidate) return sessions

  applySquashMatchDetails(
    candidate,
    'competition_match',
    context.week.weekIndex + Math.max(0, squashSessions.indexOf(candidate)),
  )
  recordRepair(meta, 'structural', sessionKeyOf(candidate))
  meta.warnings.push({
    code: 'squash_competition_match_added',
    message: `Se aseguró exposición competitiva real de squash en fase ${context.week.phase}.`,
    sessionDate: candidate.date,
  })
  return sessions
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
): CoachSessionProposal {
  const session: CoachSessionProposal = {
    date,
    timeBlock,
    sessionType: 'squash',
    subtype: 'competitive',
    title: 'Squash - Match Play Competitivo',
    durationMin: Math.min(context.wizardConfig.sessionDurationMins, 55),
    rpe: 7,
    objective: 'Competir con marcador real, presión de cierre y rutinas entre puntos.',
  }
  applySquashMatchDetails(session, 'competition_match', context.week.weekIndex)
  return session
}

function shouldEnsureSquashCompetitionMatch(context: RepairContext): boolean {
  if (getPrimarySport(context) !== 'squash') return false
  if (context.week.phase !== 'peak' && context.week.phase !== 'taper' && context.week.phase !== 'race') return false
  if (getExpectedSessionsForPlanWeek(context.plan, context.week) < 3 && context.week.phase !== 'race') return false

  const level = deriveCompetitiveLevel(context)
  if (level === 'elite' || level === 'masters' || level === 'competitive') return true

  const primaryEvent = context.profile.goalEvents?.find((event) => event.id === context.wizardConfig.goalEventId)
    ?? context.profile.goalEvents?.find((event) => event.priority === 'primary')
  return primaryEvent?.sport === 'squash'
}

// Single source of truth for "event day", aligned with the validator
// (`validateSquashCompetitionReadiness` uses macroSnapshot.goalEventDate). Falls
// back to the plan end date if the macro snapshot lacks it.
function getSquashEventDate(context: RepairContext): string {
  return context.plan.macroSnapshot?.goalEventDate ?? context.plan.endDate
}

function isSafeSquashCompetitionExposureDate(date: string, context: RepairContext): boolean {
  if (context.week.phase !== 'taper' && context.week.phase !== 'race') return true
  return daysBetween(date, getSquashEventDate(context)) >= 3
}

function normalizeLateTaperSquashMatchPlay(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): void {
  if (context.week.phase !== 'taper' && context.week.phase !== 'race') return

  const eventDate = getSquashEventDate(context)
  for (const session of sessions) {
    if (session.sessionType !== 'squash') continue
    // The event day itself IS the competition — never down-grade that session to
    // activation/control; the validator (squash.race_day) expects a match there.
    if (session.date === eventDate) continue
    if (daysBetween(session.date, eventDate) > 2) continue
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
    desiredKind: 'mixed-control-technical',
  })
  const safeDrills = selection.drills.filter((drill) => {
    const definition = findSquashDrillByName(drill.name)
    return !definition || !isSquashMatchDrill(definition)
  })
  const drills = safeDrills.length > 0 ? safeDrills : selection.drills

  session.subtype = 'control'
  session.title = 'Squash - Activación y Control Pre-Torneo'
  session.objective = 'Último toque de cancha: timing, longitud, precisión y confianza sin puntos largos ni fatiga residual.'
  session.durationMin = Math.min(session.durationMin, 35)
  session.rpe = Math.min(session.rpe ?? 4, 4)
  const details: NonNullable<CoachSessionProposal['squashDetails']> = {
    trainingFocus: selection.trainingFocus,
    sessionMode: 'drill_session',
    sessionKind: selection.sessionKind === 'match' ? 'control' : selection.sessionKind,
    drills,
    blocks: [],
  }
  setSquashDrillsAndBlocks(details, drills)
  session.squashDetails = details
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
): void {
  const drills = buildSquashMatchDrills(session, mode, variantIndex)
  const durationMin = sumDurations(drills) || Math.min(session.durationMin, mode === 'competition_match' ? 55 : 45)
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

export function buildSquashMatchDrills(
  session: CoachSessionProposal,
  mode: 'practice_match' | 'competition_match',
  variantIndex = 0,
): SquashDrill[] {
  const variants = mode === 'competition_match' ? COMPETITION_MATCH_VARIANTS : PRACTICE_MATCH_VARIANTS
  const names = variants[variantIndex % variants.length]
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
    const scaledBlocks = details.blocks?.map((block) => {
      const blockTarget = Math.max(3, Math.round((sumDurations(block.drills) * factor) / 2) * 2)
      const drills = scaleDurations(block.drills, factor, blockTarget)
      return {
        ...block,
        drills,
        durationMin: sumDurations(drills),
      }
    })

    details.drills = scaledDrills
    details.blocks = fitBlockDurationsToTarget(scaledBlocks, session.durationMin)
    recordRepair(meta, 'corrective', sessionKeyOf(session))
    meta.warnings.push({
      code: 'squash_duration_aligned',
      message: `Se ajustaron los bloques de "${session.title}" para calzar con ${session.durationMin}min.`,
      sessionDate: session.date,
    })
  }
}

function fitBlockDurationsToTarget<T extends { durationMin?: number }>(
  blocks: T[] | undefined,
  targetTotal: number,
): T[] | undefined {
  if (!blocks) return blocks
  let overflow = sumDurations(blocks) - targetTotal
  if (overflow <= 0) return blocks

  const fitted = [...blocks]
  for (let i = fitted.length - 1; i >= 0 && overflow > 0; i--) {
    const current = fitted[i]!.durationMin ?? 0
    const reduction = Math.min(overflow, Math.max(0, current - 3))
    fitted[i] = { ...fitted[i]!, durationMin: current - reduction }
    overflow -= reduction
  }
  return fitted
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

type StrengthSubstitutionReason = 'policy' | 'corrective'

interface StrengthRotationSlot {
  session: CoachSessionProposal
  sessionOrdinal: number
  position: number
  currentName: string
  currentRef?: ExerciseLibraryRef
  reason?: StrengthSubstitutionReason
}

/**
 * Una sola asignación canónica por semana para fuerza. La decisión de razón se
 * toma sobre la entrada original: corrective gana el desempate y policy nunca
 * vuelve a tocar el mismo slot.
 */
function normalizeStrengthSessions(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): void {
  const strengthSessions = sessions.filter((session) => session.sessionType === 'strength')
  if (strengthSessions.length === 0) return

  // El contrato de roles es posicional: el primer lift reconocido que no es
  // core/power es el main lift. La normalización estructural posterior conserva
  // el orden relativo dentro de cada grupo; imponer aquí un desempate
  // alfabético convertiría un accesorio en main lift y rotaría el lift
  // programado.

  const weekIndexInBlock = getWeekIndexInBlock(context)
  const currentBlockId = resolveBlockPositions(getPlanPhaseDescriptors(context), getPlanWeekDescriptors(context))
    .get(context.week.weekIndex)?.blockId
  const previous = context.previousWeek
  const previousUsable = previous != null && isReadyWeek(previous) && isPreviousWeekInSameBlock(context)
  const previousKeys = previousUsable ? collectAllStrengthKeys(previous.sessions) : new Set<string>()
  const originalCountable = collectCountableKeys(sessions)
  const hasObservedCollision = [...originalCountable]
    .filter((key) => previousKeys.has(key))
    .length >= 3
  const applyPolicy = weekIndexInBlock > 0

  const slots: StrengthRotationSlot[] = []
  const assignedKeys = new Set<string>()
  strengthSessions.forEach((session, sessionOrdinal) => {
    const exercises = session.exercises ?? []
    const roles = resolveSessionStrengthRoles(exercises)
    const alreadyCanonical = currentBlockId != null && hasCanonicalStrengthRotation(session, currentBlockId)
    exercises.forEach((exercise, position) => {
      const key = getStrengthExerciseKey(exercise)
      if (!key) return
      if (!isCountableRole(roles[position]!) || alreadyCanonical) {
        assignedKeys.add(key)
        return
      }
      const reason: StrengthSubstitutionReason | undefined = hasObservedCollision && previousKeys.has(key)
        ? 'corrective'
        : applyPolicy
          ? 'policy'
          : undefined
      if (!reason) assignedKeys.add(key)
      slots.push({
        session,
        sessionOrdinal,
        position,
        currentName: exercise.name,
        currentRef: exercise.libraryRef,
        reason,
      })
    })
  })

  // Reserva previa completa: los slot inmutables, main lifts y los slots que
  // quedan sin candidato no pueden volver a aparecer en otro ejercicio.
  const assignments = new Map<StrengthRotationSlot, StrengthSelectionExercise | undefined>()
  for (const slot of slots) {
    if (!slot.reason) continue
    const replacement = selectStrengthReplacement({
      originalName: slot.currentName,
      originalRef: slot.currentRef,
      context: buildStrengthSelectionContext(slot.session, context, []),
      excludedKeys: new Set([...assignedKeys, ...previousKeys]),
      rotationIndex: weekIndexInBlock * 31 + slot.sessionOrdinal * 7 + slot.position,
      exerciseIndex: slot.position,
    })
    assignments.set(slot, replacement)
    assignedKeys.add(getStrengthExerciseKey(
      replacement ?? { name: slot.currentName, libraryRef: slot.currentRef },
    ))
  }

  let policyActions = 0
  const policySessions = new Set<string>()
  const correctiveSessions = new Set<string>()
  for (const slot of slots) {
    const replacement = assignments.get(slot)
    if (
      !replacement ||
      getStrengthExerciseKey(replacement) === getStrengthExerciseKey({ name: slot.currentName, libraryRef: slot.currentRef })
    ) continue
    const exercises = slot.session.exercises
    if (!exercises) continue
    exercises[slot.position] = toStrengthProposal(replacement)
    if (slot.reason === 'corrective') correctiveSessions.add(sessionKeyOf(slot.session))
    else if (slot.reason === 'policy') {
      policyActions++
      policySessions.add(sessionKeyOf(slot.session))
    }
  }

  for (const key of correctiveSessions) recordRepair(meta, 'corrective', key)
  // El hidratador preserva el orden relativo dentro de cada bloque. Esto mantiene
  // el main lift programado en su posición semántica aun al insertar core.
  for (const session of strengthSessions) {
    session.exercises = enhanceStrengthSessionExercises(session.exercises, {
      durationMin: session.durationMin,
      strengthProfile: context.profile.strengthProfile,
    })
    if (session.exercises) {
      const mode = shouldApplySupersetPolicy({
        phase: context.week.phase,
        sportProfile: deriveStrengthSportProfile(context),
        sessionDurationMin: session.durationMin,
        // Sin `intent`: el wizard no tiene hoy ningun campo que exprese
        // preferencia ni rechazo, y reutilizar uno con otro significado seria
        // inventar una señal. Ausencia deja decidir al contexto.
      })
      session.exercises = planSupersetGroups(session.exercises, mode).exercises
    }
    if (currentBlockId != null && (applyPolicy || correctiveSessions.has(sessionKeyOf(session)))) {
      session.metadata = {
        ...(session.metadata ?? {}),
        planBuilderStrengthRotation: {
          blockId: currentBlockId,
          signature: canonicalStrengthSignature(session),
        },
      }
    }
  }
  if (applyPolicy) {
    meta.strengthAccessoryRotationActionCount = (meta.strengthAccessoryRotationActionCount ?? 0) + policyActions
    meta.strengthAccessoryRotationSessionsAffected =
      (meta.strengthAccessoryRotationSessionsAffected ?? 0) + policySessions.size
  }
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
  if (currentBlockId != null && (weekIndexInBlock > 0 || correctiveSessions.size > 0)) {
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
      const executionMode = drill.executionMode ?? resolveDrillExecutionMode(definition)
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
    desiredKind: mapSubtypeToDesiredKind(session.subtype) ?? inferSquashDesiredKind(session, []),
  }
}

function preservesCompetitiveExposure(
  sessions: CoachSessionProposal[],
  original: CoachSessionProposal,
  candidate: CoachSessionProposal,
  context: RepairContext,
): boolean {
  if (!shouldEnsureSquashCompetitionMatch(context)) return true
  return sessions.some((session) => {
    const evaluated = session === original ? candidate : session
    return evaluated.sessionType === 'squash'
      && evaluated.squashDetails?.sessionMode === 'competition_match'
      && isSafeSquashCompetitionExposureDate(evaluated.date, context)
  })
}

function squashDrillKey(value: string): string {
  return findSquashDrillByName(value)?.id ?? normalizeSquashDrillKey(value)
}

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
function realignSquashSessionIdentity(session: CoachSessionProposal, kind: SquashSessionKind): void {
  if (kind === 'match') return
  const blockKinds = [...new Set((session.squashDetails?.blocks ?? []).map((block) => block.kind))]
  session.subtype = resolveSquashSubtypeFromKind(kind, session.subtype)
  session.title = buildSquashTitleFromKind(kind, blockKinds)
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
    goal: session.objective ?? context.profile.mainGoal ?? '',
    sportProfile,
    primarySport: context.profile.sportContext?.primarySport,
  })
  if (!session.runningType) {
    session.runningType = result.session.runningType
    changed = true
  }

  const runningType = session.runningType ?? result.session.runningType
  const targets = buildRunningTargets(runningType, context.profile.runningProfile)

  if (!session.targetPaceMin && targets.targetPaceMin) {
    session.targetPaceMin = targets.targetPaceMin
    changed = true
  }
  if (!session.targetPaceMax && targets.targetPaceMax) {
    session.targetPaceMax = targets.targetPaceMax
    changed = true
  }
  if (session.targetHrMin == null && targets.targetHrMin != null) {
    session.targetHrMin = targets.targetHrMin
    changed = true
  }
  if (session.targetHrMax == null && targets.targetHrMax != null) {
    session.targetHrMax = targets.targetHrMax
    changed = true
  }

  if (!hasRunningStructure(session)) {
    session.intervalStructure = buildRunningIntervalStructure(
      runningType,
      session.durationMin,
      {
        targetPaceMin: session.targetPaceMin,
        targetPaceMax: session.targetPaceMax,
        targetHrMin: session.targetHrMin,
        targetHrMax: session.targetHrMax,
      },
      result.session.structure,
    )
    changed = true
  }

  return changed
}

function hasRunningStructure(session: CoachSessionProposal): boolean {
  return Array.isArray(session.intervalStructure?.blocks) && session.intervalStructure.blocks.length > 0
}

function buildRunningTargets(
  runningType: RunningType,
  profile: AthleteProfile['runningProfile'],
): Pick<CoachSessionProposal, 'targetPaceMin' | 'targetPaceMax' | 'targetHrMin' | 'targetHrMax'> {
  switch (runningType) {
    case 'tempo': {
      const threshold = profile?.thresholdPace
      return {
        targetPaceMin: threshold ? addSecsToPace(threshold, -10) : '4:40',
        targetPaceMax: threshold ?? '5:00',
        targetHrMin: 155,
        targetHrMax: 170,
      }
    }
    case 'intervals': {
      const intervalPace = profile?.fiveKTime
        ? derivePaceFromFiveK(profile.fiveKTime)
        : profile?.thresholdPace
          ? addSecsToPace(profile.thresholdPace, -25)
          : '4:15'
      return {
        targetPaceMin: intervalPace,
        targetPaceMax: addSecsToPace(intervalPace, 15),
        targetHrMin: 165,
        targetHrMax: 180,
      }
    }
    case 'long': {
      const pace = profile?.longRunPace ?? profile?.easyPaceMax ?? profile?.z2PaceMax ?? '6:00'
      return {
        targetPaceMin: profile?.easyPaceMin ?? profile?.z2PaceMin ?? pace,
        targetPaceMax: pace,
        targetHrMin: 130,
        targetHrMax: 150,
      }
    }
    case 'z2':
    default:
      return {
        targetPaceMin: profile?.z2PaceMin ?? profile?.easyPaceMin ?? '5:30',
        targetPaceMax: profile?.z2PaceMax ?? profile?.easyPaceMax ?? '6:00',
        targetHrMin: 130,
        targetHrMax: 150,
      }
  }
}

function buildRunningIntervalStructure(
  runningType: RunningType,
  durationMin: number,
  targets: Pick<CoachSessionProposal, 'targetPaceMin' | 'targetPaceMax' | 'targetHrMin' | 'targetHrMax'>,
  selectorStructure?: string,
): RunningIntervalStructure {
  const pace = formatPaceTarget(targets)
  const warmup = Math.min(10, Math.max(5, Math.floor(durationMin * 0.2)))
  const cooldown = warmup

  if (runningType === 'tempo') {
    const main = Math.max(15, Math.min(35, durationMin - warmup - cooldown))
    return {
      blocks: [
        { label: 'Calentamiento Z2', durationMin: warmup, targetPace: pace.z2, notes: 'Trote facil + movilidad dinamica.' },
        { label: 'Tempo umbral controlado', durationMin: main, targetPace: pace.main, targetHrMax: targets.targetHrMax, notes: selectorStructure ?? 'RPE 6.5-7.5; sostenido, sin cerrar a tope.' },
        { label: 'Enfriamiento Z2', durationMin: cooldown, targetPace: pace.z2, notes: 'Soltar hasta respiracion comoda.' },
      ],
    }
  }

  if (runningType === 'intervals') {
    const repetitions = durationMin >= 60 ? 5 : 4
    return {
      blocks: [
        { label: 'Calentamiento Z2', durationMin: warmup, targetPace: pace.z2, notes: 'Incluye 3 progresivos de 20s.' },
        { label: 'Series principales', repetitions, distanceKm: 0.8, targetPace: pace.main, targetHrMax: targets.targetHrMax, notes: selectorStructure ?? 'Recupera 2-3 min trotando entre repeticiones.' },
        { label: 'Enfriamiento Z2', durationMin: cooldown, targetPace: pace.z2, notes: 'Baja pulsaciones sin apurar.' },
      ],
    }
  }

  if (runningType === 'long') {
    return {
      blocks: [
        { label: 'Fondo Z2', durationMin, targetPace: pace.main, targetHrMax: targets.targetHrMax, notes: selectorStructure ?? 'Ritmo conversacional; hidrata si supera 60 min.' },
      ],
    }
  }

  return {
    blocks: [
      { label: 'Rodaje Z2', durationMin, targetPace: pace.main, targetHrMax: targets.targetHrMax, notes: selectorStructure ?? 'Ritmo conversacional y respiracion estable.' },
    ],
  }
}

function formatPaceTarget(targets: Pick<CoachSessionProposal, 'targetPaceMin' | 'targetPaceMax'>): { main?: string; z2?: string } {
  const main = targets.targetPaceMin && targets.targetPaceMax
    ? targets.targetPaceMin === targets.targetPaceMax
      ? `${targets.targetPaceMin} /km`
      : `${targets.targetPaceMin}-${targets.targetPaceMax} /km`
    : targets.targetPaceMin
      ? `${targets.targetPaceMin} /km`
      : targets.targetPaceMax
        ? `${targets.targetPaceMax} /km`
        : undefined
  return { main, z2: main }
}

function addSecsToPace(pace: string, secs: number): string {
  const match = pace.trim().match(/^(\d+):(\d{1,2})$/)
  if (!match) return pace
  const total = Math.max(60, Number(match[1]) * 60 + Number(match[2]) + secs)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function derivePaceFromFiveK(fiveKTime: string): string {
  const parts = fiveKTime.trim().split(':').map(Number)
  if (parts.length < 2 || parts.length > 3 || parts.some((value) => Number.isNaN(value))) return '4:15'
  const total = parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1]
  const pace = Math.round(total / 5)
  const minutes = Math.floor(pace / 60)
  const seconds = pace % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function completeStrengthExercises(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises = extractRecentStrengthExercises(context.previousWeek),
): void {
  const result = selectStrengthSession(buildStrengthSelectionContext(session, context, recentExercises))
  session.exercises = result.exercises.map(toStrengthProposal)
  if (result.starLift) {
    session.metadata = {
      ...(session.metadata ?? {}),
      starLift: result.starLift,
    }
  }
  enhanceStrengthSessionDetails(session, context, recentExercises)
}

function enhanceStrengthSessionDetails(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises = extractRecentStrengthExercises(context.previousWeek),
): boolean {
  const before = JSON.stringify(session.exercises ?? [])
  const enhanced = enhanceStrengthSessionExercises(session.exercises, {
    durationMin: session.durationMin,
    strengthProfile: context.profile.strengthProfile,
  })
  session.exercises = completeStrengthExerciseDensity(session, context, recentExercises, enhanced)
  return before !== JSON.stringify(session.exercises ?? [])
}

function buildStrengthSelectionContext(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises: string[],
): StrengthContext {
  const athleteParameters = buildAthleteParameters(context.profile, context.wizardConfig)

  return {
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    phase: mapStrengthPhase(context.week.phase) as StrengthPhase,
    recentExercises,
    goal: buildLevelAwareGoal(context, session.objective ?? context.profile.mainGoal ?? ''),
    sportProfile: deriveStrengthSportProfile(context),
    primarySport: context.profile.sportContext?.primarySport,
    experienceLevel: deriveStrengthExperienceLevel(context),
    availableEquipment: athleteParameters.availableEquipment,
    sessionDurationMin: session.durationMin,
    weekIndexInBlock: getWeekIndexInBlock(context),
    available1RM: athleteParameters.available1RM,
    rpeAdjustment: athleteParameters.rpeAdjustment,
    requireExtraRecovery: athleteParameters.requireExtraRecovery,
  }
}

function completeStrengthExerciseDensity(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises: string[],
  exercises: CoachExerciseProposal[] | undefined,
): CoachExerciseProposal[] | undefined {
  if (!exercises || exercises.length === 0) return exercises

  const selectionContext = buildStrengthSelectionContext(session, context, recentExercises)
  const density = getTargetExerciseDensity(selectionContext)
  if (exercises.length >= density.target) return exercises

  const selected = selectStrengthSession(selectionContext).exercises
  const existingKeys = new Set(exercises.map(getStrengthExerciseKey))
  const additions: CoachExerciseProposal[] = []
  const minimumStrengthWork = getMinimumStrengthWorkCount(session.durationMin)
  let strengthWorkCount = exercises.filter(isStrengthWorkExercise).length

  const candidates = selected
    .map(toStrengthProposal)
    .filter((exercise) => !existingKeys.has(getStrengthExerciseKey(exercise)))

  for (const candidate of candidates) {
    if (exercises.length + additions.length >= density.target) break
    if (!isStrengthWorkExercise(candidate)) continue
    additions.push(candidate)
    existingKeys.add(getStrengthExerciseKey(candidate))
    strengthWorkCount++
    if (strengthWorkCount >= minimumStrengthWork) break
  }

  for (const candidate of candidates) {
    if (exercises.length + additions.length >= density.target) break
    const key = getStrengthExerciseKey(candidate)
    if (existingKeys.has(key)) continue
    additions.push(candidate)
    existingKeys.add(key)
  }

  if (additions.length === 0) return exercises

  return enhanceStrengthSessionExercises([...exercises, ...additions], {
    durationMin: session.durationMin,
    strengthProfile: context.profile.strengthProfile,
  })
}

function getMinimumStrengthWorkCount(durationMin: number): number {
  if (durationMin >= 70) return 5
  if (durationMin >= 55) return 4
  if (durationMin >= 45) return 3
  return 2
}

function isStrengthWorkExercise(exercise: CoachExerciseProposal): boolean {
  const block = resolveStrengthExerciseBlock(exercise)
  return block !== 'core' && block !== 'cardio' && block !== 'mobility'
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

    const durationMin = Math.min(session.durationMin, isTaper ? 25 : 40)
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
        targetHrMin: session.targetHrMin ?? 130,
        targetHrMax: session.targetHrMax ?? (isTaper ? 140 : 145),
        intervalStructure: {
          blocks: [
            {
              label: isTaper ? 'Z2 activación taper' : 'Z2 soporte squash',
              durationMin: Math.max(isTaper ? 15 : 20, durationMin - 5),
              targetHrMax: session.targetHrMax ?? (isTaper ? 140 : 145),
              notes: isTaper
                ? `Trote muy suave, conversacional. Mantener <140 lpm. No forzar ritmo.`
                : `Mantener entre ${session.targetHrMin ?? 130}-${session.targetHrMax ?? 145} lpm, conversacional.`,
            },
          ],
        },
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
    targetHrMin: 130,
    targetHrMax: isTaper ? 140 : 145,
    intervalStructure: {
      blocks: [{
        label: isTaper ? 'Z2 activación taper' : 'Z2 soporte squash',
        durationMin,
        targetHrMax: isTaper ? 140 : 145,
        notes: 'Ritmo conversacional; cortar si aparece fatiga de piernas.',
      }],
    },
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
    if (!occupied.has(`${date}|${preferredBlock}`)) return { date, timeBlock: preferredBlock }
    const opposite = preferredBlock === 'AM' ? 'PM' : 'AM'
    if (canDouble && !occupied.has(`${date}|${opposite}`)) return { date, timeBlock: opposite }
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

function mapSubtypeToDesiredKind(subtype?: string) {
  if (!subtype) return undefined
  if (subtype === 'match' || subtype === 'competitive') return 'match' as const
  if (subtype === 'control') return 'control' as const
  if (subtype === 'training') return undefined // let selector decide
  return undefined
}

function inferSquashDesiredKind(session: CoachSessionProposal, recentDrills: string[]) {
  const text = `${session.title ?? ''} ${session.objective ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (text.includes('control') || text.includes('precision')) return 'control' as const
  if (text.includes('desplaz') || text.includes('movimiento') || text.includes('shadow') || text.includes('ghost')) return 'mixed-shadows-control' as const
  if (text.includes('partido') || text.includes('match')) return 'match' as const
  if (recentDrills.length >= 3 || text.includes('juego') || text.includes('condicionado')) return 'shadows' as const
  if (recentDrills.length > 0) return 'control' as const
  return undefined
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

function deriveStrengthExperienceLevel(context: RepairContext): ExperienceLevel {
  const fitness = context.wizardConfig.currentFitnessLevel
  if (fitness === 'low' || fitness === 'returning') return 'beginner'
  const competitiveLevel = deriveCompetitiveLevel(context)
  if (competitiveLevel === 'elite' || competitiveLevel === 'masters') return 'advanced'
  if (competitiveLevel === 'competitive' || fitness === 'fit') return 'intermediate'
  return 'intermediate'
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
