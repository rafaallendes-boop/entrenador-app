import type { ChatContext, CoachAction, CoachSessionProposal, DayOfWeek, SupportedSport } from '../../types'
import type { CoachNormalizedResponse } from '../ai/types'
import { filterSessionsToWeek, isStrictISODate, pickCreateWeekDiagnostic } from '../week/shared'
import type { WeekCreatorEffectiveConfig } from './WeekCreatorConfig'

export interface WeekCreatorValidationInput {
  response: CoachNormalizedResponse
  context: ChatContext
  config: WeekCreatorEffectiveConfig
  targetWeekStart: string
}

export interface WeekCreatorValidationResult {
  ok: boolean
  action?: CoachAction
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
      error: createWeekActions.length === 0
        ? 'El modelo no devolvió ninguna acción create_week.'
        : 'El modelo devolvió más de una acción create_week y este flujo solo admite una semana.',
    }
  }
  if (responseActions.length !== createWeekActions.length) {
    return fail('Week Creator solo admite una acción create_week sin acciones adicionales.')
  }

  const action = createWeekActions[0]
  const diagnostic = pickCreateWeekDiagnostic(input.response, input.targetWeekStart, action)
  const rawSessionCount = diagnostic?.rawSessions ?? action.sessions?.length
  const validSessionCount = diagnostic?.validSessions ?? action.sessions?.length
  const droppedSessionCount = diagnostic?.droppedSessions ?? (
    rawSessionCount != null && validSessionCount != null ? rawSessionCount - validSessionCount : undefined
  )

  if (action.targetDate !== input.targetWeekStart) {
    return fail(`La acción create_week debe usar targetDate=${input.targetWeekStart}.`, rawSessionCount, validSessionCount, droppedSessionCount)
  }

  if (!Array.isArray(action.sessions) || action.sessions.length === 0) {
    return fail('La acción create_week no trae sesiones válidas.', rawSessionCount, validSessionCount, droppedSessionCount)
  }

  const sessions = action.sessions
  const weekCheck = validateSessionWeekBoundaries(sessions, input.targetWeekStart)
  if (weekCheck) return fail(weekCheck, rawSessionCount, validSessionCount, droppedSessionCount)

  let warning: string | undefined
  if (sessions.length !== input.config.sessionsPerWeek) {
    const partialWarning = buildPartialWeekWarning({
      diagnostic,
      expectedSessions: input.config.sessionsPerWeek,
      validSessions: sessions.length,
    })
    if (!partialWarning) {
      const droppedInfo = droppedSessionCount && droppedSessionCount > 0
        ? ` Se descartaron ${droppedSessionCount} sesión(es) inválidas durante la normalización.`
        : ''
      return fail(
        `La semana debe traer exactamente ${input.config.sessionsPerWeek} sesiones válidas y llegó con ${sessions.length}.${droppedInfo}`,
        rawSessionCount, validSessionCount, droppedSessionCount,
      )
    }
    warning = partialWarning
  }

  const collisionError = validateCollisions(sessions)
  if (collisionError) return fail(collisionError, rawSessionCount, validSessionCount, droppedSessionCount)

  const doubleSessionError = validateDoubleSessions(sessions, input.config)
  if (doubleSessionError) return fail(doubleSessionError, rawSessionCount, validSessionCount, droppedSessionCount)

  const dayError = validateAllowedDays(sessions, input.config)
  if (dayError) return fail(dayError, rawSessionCount, validSessionCount, droppedSessionCount)

  const sportError = validateAllowedSports(sessions, input.config)
  if (sportError) return fail(sportError, rawSessionCount, validSessionCount, droppedSessionCount)

  const detailsError = validateRequiredDetails(sessions)
  if (detailsError) return fail(detailsError, rawSessionCount, validSessionCount, droppedSessionCount)

  const primarySportError = validatePrimarySportPresence(sessions, input.config)
  if (primarySportError) return fail(primarySportError, rawSessionCount, validSessionCount, droppedSessionCount)

  return {
    ok: true,
    action,
    warning,
    rawSessionCount,
    validSessionCount,
    droppedSessionCount,
  }
}

function buildPartialWeekWarning(input: {
  diagnostic: ReturnType<typeof pickCreateWeekDiagnostic>
  expectedSessions: number
  validSessions: number
}): string | undefined {
  const { diagnostic, expectedSessions, validSessions } = input
  if (!diagnostic) return undefined
  if (!diagnostic.droppedSessionReasons || diagnostic.droppedSessionReasons.length === 0) return undefined
  if (expectedSessions - validSessions !== 1) return undefined
  if (validSessions < 3) return undefined
  if (diagnostic.rawSessions !== expectedSessions) return undefined
  if (diagnostic.droppedSessions !== 1) return undefined

  return `Semana parcial: ${validSessions} de ${expectedSessions} sesiones válidas; se descartó 1 incompleta.`
}

function validateSessionWeekBoundaries(
  sessions: CoachSessionProposal[],
  targetWeekStart: string,
): string | undefined {
  for (const session of sessions) {
    if (!isStrictISODate(session.date)) {
      return `La sesión ${session.title} tiene fecha inválida (${session.date}).`
    }
  }
  if (filterSessionsToWeek(sessions, targetWeekStart).length !== sessions.length) {
    return `Todas las sesiones deben caer entre ${targetWeekStart} y los 6 días siguientes.`
  }
  return undefined
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
  if (config.allowDoubleSession) return undefined
  const byDate = new Map<string, number>()
  for (const session of sessions) {
    byDate.set(session.date, (byDate.get(session.date) ?? 0) + 1)
  }
  for (const [date, count] of byDate.entries()) {
    if (count > 1) {
      return `La configuración actual no permite doble sesión y la semana propone ${count} sesiones el ${date}.`
    }
  }
  return undefined
}

function validateAllowedDays(
  sessions: CoachSessionProposal[],
  config: WeekCreatorEffectiveConfig,
): string | undefined {
  const allowedDays = new Set(config.trainingDays)
  for (const session of sessions) {
    const day = isoDateToDayOfWeek(session.date)
    if (!day || !allowedDays.has(day)) {
      return `La sesión ${session.title} cae en un día no permitido por la configuración (${session.date}).`
    }
  }
  return undefined
}

function validateAllowedSports(
  sessions: CoachSessionProposal[],
  config: WeekCreatorEffectiveConfig,
): string | undefined {
  const allowedSports = new Set<SupportedSport>(config.allowedSports)

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
      if (!session.squashDetails || !Array.isArray(session.squashDetails.drills) || session.squashDetails.drills.length === 0) {
        return `La sesión de squash ${session.title} requiere squashDetails con drills no vacíos.`
      }
    }
  }
  return undefined
}

function validatePrimarySportPresence(
  sessions: CoachSessionProposal[],
  config: WeekCreatorEffectiveConfig,
): string | undefined {
  const primarySport = config.primarySport
  if (!primarySport) return undefined
  const count = sessions.filter((session) => session.sessionType === primarySport).length
  const minimum = primarySport === 'squash' && config.sessionsPerWeek >= 5 ? 2 : 1
  if (count < minimum) {
    return `La semana debe incluir al menos ${minimum} sesión${minimum === 1 ? '' : 'es'} de ${primarySport}.`
  }
  return undefined
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
  error: string,
  rawSessionCount?: number,
  validSessionCount?: number,
  droppedSessionCount?: number,
): WeekCreatorValidationResult {
  return { ok: false, error, rawSessionCount, validSessionCount, droppedSessionCount }
}
