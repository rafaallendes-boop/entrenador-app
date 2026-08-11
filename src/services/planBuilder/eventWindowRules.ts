import type { CoachSessionProposal } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import {
  goalEventWindowFromMacroPlan,
  resolveGoalEventWindow,
  type GoalEventWindow,
} from '../goalEventWindow'

export interface PlanEventWindow extends GoalEventWindow {
  /** Única representación de la competencia en el calendario del plan. */
  anchorDate: string
}

export type EventWindowSupportKind = 'activation' | 'technical_touch' | 'recovery'

export const EVENT_WINDOW_SUPPORT_CAPS: Record<EventWindowSupportKind, {
  minDurationMin: number
  maxDurationMin: number
  minRpe: number
  maxRpe: number
}> = {
  activation: { minDurationMin: 10, maxDurationMin: 20, minRpe: 2, maxRpe: 4 },
  technical_touch: { minDurationMin: 20, maxDurationMin: 30, minRpe: 3, maxRpe: 4 },
  recovery: { minDurationMin: 15, maxDurationMin: 30, minRpe: 1, maxRpe: 3 },
}

export const MAX_EVENT_WINDOW_SUPPORTS_PER_WEEK = 2

/**
 * Adaptador único entre el snapshot del plan y la semántica de generación.
 * `keyDate` elige el ancla; si falta, el inicio representa todo el evento.
 */
export function resolvePlanEventWindow(plan: TrainingPlan): PlanEventWindow {
  const window = resolveGoalEventWindow(goalEventWindowFromMacroPlan(plan.macroSnapshot))
  return {
    ...window,
    anchorDate: window.keyDate ?? window.startDate,
  }
}

export function isPlanEventAnchorDate(plan: TrainingPlan, isoDate: string): boolean {
  return resolvePlanEventWindow(plan).anchorDate === isoDate
}

export function planWeekContainsDate(
  plan: TrainingPlan,
  week: TrainingPlanWeek,
  isoDate: string,
): boolean {
  const weekStart = week.weekStartDate
  const weekEnd = addUtcDays(weekStart, 6)
  const startDate = weekStart > plan.startDate ? weekStart : plan.startDate
  const endDate = weekEnd < plan.endDate ? weekEnd : plan.endDate
  return isoDate >= startDate && isoDate <= endDate
}

export function planWeekContainsEventAnchor(plan: TrainingPlan, week: TrainingPlanWeek): boolean {
  return planWeekContainsDate(plan, week, resolvePlanEventWindow(plan).anchorDate)
}

/** Predicado estructurado: nunca infiere un partido desde título u objetivo. */
export function isSquashCompetitionSession(session: CoachSessionProposal): boolean {
  if (session.sessionType !== 'squash') return false
  const details = session.squashDetails
  return session.squashKind === 'match'
    || session.subtype === 'match'
    || session.subtype === 'competitive'
    || details?.sessionKind === 'match'
    || details?.sessionMode === 'practice_match'
    || details?.sessionMode === 'competition_match'
    || (details?.blocks ?? []).some((block) => block.kind === 'match')
}

/**
 * Clasifica únicamente los tres apoyos admitidos durante `race`. Una modalidad
 * competitiva devuelve undefined y debe tratarse como carga incompatible salvo
 * cuando es la única ancla.
 */
export function resolveEventWindowSupportKind(
  session: CoachSessionProposal,
): EventWindowSupportKind | undefined {
  if (session.sessionType === 'mobility' || session.sessionType === 'recovery') {
    return 'recovery'
  }
  if (session.sessionType !== 'squash' || isSquashCompetitionSession(session)) {
    return undefined
  }

  const blockKinds = new Set((session.squashDetails?.blocks ?? []).map((block) => block.kind))
  const kind = session.squashDetails?.sessionKind ?? session.squashKind
  if (kind === 'technical' || blockKinds.has('technical')) return 'technical_touch'
  if (kind === 'control' || kind === 'shadows' || blockKinds.has('control') || blockKinds.has('shadows')) {
    return 'activation'
  }

  // Compatibilidad con esqueletos antiguos: `light` era la única señal
  // estructurada de activación previa a squashKind.
  if (session.subtype === 'light' || session.subtype === 'control') return 'activation'
  return undefined
}

function addUtcDays(isoDate: string, days: number): string {
  const timestamp = new Date(`${isoDate}T00:00:00.000Z`).getTime()
  if (!Number.isFinite(timestamp)) return isoDate
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
