import type { ChatContext, CoachAction, CoachSessionProposal, DayOfWeek, SupportedSport } from '../../types'
import type { CoachNormalizedResponse } from '../ai/types'
import { findSquashDrillByName } from '../training/drillLibrary'
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

  if (sessions.length !== input.config.sessionsPerWeek) {
    const droppedInfo = droppedSessionCount && droppedSessionCount > 0
      ? ` Se descartaron ${droppedSessionCount} sesión(es) inválidas durante la normalización.`
      : ''
    return fail(
      `La semana debe traer exactamente ${input.config.sessionsPerWeek} sesiones válidas y llegó con ${sessions.length}.${droppedInfo}`,
      rawSessionCount, validSessionCount, droppedSessionCount,
    )
  }

  const collisionError = validateCollisions(sessions)
  if (collisionError) return fail(collisionError, rawSessionCount, validSessionCount, droppedSessionCount)

  const doubleSessionError = validateDoubleSessions(sessions, input.config)
  if (doubleSessionError) return fail(doubleSessionError, rawSessionCount, validSessionCount, droppedSessionCount)

  const sameDaySquashError = validateSameDaySquashSessions(sessions, input.config)
  if (sameDaySquashError) return fail(sameDaySquashError, rawSessionCount, validSessionCount, droppedSessionCount)

  const duplicateSquashError = validateDuplicateSquashSessions(sessions)
  if (duplicateSquashError) return fail(duplicateSquashError, rawSessionCount, validSessionCount, droppedSessionCount)

  const duplicateStrengthError = validateDuplicateStrengthSessions(sessions)
  if (duplicateStrengthError) return fail(duplicateStrengthError, rawSessionCount, validSessionCount, droppedSessionCount)

  const dayError = validateAllowedDays(sessions, input.config)
  if (dayError) return fail(dayError, rawSessionCount, validSessionCount, droppedSessionCount)

  const sportError = validateAllowedSports(sessions, input.config)
  if (sportError) return fail(sportError, rawSessionCount, validSessionCount, droppedSessionCount)

  const detailsError = validateRequiredDetails(sessions)
  if (detailsError) return fail(detailsError, rawSessionCount, validSessionCount, droppedSessionCount)

  const primarySportError = validatePrimarySportPresence(sessions, input.config)
  if (primarySportError) return fail(primarySportError, rawSessionCount, validSessionCount, droppedSessionCount)

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
  const byDate = new Map<string, number>()
  for (const session of sessions) {
    byDate.set(session.date, (byDate.get(session.date) ?? 0) + 1)
  }

  if (config.allowDoubleSession && config.trainingDays.length >= sessions.length) {
    const repeatedDate = [...byDate.entries()].find(([, count]) => count > 1)
    if (repeatedDate) {
      return `Evita doble jornada el ${repeatedDate[0]}: hay suficientes días disponibles para repartir ${sessions.length} sesiones.`
    }
    return undefined
  }

  if (config.allowDoubleSession) return undefined

  for (const [date, count] of byDate.entries()) {
    if (count > 1) {
      return `La configuración actual no permite doble sesión y la semana propone ${count} sesiones el ${date}.`
    }
  }
  return undefined
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
  error: string,
  rawSessionCount?: number,
  validSessionCount?: number,
  droppedSessionCount?: number,
): WeekCreatorValidationResult {
  return { ok: false, error, rawSessionCount, validSessionCount, droppedSessionCount }
}
