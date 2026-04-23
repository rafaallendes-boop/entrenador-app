import type { ChatContext } from '../types'
import { currentWeekStartISO, fromISO, nextWeek, toISO } from '../utils/date'

export type ChatRouteKind =
  | 'chat_general'
  | 'chat_action'
  | 'week_planning'
  | 'weekly_summary'
  | 'plan_builder_redirect'

export interface ChatRouteResolution {
  kind: ChatRouteKind
  targetWeekStart?: string
}

const WEEKDAY_PATTERN = /\b(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|hoy|mañana|manana)\b/
const WEEK_PLANNING_VERB_PATTERN = /\b(cr[eé]a(?:r|me)?|haz(?:me)?|arma(?:me)?|genera(?:r|me)?|planifica(?:r)?|organiza(?:r)?|programa(?:r)?|propuesta)\b/
const WEEK_PLANNING_TARGET_PATTERN = /\b(semana|microciclo|propuesta\s+de\s+semana|plan(?:\s+de\s+entrenamiento)?)\b/
const FULL_PLAN_PATTERN = /\b(plan\s+completo|todas\s+las\s+semanas|plan\s+hasta|semanas\s+hasta|hasta\s+el\s+evento|hasta\s+la\s+competencia|hasta\s+el\s+torneo|completo\s+hasta|completo\s+para\s+\d+\s+semanas)\b/
const SUMMARY_PATTERN = /\b(resumen\s+semanal|coach\s+note|resume\s+mi\s+semana|resumeme\s+la\s+semana|cierre\s+de\s+semana|balance\s+semanal)\b/
const ADJUSTMENT_VERB_PATTERN = /\b(ajusta(?:r)?|cambia(?:r)?|modifica(?:r)?|mueve|reordena(?:r)?|actualiza(?:r)?|quita(?:r)?|agrega(?:r)?|reemplaza(?:r)?|reduce|baja|sube|incorpora)\b/
const SESSION_TARGET_PATTERN = /\b(sesion|sesión|running|squash|fuerza|strength|cycling|ciclismo|movilidad|recovery|recuperacion|am|pm)\b/
const NEXT_WEEK_PATTERN = /\b(pr[oó]xima\s+semana|siguiente\s+semana)\b/
const CURRENT_WEEK_PATTERN = /\b(esta\s+semana|semana\s+actual)\b/

export function resolveChatRoute(
  message: string,
  context?: ChatContext,
): ChatRouteResolution {
  const normalized = message.trim().toLowerCase()
  const targetWeekStart = resolveRequestedWeekStart(normalized)

  if (SUMMARY_PATTERN.test(normalized) || context?.intent === 'weekly_summary') {
    return { kind: 'weekly_summary' }
  }

  if (FULL_PLAN_PATTERN.test(normalized)) {
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
      kind: 'week_planning',
      targetWeekStart,
    }
  }

  if (context?.intent === 'adjust_session') {
    return { kind: 'chat_action' }
  }

  if (context?.intent === 'plan_week') {
    return { kind: 'week_planning', targetWeekStart }
  }

  return { kind: 'chat_general' }
}

export function resolveRequestedWeekStart(message: string): string {
  const currentWeekStart = currentWeekStartISO()
  if (NEXT_WEEK_PATTERN.test(message)) {
    return toISO(nextWeek(fromISO(currentWeekStart)))
  }
  return currentWeekStart
}
