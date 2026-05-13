import type {
  AITechnicalSurface,
  AthleteProfile,
  ChatContext,
  CoachAction,
  CoachSessionProposal,
  DayOfWeek,
  MacroPlan,
  PlanWizardConfig,
  SupportedSport,
  TimeBlock,
} from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import type { CoachNormalizedResponse } from '../ai/types'
import { buildAITraceId, getAIRequestPolicy } from '../ai/requestPolicy'
import { normalizeResponse } from '../ai/responseNormalizer'
import { getActiveProvider } from '../ai/providerResolver'
import { useAIDebugStore } from '../../store/useAIDebugStore'
import { createStageTracker, type CoachOutcome } from '../ai/stageLogger'
import { buildWeekCreatorPrompt, summarizeWeekCreatorAction } from './WeekCreatorPromptBuilder'
import { validateWeekCreatorResponse } from './validateWeekCreatorResponse'
import { resolveWeekCreatorConfig, type WeekCreatorEffectiveConfig, withRequestedSessionsPerWeek } from './WeekCreatorConfig'
import { buildWeekRetryInstruction } from '../week/shared'
import { repairGeneratedWeek } from '../planBuilder/repairWeek'

type WeekCreatorOptions = {
  surface?: AITechnicalSurface
  targetWeekStart: string
  signal?: AbortSignal
}

type WeekCreatorFallbackReason =
  | 'missing_create_week'
  | 'actions_parse_failed'
  | 'multiple_create_week'
  | 'extra_actions'
  | 'wrong_target_date'
  | 'missing_sessions'
  | 'session_count_mismatch'
  | 'invalid_week_dates'
  | 'schedule_conflict'
  | 'unsupported_sport'
  | 'missing_sport_details'
  | 'missing_primary_sport'
  | 'provider_error'
  | 'schema_invalid'

type WeekCreatorFailure = {
  reason: WeekCreatorFallbackReason
  error: string
  outcome: 'parse_invalid' | 'schema_invalid'
  warnings: string[]
}

