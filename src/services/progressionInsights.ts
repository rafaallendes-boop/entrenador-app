import { db } from '../db/db'
import { getAthleteProfile } from '../db/queries'
import { computeMacroPlan } from './macroPlan'
import type { AthleteProfile, DayLog, MatchResult, Session, SquashSessionMode } from '../types'
import { getEnabledSports, getPrimarySportNormalized } from '../utils/athlete'
import {
  getRecentSquashCompetitiveExposure,
  isCompetitionSquashMatch,
  isPracticeSquashMatch,
} from '../utils/squash'
import {
  deriveSquashProgressionState,
  extractRecentSquashDrills,
  type SquashProgressionRecommendation,
  type SquashSelectionContext,
} from './training/drillSelector'
import {
  deriveStrengthProgressionState,
  extractRecentStrengthExercises,
  type StrengthContext,
  type StrengthProgressionIntent,
} from './training/strengthSelector'
import {
  deriveStrengthExperienceLevel,
  deriveStrengthSportProfile,
  mapMacroPhaseToStrengthPhase,
} from './training/strengthContext'
import {
  calculateSquashAcwr,
  calculateStrengthAcwr,
  getSquashWeeklyLoads,
  getStrengthWeeklyLoads,
  type DisciplineAcwr,
  type SquashWeeklyLoad,
  type StrengthWeeklyLoad,
} from './loadAnalytics'

const STRENGTH_PRIORITY_ORDER = [
  'sentadilla',
  'peso muerto',
  'press banca',
  'press hombro',
  'remo',
  'hip thrust',
  'lunge',
] as const

export function normalizeExerciseFamily(name: string): { key: string; label: string } {
  const normalized = name.trim().toLowerCase()

  if (normalized.includes('sentadilla frontal')) return { key: 'sentadilla', label: 'Sentadilla' }
  if (normalized.includes('sentadilla') || normalized.includes('back squat')) return { key: 'sentadilla', label: 'Sentadilla' }
  if (normalized.includes('press banca') || normalized.includes('bench')) return { key: 'press banca', label: 'Press banca' }
  if (normalized.includes('peso muerto') || normalized.includes('deadlift') || normalized === 'rdl') return { key: 'peso muerto', label: 'Peso muerto' }
  if (normalized.includes('press hombro') || normalized.includes('overhead press')) return { key: 'press hombro', label: 'Press hombro' }
  if (normalized.includes('remo')) return { key: 'remo', label: 'Remo' }
  if (normalized.includes('hip thrust')) return { key: 'hip thrust', label: 'Hip thrust' }
  if (normalized.includes('lunge') || normalized.includes('zancada')) return { key: 'lunge', label: 'Lunge' }

  const compact = normalized.replace(/\s+/g, ' ')
  return {
    key: compact,
    label: compact.charAt(0).toUpperCase() + compact.slice(1),
  }
}

export interface SquashMatchHistoryItem {
  id: string
  date: string
  opponent?: string
  result?: MatchResult
  gamesWon?: number
  gamesLost?: number
  actualRpe?: number
  title: string
  sessionMode: SquashSessionMode
  competitiveRole: 'practice_match' | 'competition_match'
}

export interface SquashCompetitiveExposureInsights {
  practiceMatchCount: number
  competitionMatchCount: number
  totalMatchCount: number
  exposureScore: number
}

export interface StrengthProgressionEntry {
  date: string
  sets: number
  reps: number | string
  weight?: number
}

export interface StrengthExerciseProgression {
  exerciseKey: string
  exerciseLabel: string
  trend: 'up' | 'flat' | 'mixed' | 'no_load'
  trendLabel: string
  entries: StrengthProgressionEntry[]
}

export interface AthleteProgressionInsights {
  squashRecommendation?: {
    status: SquashProgressionRecommendation
    message: string
  }
  strengthRecommendation?: {
    status: StrengthProgressionIntent
    message: string
  }
  matches: SquashMatchHistoryItem[]
  squashCompetitiveExposure: SquashCompetitiveExposureInsights
  strength: StrengthExerciseProgression[]
  squashAcwr: DisciplineAcwr
  strengthAcwr: DisciplineAcwr
  squashWeeklyLoads: SquashWeeklyLoad[]
  strengthWeeklyLoads: StrengthWeeklyLoad[]
}

