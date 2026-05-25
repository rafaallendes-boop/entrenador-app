import type { ChatContext, CoachAction, CoachExerciseProposal, Session, SessionType, StrengthProfile, TimeBlock } from '../../types'
import { currentWeekStartISO, todayISO } from '../../utils/date'
import { findStrengthExerciseByName, normalizeStrengthExerciseKey } from '../training/exerciseLibrary'
import { getTargetExerciseDensity, selectStrengthSession, type StrengthContext, type StrengthPhase, type StrengthSportProfile } from '../training/strengthSelector'
import { enhanceStrengthSessionExercises, resolveStrengthExerciseBlock } from '../training/strengthSessionStructure'
import type { CoachNormalizedResponse } from './types'

const WEEKDAYS = [
  { offset: 0, labels: ['lunes'] },
  { offset: 1, labels: ['martes'] },
  { offset: 2, labels: ['miercoles'] },
  { offset: 3, labels: ['jueves'] },
  { offset: 4, labels: ['viernes'] },
  { offset: 5, labels: ['sabado'] },
  { offset: 6, labels: ['domingo'] },
] as const

const NEXT_WEEK_PATTERN = /\b(proxima\s+semana|siguiente\s+semana)\b/
const CURRENT_WEEK_PATTERN = /\b(esta\s+semana|semana\s+actual)\b/

export function postProcessCoachActions(
  response: CoachNormalizedResponse,
  context: ChatContext,
  userMessage: string,
): CoachNormalizedResponse {
  if (response.requestClass !== 'chat_action') return response

  const normalizedMessage = normalizeText(userMessage)
  const requestedWeekStart = resolveRequestedWeekStart(normalizedMessage, context)
  const restOffsets = resolveRestWeekdayOffsets(normalizedMessage)
  const resolvedDate =
    resolveRelativeDate(normalizedMessage) ??
    resolveWeekdayDate(normalizedMessage, context, requestedWeekStart, restOffsets)
  const affectedSession = findAffectedSession(context, normalizedMessage, resolvedDate)
  const adjustmentIntent = isExistingSessionAdjustment(normalizedMessage)
  const sessions = getContextSessions(context)
  const occupiedSlots = buildOccupiedSlotSet(sessions, requestedWeekStart)
  const sourceActions = response.actions ?? buildFallbackSingleSessionActions(normalizedMessage, context, resolvedDate)
  if (!sourceActions?.length) return response

  const actions = sourceActions.map((action) => {
    const dateAligned = resolvedDate ? alignActionDate(action, resolvedDate) : action
    const weekAligned = requestedWeekStart
      ? alignActionToRequestedWeek(dateAligned, requestedWeekStart, restOffsets, occupiedSlots)
      : dateAligned
    const loadAligned = completeStrengthLoads(weekAligned, context)

    if (loadAligned.type === 'add_session' && adjustmentIntent && affectedSession) {
      return convertAddSessionToUpdateSession(loadAligned, affectedSession)
    }

    if (loadAligned.type === 'update_session' && affectedSession && !resolvesKnownSession(loadAligned.sessionId, sessions)) {
      return { ...loadAligned, sessionId: affectedSession.id }
    }

    return loadAligned
  })

  return {
    ...response,
    actions,
    message: response.actions?.length ? response.message : buildFallbackActionMessage(actions, response.message),
    fallbackUsed: response.fallbackUsed || !response.actions?.length,
    meta: response.actions?.length
      ? response.meta
      : {
          ...response.meta,
          hadActionsMarkup: response.meta?.hadActionsMarkup ?? false,
          actionParseFailed: false,
          likelyTruncated: false,
          warnings: [
            ...(response.meta?.warnings ?? []),
            'chat_action_without_actions_repaired',
            ...(response.meta?.actionParseFailed || response.meta?.likelyTruncated
              ? ['chat_action_malformed_response_repaired']
              : []),
          ],
        },
  }
}