export const WeekCreatorEngine = {
  async sendWeekCreate(
    userMessage: string,
    context: ChatContext,
    options: WeekCreatorOptions,
  ): Promise<CoachNormalizedResponse> {
    const config = withRequestedSessionsPerWeek(
      resolveWeekCreatorConfig(context.athleteProfile),
      userMessage,
    )

    if (config.configSource === 'defaults') {
      return {
        message: 'Para proponer una semana necesito conocer tus deportes y disponibilidad horaria. ¿Quieres completar tu perfil de atleta primero? Puedes hacerlo desde Configuración → Perfil de atleta.',
        actions: [],
        provider: 'mock',
        model: 'none',
        timestamp: Date.now(),
        traceId: buildAITraceId('week_creator'),
        requestClass: 'week_creator',
        durationMs: 0,
        retryUsed: false,
        fallbackUsed: false,
        meta: { hadActionsMarkup: false, actionParseFailed: false, likelyTruncated: false },
      }
    }

    const provider = getActiveProvider()
    const policy = getAIRequestPolicy('week_creator')
    const surface = options.surface ?? 'chat'
    let lastFailure: {
      provider?: CoachNormalizedResponse['provider']
      model?: string
      traceId?: string
      durationMs?: number
      fallbackUsed?: boolean
      retryUsed?: boolean
      fallbackReason?: WeekCreatorFallbackReason
      outcome?: WeekCreatorFailure['outcome']
      error?: string
      warnings?: string[]
    } | null = null

    const MAX_ATTEMPTS = 2
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const traceId = buildAITraceId('week_creator')
      const tracker = createStageTracker(traceId, 'week_creator')
      let outcome: CoachOutcome = 'error'
      useAIDebugStore.getState().startRequest({
        traceId,
        requestClass: 'week_creator',
        surface,
        startedAt: Date.now(),
      })

      try {
        const promptStage = tracker.stage('prompt_build')
        const prompt = buildWeekCreatorPrompt(context, {
          userMessage,
          targetWeekStart: options.targetWeekStart,
          config,
          retryInstruction: buildWeekRetryInstruction(lastFailure?.error, options.targetWeekStart, config.sessionsPerWeek, attempt),
          strictFormatting: true,
        })
        promptStage.end({ ok: true })

        const providerStage = tracker.stage('provider_call')
        const raw = await provider.call({
          systemPrompt: prompt.systemPrompt,
          userMessage: prompt.userPrompt,
          requestClass: 'week_creator',
          traceId,
          maxTokens: policy.maxTokens,
          temperature: Math.min(policy.temperature, 0.25),
          allowFallback: policy.allowFallback,
          signal: options.signal,
        })
        providerStage.end({ ok: true })

        const normalizeStage = tracker.stage('normalize')
        const normalized = normalizeResponse(raw)
        normalizeStage.end({ ok: true })

        const repairStage = tracker.stage('repair')
        const repaired = repairWeekCreatorResponse(normalized, context, config, options.targetWeekStart)
        repairStage.end({ ok: true })

        const validateStage = tracker.stage('validate')
        const validation = validateWeekCreatorResponse({
          response: repaired,
          context,
          config,
          targetWeekStart: options.targetWeekStart,
        })
        validateStage.end({ ok: validation.ok, error: validation.ok ? undefined : validation.error })

        if (!validation.ok) {
          const failure = classifyWeekCreatorFailure(validation.error, repaired)
          outcome = 'invalid_schema'
          lastFailure = {
            provider: repaired.provider,
            model: repaired.model,
            traceId: repaired.traceId,
            durationMs: repaired.durationMs,
            fallbackUsed: repaired.fallbackUsed,
            retryUsed: attempt > 1 || repaired.retryUsed,
            fallbackReason: failure.reason,
            outcome: failure.outcome,
            error: failure.error,
            warnings: failure.warnings,
          }
          useAIDebugStore.getState().failRequest(traceId, {
            provider: repaired.provider,
            model: repaired.model,
            durationMs: repaired.durationMs,
            retryUsed: repaired.retryUsed,
            fallbackUsed: repaired.fallbackUsed,
            errorCode: failure.reason,
            outcome: failure.outcome,
            warnings: failure.warnings,
          })
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[WeekCreatorEngine] validation failed', {
              attempt,
              traceId,
              error: validation.error,
            })
          }
          tracker.flush(outcome, { attempt, fallbackReason: failure.reason, validationError: failure.error })
          continue
        }

        useAIDebugStore.getState().completeRequest(traceId, {
          provider: repaired.provider,
          model: repaired.model,
          durationMs: repaired.durationMs,
          retryUsed: repaired.retryUsed,
          fallbackUsed: repaired.fallbackUsed,
        })

        const action = validation.action
        if (!action) {
          throw new Error('WeekCreator devolvió una validación exitosa sin acción create_week.')
        }
        const message = repaired.message.trim() || summarizeWeekCreatorAction(action)
        const warnings = [
          validation.warning,
          ...repaired.repairWarnings,
        ].filter((warning): warning is string => Boolean(warning?.trim()))
        const messageWithWarning = warnings.length > 0
          ? `${message}\n\nNota: ${warnings.join(' ')}`
          : message

        outcome = 'ok'
        tracker.flush(outcome, { attempt })
        return {
          ...repaired,
          actions: [action],
          message: messageWithWarning,
          requestClass: 'week_creator',
          retryUsed: attempt > 1 || repaired.retryUsed,
          meta: warnings.length > 0 && repaired.meta
            ? { ...repaired.meta, likelyTruncated: false }
            : repaired.meta,
        }
      } catch (error) {
        outcome = 'error'
        lastFailure = {
          provider: provider.name,
          traceId,
          retryUsed: attempt > 1,
          fallbackReason: 'provider_error',
          error: error instanceof Error ? error.message : String(error),
          warnings: [`week_creator_failure:provider_error`, error instanceof Error ? error.message : String(error)],
        }
        useAIDebugStore.getState().failRequest(traceId, {
          provider: provider.name,
          errorCode: 'provider_error',
          warnings: lastFailure.warnings,
        })
        tracker.flush(outcome, { attempt, error: lastFailure.error })
      }
    }

    // After exhausting retries, surface a real error to the chat store catch
    // block so the UI shows it instead of staying in an infinite loading state.
    const failureMessage = lastFailure?.error
      ? `No pude generar la semana después de ${MAX_ATTEMPTS} intentos: ${lastFailure.error}`
      : `No pude generar una semana válida después de ${MAX_ATTEMPTS} intentos. Revisa tu perfil y vuelve a intentarlo.`
    const failureTraceId = lastFailure?.traceId ?? buildAITraceId('week_creator')
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[WeekCreatorEngine] all attempts failed', {
        traceId: failureTraceId,
        provider: lastFailure?.provider,
        error: lastFailure?.error,
      })
    }
    const fallback = buildDeterministicWeekCreatorResponse({
      config,
      targetWeekStart: options.targetWeekStart,
      provider: lastFailure?.provider,
      error: failureMessage,
    })
    const fallbackValidation = validateWeekCreatorResponse({
      response: fallback,
      context,
      config,
      targetWeekStart: options.targetWeekStart,
    })
    if (!fallbackValidation.ok || !fallbackValidation.action) {
      throw new Error(`${failureMessage} (trace ${failureTraceId})`)
    }
    useAIDebugStore.getState().startRequest({
      traceId: fallback.traceId,
      requestClass: 'week_creator',
      surface,
      startedAt: Date.now(),
    })
    useAIDebugStore.getState().completeRequest(fallback.traceId, {
      provider: fallback.provider,
      model: fallback.model,
      durationMs: 0,
      retryUsed: true,
      fallbackUsed: true,
      errorCode: lastFailure?.fallbackReason,
      outcome: lastFailure?.outcome ?? 'schema_invalid',
      warnings: [
        buildWeekCreatorFallbackNote(lastFailure?.provider, MAX_ATTEMPTS),
        ...(lastFailure?.warnings ?? []),
      ],
    })
    return {
      ...fallback,
      actions: [fallbackValidation.action],
      retryUsed: true,
      fallbackUsed: true,
      message: `${summarizeWeekCreatorAction(fallbackValidation.action)}\n\nNota: ${buildWeekCreatorFallbackNote(lastFailure?.provider, MAX_ATTEMPTS)}`,
    }
  },
}

