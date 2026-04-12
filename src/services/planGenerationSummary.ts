import { differenceInCalendarDays } from 'date-fns'

import type {
  AthleteProfile,
  CoachAction,
  CoachSessionProposal,
  MacroPlanPhase,
  PlanGenerationSummary,
  Session,
  SupportedSport,
  WeeklyPlanIntent,
} from '../types'
import { calculateRunningAcwr, calculateSquashAcwr, calculateStrengthAcwr } from './loadAnalytics'
import { computeMacroPlan, getPrimaryGoalEvent } from './macroPlan'
import { buildMacroWeekCoherenceSummary } from './macroWeekCoherence'
import { getAllowedPlanningSports, getPlanningPrimarySport, RESTRICTED_PLANNING_SPORTS } from './planningConstraints'
import {
  deriveSquashProgressionState,
  extractRecentSquashDrills,
  type SquashSelectionPhase,
} from './training/drillSelector'
import {
  deriveStrengthProgressionState,
  extractRecentStrengthExercises,
  type StrengthPhase,
  type StrengthSportProfile,
} from './training/strengthSelector'
import {
  deriveRunningProgressionState,
  extractRecentRunningSessions,
  type RunningPhase,
  type RunningSportProfile,
} from './training/runningSelector'

const SPORT_LABELS: Record<SupportedSport, string> = {
  squash: 'squash',
  running: 'running',
  strength: 'fuerza',
  mobility: 'movilidad',
  cycling: 'ciclismo',
}

function mapFatigueLevel(profile: AthleteProfile | null | undefined): number {
  switch (profile?.planWizardConfig?.currentFatigue) {
    case 'fresh':
      return 2
    case 'loaded':
      return 6
    case 'overloaded':
      return 8
    case 'normal':
    default:
      return 4
  }
}

function mapPhaseToSquash(phase: MacroPlanPhase | undefined): SquashSelectionPhase {
  switch (phase) {
    case 'build':
      return 'build'
    case 'peak':
      return 'peak'
    case 'taper':
    case 'race':
      return 'taper'
    case 'transition':
    case 'base':
    default:
      return 'base'
  }
}

function mapPhaseToStrength(phase: MacroPlanPhase | undefined): StrengthPhase {
  switch (phase) {
    case 'build':
      return 'build'
    case 'peak':
      return 'peak'
    case 'taper':
    case 'race':
      return 'taper'
    case 'transition':
      return 'transition'
    case 'base':
    default:
      return 'base'
  }
}

function mapPhaseToRunning(phase: MacroPlanPhase | undefined): RunningPhase {
  switch (phase) {
    case 'build':
      return 'build'
    case 'peak':
      return 'peak'
    case 'taper':
    case 'race':
      return 'taper'
    case 'transition':
      return 'transition'
    case 'base':
    default:
      return 'base'
  }
}

function deriveStrengthSportProfile(primarySport: SupportedSport | undefined, allowedSports: SupportedSport[]): StrengthSportProfile {
  if (primarySport === 'strength') return 'strength_primary'
  if (allowedSports.includes('strength') && allowedSports.length > 1) return 'hybrid'
  return 'sport_support'
}

function deriveRunningSportProfile(primarySport: SupportedSport | undefined, allowedSports: SupportedSport[]): RunningSportProfile {
  if (primarySport === 'running') return 'running_primary'
  if (allowedSports.includes('running') && allowedSports.length > 1) return 'hybrid'
  return 'sport_support'
}

function extractProposedSessions(actions: CoachAction[]): CoachSessionProposal[] {
  return actions.flatMap((action) => {
    if (action.type === 'create_week') return action.sessions ?? []
    if (action.type === 'add_session' && action.sessionType && action.targetDate && action.timeBlock && action.title && action.durationMin) {
      return [{
        date: action.targetDate,
        timeBlock: action.timeBlock,
        sessionType: action.sessionType,
        title: action.title,
        durationMin: action.durationMin,
        rpe: action.rpe ?? action.newRpe,
        objective: action.objective,
        subtype: action.subtype,
        runningType: action.runningType,
        targetPaceMin: action.targetPaceMin,
        targetPaceMax: action.targetPaceMax,
        targetHrMin: action.targetHrMin,
        targetHrMax: action.targetHrMax,
        exercises: action.exercises,
        squashDetails: action.squashDetails,
        warmup: action.warmup,
        cooldown: action.cooldown,
      }]
    }
    return []
  })
}

