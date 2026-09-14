import type { ChatContext } from '../../types'
import { buildExecutionSignals, previousWeekWindowStart } from '../training/executionSignals'
import { captureSources, deriveSlotContext, type ReferenceSlot, type SourceCapture } from '../training/slotContext'
import { resolveStrengthAthleteContext, type StrengthAthleteContext } from '../training/strengthAthleteContext'

/** I14: misma ventana que `buildSessionFeedbackSection`. */
export const CHAT_HISTORY_LOOKBACK_DAYS = 28

/** B no lee la identidad de la captura del chat; la revalidación de D sí. */
const CHAT_CONTEXT_SCOPE = { athleteId: null, epoch: 0, requestId: 'chat-context' }
const captures = new WeakMap<ChatContext, SourceCapture>()
const athletesByCapture = new WeakMap<SourceCapture, Map<string, StrengthAthleteContext>>()

/**
 * Una captura por objeto de contexto: todas las sesiones de fuerza de una
 * operación del chat leen la misma. Si el optimizador adjuntó la captura del
 * dominio, manda esa: una proyección recortada nunca decide fuerza.
 */
export function captureFromChatContext(context: ChatContext, now = Date.now()): SourceCapture {
  if (context.sourceCapture) return context.sourceCapture
  const cached = captures.get(context)
  if (cached) return cached
  const capture = captureSources({
    scope: CHAT_CONTEXT_SCOPE,
    now,
    profile: context.athleteProfile,
    sessions: [...(context.recentSessions ?? []), ...(context.plannedSessions ?? []), ...(context.historicalSessions ?? [])],
    dayLogs: [...(context.weekDayLogs ?? []), ...(context.dayLog ? [context.dayLog] : [])],
  })
  captures.set(context, capture)
  return capture
}

/** Próxima franja de hoy: lo completado esta mañana ya es historial. */
export function chatPromptSlot(capture: SourceCapture): ReferenceSlot {
  return { date: capture.knowledgeDate, timeBlock: 'PM' }
}

/**
 * I6/I7/I9: la declaración es `profile.planWizardConfig` —la misma de la que
 * `resolveWeekCreatorConfig` deriva la del Week Creator— y su vigencia la
 * decide el resolver para la fecha del slot.
 */
export function resolveCapturedStrengthAthleteContext(capture: SourceCapture, slot: ReferenceSlot): StrengthAthleteContext {
  const key = `${slot.date}|${slot.timeBlock}`
  const cache = athletesByCapture.get(capture) ?? new Map<string, StrengthAthleteContext>()
  athletesByCapture.set(capture, cache)
  const cached = cache.get(key)
  if (cached) return cached
  const slotContext = deriveSlotContext(capture, slot)
  const { signals } = buildExecutionSignals(slotContext, { windowStart: previousWeekWindowStart(slot.date) })
  const athlete = resolveStrengthAthleteContext({
    slotContext,
    executionSignals: signals,
    declaration: capture.profile?.planWizardConfig,
  })
  cache.set(key, athlete)
  return athlete
}

export function resolveChatStrengthAthleteContext(context: ChatContext, slot: ReferenceSlot): StrengthAthleteContext {
  return resolveCapturedStrengthAthleteContext(captureFromChatContext(context), slot)
}