function buildFallbackSingleSessionActions(
  normalizedMessage: string,
  context: ChatContext,
  resolvedDate: string | undefined,
): CoachAction[] | undefined {
  if (!isClearSingleSessionCreationRequest(normalizedMessage)) return undefined
  const sessionType = inferRequestedSessionType(normalizedMessage)
  if (!sessionType || !resolvedDate) return undefined

  const durationMin = inferRequestedDuration(normalizedMessage, sessionType)
  const objective = buildFallbackObjective(sessionType, normalizedMessage)
  const action: CoachAction = {
    type: 'add_session',
    reason: 'El modelo respondió en texto; se creó una acción estructurada desde la solicitud puntual.',
    targetDate: resolvedDate,
    timeBlock: resolveTimeBlock(normalizedMessage) ?? 'PM',
    sessionType,
    title: buildFallbackTitle(sessionType),
    durationMin,
    rpe: sessionType === 'strength' ? 7 : undefined,
    objective,
  }

  if (sessionType === 'strength') {
    const selection = selectStrengthSession(buildStrengthSelectionContextForAction(context, durationMin, objective))
    action.exercises = selection.exercises.map((exercise) => ({
      name: exercise.name,
      sets: exercise.sets,
      reps: exercise.reps,
      group: exercise.group,
      notes: exercise.notes,
    }))
  }

  return [action]
}

function isClearSingleSessionCreationRequest(normalizedMessage: string): boolean {
  const hasCreateIntent = /\b(crea(?:r|me)?|crear|genera(?:r|me)?|generar|haz(?:me)?|hacer|arma(?:me)?|programa(?:me)?|agenda(?:me)?|agrega(?:me)?|pon(?:me)?)\b/.test(normalizedMessage)
  const hasSessionTarget = /\b(sesion|fuerza|pesas|gym|gimnasio|running|correr|squash|cycling|ciclismo|bici|movilidad|recovery|recuperacion)\b/.test(normalizedMessage)
  const hasDay = /\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(normalizedMessage)
  const weekTarget = /\b(semana|microciclo|plan completo|planificar semana)\b/.test(normalizedMessage)
  return hasCreateIntent && hasSessionTarget && hasDay && !weekTarget
}

function inferRequestedSessionType(normalizedMessage: string): SessionType | undefined {
  if (/\b(fuerza|pesas|gym|gimnasio|strength)\b/.test(normalizedMessage)) return 'strength'
  if (/\b(squash)\b/.test(normalizedMessage)) return 'squash'
  if (/\b(running|correr|corrida|trote)\b/.test(normalizedMessage)) return 'running'
  if (/\b(cycling|ciclismo|bici|bicicleta)\b/.test(normalizedMessage)) return 'cycling'
  if (/\b(movilidad|mobility)\b/.test(normalizedMessage)) return 'mobility'
  if (/\b(recovery|recuperacion|descarga)\b/.test(normalizedMessage)) return 'recovery'
  return undefined
}

function inferRequestedDuration(normalizedMessage: string, sessionType: SessionType): number {
  const explicit = normalizedMessage.match(/\b(\d{2,3})\s*(?:min|mins|minutos)\b/)
  if (explicit) return Number(explicit[1])
  if (sessionType === 'strength') return 60
  if (sessionType === 'squash') return 60
  if (sessionType === 'running') return 45
  if (sessionType === 'cycling') return 60
  if (sessionType === 'mobility') return 30
  return 25
}

function buildFallbackTitle(sessionType: SessionType): string {
  switch (sessionType) {
    case 'strength': return 'Fuerza estructurada'
    case 'squash': return 'Squash técnico'
    case 'running': return 'Running suave'
    case 'cycling': return 'Ciclismo base'
    case 'mobility': return 'Movilidad'
    case 'recovery': return 'Recuperación activa'
    default: return 'Sesión'
  }
}