function buildSessionsBySport(sessions: CoachSessionProposal[]): Partial<Record<SupportedSport, number>> {
  const counts: Partial<Record<SupportedSport, number>> = {}
  for (const sport of RESTRICTED_PLANNING_SPORTS) counts[sport] = 0
  for (const session of sessions) {
    const sport = session.sessionType as SupportedSport
    if (!RESTRICTED_PLANNING_SPORTS.includes(sport)) continue
    counts[sport] = (counts[sport] ?? 0) + 1
  }
  return counts
}

function buildEstimatedLoadBySport(sessions: CoachSessionProposal[]): Partial<Record<SupportedSport, number>> {
  const loads: Partial<Record<SupportedSport, number>> = {}
  for (const sport of RESTRICTED_PLANNING_SPORTS) loads[sport] = 0
  loads.mobility = 0
  for (const session of sessions) {
    const sport = session.sessionType as SupportedSport
    if (!RESTRICTED_PLANNING_SPORTS.includes(sport) && sport !== 'mobility') continue
    const rpe = session.rpe ?? (sport === 'mobility' ? 4 : 6)
    loads[sport] = (loads[sport] ?? 0) + (session.durationMin * rpe)
  }
  return loads
}

function buildWeeklyGoalSummary(actions: CoachAction[], primarySport: SupportedSport | undefined): string {
  const objectives = actions.find((action) => action.type === 'create_week')?.weekObjectives ?? []
  if (objectives.length > 0) {
    return objectives.join(' · ')
  }

  if (primarySport) {
    return `Mantener coherencia en ${SPORT_LABELS[primarySport]} durante la semana`
  }

  return 'Semana estructurada según las restricciones seleccionadas'
}

function getCompetitionSoon(profile: AthleteProfile | null | undefined): boolean {
  const primaryGoalEvent = getPrimaryGoalEvent(profile)
  if (!primaryGoalEvent) return false
  return differenceInCalendarDays(new Date(primaryGoalEvent.date), new Date()) <= 7
}

function inferCyclingIntent(profile: AthleteProfile | null | undefined): WeeklyPlanIntent {
  const phase = computeMacroPlan(profile)?.currentPhase
  const fatigue = mapFatigueLevel(profile)
  if (fatigue >= 7 || phase === 'taper' || phase === 'race') return 'deload'
  if (phase === 'peak') return 'hold'
  return 'progress'
}

function buildIntentsBySport(
  profile: AthleteProfile | null | undefined,
  historicalSessions: Session[],
  allowedSports: SupportedSport[],
  weeklyGoalSummary: string,
): Partial<Record<SupportedSport, WeeklyPlanIntent>> {
  const intents: Partial<Record<SupportedSport, WeeklyPlanIntent>> = {}
  const primarySport = getPlanningPrimarySport(profile)
  const macroPlan = computeMacroPlan(profile)
  const fatigueLevel = mapFatigueLevel(profile)
  const competitionSoon = getCompetitionSoon(profile)
  const acwr = {
    squash: calculateSquashAcwr(historicalSessions),
    running: calculateRunningAcwr(historicalSessions),
    strength: calculateStrengthAcwr(historicalSessions),
  }

  if (allowedSports.includes('squash')) {
    const state = deriveSquashProgressionState({
      fatigueLevel,
      phase: mapPhaseToSquash(macroPlan?.currentPhase),
      recentDrills: extractRecentSquashDrills(historicalSessions),
      goal: weeklyGoalSummary,
      competitionSoon,
      historicalSessions,
      squashAcwr: acwr.squash,
    })
    intents.squash = state.recommendation
  }

  if (allowedSports.includes('strength')) {
    const state = deriveStrengthProgressionState({
      fatigueLevel,
      phase: mapPhaseToStrength(macroPlan?.currentPhase),
      recentExercises: extractRecentStrengthExercises(historicalSessions),
      goal: weeklyGoalSummary,
      sportProfile: deriveStrengthSportProfile(primarySport, allowedSports),
      primarySport,
      competitionSoon,
      historicalSessions,
      strengthAcwr: acwr.strength,
    })
    intents.strength = state.intent
  }

  if (allowedSports.includes('running')) {
    const state = deriveRunningProgressionState({
      fatigueLevel,
      phase: mapPhaseToRunning(macroPlan?.currentPhase),
      recentSessions: extractRecentRunningSessions(historicalSessions),
      goal: weeklyGoalSummary,
      sportProfile: deriveRunningSportProfile(primarySport, allowedSports),
      primarySport,
      competitionSoon,
      historicalSessions,
      runningAcwr: acwr.running,
    })
    intents.running = state.intent
  }

  if (allowedSports.includes('cycling')) {
    intents.cycling = inferCyclingIntent(profile)
  }

  return intents
}

