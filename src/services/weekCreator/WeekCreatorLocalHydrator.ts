import type {
  AthleteProfile,
  ChatContext,
  CoachAction,
  CoachSessionProposal,
  MacroPlan,
  PlanWizardConfig,
  SupportedSport,
} from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import type { CoachNormalizedResponse } from '../ai/types'
import {
  repairGeneratedWeek,
  type RepairContext,
  type RepairFailure,
  type RepairMeta,
} from '../planBuilder/repairWeek'
import { recordRepairAction } from '../planBuilder/repairTaxonomy'
import type { WeekCreatorEffectiveConfig } from './WeekCreatorConfig'
import { alignSessionsToScheduleConstraints, buildScheduleAwareConfig } from './scheduleConstraints'
import type { WeekCreatorSkeleton, WeekCreatorSkeletonSession } from './weekCreatorSkeleton'
import { resolveWeekCreatorEventContext } from './WeekCreatorEventContext'
import type { StrengthConstraint } from '../../types/strengthSafety'
import { resolveStrengthSafetyConstraints } from '../training/strengthSafetyConstraints'
import { buildWeekCreatorExecutionSignals } from './weekCreatorExecutionSignals'

export type WeekCreatorHydrationStatus =
  | 'hydrated'
  | 'unchanged'
  | 'blocked_medical_restrictions'
  | 'skipped_invalid_shape'
  | 'repair_failed'

export interface WeekCreatorHydrationResult {
  response: CoachNormalizedResponse
  status: WeekCreatorHydrationStatus
  warnings: string[]
  repairMeta?: RepairMeta
  /** El repair fail-closed rechazó la candidata; nunca equivale a una semana vacía válida. */
  repairFailure?: RepairFailure
  focusOverlayCount: number
}

export interface WeekCreatorHydrationInput {
  response: CoachNormalizedResponse
  context: ChatContext
  config: WeekCreatorEffectiveConfig
  targetWeekStart: string
  planningStartDate?: string
  /**
   * Parsed provider skeleton. normalizeResponse intentionally strips focusKey,
   * so the engine must pass this sidecar until CoachSessionProposal owns a
   * typed semantic-intent field.
   */
  skeleton?: WeekCreatorSkeleton
}

export interface WeekCreatorSkeletonHydrationInput {
  skeleton: WeekCreatorSkeleton
  /** Provider/telemetry envelope; any generic-normalizer actions are replaced. */
  response: CoachNormalizedResponse
  context: ChatContext
  config: WeekCreatorEffectiveConfig
  targetWeekStart: string
  planningStartDate?: string
}

/**
 * Preferred Phase 3 entry point. It maps the typed skeleton directly to
 * CoachSessionProposal, before focusKey can be discarded by normalizeResponse.
 */
export function hydrateWeekCreatorSkeleton(
  input: WeekCreatorSkeletonHydrationInput,
): WeekCreatorHydrationResult {
  if (hasActiveMedicalRestrictions(input.context, input.config)) {
    return {
      response: input.response,
      status: 'blocked_medical_restrictions',
      warnings: [
        'La hidratación local se omitió porque hay restricciones médicas activas; se requiere contenido deportivo adaptado explícitamente.',
      ],
      focusOverlayCount: 0,
    }
  }
  const mapped = mapWeekCreatorSkeletonToAction(input.skeleton)
  const result = hydrateWeekCreatorResponse({
    response: {
      ...input.response,
      message: input.response.message.trim() || input.skeleton.reason,
      actions: [mapped.action],
    },
    context: input.context,
    config: input.config,
    targetWeekStart: input.targetWeekStart,
    planningStartDate: input.planningStartDate,
  })
  return { ...result, focusOverlayCount: mapped.appliedCount }
}

/**
 * Turns the compact Week Creator session skeleton into executable sessions
 * using the same deterministic selectors and repair pipeline as Plan Builder.
 *
 * This deliberately refuses to synthesize sport-specific content when active
 * free-text medical restrictions exist. The local selectors cannot interpret
 * an arbitrary diagnosis safely; callers should keep using the detailed model
 * contract for that cohort until there is a typed restriction model.
 */
