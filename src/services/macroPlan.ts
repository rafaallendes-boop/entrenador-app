/**
 * Deterministic local macro-plan computation.
 *
 * Given an AthleteProfile with a primary goal event, resolves:
 *   - currentPhase (base / build / peak / taper / race / transition)
 *   - weeksRemaining (integer, rounded up)
 *   - blockFocus (human-readable one-liner for the current block)
 *
 * Rules are deliberately simple and fixed. The coach/LLM cannot redefine
 * phases — it treats them as system input.
 *
 * Phase thresholds (weeks to event):
 *   >12  base       — build aerobic/strength volume, low-intensity accumulation
 *   8-12 build      — increase sport-specific intensity, maintain volume
 *   4-8  peak       — highest quality, sharpen sport-specific skills
 *   1-4  taper      — reduce volume, keep intensity, freshness for event
 *   0    race       — event week / event day
 *   <0   transition — event passed, active recovery, reset
 */

import type { AthleteProfile, GoalEvent, MacroPlan, MacroPlanPhase } from '../types'

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Computes a MacroPlan from the athlete's primary goal event.
 * Returns undefined if no valid primary event exists or if the event is
 * missing required fields.
 *
 * @param profile  The full AthleteProfile (may be null)
 * @param now      Optional reference date for testability (defaults to today)
 */
export function computeMacroPlan(
  profile: AthleteProfile | null | undefined,
  now?: Date,
): MacroPlan | undefined {
  const event = getPrimaryGoalEvent(profile)
  if (!event) return undefined

  const refDate = now ?? new Date()
  const weeksRemaining = computeWeeksRemaining(event.date, refDate)
  const currentPhase = resolvePhase(weeksRemaining)
  const blockFocus = resolveBlockFocus(currentPhase)

  return {
    goalEventId: event.id,
    goalEventDate: event.date,
    currentPhase,
    weeksRemaining,
    blockFocus,
    computedAt: Date.now(),
  }
}

/**
 * Returns the first valid primary goal event from the profile, or undefined.
 * A valid event must have an id, title, and a well-formed date.
 */
export function getPrimaryGoalEvent(
  profile: AthleteProfile | null | undefined,
): GoalEvent | undefined {
  if (!profile?.goalEvents || profile.goalEvents.length === 0) return undefined

  const event = profile.goalEvents.find(
    (e) => e.priority === 'primary' && isValidISODate(e.date) && e.title.trim().length > 0,
  )

  return event
}

// ─── Phase resolution ────────────────────────────────────────────────────────

/**
 * Number of full weeks from `refDate` to the event date (rounded up).
 * Negative values mean the event is in the past.
 */
export function computeWeeksRemaining(eventDateISO: string, refDate: Date): number {
  const [y, m, d] = eventDateISO.split('-').map(Number)
  const eventDate = new Date(y, m - 1, d)
  const refNormalized = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate())

  const diffMs = eventDate.getTime() - refNormalized.getTime()
  const diffDays = diffMs / (24 * 60 * 60 * 1000)

  // Round up so that partial weeks count as a full week
  return Math.ceil(diffDays / 7)
}

export function resolvePhase(weeksRemaining: number): MacroPlanPhase {
  if (weeksRemaining < 0) return 'transition'
  if (weeksRemaining === 0) return 'race'
  if (weeksRemaining <= 4) return 'taper'
  if (weeksRemaining <= 8) return 'peak'
  if (weeksRemaining <= 12) return 'build'
  return 'base'
}

export function resolveBlockFocus(phase: MacroPlanPhase): string {
  switch (phase) {
    case 'base':
      return 'Construir volumen aeróbico y fuerza general. Intensidad baja-media.'
    case 'build':
      return 'Aumentar intensidad específica del deporte. Mantener volumen.'
    case 'peak':
      return 'Máxima calidad. Afilar habilidades específicas. Volumen controlado.'
    case 'taper':
      return 'Reducir volumen, mantener intensidad. Priorizar frescura.'
    case 'race':
      return 'Semana del evento. Activación, frescura y foco mental.'
    case 'transition':
      return 'Post-evento. Recuperación activa, descanso y reset.'
  }
}

// ─── Display helpers ─────────────────────────────────────────────────────────

const PHASE_LABELS: Record<MacroPlanPhase, string> = {
  base: 'Base',
  build: 'Construcción',
  peak: 'Pico',
  taper: 'Taper',
  race: 'Evento',
  transition: 'Transición',
}

export function getPhaseLabel(phase: MacroPlanPhase): string {
  return PHASE_LABELS[phase]
}

export function formatWeeksRemaining(weeks: number): string {
  if (weeks < 0) return 'Evento pasado'
  if (weeks === 0) return 'Esta semana'
  if (weeks === 1) return '1 semana'
  return `${weeks} semanas`
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function isValidISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}
