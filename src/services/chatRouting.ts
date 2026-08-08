import type { ChatContext } from '../types'
import { currentWeekStartISO, fromISO, nextWeek, toISO } from '../utils/date'

export type ChatRouteKind =
  | 'chat_general'
  | 'chat_action'
  | 'week_creator'
  | 'weekly_summary'
  | 'plan_builder_redirect'

export interface ChatRouteResolution {
  kind: ChatRouteKind
  targetWeekStart?: string
}

const WEEKDAY_PATTERN = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoy|manana)\b/
const WEEK_PLANNING_VERB_PATTERN = /\b(crea(?:r|me)?|haz(?:me)?|arma(?:me)?|genera(?:r|me)?|planifica(?:r)?|organiza(?:r)?|programa(?:r)?|propuesta|dame|entrega(?:me)?)\b/
const WEEK_PLANNING_TARGET_PATTERN = /\b(semana|microciclo|propuesta\s+de\s+semana|plan(?:\s+de\s+entrenamiento)?)\b/
const FULL_PLAN_PATTERN = /\b(plan\s+completo|todas\s+las\s+semanas|plan\s+hasta|semanas\s+hasta|hasta\s+el\s+evento|hasta\s+la\s+competencia|hasta\s+el\s+torneo|completo\s+hasta|completo\s+para\s+\d+\s+semanas)\b/
const MULTI_WEEK_PATTERN = /\b(?:[2-9]|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\s+semanas\b/
const SUMMARY_PATTERN = /\b(resumen\s+semanal|coach\s+note|resume\s+mi\s+semana|resumeme\s+la\s+semana|cierre\s+de\s+semana|balance\s+semanal)\b/
const ADJUSTMENT_VERB_PATTERN = /\b(ajusta(?:r|me)?|ajustame|cambia(?:r|me)?|cambiame|cambie|modifica(?:r|me)?|modificame|mueve|mueveme|mover|pasa(?:r|me)?|reprograma(?:r|me)?|reordena(?:r|me)?|actualiza(?:r|me)?|quit(?:a|ar|ame)|borra(?:r|me)?|borrame|elimina(?:r|me)?|eliminame|saca(?:r|me)?|sacame|pon(?:er|me)?|agrega(?:r|me)?|reemplaza(?:r|me)?|reduce|baja|sube|incorpora)\b/
const SESSION_TARGET_PATTERN = /\b(sesion(?:es)?|entreno|entrenamiento|descanso|libre|off|running|squash|fuerza|pesas|gym|gimnasio|strength|cycling|ciclismo|bici|movilidad|recovery|recuperacion|am|pm)\b/
const NEXT_WEEK_PATTERN = /\b(proxima\s+semana|siguiente\s+semana)\b/
const CURRENT_WEEK_PATTERN = /\b(esta\s+semana|semana\s+actual)\b/
// "lunes de la próxima semana" is a temporal qualifier, not a request to
// generate the whole week. Treat a week word as scope only when it follows the
// planning verb directly ("créame una semana", "arma el plan").
const EXPLICIT_WEEK_SCOPE_PATTERN = /\b(?:crea(?:r|me)?|haz(?:me)?|arma(?:me)?|genera(?:r|me)?|planifica(?:r)?|organiza(?:r)?|programa(?:r)?|propuesta|dame|entrega(?:me)?)(?:\s+\w+){0,4}\s+\b(?:semana|microciclo|plan(?:\s+de\s+entrenamiento)?)\b/
// Include short object-pronoun imperatives ("créala", "hazlo") because users
// commonly confirm the session the coach just described with a one-word reply.
// Without this, those replies fall through to chat_general and can only produce
// prose, even though the preceding turn was asking to create a session.
const ACTION_CONFIRMATION_PATTERN = /\b(si|sí|ok|okay|dale|confirmo|correcto|hazlo|hacelo|crea(?:la|lo)?|aplica(?:lo)?|aplicar|realiza(?:r)?(?:\s+el)?\s+cambio|procede|adelante)\b/
const RECENT_ACTION_DISCUSSION_PATTERN = /\b(confirmas?|quieres?|quiero|cambio|cambiar|reemplaza(?:r)?|reemplazo|elimina(?:r)?|eliminar|borra(?:r)?|borrar|saca(?:r)?|sacar|ajusta(?:r)?|modifica(?:r)?|sesion|entreno|entrenamiento|running|corrida|trote|squash|zona\s*2|z2)\b/

export function resolveChatRoute(
  message: string,
  context?: ChatContext,
): ChatRouteResolution {
  const normalized = normalizeRoutingText(message)
  const targetWeekStart = resolveRequestedWeekStart(normalized)

  if (SUMMARY_PATTERN.test(normalized) || context?.intent === 'weekly_summary') {
    return { kind: 'weekly_summary' }
  }

  if (FULL_PLAN_PATTERN.test(normalized) || MULTI_WEEK_PATTERN.test(normalized)) {
    return { kind: 'plan_builder_redirect', targetWeekStart }
  }

  if (isActionConfirmation(normalized) && hasRecentActionDiscussion(context)) {
    return { kind: 'chat_action' }
  }

  const isSpecificDaySessionRequest =
    WEEKDAY_PATTERN.test(normalized)
    && SESSION_TARGET_PATTERN.test(normalized)
    && !EXPLICIT_WEEK_SCOPE_PATTERN.test(normalized)

  if (
    ADJUSTMENT_VERB_PATTERN.test(normalized)
    && (
      SESSION_TARGET_PATTERN.test(normalized)
      || WEEKDAY_PATTERN.test(normalized)
      || /\b(semana|plan|carga)\b/.test(normalized)
    )
  ) {
    return { kind: 'chat_action' }
  }

  if (WEEK_PLANNING_VERB_PATTERN.test(normalized) && isSpecificDaySessionRequest) {
    return { kind: 'chat_action' }
  }

  // Single-session creation requests: a weekday + a sport, with no week-level target,
  // should always reach the action engine even when the verb is colloquial
  // ("ponme un running el viernes", "haceme squash mañana", "quiero una sesión de fuerza el lunes").
  if (isSpecificDaySessionRequest) {
    return { kind: 'chat_action' }
  }

  const isWeekPlanningRequest =
    WEEK_PLANNING_VERB_PATTERN.test(normalized)
    && (
      WEEK_PLANNING_TARGET_PATTERN.test(normalized)
      || CURRENT_WEEK_PATTERN.test(normalized)
      || NEXT_WEEK_PATTERN.test(normalized)
      || /\b(que\s+hacemos\s+esta\s+semana|qué\s+hacemos\s+esta\s+semana)\b/.test(normalized)
    )

  if (isWeekPlanningRequest) {
    return {
      kind: 'week_creator',
      targetWeekStart,
    }
  }

  if (context?.intent === 'adjust_session') {
    return { kind: 'chat_action' }
  }

  if (context?.intent === 'plan_week') {
    return { kind: 'week_creator', targetWeekStart }
  }

  return { kind: 'chat_general' }
}

function isActionConfirmation(normalized: string): boolean {
  if (!ACTION_CONFIRMATION_PATTERN.test(normalized)) return false
  return normalized.length <= 80 && !/\b(porque|pero|aunque|opino|creo|pregunta|duda)\b/.test(normalized)
}

function hasRecentActionDiscussion(context?: ChatContext): boolean {
  const recent = context?.recentMessages?.slice(-8) ?? []
  if (recent.length === 0) return false
  const text = normalizeRoutingText(recent.map(message => message.content).join('\n'))
  return RECENT_ACTION_DISCUSSION_PATTERN.test(text)
}

export function resolveRequestedWeekStart(message: string): string {
  const normalized = normalizeRoutingText(message)
  const currentWeekStart = currentWeekStartISO()
  if (NEXT_WEEK_PATTERN.test(normalized)) {
    return toISO(nextWeek(fromISO(currentWeekStart)))
  }
  return currentWeekStart
}

function normalizeRoutingText(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\ba\s*hoy\b/g, 'hoy')
    .replace(/\bahoy\b/g, 'hoy')
    .replace(/\bmanan[ao]\b/g, 'manana')
    .replace(/\bsabado\b/g, 'sabado')
}