function getSquashRecommendationMessage(
  recommendation: SquashProgressionRecommendation,
  targetFamily: string,
): string {
  switch (recommendation) {
    case 'progress':
      return `Familia ${targetFamily} en progresión. Puedes sostener continuidad y subir exigencia.`
    case 'hold':
      return `Familia ${targetFamily} para consolidar. Mantén el estímulo sin escalar todavía.`
    case 'rotate':
      return `Familia ${targetFamily} ya va cargada. Conviene rotar el foco en la próxima sesión.`
    case 'deload':
      return `Familia ${targetFamily} pide descarga. Baja volumen o intensidad para llegar más fresco.`
  }
}

function getStrengthRecommendationMessage(
  intent: StrengthProgressionIntent,
  mainPattern: string,
): string {
  switch (intent) {
    case 'progress':
      return `Patrón ${mainPattern} en progresión. Puedes escalar carga o densidad de forma controlada.`
    case 'hold':
      return `Patrón ${mainPattern} para mantener. Consolida sin subir carga por ahora.`
    case 'rotate':
      return `Patrón ${mainPattern} necesita rotación. Cambia el estímulo principal en la próxima sesión.`
    case 'deload':
      return `Patrón ${mainPattern} necesita descarga. Reduce volumen e intensidad antes de volver a empujar.`
  }
}

function getStrengthTrend(entries: StrengthProgressionEntry[]): Pick<StrengthExerciseProgression, 'trend' | 'trendLabel'> {
  const weightedEntries = entries.filter((entry) => entry.weight != null)
  if (weightedEntries.length < 2) {
    return {
      trend: weightedEntries.length === 0 ? 'no_load' : 'flat',
      trendLabel: weightedEntries.length === 0 ? 'sin carga registrada' : 'estable',
    }
  }

  const first = weightedEntries[0].weight as number
  const last = weightedEntries[weightedEntries.length - 1].weight as number
  const uniqueWeights = new Set(weightedEntries.map((entry) => entry.weight as number))

  if (last > first) return { trend: 'up', trendLabel: 'subiendo' }
  if (last === first && uniqueWeights.size === 1) return { trend: 'flat', trendLabel: 'estable' }
  return { trend: 'mixed', trendLabel: 'variable' }
}