export function hydrateWeekCreatorResponse(
  input: WeekCreatorHydrationInput,
): WeekCreatorHydrationResult {
  const actions = input.response.actions ?? []
  const createWeekActions = actions.filter((action) => action.type === 'create_week')
  if (createWeekActions.length !== 1) {
    return {
      response: input.response,
      status: 'skipped_invalid_shape',
      warnings: ['La hidratación local requiere exactamente una acción create_week.'],
      focusOverlayCount: 0,
    }
  }

  const action = createWeekActions[0]
  if (!Array.isArray(action.sessions) || action.sessions.length === 0) {
    return {
      response: input.response,
      status: 'skipped_invalid_shape',
      warnings: ['La hidratación local requiere un esqueleto con sesiones no vacías.'],
      focusOverlayCount: 0,
    }
  }

  if (hasActiveMedicalRestrictions(input.context, input.config)) {
    return {
      response: input.response,
      status: 'blocked_medical_restrictions',
      warnings: [
        'La hidratación local se omitió porque hay restricciones médicas activas; se requiere contenido deportivo adaptado explícitamente.',
      ],
      focusOverlayCount: 0,
    }
  }

  const overlay = input.skeleton
    ? overlayWeekCreatorSkeletonIntent(action, input.skeleton)
    : { action: cloneCoachAction(action), appliedCount: 0 }
  const clonedAction = overlay.action
  const scheduleAwareConfig = buildScheduleAwareConfig(input.config)
  const initiallyAligned = alignSessionsToScheduleConstraints(
    clonedAction.sessions ?? [],
    scheduleAwareConfig.scheduleConstraints,
  )
  const repairContext = buildWeekCreatorHydrationRepairContext({
    context: input.context,
    config: scheduleAwareConfig,
    targetWeekStart: input.targetWeekStart,
    planningStartDate: input.planningStartDate,
  })
  const repairResult = repairGeneratedWeek(initiallyAligned.sessions, repairContext)
  if (repairResult.failure) {
    return {
      response: input.response,
      status: 'repair_failed',
      warnings: [repairResult.failure.message],
      repairMeta: repairResult.meta,
      repairFailure: repairResult.failure,
      focusOverlayCount: overlay.appliedCount,
    }
  }
  const finallyAligned = alignSessionsToScheduleConstraints(
    repairResult.sessions,
    scheduleAwareConfig.scheduleConstraints,
    { skipOccupied: true },
  )

  const scheduleAdjustments = initiallyAligned.adjustedCount + finallyAligned.adjustedCount
  if (scheduleAdjustments > 0) {
    repairResult.meta.repairedSessionCount += scheduleAdjustments
    for (const sessionKey of [
      ...initiallyAligned.adjustedSessionKeys,
      ...finallyAligned.adjustedSessionKeys,
    ]) {
      recordRepairAction(repairResult.meta.taxonomy, 'corrective', sessionKey)
    }
    repairResult.meta.warnings.push({
      code: 'schedule_time_block_adjusted',
      message: `Se ajustaron ${scheduleAdjustments} sesión(es) a los bloques AM/PM configurados.`,
    })
  }

  const hydratedAction: CoachAction = {
    ...clonedAction,
    targetDate: clonedAction.targetDate ?? input.targetWeekStart,
    sessions: finallyAligned.sessions,
  }
  const hydratedActions = actions.map((candidate) =>
    candidate === action ? hydratedAction : candidate)
  const response = {
    ...input.response,
    actions: hydratedActions,
  }
  const changed = JSON.stringify(action) !== JSON.stringify(hydratedAction)

  return {
    response,
    status: changed ? 'hydrated' : 'unchanged',
    warnings: repairResult.meta.warnings.map((warning) => warning.message),
    repairMeta: repairResult.meta,
    focusOverlayCount: overlay.appliedCount,
  }
}

/**
 * Reattaches focusKey intent to the normalized sessions through fields that
 * the existing selectors already consume. Matching is identity-based instead
 * of index-only so a malformed/dropped session cannot receive another
 * session's intent.
 */