function buildFallbackObjective(sessionType: SessionType, normalizedMessage: string): string {
  if (sessionType === 'strength') {
    return normalizedMessage.includes('squash')
      ? 'Desarrollar fuerza útil para squash con zona media, fuerza principal y transferencia controlada.'
      : 'Desarrollar fuerza general con zona media, patrones principales y accesorios seguros.'
  }
  if (sessionType === 'squash') return 'Mejorar control técnico y ritmo de juego con carga manejable.'
  if (sessionType === 'running') return 'Sumar base aeróbica con esfuerzo controlado.'
  if (sessionType === 'cycling') return 'Sumar trabajo aeróbico de bajo impacto.'
  if (sessionType === 'mobility') return 'Mejorar rango de movimiento y soltar zonas cargadas.'
  return 'Favorecer recuperación y continuidad sin sumar fatiga relevante.'
}

function buildFallbackActionMessage(actions: CoachAction[], originalMessage: string): string {
  const first = actions[0]
  if (first?.type === 'add_session') {
    return `Te preparé la sesión como acción para que puedas revisarla y aplicarla.${originalMessage ? `\n\n${originalMessage}` : ''}`
  }
  return originalMessage || 'Te propongo este cambio:'
}

function completeStrengthLoads(action: CoachAction, context: ChatContext): CoachAction {
  const profile = context.athleteProfile?.strengthProfile
  if ((action.type === 'add_session' || action.type === 'update_session') && action.exercises) {
    const shouldDensify = action.type === 'add_session'
      ? action.sessionType === 'strength'
      : action.newType === 'strength' || action.exercises.some((exercise) => findStrengthExerciseByName(exercise.name))
    return {
      ...action,
      exercises: shouldDensify
        ? enrichStrengthExercises(action.exercises, {
            durationMin: action.type === 'add_session' ? action.durationMin : action.newDurationMin,
            strengthProfile: profile,
            context,
            objective: action.type === 'add_session' ? action.objective : action.newObjective,
          })
        : action.exercises,
    }
  }

  if (action.type === 'create_week' && action.sessions) {
    return {
      ...action,
      sessions: action.sessions.map((session) => (
        session.sessionType === 'strength' && session.exercises
          ? {
              ...session,
              exercises: enrichStrengthExercises(session.exercises, {
                durationMin: session.durationMin,
                strengthProfile: profile,
                context,
                objective: session.objective,
              }),
            }
          : session
      )),
    }
  }

  return action
}

function enrichStrengthExercises(
  exercises: CoachExerciseProposal[],
  options: {
    durationMin?: number
    strengthProfile?: StrengthProfile
    context: ChatContext
    objective?: string
  },
): CoachExerciseProposal[] | undefined {
  const enhanced = enhanceStrengthSessionExercises(exercises, {
    durationMin: options.durationMin,
    strengthProfile: options.strengthProfile,
  })
  if (!enhanced || enhanced.length === 0) return enhanced

  const selectionContext = buildStrengthSelectionContextForAction(options.context, options.durationMin, options.objective)
  const density = getTargetExerciseDensity(selectionContext)
  if (enhanced.length >= density.target) return enhanced

  const existingKeys = new Set(enhanced.map(getStrengthExerciseKey))
  const additions: CoachExerciseProposal[] = []
  const candidates = selectStrengthSession(selectionContext).exercises
    .map((exercise) => ({
      name: exercise.name,
      sets: exercise.sets,
      reps: exercise.reps,
      group: exercise.group,
      notes: exercise.notes,
    }))
    .filter((exercise) => !existingKeys.has(getStrengthExerciseKey(exercise)))

  const minimumStrengthWork = getMinimumStrengthWorkCount(options.durationMin ?? 50)
  let strengthWorkCount = enhanced.filter(isStrengthWorkExercise).length

  for (const candidate of candidates) {
    if (enhanced.length + additions.length >= density.target) break
    if (!isStrengthWorkExercise(candidate)) continue
    additions.push(candidate)
    existingKeys.add(getStrengthExerciseKey(candidate))
    strengthWorkCount++
    if (strengthWorkCount >= minimumStrengthWork) break
  }

  for (const candidate of candidates) {
    if (enhanced.length + additions.length >= density.target) break
    const key = getStrengthExerciseKey(candidate)
    if (existingKeys.has(key)) continue
    additions.push(candidate)
    existingKeys.add(key)
  }

  if (additions.length === 0) return enhanced

  return enhanceStrengthSessionExercises([...enhanced, ...additions], {
    durationMin: options.durationMin,
    strengthProfile: options.strengthProfile,
  })
}