function classifyWeekCreatorFailure(
  error: string | undefined,
  response: CoachNormalizedResponse,
): WeekCreatorFailure {
  const message = error?.trim() || 'La respuesta del modelo no pasó la validación del Week Creator.'
  const meta = response.meta
  let reason: WeekCreatorFallbackReason = 'schema_invalid'
  let outcome: WeekCreatorFailure['outcome'] = 'schema_invalid'

  if (meta?.actionParseFailed || meta?.outcome === 'parse_invalid') {
    reason = 'actions_parse_failed'
    outcome = 'parse_invalid'
  } else if (/ninguna acción create_week/i.test(message)) {
    reason = 'missing_create_week'
  } else if (/más de una acción create_week/i.test(message)) {
    reason = 'multiple_create_week'
  } else if (/solo admite una acción create_week/i.test(message)) {
    reason = 'extra_actions'
  } else if (/targetDate=/i.test(message)) {
    reason = 'wrong_target_date'
  } else if (/no trae sesiones válidas/i.test(message)) {
    reason = 'missing_sessions'
  } else if (/exactamente \d+ sesiones válidas/i.test(message)) {
    reason = 'session_count_mismatch'
  } else if (/entre .* y los 6 días siguientes|fecha inválida/i.test(message)) {
    reason = 'invalid_week_dates'
  } else if (/colisiones|doble jornada|doble sesión|día no permitido|dos sesiones de squash el mismo día|duplicar squash/i.test(message)) {
    reason = 'schedule_conflict'
  } else if (/deportes permitidos|no está dentro de los deportes permitidos/i.test(message)) {
    reason = 'unsupported_sport'
  } else if (/requiere .*Details|drill fuera de catálogo|ejercicios|cyclingDetails|mobilityDetails/i.test(message)) {
    reason = 'missing_sport_details'
  } else if (/deporte principal/i.test(message)) {
    reason = 'missing_primary_sport'
  }

  return {
    reason,
    error: message,
    outcome,
    warnings: [
      `week_creator_failure:${reason}`,
      message,
      ...(meta?.warnings ?? []),
    ],
  }
}