export function overlayWeekCreatorSkeletonIntent(
  action: CoachAction,
  skeleton: WeekCreatorSkeleton,
): { action: CoachAction; appliedCount: number } {
  const cloned = cloneCoachAction(action)
  if (!cloned.sessions) return { action: cloned, appliedCount: 0 }

  const available = [...skeleton.sessions]
  let appliedCount = 0
  cloned.sessions = cloned.sessions.map((session) => {
    const matchIndex = available.findIndex((candidate) =>
      candidate.date === session.date
      && candidate.timeBlock === session.timeBlock
      && candidate.sessionType === session.sessionType)
    if (matchIndex < 0) return session

    const [skeletonSession] = available.splice(matchIndex, 1)
    const overlaid = applyFocusIntent(session, skeletonSession)
    if (overlaid !== session) appliedCount += 1
    return overlaid
  })

  return { action: cloned, appliedCount }
}

export function mapWeekCreatorSkeletonToAction(
  skeleton: WeekCreatorSkeleton,
): { action: CoachAction; appliedCount: number } {
  let appliedCount = 0
  const sessions = skeleton.sessions.map((skeletonSession) => {
    const base: CoachSessionProposal = {
      date: skeletonSession.date,
      timeBlock: skeletonSession.timeBlock,
      sessionType: skeletonSession.sessionType,
      durationMin: skeletonSession.durationMin,
      rpe: skeletonSession.rpe,
      title: skeletonSession.title,
      objective: skeletonSession.objective,
      ...(skeletonSession.sessionType === 'squash' && skeletonSession.squashKind
        ? { squashKind: skeletonSession.squashKind }
        : {}),
      ...(skeletonSession.sessionType === 'squash' && skeletonSession.subtype
        ? { subtype: skeletonSession.subtype }
        : {}),
      ...(skeletonSession.sessionType === 'running' && skeletonSession.runningType
        ? { runningType: skeletonSession.runningType }
        : {}),
    }
    const mapped = applyFocusIntent(base, skeletonSession)
    if (mapped !== base) appliedCount += 1
    return mapped
  })
  return {
    action: {
      type: 'create_week',
      reason: skeleton.reason,
      targetDate: skeleton.targetDate,
      weekObjectives: skeleton.weekObjectives,
      sessions,
    },
    appliedCount,
  }
}

function applyFocusIntent(
  session: CoachSessionProposal,
  skeleton: WeekCreatorSkeletonSession,
): CoachSessionProposal {
  const semanticIntent = resolveFocusSemanticIntent(skeleton.focusKey, session.sessionType)
  if (!semanticIntent) return session

  const overlaid: CoachSessionProposal = {
    ...session,
    objective: appendSemanticIntent(session.objective, semanticIntent),
  }
  // La modalidad viaja como dato desde el skeleton. `focusKey` vuelve a ser sólo
  // foco deportivo: derivar de él el subtype convertía `squash_length_control`
  // —un foco legítimo de una sesión con partner— en una sesión en solitario.
  if (session.sessionType === 'squash' && skeleton.squashKind) {
    overlaid.squashKind = skeleton.squashKind
  }
  if (session.sessionType === 'running' && !session.runningType) {
    overlaid.runningType = inferRunningTypeFromFocus(skeleton.focusKey)
  }
  return overlaid
}

/**
 * La frase agregada es copy para el atleta, no un canal de control.
 *
 * Antes SÍ dirigía a los selectores: `repairWeek` leía `objective` y `title`
 * para elegir drills, así que inyectar texto acá era la forma de que `focusKey`
 * influyera. Esa inferencia se eliminó —la modalidad viaja en `squashKind`—, de
 * modo que esto sólo debe leerse como nota de entrenador.
 */