function buildStrengthSelectionContextForAction(
  context: ChatContext,
  durationMin?: number,
  objective?: string,
): StrengthContext {
  const primarySport = context.athleteProfile?.sportContext?.primarySport
  return {
    fatigueLevel: 5,
    phase: mapActionStrengthPhase(context.athleteProfile?.macroPlan?.currentPhase),
    recentExercises: [],
    goal: objective ?? context.athleteProfile?.mainGoal ?? 'sesion de fuerza util y estructurada',
    sportProfile: deriveActionStrengthSportProfile(primarySport),
    primarySport,
    experienceLevel: 'intermediate',
    sessionDurationMin: durationMin ?? 60,
  }
}

function mapActionStrengthPhase(phase: string | undefined): StrengthPhase {
  if (phase === 'build' || phase === 'peak' || phase === 'taper' || phase === 'transition') return phase
  if (phase === 'race') return 'taper'
  return 'base'
}

function deriveActionStrengthSportProfile(primarySport: string | undefined): StrengthSportProfile {
  if (primarySport === 'strength') return 'strength_primary'
  if (primarySport) return 'sport_support'
  return 'hybrid'
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

function getStrengthExerciseKey(exercise: Pick<CoachExerciseProposal, 'name'>): string {
  return findStrengthExerciseByName(exercise.name)?.id ?? normalizeStrengthExerciseKey(exercise.name)
}

function alignActionDate(action: CoachAction, targetDate: string): CoachAction {
  if (action.type === 'add_session' || action.type === 'move_session' || action.type === 'insert_recovery') {
    return { ...action, targetDate }
  }

  return action
}

function convertAddSessionToUpdateSession(action: CoachAction, session: Session): CoachAction {
  const next: CoachAction = {
    type: 'update_session',
    sessionId: session.id,
    reason: action.reason,
  }

  if (action.title) next.newTitle = action.title
  if (action.objective) next.newObjective = action.objective
  if (action.durationMin != null) next.newDurationMin = action.durationMin
  if (action.rpe != null) next.newRpe = action.rpe
  if (action.sessionType && action.sessionType !== session.type) next.newType = action.sessionType
  if (action.subtype) next.subtype = action.subtype
  if (action.runningType) next.runningType = action.runningType
  if (action.targetPaceMin) next.targetPaceMin = action.targetPaceMin
  if (action.targetPaceMax) next.targetPaceMax = action.targetPaceMax
  if (action.targetHrMin != null) next.targetHrMin = action.targetHrMin
  if (action.targetHrMax != null) next.targetHrMax = action.targetHrMax
  if (action.intervalStructure) next.intervalStructure = action.intervalStructure
  if (action.cyclingDetails) next.cyclingDetails = action.cyclingDetails
  if (action.mobilityDetails) next.mobilityDetails = action.mobilityDetails
  if (action.squashDetails) next.squashDetails = action.squashDetails
  if (action.exercises) next.exercises = action.exercises
  if (action.warmup) next.warmup = action.warmup
  if (action.cooldown) next.cooldown = action.cooldown

  return next
}

function alignActionToRequestedWeek(
  action: CoachAction,
  requestedWeekStart: string,
  restOffsets: Set<number>,
  occupiedSlots: Set<string>,
): CoachAction {
  if (action.type !== 'add_session' && action.type !== 'move_session' && action.type !== 'insert_recovery') {
    return action
  }

  const targetDate = action.targetDate
  const timeBlock = action.type === 'add_session' ? action.timeBlock : undefined
  if (
    targetDate &&
    isDateInWeek(targetDate, requestedWeekStart) &&
    !restOffsets.has(getWeekdayOffset(targetDate)) &&
    (!timeBlock || !occupiedSlots.has(`${targetDate}|${timeBlock}`))
  ) {
    if (timeBlock) occupiedSlots.add(`${targetDate}|${timeBlock}`)
    return action
  }

  const replacement = findAvailableDateInRequestedWeek(
    requestedWeekStart,
    targetDate,
    timeBlock,
    restOffsets,
    occupiedSlots,
  )
  if (!replacement) return action

  if (replacement.timeBlock) occupiedSlots.add(`${replacement.date}|${replacement.timeBlock}`)
  return action.type === 'add_session' && replacement.timeBlock
    ? { ...action, targetDate: replacement.date, timeBlock: replacement.timeBlock }
    : { ...action, targetDate: replacement.date }
}

function resolveWeekdayDate(
  normalizedMessage: string,
  context: ChatContext,
  requestedWeekStart: string | undefined,
  restOffsets: Set<number>,
): string | undefined {
  const match = WEEKDAYS.find((day) =>
    !restOffsets.has(day.offset) &&
    day.labels.some((label) => normalizedMessage.includes(label)),
  )
  if (!match) return undefined
  return addDaysToISO(requestedWeekStart ?? context.currentWeekSummary?.weekStartDate ?? currentWeekStartISO(), match.offset)
}

function resolveRelativeDate(normalizedMessage: string): string | undefined {
  if (/\bhoy\b/.test(normalizedMessage)) return todayISO()
  if (/\bmanana\b/.test(normalizedMessage)) return addDaysToISO(todayISO(), 1)
  return undefined
}

function resolveRequestedWeekStart(normalizedMessage: string, context: ChatContext): string | undefined {
  const baseWeekStart = context.currentWeekSummary?.weekStartDate ?? currentWeekStartISO()
  if (NEXT_WEEK_PATTERN.test(normalizedMessage)) return addDaysToISO(baseWeekStart, 7)
  if (CURRENT_WEEK_PATTERN.test(normalizedMessage)) return baseWeekStart
  return undefined
}

function resolveRestWeekdayOffsets(normalizedMessage: string): Set<number> {
  const offsets = new Set<number>()
  for (const day of WEEKDAYS) {
    if (day.labels.some((label) => hasRestWeekdayReference(normalizedMessage, label))) {
      offsets.add(day.offset)
    }
  }
  return offsets
}

function hasRestWeekdayReference(normalizedMessage: string, weekdayLabel: string): boolean {
  let index = normalizedMessage.indexOf(weekdayLabel)
  while (index !== -1) {
    const windowStart = Math.max(0, index - 32)
    const windowEnd = Math.min(normalizedMessage.length, index + weekdayLabel.length + 40)
    const windowText = normalizedMessage.slice(windowStart, windowEnd)
    if (/\b(descanso|descansar|libre|off|sin\s+entren|no\s+entren|no\s+poner|no\s+agregar|dejar(?:lo)?\s+libre)\b/.test(windowText)) {
      return true
    }
    index = normalizedMessage.indexOf(weekdayLabel, index + weekdayLabel.length)
  }
  return false
}

function buildOccupiedSlotSet(sessions: Session[], requestedWeekStart: string | undefined): Set<string> {
  const occupied = new Set<string>()
  if (!requestedWeekStart) return occupied
  for (const session of sessions) {
    if (isDateInWeek(session.date, requestedWeekStart)) {
      occupied.add(`${session.date}|${session.timeBlock}`)
    }
  }
  return occupied
}

function findAvailableDateInRequestedWeek(
  requestedWeekStart: string,
  originalDate: string | undefined,
  preferredBlock: TimeBlock | undefined,
  restOffsets: Set<number>,
  occupiedSlots: Set<string>,
): { date: string; timeBlock?: TimeBlock } | undefined {
  const originalOffset = originalDate && isValidISODate(originalDate) ? getWeekdayOffset(originalDate) : undefined
  const candidateOffsets = [
    ...(originalOffset != null && !restOffsets.has(originalOffset) ? [originalOffset] : []),
    ...Array.from({ length: 7 }, (_, offset) => offset).filter((offset) => offset !== originalOffset && !restOffsets.has(offset)),
  ]
  const blockCandidates = preferredBlock ? [preferredBlock, preferredBlock === 'AM' ? 'PM' : 'AM'] as TimeBlock[] : [undefined]

  for (const offset of candidateOffsets) {
    const date = addDaysToISO(requestedWeekStart, offset)
    for (const block of blockCandidates) {
      if (!block || !occupiedSlots.has(`${date}|${block}`)) {
        return { date, timeBlock: block }
      }
    }
  }

  return undefined
}

function isDateInWeek(date: string, weekStart: string): boolean {
  if (!isValidISODate(date)) return false
  return date >= weekStart && date <= addDaysToISO(weekStart, 6)
}

function getWeekdayOffset(date: string): number {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  return (weekday + 6) % 7
}

function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

function findAffectedSession(
  context: ChatContext,
  normalizedMessage: string,
  resolvedDate: string | undefined,
): Session | undefined {
  const sessions = getContextSessions(context)
  const byId = sessions.find((session) => normalizedMessage.includes(session.id.slice(0, 8).toLowerCase()))
  if (byId) return byId

  if (!resolvedDate) return undefined
  const timeBlock = resolveTimeBlock(normalizedMessage)
  const candidates = sessions.filter((session) => {
    if (session.date !== resolvedDate) return false
    if (timeBlock && session.timeBlock !== timeBlock) return false
    return session.status !== 'skipped'
  })

  return candidates.length === 1 ? candidates[0] : undefined
}

function getContextSessions(context: ChatContext): Session[] {
  const merged = new Map<string, Session>()
  for (const session of context.recentSessions ?? []) merged.set(session.id, session)
  for (const session of context.plannedSessions ?? []) merged.set(session.id, session)
  for (const session of context.historicalSessions ?? []) merged.set(session.id, session)
  return [...merged.values()]
}

function resolvesKnownSession(sessionIdOrPrefix: string | undefined, sessions: Session[]): boolean {
  if (!sessionIdOrPrefix) return false
  if (sessionIdOrPrefix === 'ID_DE_8_CHARS') return false
  if (sessions.some((session) => session.id === sessionIdOrPrefix)) return true
  return sessions.filter((session) => session.id.startsWith(sessionIdOrPrefix)).length === 1
}

function resolveTimeBlock(normalizedMessage: string): TimeBlock | undefined {
  if (/\bpm\b/.test(normalizedMessage) || normalizedMessage.includes(' tarde')) return 'PM'
  if (/\bam\b/.test(normalizedMessage) || /\b(por|en)\s+la\s+manana\b/.test(normalizedMessage)) return 'AM'
  return undefined
}

function isExistingSessionAdjustment(normalizedMessage: string): boolean {
  return /\b(ajusta|ajustar|ajustame|cambia|cambiar|cambiame|modifica|modificar|actualiza|actualizar|reemplaza|reemplazar|edita|editar|baja|sube|mejora|hazla|hacerla)\b/.test(normalizedMessage)
}

function addDaysToISO(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day + days)
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\ba\s*hoy\b/g, 'hoy')
    .replace(/\bahoy\b/g, 'hoy')
    .replace(/\bmanan[ao]\b/g, 'manana')
}
