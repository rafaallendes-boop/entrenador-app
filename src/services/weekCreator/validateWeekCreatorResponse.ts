import type { ChatContext, CoachAction, CoachSessionProposal, DayOfWeek, SupportedSport } from '../../types'
import type { CoachNormalizedResponse } from '../ai/types'
import { ACTION_CONTRACTS } from '../ai/prompt/core/outputContract'
import { validateAgainstContract } from '../ai/prompt/validators/validateAgainstContract'
import { findSquashDrillByName } from '../training/drillLibrary'
import { resolveSquashMatchRole } from '../training/squashMatchRole'
import { filterSessionsToWeek, isStrictISODate, pickCreateWeekDiagnostic } from '../week/shared'
import type { WeekCreatorEffectiveConfig } from './WeekCreatorConfig'
import type { WeekCreatorValidationCode } from './WeekCreatorFailurePolicy'
import { resolveDayScheduleConstraint } from './scheduleConstraints'
import { resolveWeekCreatorEventContext } from './WeekCreatorEventContext'
import { isDeclaredSquashMatchSession } from '../planBuilder/eventWindowRules'

/**
 * Fields where structural recursion stops. Their internal validation is owned
 * by the imperative checks below because:
 *   - squashDetails / cyclingDetails / mobilityDetails / intervalStructure — required-ness depends
 *     on the sibling sessionType discriminator, and inner rules (drill catalog
 *     membership, focus consistency) are deportive business logic.
 *   - exercises — items use union types (e.g. reps accepts number | string)
 *     that the structural FieldSpec cannot currently express.
 */
const SKIP_DEEP_FIELDS = ['squashDetails', 'cyclingDetails', 'mobilityDetails', 'intervalStructure', 'exercises'] as const

export interface WeekCreatorValidationInput {
  response: CoachNormalizedResponse
  context: ChatContext
  config: WeekCreatorEffectiveConfig
  targetWeekStart: string
  planningStartDate?: string
  /**
   * Bloques de fuerza retirados por seguridad. Siguen ocupando su cupo para el
   * conteo y la presencia de deportes: la semana es parcial a propósito, no
   * incompleta por un error del modelo.
   */
  safetyDroppedSlots?: readonly { date: string; timeBlock: CoachSessionProposal['timeBlock'] }[]
}

export interface WeekCreatorValidationResult {
  ok: boolean
  action?: CoachAction
  code?: WeekCreatorValidationCode
  error?: string
  warning?: string
  rawSessionCount?: number
  validSessionCount?: number
  droppedSessionCount?: number
}