function appendSemanticIntent(objective: string | undefined, semanticIntent: string): string {
  const base = objective?.trim()
  if (!base) return capitalizeFirst(semanticIntent)
  if (normalizeFocusKey(base).includes(normalizeFocusKey(semanticIntent))) return base
  const separator = /[.!?]$/.test(base) ? '' : '.'
  return `${base}${separator} Foco: ${semanticIntent}.`
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function resolveFocusSemanticIntent(
  focusKey: string,
  sport: CoachSessionProposal['sessionType'],
): string | undefined {
  const key = normalizeFocusKey(focusKey)
  const mappings: Partial<Record<CoachSessionProposal['sessionType'], Array<[RegExp, string]>>> = {
    squash: [
      [/match|partido|competition|competitive/, 'partido y presión competitiva'],
      [/control/, 'control de largo y recuperación a la T'],
      [/tactic|tactica|pressure|presion/, 'táctica y presión'],
      [/ghost|shadow|physical|fisic/, 'ghosting y desplazamiento'],
      [/light|recovery|activation|recuper|activacion/, 'activación técnica ligera'],
      [/technic|tecnic|drive|volley|volea/, 'técnica y precisión'],
    ],
    running: [
      [/interval|vo2/, 'intervalos'],
      [/tempo|threshold|umbral/, 'tempo umbral'],
      [/long|fondo/, 'rodaje largo'],
      [/z2|easy|recovery|suave/, 'rodaje Z2'],
    ],
    strength: [
      [/lower|pierna/, 'fuerza lower de tren inferior'],
      [/upper|torso/, 'fuerza upper de tren superior'],
      [/power|potencia/, 'potencia'],
      [/core|trunk|zona media/, 'zona media y estabilidad'],
      [/full body|general/, 'fuerza full body'],
    ],
    cycling: [
      [/interval|vo2/, 'intervalos de ciclismo'],
      [/tempo|threshold|umbral/, 'tempo de ciclismo'],
      [/z2|easy|recovery|suave/, 'ciclismo Z2'],
    ],
    mobility: [
      [/hip|cadera/, 'movilidad de cadera'],
      [/ankle|tobillo/, 'movilidad de tobillo'],
      [/thoracic|torac|spine|columna/, 'movilidad torácica y de columna'],
      [/recovery|full body|general/, 'movilidad restaurativa full body'],
    ],
  }
  return mappings[sport]?.find(([pattern]) => pattern.test(key))?.[1]
}


function inferRunningTypeFromFocus(focusKey: string): CoachSessionProposal['runningType'] {
  const key = normalizeFocusKey(focusKey)
  if (/interval|vo2/.test(key)) return 'intervals'
  if (/tempo|threshold|umbral/.test(key)) return 'tempo'
  if (/long|fondo/.test(key)) return 'long'
  return 'z2'
}

function normalizeFocusKey(value: string): string {
  return value.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function hasActiveMedicalRestrictions(
  context: ChatContext,
  config: WeekCreatorEffectiveConfig,
  userMessage = '',
): boolean {
  return resolveWeekCreatorSafetyConstraints(context, config, userMessage).length > 0
}

/**
 * Resolve only from the original persisted fields and the request that caused
 * this generation. `config.injuryNotes` is intentionally not read: in the
 * Week Creator it can be a transport field for recovery restrictions.
 */
export function resolveWeekCreatorSafetyConstraints(
  context: ChatContext,
  config: WeekCreatorEffectiveConfig,
  userMessage = '',
): readonly StrengthConstraint[] {
  const profile = context.athleteProfile
  const recovery = profile?.recoveryProfile
  return resolveStrengthSafetyConstraints({
    currentInjuries: recovery?.currentInjuries,
    restrictions: recovery?.restrictions,
    injuryNotes: profile?.planWizardConfig?.injuryNotes,
    userMessages: userMessage.trim() ? [userMessage] : [],
    trainingPriority: config.trainingPriority,
  })
}

interface BuildRepairContextInput {
  context: ChatContext
  config: WeekCreatorEffectiveConfig
  targetWeekStart: string
  planningStartDate?: string
}

/** Public adapter needed by the Phase 3 Week Creator pipeline. */
export function buildWeekCreatorHydrationRepairContext(
  input: BuildRepairContextInput,
): RepairContext {
  const profile = input.context.athleteProfile ?? buildFallbackProfile()
  const primarySport = input.config.primarySport ?? input.config.allowedSports[0] ?? 'squash'
  const now = Date.now()
  const weekEndDate = addDaysIso(input.targetWeekStart, 6)
  const eventContext = resolveWeekCreatorEventContext({
    profile,
    targetWeekStart: input.targetWeekStart,
    weekEndDate,
    planningStartDate: input.planningStartDate,
    primarySport,
  })
  const phase = eventContext.phase
  const sportDetails = buildSportDetails(input.config.allowedSports, primarySport)
  const goalEventId = eventContext.goalEvent?.id
    ?? profile.planWizardConfig?.goalEventId
    ?? 'week-creator'
  const macroSnapshot: MacroPlan = {
    goalEventId,
    goalEventDate: eventContext.window?.startDate ?? weekEndDate,
    goalEventEndDate: eventContext.window?.endDate,
    goalEventKeyDate: eventContext.window?.keyDate,
    currentPhase: phase,
    weeksRemaining: eventContext.weeksRemaining,
    blockFocus: eventContext.blockFocus,
    headline: profile.macroPlan?.currentPhase === phase
      ? profile.macroPlan.headline
      : `Semana ${phase} de ${primarySport}`,
    timeline: [],
    sportDetails,
    secondaryEvents: [],
    computedAt: now,
  }
  const wizardConfig: PlanWizardConfig = {
    goalEventId,
    trainingDays: input.config.trainingDays,
    sessionsPerWeek: input.config.sessionsPerWeek,
    targetHardPrimaryMatches: input.config.targetHardPrimaryMatches,
    sessionDurationMins: input.config.sessionDurationMins,
    allowDoubleSession: input.config.allowDoubleSession,
    doubleSessionDays: input.config.doubleSessionDays,
    scheduleConstraints: input.config.scheduleConstraints,
    partnerAvailability: profile.planWizardConfig?.partnerAvailability,
    complementarySports: input.config.allowedSports.filter((sport) => sport !== primarySport),
    currentFitnessLevel: input.config.currentFitnessLevel,
    currentFatigue: input.config.currentFatigue,
    // Fuente persistida, NO el campo transportador: en Week Creator
    // `config.injuryNotes` puede llevar `recoveryProfile.restrictions`, que
    // `resolveWeekCreatorSafetyConstraints` excluye a propósito. Pasarlo acá lo
    // reclasificaba bajo la fuente médica `injury_notes`, de modo que el mismo
    // texto resolvía sin restricción arriba y como restricción sin resolver en
    // la reparación, produciendo safe declines sin reintento ni fallback.
    injuryNotes: profile.planWizardConfig?.injuryNotes,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  }
  const plan: TrainingPlan = {
    id: 'week-creator-hydration-plan',
    athleteId: profile.id,
    goalEventId: wizardConfig.goalEventId,
    status: 'draft',
    generationState: 'shell',
    title: 'Week Creator hydration',
    startDate: input.planningStartDate ?? input.targetWeekStart,
    endDate: weekEndDate,
    totalWeeks: 1,
    phases: [{
      phase,
      startWeekIndex: 0,
      endWeekIndex: 0,
      blockFocus: macroSnapshot.blockFocus,
      intentBySport: {},
    }],
    wizardConfig,
    macroSnapshot,
    createdAt: now,
    updatedAt: now,
  }
  const week: TrainingPlanWeek = {
    id: 'week-creator-hydration-week',
    planId: plan.id,
    weekIndex: 0,
    weekStartDate: input.targetWeekStart,
    phase,
    status: 'draft',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 1 },
    createdAt: now,
    updatedAt: now,
  }

  const historicalSessions = input.context.historicalSessions ?? input.context.recentSessions
  return {
    plan,
    week,
    profile,
    wizardConfig,
    planWeekDescriptors: [{ weekIndex: week.weekIndex, phase: week.phase }],
    historicalSessions,
    executionSignals: buildWeekCreatorExecutionSignals(
      input.config,
      historicalSessions,
      input.context.weekDayLogs,
    ),
  }
}

function cloneCoachAction(action: CoachAction): CoachAction {
  return JSON.parse(JSON.stringify(action)) as CoachAction
}

function buildFallbackProfile(): AthleteProfile {
  return { id: 'week-creator-hydration-profile', updatedAt: Date.now() }
}

function buildSportDetails(
  allowedSports: SupportedSport[],
  primarySport: SupportedSport,
): MacroPlan['sportDetails'] {
  const sports = allowedSports.length > 0 ? allowedSports : [primarySport]
  return [...new Set([primarySport, ...sports])].map((sport) => ({
    sport,
    role: sport === primarySport ? 'primary' as const : 'support' as const,
    phaseFocus: sport === primarySport
      ? 'mantener continuidad del deporte principal'
      : 'soporte de baja interferencia',
    weeklyIntent: sport === primarySport ? 'progress' : 'support',
    volumeBias: sport === primarySport ? 'build' as const : 'hold' as const,
    intensityBias: 'hold' as const,
    notes: sport === primarySport
      ? 'Deporte principal declarado en el perfil.'
      : 'Deporte complementario habilitado.',
  }))
}

function addDaysIso(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}