export function validateGeneratedPlan(args: {
  athleteProfile: AthleteProfile | null | undefined
  sessions: CoachSessionProposal[]
  intentsBySport: Partial<Record<SupportedSport, WeeklyPlanIntent>>
}): { validationStatus: PlanGenerationSummary['validationStatus']; validationIssues: string[] } {
  const { athleteProfile, sessions, intentsBySport } = args
  const allowedSports = getAllowedPlanningSports(athleteProfile)
  const primarySport = getPlanningPrimarySport(athleteProfile)
  const issues: string[] = []
  const sessionsBySport = buildSessionsBySport(sessions)

  const disallowedSports = [...new Set(
    sessions
      .map((session) => session.sessionType as SupportedSport)
      .filter((sport) => RESTRICTED_PLANNING_SPORTS.includes(sport) && !allowedSports.includes(sport)),
  )]

  if (disallowedSports.length > 0) {
    issues.push(`Se detectó un deporte no permitido en el plan generado: ${disallowedSports.map((sport) => SPORT_LABELS[sport]).join(', ')}`)
  }

  if (primarySport && (sessionsBySport[primarySport] ?? 0) === 0) {
    issues.push('La distribución del plan no coincide con las restricciones seleccionadas: falta una sesión del deporte principal.')
  }

  if (allowedSports.length > 0 && allowedSports.every((sport) => (sessionsBySport[sport] ?? 0) === 0)) {
    issues.push('La distribución del plan no coincide con las restricciones seleccionadas: no se programaron sesiones para los deportes permitidos.')
  }

  const missingIntentSports = allowedSports.filter((sport) => intentsBySport[sport] == null)
  if (missingIntentSports.length > 0) {
    issues.push(`La intención semanal no pudo determinarse para: ${missingIntentSports.map((sport) => SPORT_LABELS[sport]).join(', ')}`)
  }

  return {
    validationStatus: issues.length > 0 ? 'warning' : 'ok',
    validationIssues: issues,
  }
}

export function buildPlanGenerationSummary(args: {
  athleteProfile: AthleteProfile | null | undefined
  actions: CoachAction[]
  historicalSessions: Session[]
}): PlanGenerationSummary | undefined {
  const { athleteProfile, actions, historicalSessions } = args
  const proposedSessions = extractProposedSessions(actions)
  if (proposedSessions.length === 0) return undefined

  const allowedSports = getAllowedPlanningSports(athleteProfile)
  const excludedSports = RESTRICTED_PLANNING_SPORTS.filter((sport) => !allowedSports.includes(sport))
  const sessionsBySport = buildSessionsBySport(proposedSessions)
  const estimatedLoadBySport = buildEstimatedLoadBySport(proposedSessions)
  const weeklyGoalSummary = buildWeeklyGoalSummary(actions, getPlanningPrimarySport(athleteProfile))
  const intentsBySport = buildIntentsBySport(athleteProfile, historicalSessions, allowedSports, weeklyGoalSummary)
  const primarySport = getPlanningPrimarySport(athleteProfile)
  const weeklyIntent = (primarySport && intentsBySport[primarySport]) || intentsBySport[allowedSports[0]] || 'unknown'
  const validation = validateGeneratedPlan({
    athleteProfile,
    sessions: proposedSessions,
    intentsBySport,
  })
  const macroWeekCoherence = buildMacroWeekCoherenceSummary({
    athleteProfile,
    sessions: proposedSessions,
    historicalSessions,
  })

  return {
    allowedSports,
    excludedSports,
    sessionsBySport,
    estimatedLoadBySport,
    intentsBySport,
    weeklyIntent,
    weeklyGoalSummary,
    validationStatus: validation.validationStatus,
    validationIssues: validation.validationIssues,
    macroWeekCoherence,
  }
}