export function validateWeekCreatorResponse(
  input: WeekCreatorValidationInput,
): WeekCreatorValidationResult {
  const responseActions = input.response.actions ?? []
  const createWeekActions = responseActions.filter((action) => action.type === 'create_week')
  if (createWeekActions.length !== 1) {
    return {
      ok: false,
      code: createWeekActions.length === 0 ? 'missing_create_week' : 'multiple_create_week',
      error: createWeekActions.length === 0
        ? 'El modelo no devolvió ninguna acción create_week.'
        : 'El modelo devolvió más de una acción create_week y este flujo solo admite una semana.',
    }
  }
  if (responseActions.length !== createWeekActions.length) {
    return fail('extra_actions', 'Week Creator solo admite una acción create_week sin acciones adicionales.')
  }

  const action = createWeekActions[0]
  const diagnostic = pickCreateWeekDiagnostic(input.response, input.targetWeekStart, action)
  const rawSessionCount = diagnostic?.rawSessions ?? action.sessions?.length
  const validSessionCount = diagnostic?.validSessions ?? action.sessions?.length
  const droppedSessionCount = diagnostic?.droppedSessions ?? (
    rawSessionCount != null && validSessionCount != null ? rawSessionCount - validSessionCount : undefined
  )

  const shapeCheck = validateAgainstContract(action, ACTION_CONTRACTS.create_week, {
    skipDeep: SKIP_DEEP_FIELDS,
  })
  if (!shapeCheck.ok) {
    return fail(
      'invalid_action_contract',
      `La acción create_week no cumple el contrato estructural — ${shapeCheck.error}.`,
      rawSessionCount, validSessionCount, droppedSessionCount,
    )
  }

  if (action.targetDate !== input.targetWeekStart) {
    return fail('wrong_target_date', `La acción create_week debe usar targetDate=${input.targetWeekStart}.`, rawSessionCount, validSessionCount, droppedSessionCount)
  }

  const sessions = action.sessions as CoachSessionProposal[]
  const weekCheck = validateSessionWeekBoundaries(sessions, input.targetWeekStart, input.planningStartDate)
  if (weekCheck) return fail('invalid_week_dates', weekCheck, rawSessionCount, validSessionCount, droppedSessionCount)
  const eventContext = resolveWeekCreatorEventContext({
    profile: input.context.athleteProfile,
    targetWeekStart: input.targetWeekStart,
    weekEndDate: addDaysIso(input.targetWeekStart, 6),
    planningStartDate: input.planningStartDate,
    primarySport: input.config.primarySport,
  })
  const eventAnchorDate = eventContext.anchorInsidePlanningWindow
    ? eventContext.anchorDate
    : undefined

  const quotaSessions: CoachSessionProposal[] = [
    ...sessions,
    ...(input.safetyDroppedSlots ?? []).map((slot) => ({
      date: slot.date, timeBlock: slot.timeBlock, sessionType: 'strength' as const, title: '', durationMin: 0,
    })),
  ]
  if (quotaSessions.length !== input.config.sessionsPerWeek) {
    const droppedInfo = droppedSessionCount && droppedSessionCount > 0
      ? ` Se descartaron ${droppedSessionCount} sesión(es) inválidas durante la normalización.`
      : ''
    return fail(
      'session_count_mismatch',
      `La semana debe traer exactamente ${input.config.sessionsPerWeek} sesiones válidas y llegó con ${quotaSessions.length}.${droppedInfo}`,
      rawSessionCount, validSessionCount, droppedSessionCount,
    )
  }

  const collisionError = validateCollisions(sessions)
  if (collisionError) return fail('slot_collision', collisionError, rawSessionCount, validSessionCount, droppedSessionCount)

  const doubleSessionError = validateDoubleSessions(sessions, input.config)
  if (doubleSessionError) return fail('invalid_double_session', doubleSessionError, rawSessionCount, validSessionCount, droppedSessionCount)

  const sameDaySquashError = validateSameDaySquashSessions(sessions, input.config)
  if (sameDaySquashError) return fail('duplicate_primary_same_day', sameDaySquashError, rawSessionCount, validSessionCount, droppedSessionCount)

  const duplicateSquashError = validateDuplicateSquashSessions(sessions)
  if (duplicateSquashError) return fail('duplicate_squash_content', duplicateSquashError, rawSessionCount, validSessionCount, droppedSessionCount)

  const duplicateStrengthError = validateDuplicateStrengthSessions(sessions)
  if (duplicateStrengthError) return fail('duplicate_strength_content', duplicateStrengthError, rawSessionCount, validSessionCount, droppedSessionCount)

  const dayError = validateAllowedDays(sessions, input.config, eventAnchorDate)
  if (dayError) return fail('unavailable_day', dayError, rawSessionCount, validSessionCount, droppedSessionCount)

  const timeConstraintError = validateScheduleTimeConstraints(sessions, input.config, eventAnchorDate)
  if (timeConstraintError) return fail('schedule_constraint', timeConstraintError, rawSessionCount, validSessionCount, droppedSessionCount)

  const sportError = validateAllowedSports(sessions, input.config)
  if (sportError) return fail('unsupported_sport', sportError, rawSessionCount, validSessionCount, droppedSessionCount)

  const detailsError = validateRequiredDetails(sessions)
  if (detailsError) return fail('missing_sport_details', detailsError, rawSessionCount, validSessionCount, droppedSessionCount)

  const primarySportError = validatePrimarySportPresence(quotaSessions, input.config)
  if (primarySportError) return fail('missing_primary_sport', primarySportError, rawSessionCount, validSessionCount, droppedSessionCount)

  const supportSportError = validateSupportSportPresence(quotaSessions, input.config)
  if (supportSportError) return fail('missing_support_sport', supportSportError, rawSessionCount, validSessionCount, droppedSessionCount)

  const sportWarnings = collectSportDetailWarnings(sessions)

  return {
    ok: true,
    action,
    warning: sportWarnings.length > 0 ? sportWarnings.join(' ') : undefined,
    rawSessionCount,
    validSessionCount,
    droppedSessionCount,
  }
}

function validateSessionWeekBoundaries(
  sessions: CoachSessionProposal[],
  targetWeekStart: string,
  planningStartDate = targetWeekStart,
): string | undefined {
  for (const session of sessions) {
    if (!isStrictISODate(session.date)) {
      return `La sesión ${session.title} tiene fecha inválida (${session.date}).`
    }
  }
  if (filterSessionsToWeek(sessions, targetWeekStart).length !== sessions.length) {
    return `Todas las sesiones deben caer entre ${targetWeekStart} y los 6 días siguientes.`
  }
  const weekEnd = addDaysIso(targetWeekStart, 6)
  if (sessions.some((session) => session.date < planningStartDate || session.date > weekEnd)) {
    return `Todas las sesiones deben caer entre ${planningStartDate} y ${weekEnd}.`
  }
  return undefined
}

