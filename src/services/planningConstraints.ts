import type { AthleteProfile, CoachAction, CoachSessionProposal, PlanWizardConfig, SessionType, SupportedSport } from '../types'
import { getEnabledSports, getPrimarySportNormalized, normalizeSport } from '../utils/athlete'

export const RESTRICTED_PLANNING_SPORTS: SupportedSport[] = ['squash', 'running', 'strength', 'cycling']

function getPlanGoalEventSport(profile: AthleteProfile | null | undefined): SupportedSport | undefined {
  if (!profile?.goalEvents || profile.goalEvents.length === 0) return undefined

  const targetEvent = profile.planWizardConfig?.goalEventId
    ? profile.goalEvents.find((event) => event.id === profile.planWizardConfig?.goalEventId)
    : undefined

  const fallbackPrimary = profile.goalEvents.find((event) => event.priority === 'primary')
  const resolved = targetEvent ?? fallbackPrimary
  return resolved?.sport ? normalizeSport(resolved.sport) : undefined
}

export function getPlanningPrimarySport(profile: AthleteProfile | null | undefined): SupportedSport | undefined {
  return getPlanGoalEventSport(profile) ?? getPrimarySportNormalized(profile)
}

export function getAllowedPlanningSports(profile: AthleteProfile | null | undefined): SupportedSport[] {
  if (!profile) return []

  const config = profile.planWizardConfig
  const planningPrimary = getPlanningPrimarySport(profile)

  if (!config || !planningPrimary) {
    return getEnabledSports(profile)
  }

  return [...new Set([
    planningPrimary,
    ...config.complementarySports
      .map((sport) => normalizeSport(sport))
      .filter((sport): sport is SupportedSport => sport !== undefined),
  ])]
}

export function getPlanWizardDefaultComplementarySports(
  existingConfig: PlanWizardConfig | undefined,
  primarySportForEvent: SupportedSport | null,
): SupportedSport[] {
  if (!existingConfig) return []

  return existingConfig.complementarySports
    .map((sport) => normalizeSport(sport))
    .filter((sport): sport is SupportedSport => sport !== undefined && sport !== primarySportForEvent)
}

export function isSessionTypeAllowedForPlan(
  sessionType: SessionType | string | undefined,
  profile: AthleteProfile | null | undefined,
): boolean {
  if (!sessionType) return true

  const normalized = normalizeSport(sessionType)
  if (!normalized || !RESTRICTED_PLANNING_SPORTS.includes(normalized)) {
    return true
  }

  const allowedSports = getAllowedPlanningSports(profile)
  if (allowedSports.length === 0) return true
  return allowedSports.includes(normalized)
}

export function filterCoachSessionsToAllowedSports(
  sessions: CoachSessionProposal[],
  profile: AthleteProfile | null | undefined,
): CoachSessionProposal[] {
  return sessions.filter((session) => isSessionTypeAllowedForPlan(session.sessionType, profile))
}

export function sanitizeCoachActionsForPlan(
  actions: CoachAction[],
  profile: AthleteProfile | null | undefined,
): { actions: CoachAction[]; warnings: string[] } {
  const warnings: string[] = []
  const nextActions: CoachAction[] = []

  for (const action of actions) {
    if (action.type === 'add_session') {
      if (!isSessionTypeAllowedForPlan(action.sessionType, profile)) {
        warnings.push(`Se filtró add_session con deporte no permitido: ${action.sessionType}`)
        continue
      }
      nextActions.push(action)
      continue
    }

    if (action.type === 'replace_session_type' || action.type === 'update_session') {
      const nextType = action.newType
      if (nextType && !isSessionTypeAllowedForPlan(nextType, profile)) {
        warnings.push(`Se filtró ${action.type} con deporte no permitido: ${nextType}`)
        continue
      }
      nextActions.push(action)
      continue
    }

    if (action.type === 'create_week') {
      const allowedSessions = filterCoachSessionsToAllowedSports(action.sessions ?? [], profile)
      if (allowedSessions.length === 0) {
        warnings.push('Se filtró create_week completo porque todas las sesiones propuestas eran de deportes no permitidos.')
        continue
      }
      if (allowedSessions.length !== (action.sessions?.length ?? 0)) {
        warnings.push('Se filtraron sesiones de deportes no permitidos dentro de create_week.')
      }
      nextActions.push({ ...action, sessions: allowedSessions })
      continue
    }

    nextActions.push(action)
  }

  return { actions: nextActions, warnings }
}