export function getSquashMatchHistory(
  sessions: Session[],
  limit = 10,
): SquashMatchHistoryItem[] {
  return sessions
    .filter((session) =>
      isPracticeSquashMatch(session) || isCompetitionSquashMatch(session),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
    .slice(0, limit)
    .map((session) => ({
      id: session.id,
      date: session.date,
      opponent: session.opponent,
      result: session.matchResult,
      gamesWon: session.gamesWon,
      gamesLost: session.gamesLost,
      actualRpe: session.actualRpe,
      title: session.title,
      sessionMode: isPracticeSquashMatch(session) ? 'practice_match' : 'competition_match',
      competitiveRole: isPracticeSquashMatch(session) ? 'practice_match' : 'competition_match',
    }))
}

export function getStrengthProgression(
  sessions: Session[],
  limitPerExercise = 4,
  maxFamilies = 4,
): StrengthExerciseProgression[] {
  const familyMap = new Map<string, StrengthExerciseProgression>()

  const strengthSessions = sessions
    .filter((session) =>
      session.type === 'strength' &&
      (session.status === 'completed' || session.status === 'adjusted') &&
      session.exercises &&
      session.exercises.length > 0,
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))

  for (const session of strengthSessions) {
    for (const exercise of session.exercises ?? []) {
      if (!exercise.sets) continue

      const family = normalizeExerciseFamily(exercise.name)
      const progression = familyMap.get(family.key) ?? {
        exerciseKey: family.key,
        exerciseLabel: family.label,
        trend: 'no_load' as const,
        trendLabel: 'sin carga registrada',
        entries: [],
      }

      if (progression.entries.length < limitPerExercise) {
        progression.entries.push({
          date: session.date,
          sets: exercise.sets,
          reps: exercise.reps,
          weight: exercise.weight,
        })
      }

      familyMap.set(family.key, progression)
    }
  }

  return [...familyMap.values()]
    .filter((progression) => progression.entries.length > 0)
    .sort((a, b) => {
      const aHasWeight = a.entries.some((entry) => entry.weight != null)
      const bHasWeight = b.entries.some((entry) => entry.weight != null)
      if (aHasWeight !== bHasWeight) return aHasWeight ? -1 : 1

      const aIdx = STRENGTH_PRIORITY_ORDER.indexOf(a.exerciseKey as (typeof STRENGTH_PRIORITY_ORDER)[number])
      const bIdx = STRENGTH_PRIORITY_ORDER.indexOf(b.exerciseKey as (typeof STRENGTH_PRIORITY_ORDER)[number])
      const aRank = aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx
      const bRank = bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx
      return aRank - bRank || a.exerciseLabel.localeCompare(b.exerciseLabel)
    })
    .slice(0, maxFamilies)
    .map((progression) => {
      const entries = progression.entries.reverse()
      return {
        ...progression,
        ...getStrengthTrend(entries),
        entries,
      }
    })
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function mapMacroPhaseToSquashPhase(profile: AthleteProfile | undefined): SquashSelectionContext['phase'] {
  const phase = computeMacroPlan(profile)?.currentPhase
  switch (phase) {
    case 'build':
      return 'build'
    case 'peak':
      return 'peak'
    case 'taper':
    case 'race':
      return 'taper'
    case 'transition':
      return 'base'
    case 'base':
    default:
      return 'base'
  }
}

function deriveFatigueLevel(dayLogs: DayLog[], sessions: Session[]): number {
  let score = 4
  const latestLog = [...dayLogs]
    .sort((a, b) => b.date.localeCompare(a.date))
    .find(Boolean)

  if (latestLog) {
    if (latestLog.energyLevel != null && latestLog.energyLevel <= 3) score += 2
    else if (latestLog.energyLevel != null && latestLog.energyLevel <= 5) score += 1

    if (latestLog.painLevel != null && latestLog.painLevel >= 6) score += 3
    else if (latestLog.painLevel != null && latestLog.painLevel >= 3) score += 1

    if (latestLog.sleepHours != null && latestLog.sleepHours < 6) score += 2
    else if (latestLog.sleepHours != null && latestLog.sleepHours < 7) score += 1

    if (latestLog.rpeActual != null && latestLog.rpeActual >= 8) score += 2
    else if (latestLog.rpeActual != null && latestLog.rpeActual >= 6) score += 1
  }

  const recentActualRpe = sessions
    .filter((session) => session.actualRpe != null)
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
    .slice(0, 3)
    .map((session) => session.actualRpe as number)

  if (recentActualRpe.length > 0) {
    const avgRecentRpe = recentActualRpe.reduce((sum, rpe) => sum + rpe, 0) / recentActualRpe.length
    if (avgRecentRpe >= 8) score += 2
    else if (avgRecentRpe >= 6.5) score += 1
  }

  return clamp(score, 1, 10)
}

function diffDays(fromISODate: string, toISODate: string): number {
  const from = new Date(`${fromISODate}T00:00:00`)
  const to = new Date(`${toISODate}T00:00:00`)
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function getNextCompetitionSessions(
  allSessions: Session[],
  today: string,
  predicate?: (session: Session) => boolean,
) {
  return allSessions
    .filter((session) =>
      session.date >= today &&
      isCompetitionSquashMatch(session) &&
      (!predicate || predicate(session)),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

function buildSquashContext(
  profile: AthleteProfile | undefined,
  completedSessions: Session[],
  squashAcwr: DisciplineAcwr,
  upcomingCompetition?: Session,
  fatigueLevel = 4,
): SquashSelectionContext {
  return {
    fatigueLevel,
    phase: mapMacroPhaseToSquashPhase(profile),
    recentDrills: extractRecentSquashDrills(completedSessions),
    goal: upcomingCompetition?.title ?? profile?.mainGoal ?? 'mejorar squash con continuidad',
    competitionSoon: Boolean(upcomingCompetition && diffDays(todayISO(), upcomingCompetition.date) <= 4),
    historicalSessions: completedSessions,
    squashAcwr,
  }
}

function buildStrengthContext(
  profile: AthleteProfile | undefined,
  completedSessions: Session[],
  strengthAcwr: DisciplineAcwr,
  upcomingCompetition: Session | undefined,
  fatigueLevel: number,
): StrengthContext {
  return {
    fatigueLevel,
    phase: mapMacroPhaseToStrengthPhase(computeMacroPlan(profile)?.currentPhase),
    recentExercises: extractRecentStrengthExercises(completedSessions),
    goal: upcomingCompetition?.title ?? profile?.mainGoal ?? 'desarrollar fuerza util',
    sportProfile: deriveStrengthSportProfile(profile),
    primarySport: getPrimarySportNormalized(profile),
    experienceLevel: deriveStrengthExperienceLevel(profile),
    sessionDurationMin: profile?.planWizardConfig?.sessionDurationMins ?? 50,
    competitionSoon: Boolean(upcomingCompetition && diffDays(todayISO(), upcomingCompetition.date) <= 4),
    daysToCompetition: upcomingCompetition ? diffDays(todayISO(), upcomingCompetition.date) : undefined,
    historicalSessions: completedSessions,
    strengthAcwr,
  }
}

export async function getAthleteProgressionInsights(): Promise<AthleteProgressionInsights> {
  const today = todayISO()
  const [allSessions, dayLogs, profile] = await Promise.all([
    db.sessions.toArray(),
    db.dayLogs.toArray(),
    getAthleteProfile(),
  ])

  const completedSessions = allSessions.filter(
    (session) => session.status === 'completed' || session.status === 'adjusted',
  )
  const nextCompetition = getNextCompetitionSessions(allSessions, today)[0]
  const nextSquashCompetition = getNextCompetitionSessions(
    allSessions,
    today,
    (session) => session.type === 'squash',
  )[0]
  const fatigueLevel = deriveFatigueLevel(dayLogs, completedSessions)

  const matchHistory = getSquashMatchHistory(completedSessions, 10)
  const squashCompetitiveExposure = getRecentSquashCompetitiveExposure(
    [...completedSessions]
      .filter((session) => session.type === 'squash')
      .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock)),
    6,
  )
  const strengthProgression = getStrengthProgression(completedSessions, 4, 4)

  const squashAcwr = calculateSquashAcwr(completedSessions)
  const strengthAcwr = calculateStrengthAcwr(completedSessions)
  const squashWeeklyLoads = getSquashWeeklyLoads(completedSessions)
  const strengthWeeklyLoads = getStrengthWeeklyLoads(completedSessions)

  const enabledSports = getEnabledSports(profile)
  const squashContext = buildSquashContext(profile, completedSessions, squashAcwr, nextSquashCompetition, fatigueLevel)
  const squashProgressionState = deriveSquashProgressionState(squashContext)
  const squashRecommendation = enabledSports.includes('squash') && squashProgressionState.targetFamily
    ? {
        status: squashProgressionState.recommendation,
        message: getSquashRecommendationMessage(
          squashProgressionState.recommendation,
          squashProgressionState.targetFamily,
        ),
      }
    : undefined

  const strengthContext = buildStrengthContext(profile, completedSessions, strengthAcwr, nextCompetition, fatigueLevel)
  const strengthProgressionState = deriveStrengthProgressionState(strengthContext)
  const strengthRecommendation = enabledSports.includes('strength') && strengthProgressionState.mainPattern
    ? {
        status: strengthProgressionState.intent,
        message: getStrengthRecommendationMessage(
          strengthProgressionState.intent,
          strengthProgressionState.mainPattern,
        ),
      }
    : undefined

  return {
    squashRecommendation,
    strengthRecommendation,
    matches: matchHistory,
    squashCompetitiveExposure,
    strength: strengthProgression,
    squashAcwr,
    strengthAcwr,
    squashWeeklyLoads,
    strengthWeeklyLoads,
  }
}
