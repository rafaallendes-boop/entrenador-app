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

/**
 * `true` cuando las reglas de ventana de squash aplican a este plan.
 *
 * El repair ya se abstiene si el evento objetivo es de otro deporte; sin este
 * gate el validator exigía un ancla squash que el repair nunca iba a construir,
 * y la semana quemaba reintentos sin poder aceptarse jamás.
 */
export function planEventAppliesToSquash(plan: TrainingPlan): boolean {
  const eventSport = plan.macroSnapshot?.goalEventSport
  // Snapshot anterior a esta denormalización: se conserva el comportamiento
  // previo en vez de inventar un deporte que no fue registrado.
  if (!eventSport) return true
  return eventSport === 'squash'
}

/**
 * Las reglas de carga del campeonato aplican a los **días del evento**, no a la
 * semana `race` entera: un evento de sábado a domingo no puede vaciar el lunes.
 * Fuera de la ventana rigen las reglas de taper que ya existían.
 */
export function isWithinPlanEventWindow(plan: TrainingPlan, isoDate: string): boolean {
  const { startDate, endDate } = resolvePlanEventWindow(plan)
  return isoDate >= startDate && isoDate <= endDate
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

/**
 * Reconoce la **intención declarada** de partido: `squashKind`, `subtype`,
 * `sessionMode` o un bloque `match`. Nunca infiere desde título ni objetivo.
 *
 * NO acredita exposición competitiva. Sirve para materializar el ancla, reparar
 * respuestas incompletas y rechazar apoyos competitivos extra, todo eso antes de
 * que el repair complete los drills. El único predicado de exposición real es
 * `hasSquashCompetitiveExposureContent` (`training/squashMatchRole.ts`), que
 * mide contenido canónico y ejecutable. Unificarlos perdería las señales
 * declaradas mientras la sesión todavía no tiene drills.
 */
export function isDeclaredSquashMatchSession(session: CoachSessionProposal): boolean {
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
  if (session.sessionType !== 'squash' || isDeclaredSquashMatchSession(session)) {
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
