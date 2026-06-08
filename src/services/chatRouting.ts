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
const ADJUSTMENT_VERB_PATTERN = /\b(ajusta(?:r|me)?|ajustame|cambia(?:r|me)?|cambiame|cambie|modifica(?:r|me)?|modificame|mueve|mueveme|reordena(?:r|me)?|actualiza(?:r|me)?|quit(?:a|ar|ame)|agrega(?:r|me)?|reemplaza(?:r|me)?|reduce|baja|sube|incorpora)\b/
const SESSION_TARGET_PATTERN = /\b(sesion(?:es)?|running|squash|fuerza|pesas|gym|gimnasio|strength|cycling|ciclismo|bici|movilidad|recovery|recuperacion|am|pm)\b/
const NEXT_WEEK_PATTERN = /\b(proxima\s+semana|siguiente\s+semana)\b/
const CURRENT_WEEK_PATTERN = /\b(esta\s+semana|semana\s+actual)\b/

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

  const isSpecificDaySessionRequest =
    WEEKDAY_PATTERN.test(normalized)
    && SESSION_TARGET_PATTERN.test(normalized)
    && !WEEK_PLANNING_TARGET_PATTERN.test(normalized)

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