function buildWeekCreatorFallbackNote(
  provider: CoachNormalizedResponse['provider'] | undefined,
  attempts: number,
): string {
  const providerLabel = provider && provider !== 'mock'
    ? `El proveedor ${provider}`
    : 'El proveedor de IA'
  return `${providerLabel} no devolvió una semana aplicable en formato estructurado después de ${attempts} intentos. Preparé una semana base segura con tu configuración actual para que puedas revisarla y ajustarla antes de aplicarla.`
}

type RepairedWeekCreatorResponse = CoachNormalizedResponse & {
  repairWarnings: string[]
}

function repairWeekCreatorResponse(
  response: CoachNormalizedResponse,
  context: ChatContext,
  config: WeekCreatorEffectiveConfig,
  targetWeekStart: string,
): RepairedWeekCreatorResponse {
  const actions = response.actions ?? []
  const createWeekActions = actions.filter((action) => action.type === 'create_week')
  if (createWeekActions.length !== 1) {
    return { ...response, repairWarnings: [] }
  }

  const action = createWeekActions[0]
  if (!Array.isArray(action.sessions) || action.sessions.length === 0) {
    return { ...response, repairWarnings: [] }
  }

  const profile = buildRepairProfile(context)
  const repairContext = buildRepairContext(profile, config, targetWeekStart)
  const repairResult = repairGeneratedWeek(action.sessions, repairContext)
  if (repairResult.meta.repairedSessionCount === 0
    && repairResult.meta.movedSessionCount === 0
    && repairResult.meta.addedFallbackCount === 0
    && repairResult.meta.droppedSessionCount === 0
    && repairResult.meta.filteredSportCount === 0
  ) {
    return { ...response, repairWarnings: [] }
  }

  const repairedAction: CoachAction = {
    ...action,
    targetDate: action.targetDate ?? targetWeekStart,
    sessions: repairResult.sessions,
  }
  const repairedActions = actions.map((item) => (item === action ? repairedAction : item))
  const repairWarnings = repairResult.meta.warnings.map((warning) => warning.message)

  return {
    ...response,
    actions: repairedActions,
    repairWarnings,
  }
}

function buildRepairProfile(context: ChatContext): AthleteProfile {
  if (context.athleteProfile) return context.athleteProfile
  return {
    id: 'week-creator-profile',
    updatedAt: Date.now(),
  }
}

function buildRepairContext(
  profile: ReturnType<typeof buildRepairProfile>,
  config: WeekCreatorEffectiveConfig,
  targetWeekStart: string,
) {
  const now = Date.now()
  const primarySport = config.primarySport ?? config.allowedSports[0] ?? 'squash'
  const sportDetails = buildSportDetails(config.allowedSports, primarySport)
  const macroSnapshot: MacroPlan = {
    goalEventId: profile.planWizardConfig?.goalEventId ?? 'week-creator',
    goalEventDate: addDaysIso(targetWeekStart, 6),
    currentPhase: profile.macroPlan?.currentPhase ?? 'base',
    weeksRemaining: profile.macroPlan?.weeksRemaining ?? 0,
    blockFocus: profile.macroPlan?.blockFocus ?? `Semana base de ${primarySport}`,
    headline: profile.macroPlan?.headline ?? `Semana de ${primarySport}`,
    timeline: [],
    sportDetails,
    secondaryEvents: [],
    computedAt: now,
  }
  const wizardConfig: PlanWizardConfig = {
    goalEventId: profile.planWizardConfig?.goalEventId ?? 'week-creator',
    trainingDays: config.trainingDays,
    sessionsPerWeek: config.sessionsPerWeek,
    sessionDurationMins: config.sessionDurationMins,
    allowDoubleSession: config.allowDoubleSession,
    complementarySports: config.allowedSports.filter((sport) => sport !== primarySport),
    currentFitnessLevel: config.currentFitnessLevel,
    currentFatigue: config.currentFatigue,
    injuryNotes: config.injuryNotes,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  }
  const plan: TrainingPlan = {
    id: 'week-creator-plan',
    athleteId: profile.id,
    goalEventId: wizardConfig.goalEventId,
    status: 'draft',
    generationState: 'shell',
    title: 'Week Creator',
    startDate: targetWeekStart,
    endDate: addDaysIso(targetWeekStart, 6),
    totalWeeks: 1,
    phases: [],
    wizardConfig,
    macroSnapshot,
    createdAt: now,
    updatedAt: now,
  }
  const week: TrainingPlanWeek = {
    id: 'week-creator-week',
    planId: plan.id,
    weekIndex: 0,
    weekStartDate: targetWeekStart,
    phase: macroSnapshot.currentPhase,
    status: 'draft',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 1 },
    createdAt: now,
    updatedAt: now,
  }

  return { plan, week, profile, wizardConfig }
}