function addDaysIso(date: string, days: number): string {
  const start = new Date(`${date}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() + days)
  return start.toISOString().slice(0, 10)
}

function validateCollisions(sessions: CoachSessionProposal[]): string | undefined {
  const seen = new Set<string>()
  for (const session of sessions) {
    const key = `${session.date}|${session.timeBlock}`
    if (seen.has(key)) return `No se permiten colisiones de sesiones en ${session.date} ${session.timeBlock}.`
    seen.add(key)
  }
  return undefined
}

function validateDoubleSessions(
  sessions: CoachSessionProposal[],
  config: WeekCreatorEffectiveConfig,
): string | undefined {
  const byDate = new Map<string, number>()
  for (const session of sessions) {
    byDate.set(session.date, (byDate.get(session.date) ?? 0) + 1)
  }

  if (config.allowDoubleSession) {
    for (const [date, count] of byDate.entries()) {
      if (count <= 1) continue
      if (count > 2) {
        return `No programes más de dos sesiones el mismo día (${date}).`
      }
      if (!canUseDoubleSessionOnDate(date, config)) {
        return `La doble sesión del ${date} cae en un día no marcado como doble sesión posible.`
      }
    }

    const hasExplicitDoubleDays = (config.doubleSessionDays ?? []).length > 0
    if (!hasExplicitDoubleDays && config.trainingDays.length >= sessions.length) {
      const repeatedDate = [...byDate.entries()].find(([, count]) => count > 1)
      if (repeatedDate) {
        return `Evita doble jornada el ${repeatedDate[0]}: hay suficientes días disponibles para repartir ${sessions.length} sesiones.`
      }
    }
    return undefined
  }

  for (const [date, count] of byDate.entries()) {
    if (count > 1) {
      return `La configuración actual no permite doble sesión y la semana propone ${count} sesiones el ${date}.`
    }
  }
  return undefined
}

function canUseDoubleSessionOnDate(
  date: string,
  config: WeekCreatorEffectiveConfig,
): boolean {
  if (!config.allowDoubleSession) return false
  const doubleSessionDays = config.doubleSessionDays ?? []
  if (doubleSessionDays.length === 0) return true
  const day = isoDateToDayOfWeek(date)
  return Boolean(day && doubleSessionDays.includes(day))
}

function validateSameDaySquashSessions(
  sessions: CoachSessionProposal[],
  config: WeekCreatorEffectiveConfig,
): string | undefined {
  const squashSessions = sessions.filter((session) => session.sessionType === 'squash')
  if (squashSessions.length < 2) return undefined

  const byDate = new Map<string, CoachSessionProposal[]>()
  for (const session of squashSessions) {
    byDate.set(session.date, [...(byDate.get(session.date) ?? []), session])
  }

  const repeatedDate = [...byDate.entries()].find(([, items]) => items.length > 1)
  if (!repeatedDate) return undefined

  if (config.trainingDays.length >= squashSessions.length) {
    return `No programes dos sesiones de squash el mismo día (${repeatedDate[0]}) cuando hay días disponibles para separarlas.`
  }

  if (config.allowedSports.some((sport) => sport !== 'squash')) {
    return `Evita duplicar squash el ${repeatedDate[0]}; usa la segunda jornada para fuerza, running, cycling o movilidad si están permitidos.`
  }

  return undefined
}

function validateDuplicateSquashSessions(sessions: CoachSessionProposal[]): string | undefined {
  const seen = new Map<string, CoachSessionProposal>()
  for (const session of sessions) {
    if (session.sessionType !== 'squash') continue
    // Dos partidos al mejor de 5 comparten formato, pero no son una
    // prescripción de drills repetida.
    if (resolveSquashMatchRole(session.squashDetails) === 'standalone') continue
    const signature = buildSquashDrillSignature(session)
    if (!signature) continue

    const previous = seen.get(signature)
    if (previous) {
      return `Las sesiones de squash "${previous.title}" y "${session.title}" repiten los mismos drills; deben tener focos o ejercicios distintos.`
    }
    seen.set(signature, session)
  }
  return undefined
}

function buildSquashDrillSignature(session: CoachSessionProposal): string | undefined {
  const drills = getSquashDrills(session)
  if (drills.length === 0) return undefined
  return drills
    .map((drill) => findSquashDrillByName(drill.name)?.id ?? drill.name.trim().toLowerCase())
    .sort()
    .join('|')
}

function validateDuplicateStrengthSessions(sessions: CoachSessionProposal[]): string | undefined {
  const seen = new Map<string, CoachSessionProposal>()
  for (const session of sessions) {
    if (session.sessionType !== 'strength') continue
    const signature = buildStrengthExerciseSignature(session)
    if (!signature) continue
    const previous = seen.get(signature)
    if (previous) {
      return `Las sesiones de fuerza "${previous.title}" y "${session.title}" repiten exactamente los mismos ejercicios; deben tener focos o ejercicios distintos.`
    }
    seen.set(signature, session)
  }
  return undefined
}

function buildStrengthExerciseSignature(session: CoachSessionProposal): string | undefined {
  if (!Array.isArray(session.exercises) || session.exercises.length === 0) return undefined
  return session.exercises
    .map((exercise) => [
      exercise.name.trim().toLowerCase(),
      exercise.sets,
      String(exercise.reps).trim().toLowerCase(),
      exercise.weight ?? '',
      exercise.group ?? '',
    ].join(':'))
    .join('|')
}

function validateAllowedDays(
  sessions: CoachSessionProposal[],
  config: WeekCreatorEffectiveConfig,
  eventAnchorDate?: string,
): string | undefined {
  const allowedDays = new Set(config.trainingDays)
  for (const session of sessions) {
    if (session.date === eventAnchorDate && isDeclaredSquashMatchSession(session)) continue
    const day = isoDateToDayOfWeek(session.date)
    if (!day || !allowedDays.has(day)) {
      return `La sesión ${session.title} cae en un día no permitido por la configuración (${session.date}).`
    }
  }
  return undefined
}

function validateScheduleTimeConstraints(
  sessions: CoachSessionProposal[],
  config: WeekCreatorEffectiveConfig,
  eventAnchorDate?: string,
): string | undefined {
  for (const session of sessions) {
    if (session.date === eventAnchorDate && isDeclaredSquashMatchSession(session)) continue
    const day = isoDateToDayOfWeek(session.date)
    if (!day) continue
    const constraint = resolveDayScheduleConstraint(config.scheduleConstraints, day)

    if (constraint === 'unavailable') {
      return `La sesión ${session.title} cae en ${session.date}, pero las restricciones horarias indican que ese día no está disponible.`
    }
    if (constraint === 'AM' && session.timeBlock !== 'AM') {
      return `La sesión ${session.title} cae en ${session.date} ${session.timeBlock}, pero las restricciones horarias indican solo AM para ese día.`
    }
    if (constraint === 'PM' && session.timeBlock !== 'PM') {
      return `La sesión ${session.title} cae en ${session.date} ${session.timeBlock}, pero las restricciones horarias indican solo PM para ese día.`
    }
  }

  return undefined
}

function validateAllowedSports(
  sessions: CoachSessionProposal[],
  config: WeekCreatorEffectiveConfig,
): string | undefined {
  const allowedSports = new Set<SupportedSport>([...config.allowedSports, 'mobility'])

  const invalid = sessions.find((session) => {
    const sport = normalizeSessionSport(session)
    return sport != null && !allowedSports.has(sport)
  })
  if (invalid) {
    return `La sesión ${invalid.title} usa ${invalid.sessionType}, que no está dentro de los deportes permitidos.`
  }
  return undefined
}

function validateRequiredDetails(sessions: CoachSessionProposal[]): string | undefined {
  for (const session of sessions) {
    if (session.sessionType === 'squash') {
      if (!session.squashDetails || !hasSquashDrills(session)) {
        return `La sesión de squash ${session.title} requiere squashDetails con drills no vacíos.`
      }
      const unknownDrill = getSquashDrills(session).find((drill) => !findSquashDrillByName(drill.name))
      if (unknownDrill) {
        return `La sesión de squash ${session.title} usa un drill fuera de catálogo: "${unknownDrill.name}". Usa nombres de la librería visible.`
      }
    }
  }
  return undefined
}

function hasSquashDrills(session: CoachSessionProposal): boolean {
  const details = session.squashDetails
  if (!details) return false
  if (Array.isArray(details.drills) && details.drills.length > 0) return true
  return Array.isArray(details.blocks)
    && details.blocks.some(block => Array.isArray(block.drills) && block.drills.length > 0)
}

function getSquashDrills(session: CoachSessionProposal) {
  const details = session.squashDetails
  if (!details) return []
  return [
    ...(Array.isArray(details.drills) ? details.drills : []),
    ...(Array.isArray(details.blocks)
      ? details.blocks.flatMap((block) => Array.isArray(block.drills) ? block.drills : [])
      : []),
  ].filter((drill) => typeof drill.name === 'string' && drill.name.trim().length > 0)
}

function collectSportDetailWarnings(sessions: CoachSessionProposal[]): string[] {
  const warnings: string[] = []
  for (const session of sessions) {
    if (session.sessionType === 'running') {
      if (!session.runningType) {
        warnings.push(`La sesión de running "${session.title}" no especifica runningType.`)
      } else if ((session.runningType === 'tempo' || session.runningType === 'intervals') && !session.intervalStructure) {
        warnings.push(`La sesión de running "${session.title}" no incluye intervalStructure.`)
      }
    }
    if (session.sessionType === 'strength' && (!Array.isArray(session.exercises) || session.exercises.length === 0)) {
      warnings.push(`La sesión de fuerza "${session.title}" no incluye ejercicios.`)
    }
    if (session.sessionType === 'cycling' && !session.cyclingDetails) {
      warnings.push(`La sesión de ciclismo "${session.title}" no incluye cyclingDetails.`)
    }
    if (session.sessionType === 'mobility' && !session.mobilityDetails) {
      warnings.push(`La sesión de movilidad "${session.title}" no incluye mobilityDetails.`)
    }
  }
  return warnings
}

function validatePrimarySportPresence(
  sessions: CoachSessionProposal[],
  config: WeekCreatorEffectiveConfig,
): string | undefined {
  const primarySport = config.primarySport
  if (!primarySport) return undefined
  const count = sessions.filter((session) => session.sessionType === primarySport).length
  const minimum = getMinimumPrimarySessions(config, primarySport)
  if (count < minimum) {
    return `La semana debe incluir al menos ${minimum} sesión${minimum === 1 ? '' : 'es'} de ${primarySport}.`
  }
  return undefined
}

function validateSupportSportPresence(
  sessions: CoachSessionProposal[],
  config: WeekCreatorEffectiveConfig,
): string | undefined {
  const primarySport = config.primarySport
  if (primarySport !== 'squash' || config.sessionsPerWeek < 4) return undefined

  const supportSports = config.allowedSports.filter((sport) => sport !== primarySport)
  if (supportSports.length === 0) return undefined

  const minimumPrimary = getMinimumPrimarySessions(config, primarySport)
  const supportSlots = Math.max(0, config.sessionsPerWeek - minimumPrimary)
  if (supportSlots === 0) return undefined

  const presentSupportSports = new Set(
    sessions
      .map((session) => normalizeSessionSport(session))
      .filter((sport): sport is SupportedSport => sport != null && sport !== primarySport && supportSports.includes(sport)),
  )

  if (supportSlots === 1) {
    if (presentSupportSports.size === 0) {
      return `La semana debe usar 1 cupo accesorio con un deporte de soporte permitido (${supportSports.join(', ')}).`
    }
    return undefined
  }

  const requiredSupportSports = supportSports.slice(0, supportSlots)
  const missing = requiredSupportSports.filter((sport) => !presentSupportSports.has(sport))

  if (missing.length > 0) {
    return `La semana debe usar ${supportSlots} cupo${supportSlots === 1 ? '' : 's'} accesorio${supportSlots === 1 ? '' : 's'} con deportes de soporte permitidos (${requiredSupportSports.join(', ')}); faltan ${missing.join(', ')}.`
  }

  return undefined
}

function getMinimumPrimarySessions(
  config: WeekCreatorEffectiveConfig,
  primarySport: SupportedSport,
): number {
  if (primarySport !== 'squash' || config.sessionsPerWeek < 4) return 1
  const supportSports = config.allowedSports.filter((sport) => sport !== primarySport)
  const majorityTarget = Math.floor(config.sessionsPerWeek / 2) + 1
  if (supportSports.length === 0) return majorityTarget
  return Math.min(majorityTarget, Math.max(1, config.trainingDays.length))
}

function isoDateToDayOfWeek(date: string): DayOfWeek | null {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  const mapping: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return mapping[weekday] ?? null
}

function normalizeSessionSport(session: CoachSessionProposal): SupportedSport | undefined {
  switch (session.sessionType) {
    case 'squash':
    case 'running':
    case 'strength':
    case 'cycling':
    case 'mobility':
      return session.sessionType
    default:
      return undefined
  }
}

function fail(
  code: WeekCreatorValidationCode,
  error: string,
  rawSessionCount?: number,
  validSessionCount?: number,
  droppedSessionCount?: number,
): WeekCreatorValidationResult {
  return { ok: false, code, error, rawSessionCount, validSessionCount, droppedSessionCount }
}
