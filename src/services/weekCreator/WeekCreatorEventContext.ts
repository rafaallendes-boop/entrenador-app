import type {
  AthleteProfile,
  GoalEvent,
  MacroPlanEventTiming,
  MacroPlanPhase,
  SupportedSport,
} from '../../types'
import {
  resolveGoalEventWindow,
  type GoalEventWindow,
} from '../goalEventWindow'
import {
  computeWeeksRemainingForWindow,
  resolveBlockFocus,
  resolvePhase,
} from '../macroPlan'
import { normalizeSport } from '../../utils/athlete'
import type { WeekCreatorEffectiveConfig } from './WeekCreatorConfig'
import { isoDateToDayOfWeek } from './WeekCreatorDateWindow'

export interface WeekCreatorEventContext {
  goalEvent?: GoalEvent
  window?: GoalEventWindow
  anchorDate?: string
  timing?: MacroPlanEventTiming
  phase: MacroPlanPhase
  weeksRemaining: number
  blockFocus: string
  appliesToPrimarySport: boolean
  intersectsTargetWeek: boolean
  anchorInsideTargetWeek: boolean
  anchorInsidePlanningWindow: boolean
}

export function resolveWeekCreatorGoalEvent(
  profile: AthleteProfile | null | undefined,
): GoalEvent | undefined {
  if (!profile) return undefined
  const goalEventId = profile.planWizardConfig?.goalEventId
  if (goalEventId) {
    const selected = profile.goalEvents?.find((event) => event.id === goalEventId)
    if (selected) return selected
  }
  return profile.goalEvents?.find((event) => event.priority === 'primary') ?? profile.goalEvents?.[0]
}

export function resolveWeekCreatorEventContext(input: {
  profile: AthleteProfile | null | undefined
  targetWeekStart: string
  weekEndDate: string
  planningStartDate?: string
  primarySport?: SupportedSport
}): WeekCreatorEventContext {
  const goalEvent = resolveWeekCreatorGoalEvent(input.profile)
  const fallbackPhase = input.profile?.macroPlan?.currentPhase ?? 'base'
  if (!goalEvent) {
    return {
      phase: fallbackPhase,
      weeksRemaining: input.profile?.macroPlan?.weeksRemaining ?? 0,
      blockFocus: input.profile?.macroPlan?.blockFocus ?? resolveBlockFocus(fallbackPhase),
      appliesToPrimarySport: false,
      intersectsTargetWeek: false,
      anchorInsideTargetWeek: false,
      anchorInsidePlanningWindow: false,
    }
  }

  const window = resolveGoalEventWindow(goalEvent)
  const eventSport = normalizeSport(goalEvent.sport)
  const appliesToPrimarySport = input.primarySport == null
    || eventSport == null
    || eventSport === input.primarySport
  const anchorDate = window.keyDate ?? window.startDate
  const intersectsTargetWeek = appliesToPrimarySport
    && input.targetWeekStart <= window.endDate
    && input.weekEndDate >= window.startDate
  const timing: MacroPlanEventTiming = input.weekEndDate < window.startDate
    ? 'upcoming'
    : input.targetWeekStart > window.endDate
      ? 'past'
      : 'active'
  const referenceDate = new Date(`${input.targetWeekStart}T12:00:00`)
  const weeksRemaining = appliesToPrimarySport
    ? timing === 'active'
      ? 0
      : computeWeeksRemainingForWindow(goalEvent, referenceDate)
    : input.profile?.macroPlan?.weeksRemaining ?? 0
  const phase = appliesToPrimarySport
    ? timing === 'active'
      ? 'race'
      : timing === 'past'
        ? 'transition'
        : resolvePhase(weeksRemaining, input.primarySport)
    : fallbackPhase
  const planningStartDate = input.planningStartDate ?? input.targetWeekStart
  const anchorInsideTargetWeek = appliesToPrimarySport
    && anchorDate >= input.targetWeekStart
    && anchorDate <= input.weekEndDate
  const anchorInsidePlanningWindow = appliesToPrimarySport
    && anchorDate >= planningStartDate
    && anchorDate <= input.weekEndDate
  const blockFocus = input.profile?.macroPlan?.currentPhase === phase
    ? input.profile.macroPlan.blockFocus
    : resolveBlockFocus(phase)

  return {
    goalEvent,
    window,
    anchorDate,
    timing,
    phase,
    weeksRemaining,
    blockFocus,
    appliesToPrimarySport,
    intersectsTargetWeek,
    anchorInsideTargetWeek,
    anchorInsidePlanningWindow,
  }
}

/**
 * Durante una semana race de squash, Week Creator usa la misma cantidad
 * efectiva que el Plan Builder y reconoce el día de competencia como excepción
 * válida a los días habituales de entrenamiento.
 */
export function applyWeekCreatorEventContextToConfig(
  config: WeekCreatorEffectiveConfig,
  eventContext: WeekCreatorEventContext,
): WeekCreatorEffectiveConfig {
  if (
    config.primarySport !== 'squash'
    || eventContext.phase !== 'race'
    || !eventContext.appliesToPrimarySport
  ) return config

  const sessionsPerWeek = Math.max(1, Math.min(config.sessionsPerWeek, 2))
  const maxSessionsPerWeek = Math.max(sessionsPerWeek, Math.min(config.maxSessionsPerWeek, 2))
  const anchorDay = eventContext.anchorInsidePlanningWindow && eventContext.anchorDate
    ? isoDateToDayOfWeek(eventContext.anchorDate)
    : null
  const trainingDays = anchorDay && !config.trainingDays.includes(anchorDay)
    ? [...config.trainingDays, anchorDay]
    : config.trainingDays

  return {
    ...config,
    trainingDays,
    sessionsPerWeek,
    maxSessionsPerWeek,
  }
}