function buildSportDetails(allowedSports: SupportedSport[], primarySport: SupportedSport) {
  const sports = allowedSports.length > 0 ? allowedSports : [primarySport]
  return [...new Set(sports)].map((sport) => ({
    sport,
    role: sport === primarySport ? 'primary' as const : 'support' as const,
    phaseFocus: sport === primarySport ? 'mantener continuidad del deporte principal' : 'soporte de baja interferencia',
    weeklyIntent: sport === primarySport ? 'progress' : 'support',
    volumeBias: sport === primarySport ? 'build' as const : 'hold' as const,
    intensityBias: 'hold' as const,
    notes: sport === primarySport ? 'Deporte principal declarado en el perfil.' : 'Deporte complementario habilitado.',
  }))
}

function addDaysIso(date: string, days: number): string {
  const start = new Date(`${date}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() + days)
  return start.toISOString().slice(0, 10)
}

function buildDeterministicWeekCreatorResponse(input: {
  config: WeekCreatorEffectiveConfig
  targetWeekStart: string
  provider?: CoachNormalizedResponse['provider']
  error?: string
}): CoachNormalizedResponse {
  const action: CoachAction = {
    type: 'create_week',
    reason: 'Fallback local: el provider no entregó una acción create_week válida.',
    targetDate: input.targetWeekStart,
    weekObjectives: [
      'Mantener continuidad con carga controlada.',
      'Priorizar el deporte principal sin perder soporte complementario.',
      'Dejar una semana ejecutable y fácil de ajustar.',
    ],
    sessions: buildDeterministicSessions(input.config, input.targetWeekStart),
  }

  return {
    message: summarizeWeekCreatorAction(action),
    actions: [action],
    provider: 'mock',
    model: `local-week-fallback${input.provider ? `-after-${input.provider}` : ''}`,
    timestamp: Date.now(),
    durationMs: 0,
    traceId: buildAITraceId('week_creator'),
    requestClass: 'week_creator',
    retryUsed: true,
    fallbackUsed: true,
    raw: input.error ? { fallbackReason: input.error } : undefined,
    meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false, outcome: 'ok' },
  }
}

function buildDeterministicSessions(
  config: WeekCreatorEffectiveConfig,
  targetWeekStart: string,
): CoachSessionProposal[] {
  const sportSequence = buildFallbackSportSequence(config)
  const plannedSlots = buildFallbackSlots(config, targetWeekStart, sportSequence.length)

  return sportSequence.map((sport, index) => {
    const slot = plannedSlots[index]
    return buildFallbackSession(sport, slot.date, slot.timeBlock, config.sessionDurationMins, index)
  })
}

function buildFallbackSportSequence(config: WeekCreatorEffectiveConfig): SupportedSport[] {
  const primary = config.primarySport ?? config.allowedSports[0] ?? 'squash'
  const allowed = uniqueSports([primary, ...config.allowedSports])
  const supportSports = allowed.filter((sport) => sport !== primary)
  const total = Math.max(1, config.sessionsPerWeek)
  const primaryTarget = getFallbackPrimaryTarget(config, primary, total, supportSports.length > 0)
  const sequence: SupportedSport[] = []
  let primaryCount = 0
  let supportIndex = 0

  for (let index = 0; index < total; index++) {
    const remainingSlots = total - index
    const remainingPrimary = primaryTarget - primaryCount
    const mustUsePrimary = remainingPrimary >= remainingSlots
    const shouldUsePrimary = primaryCount < primaryTarget && (index % 2 === 0 || supportSports.length === 0)
    if (mustUsePrimary || shouldUsePrimary) {
      sequence.push(primary)
      primaryCount += 1
      continue
    }

    sequence.push(supportSports[supportIndex % supportSports.length] ?? primary)
    supportIndex += 1
  }

  return sequence
}

function getFallbackPrimaryTarget(
  config: WeekCreatorEffectiveConfig,
  primary: SupportedSport,
  total: number,
  hasSupportSports: boolean,
): number {
  const majorityTarget = primary === 'squash' && total >= 4
    ? Math.floor(total / 2) + 1
    : Math.min(total, Math.max(1, Math.ceil(total / 2)))

  if (!hasSupportSports) return majorityTarget

  // If capacity comes from double sessions across only a few days, avoid
  // forcing the same primary sport twice on one date. A squash+strength day is
  // much more useful than squash+squash when we are in local fallback mode.
  const perDayPrimaryCap = Math.max(1, config.trainingDays.length)
  return Math.min(majorityTarget, perDayPrimaryCap)
}

function uniqueSports(sports: SupportedSport[]): SupportedSport[] {
  return sports.filter((sport, index) => sports.indexOf(sport) === index)
}

function buildFallbackSlots(
  config: WeekCreatorEffectiveConfig,
  targetWeekStart: string,
  count: number,
): Array<{ date: string; timeBlock: TimeBlock }> {
  const fallbackDays: DayOfWeek[] = ['monday', 'wednesday', 'friday']
  const allowedDays = config.trainingDays.length > 0 ? config.trainingDays : fallbackDays
  const dates = allowedDays
    .map((day) => addDaysIso(targetWeekStart, dayOffset(day)))
    .sort()
  const slots: Array<{ date: string; timeBlock: TimeBlock }> = []

  for (const date of dates) {
    slots.push({ date, timeBlock: 'AM' })
  }

  if (config.allowDoubleSession) {
    for (const date of dates) {
      slots.push({ date, timeBlock: 'PM' })
    }
  }

  return slots.slice(0, count)
}

function dayOffset(day: DayOfWeek): number {
  const offsets: Record<DayOfWeek, number> = {
    monday: 0,
    tuesday: 1,
    wednesday: 2,
    thursday: 3,
    friday: 4,
    saturday: 5,
    sunday: 6,
  }
  return offsets[day]
}

function buildFallbackSession(
  sport: SupportedSport,
  date: string,
  timeBlock: TimeBlock,
  baseDurationMin: number,
  index: number,
): CoachSessionProposal {
  const durationMin = sport === 'mobility' ? Math.min(40, baseDurationMin) : baseDurationMin
  const base = {
    date,
    timeBlock,
    sessionType: sport,
    durationMin,
    rpe: sport === 'mobility' ? 3 : sport === 'strength' ? 6 : 5,
  }

  if (sport === 'running') {
    return {
      ...base,
      title: 'Rodaje Z2 controlado',
      objective: 'Sumar carga aeróbica sin interferir con el deporte principal.',
      runningType: 'z2',
      targetHrMin: 130,
      targetHrMax: 150,
    }
  }

  if (sport === 'strength') {
    const variants = [
      [
        { name: 'Sentadilla goblet', sets: 3, reps: 8, group: 'legs' as const },
        { name: 'Remo con pecho apoyado', sets: 3, reps: 10, group: 'pull' as const },
        { name: 'Press sobre cabeza', sets: 3, reps: '8/lado', group: 'push' as const },
        { name: 'Zancada lateral con barra', sets: 3, reps: '8/lado', group: 'legs' as const },
        { name: 'Plancha lateral', sets: 3, reps: '30s/lado', group: 'core' as const },
      ],
      [
        { name: 'Peso muerto rumano', sets: 3, reps: 8, group: 'legs' as const },
        { name: 'Press inclinado con mancuernas', sets: 3, reps: 8, group: 'push' as const },
        { name: 'Remo invertido', sets: 3, reps: 10, group: 'pull' as const },
        { name: 'Sentadilla en zancada', sets: 3, reps: '8/lado', group: 'legs' as const },
        { name: 'Press Pallof', sets: 3, reps: '10/lado', group: 'core' as const },
      ],
    ]
    return {
      ...base,
      title: index % 2 === 0 ? 'Fuerza base tren inferior' : 'Fuerza soporte torso',
      objective: 'Construir soporte general con fatiga controlada.',
      exercises: variants[index % variants.length],
    }
  }

  if (sport === 'cycling') {
    return {
      ...base,
      title: 'Ciclismo Z2 suave',
      objective: 'Base aeróbica de baja interferencia.',
      cyclingDetails: {
        sessionCategory: 'support aerobic',
        sessionFamily: 'z2_aerobic',
        targetStructure: `${durationMin}min continuos en Z2, cadencia cómoda.`,
        intensityReference: 'low',
        executionNotes: 'Mantén sensación conversacional y evita cerrar fuerte.',
      },
    }
  }

  if (sport === 'mobility') {
    return {
      ...base,
      title: 'Movilidad restaurativa',
      objective: 'Liberar cadera, columna y tobillo para sostener la semana.',
      exercises: [
        { name: '90/90 de cadera', sets: 2, reps: '60s/lado', group: 'mobility', mobilityFocus: 'hip' },
        { name: 'Rotación torácica', sets: 2, reps: '8/lado', group: 'mobility', mobilityFocus: 'spine' },
        { name: 'Movilidad de tobillo', sets: 2, reps: '10/lado', group: 'mobility', mobilityFocus: 'ankle' },
      ],
      mobilityDetails: {
        focusAreas: ['hip', 'spine', 'ankle'],
        context: 'full_body',
        targetStructure: `${durationMin}min de movilidad continua, sin dolor y con respiración nasal.`,
        executionNotes: 'Usa rango cómodo; debe dejarte mejor, no cansado.',
      },
    }
  }

  const squashVariants = [
    {
      title: 'Squash técnico de profundidad',
      trainingFocus: 'technical' as const,
      sessionKind: 'technical' as const,
      drills: [
        { name: 'Tiros paralelos profundos', durationMin: 18 },
        { name: 'Tiros cruzados profundos', durationMin: 16 },
      ],
    },
    {
      title: 'Squash control en solitario',
      trainingFocus: 'technical' as const,
      sessionKind: 'control' as const,
      drills: [
        { name: '100 drops en solitario (50 por lado)', durationMin: 20 },
        { name: '100 drives al cuadro de saque', durationMin: 18 },
      ],
    },
    {
      title: 'Squash desplazamientos y timing',
      trainingFocus: 'physical' as const,
      sessionKind: 'shadows' as const,
      drills: [
        { name: 'Ghosting a cuatro esquinas', durationMin: 18 },
        { name: 'Split-step y vuelta a la T', durationMin: 14 },
      ],
    },
    {
      title: 'Squash presión de fondo',
      trainingFocus: 'tactical' as const,
      sessionKind: 'technical' as const,
      drills: [
        { name: 'Presión a esquinas de fondo', durationMin: 18 },
        { name: 'Juego condicionado solo al fondo', durationMin: 16 },
      ],
    },
    {
      title: 'Squash ataque controlado',
      trainingFocus: 'conditioned_games' as const,
      sessionKind: 'technical' as const,
      drills: [
        { name: 'Ataque desde tres cuartos de cancha', durationMin: 18 },
        { name: 'Definición con ángulo en zona delantera', durationMin: 14 },
      ],
    },
    {
      title: 'Squash voleas y transición',
      trainingFocus: 'technical' as const,
      sessionKind: 'technical' as const,
      drills: [
        { name: 'Volea de control desde media cancha', durationMin: 16 },
        { name: 'Transición frente-fondo con vuelta a la T', durationMin: 16 },
      ],
    },
  ]
  const variant = squashVariants[index % squashVariants.length]

  return {
    ...base,
    sessionType: 'squash',
    title: variant.title,
    objective: 'Mantener calidad técnica y desplazamiento sin exceder la carga.',
    subtype: 'training',
    squashDetails: {
      trainingFocus: variant.trainingFocus,
      sessionMode: 'drill_session',
      sessionKind: variant.sessionKind,
      drills: variant.drills,
    },
  }
}
