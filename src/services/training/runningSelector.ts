import type { RunningAcwr, RunningWeeklyLoad } from '../loadAnalytics'
import type { Session, RunningType } from '../../types'
import {
  RUNNING_SESSION_LIBRARY,
  type RunningIntensity,
  type RunningSessionCategory,
  type RunningSessionDefinition,
  type RunningSessionFamily,
} from './runningSessionLibrary'

export type RunningSportProfile = 'running_primary' | 'hybrid' | 'sport_support'
export type RunningPhase = 'base' | 'build' | 'peak' | 'taper' | 'transition'

export interface RunningContext {
  fatigueLevel: number
  phase: RunningPhase
  recentSessions: string[]      // family keys from last 4-6 running sessions
  goal: string
  sportProfile: RunningSportProfile
  primarySport?: string
  competitionSoon?: boolean
  daysToCompetition?: number
  sessionDurationMin?: number
  weeklyRunCount?: number
  experienceLevel?: 'beginner' | 'intermediate' | 'advanced'
  historicalSessions?: Session[]
  runningAcwr?: RunningAcwr
  runningWeeklyLoad?: RunningWeeklyLoad
}

export type RunningProgressionIntent = 'progress' | 'hold' | 'deload' | 'rotate'

interface RunningFamilyEntry {
  family: RunningSessionFamily
  frequency: number
  lastDate: string
}

export interface RunningProgressionState {
  intent: RunningProgressionIntent
  currentFamily?: RunningSessionFamily
  families: Record<string, RunningFamilyEntry>
}

export interface RunningSelectionResult {
  focus: string
  session: {
    name: string
    category: RunningSessionCategory
    family: RunningSessionFamily
    runningType: RunningType
    structure: string
    intensity: RunningIntensity
    notes?: string
  }
  progressionSummary?: string
}

interface ScoredSession {
  session: RunningSessionDefinition
  score: number
}

let cachedRunningSelectorSmokeChecks: string[] | null = null

// ─── Main selector ────────────────────────────────────────────────────────────

export function selectRunningSession(context: RunningContext): RunningSelectionResult {
  const recentFamilies = new Set(context.recentSessions)
  const progressionState = deriveRunningProgressionState(context)

  const byFatigue = filterByFatigue(RUNNING_SESSION_LIBRARY, context)
  const byPhase = filterByPhase(byFatigue, context)
  const byCompetition = filterByCompetition(byPhase, context)
  const byProfile = filterByProfile(byCompetition, context)
  const withoutRecent = avoidRecentFamilies(byProfile, recentFamilies)

  const pool = withoutRecent.length >= 3 ? withoutRecent : byProfile
  const scored = scoreSessions(pool, context, recentFamilies, progressionState)
  const fallbackScored = scored.length > 0
    ? scored
    : scoreSessions(byFatigue, context, recentFamilies, progressionState)

  const selected =
    fallbackScored[0]?.session ??
    RUNNING_SESSION_LIBRARY.find(s => s.id === 'easy_z2_base') ??
    RUNNING_SESSION_LIBRARY[0]

  const notes = buildProgressedRunningNotes(selected, progressionState, context)
  const progressionSummary = summarizeRunningProgression(context, progressionState)

  return {
    focus: deriveRunningFocus(selected, context),
    session: {
      name: selected.name,
      category: selected.category,
      family: selected.family,
      runningType: selected.runningType,
      structure: selected.typicalStructure,
      intensity: selected.intensity,
      notes,
    },
    progressionSummary,
  }
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export function filterByFatigue(
  sessions: RunningSessionDefinition[],
  context: RunningContext,
): RunningSessionDefinition[] {
  const isCriticalComp =
    context.competitionSoon &&
    context.daysToCompetition != null &&
    context.daysToCompetition <= 4

  if (isCriticalComp) {
    return sessions.filter(
      s => s.intensity === 'low' || s.id === 'race_activation' || s.id === 'strides_session',
    )
  }
  if (context.fatigueLevel >= 8) {
    return sessions.filter(s => s.intensity === 'low')
  }
  if (context.fatigueLevel >= 6) {
    return sessions.filter(s => s.intensity !== 'high')
  }
  return sessions
}

export function filterByPhase(
  sessions: RunningSessionDefinition[],
  context: RunningContext,
): RunningSessionDefinition[] {
  switch (context.phase) {
    case 'taper':
      return sessions.filter(
        s =>
          !['intervals_vo2', 'hill'].includes(s.family) &&
          s.intensity !== 'high' &&
          s.id !== 'progressive_long' &&
          s.id !== 'long_fast_finish',
      )
    case 'peak':
      return sessions.filter(
        s => s.intensity !== 'low' || s.family === 'recovery' || s.family === 'speed_economy',
      )
    case 'base':
      return sessions.filter(
        s => s.family !== 'race_specific' || s.id === 'race_activation',
      )
    case 'transition':
      return sessions.filter(s => s.intensity !== 'high' && s.family !== 'race_specific')
    case 'build':
    default:
      return sessions
  }
}

export function filterByCompetition(
  sessions: RunningSessionDefinition[],
  context: RunningContext,
): RunningSessionDefinition[] {
  if (!context.competitionSoon) return sessions
  const days = context.daysToCompetition ?? 99
  if (days <= 7) {
    return sessions.filter(
      s =>
        !(s.family === 'intervals_vo2' && s.intensity === 'high') &&
        s.family !== 'hill' &&
        !(s.family === 'tempo_threshold' && s.intensity === 'high') &&
        !(s.family === 'race_specific' && s.intensity === 'high'),
    )
  }
  return sessions
}

export function filterByProfile(
  sessions: RunningSessionDefinition[],
  context: RunningContext,
): RunningSessionDefinition[] {
  if (context.sportProfile === 'sport_support') {
    return sessions.filter(
      s =>
        ['easy_aerobic', 'recovery', 'speed_economy'].includes(s.family) ||
        (s.family === 'tempo_threshold' && s.intensity !== 'high') ||
        s.id === 'race_activation',
    )
  }
  return sessions
}

export function avoidRecentFamilies(
  sessions: RunningSessionDefinition[],
  recentFamilies: Set<string>,
): RunningSessionDefinition[] {
  return sessions.filter(s => !recentFamilies.has(s.family))
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreSessions(
  sessions: RunningSessionDefinition[],
  context: RunningContext,
  recentFamilies: Set<string>,
  progressionState: RunningProgressionState,
): ScoredSession[] {
  const goal = context.goal.toLowerCase()

  return sessions
    .map(session => {
      let score = 0

      // Phase alignment
      switch (context.phase) {
        case 'base':
          if (['easy_aerobic', 'speed_economy'].includes(session.family)) score += 5
          if (session.family === 'long_run') score += 4
          if (['tempo_threshold', 'intervals_vo2', 'hill'].includes(session.family)) score -= 3
          break
        case 'build':
          if (['tempo_threshold', 'intervals_vo2'].includes(session.family)) score += 5
          if (session.family === 'long_run') score += 3
          if (session.family === 'race_specific') score += 2
          if (session.family === 'hill') score += 2
          break
        case 'peak':
          if (session.family === 'race_specific') score += 6
          if (session.family === 'tempo_threshold') score += 3
          if (session.family === 'long_run') score += 1
          if (session.family === 'intervals_vo2') score += 2
          break
        case 'taper':
          if (['easy_aerobic', 'recovery', 'speed_economy'].includes(session.family)) score += 6
          if (session.id === 'race_activation') score += 8
          if (['intervals_vo2', 'hill'].includes(session.family)) score -= 10
          break
        case 'transition':
          if (['recovery', 'easy_aerobic'].includes(session.family)) score += 6
          if (session.intensity === 'high') score -= 5
          break
      }

      // Sport profile alignment
      if (context.sportProfile === 'sport_support') {
        if (['easy_aerobic', 'recovery', 'speed_economy'].includes(session.family)) score += 4
        if (session.intensity === 'high') score -= 6
        if (session.intensity === 'low') score += 3
      }
      if (context.sportProfile === 'hybrid') {
        if (session.family === 'tempo_threshold') score += 2
        if (session.intensity === 'moderate' || session.intensity === 'low') score += 1
        if (session.family === 'long_run' && session.id === 'long_fast_finish') score -= 2
      }
      if (context.sportProfile === 'running_primary') {
        if (session.progressionLevel != null) score += session.progressionLevel
        if (['tempo_threshold', 'intervals_vo2', 'long_run', 'race_specific'].includes(session.family)) score += 2
      }

      // Goal alignment
      if ((goal.includes('5k') || goal.includes('5km')) && session.tags.includes('5k')) score += 5
      if ((goal.includes('10k') || goal.includes('10km')) && session.tags.includes('10k')) score += 5
      if ((goal.includes('media') || goal.includes('hm') || goal.includes('half')) && session.tags.includes('half_marathon')) score += 5
      if ((goal.includes('marath') || goal.includes('fondo')) && session.tags.includes('marathon')) score += 5
      if ((goal.includes('base') || goal.includes('aerob')) && session.tags.includes('aerobic_base')) score += 4
      if ((goal.includes('veloc') || goal.includes('speed') || goal.includes('econom')) && session.tags.includes('economy')) score += 4
      if ((goal.includes('umbral') || goal.includes('threshold') || goal.includes('tempo')) && session.family === 'tempo_threshold') score += 4
      if ((goal.includes('recup') || goal.includes('volver') || goal.includes('recovery')) && session.family === 'recovery') score += 5

      // Fatigue modifiers
      if (context.fatigueLevel >= 7) {
        if (session.intensity === 'low') score += 4
        if (session.intensity === 'high') score -= 6
      }
      if (context.fatigueLevel <= 3 && context.sportProfile === 'running_primary') {
        if (session.progressionLevel === 3) score += 2
      }

      // Progression intent
      const inCurrentFamily = session.family === progressionState.currentFamily
      if (inCurrentFamily) {
        if (progressionState.intent === 'progress' && (session.progressionLevel ?? 1) > 1) score += 5
        if (progressionState.intent === 'rotate') score -= 8
        if (progressionState.intent === 'hold') score += 2
        if (progressionState.intent === 'deload' && session.intensity !== 'low') score -= 4
      }
      if (progressionState.intent === 'deload') {
        if (session.intensity === 'low') score += 4
        if (session.family === 'recovery') score += 3
      }
      if (progressionState.intent === 'rotate' && !inCurrentFamily) {
        score += 3
      }

      // Recency penalty
      if (recentFamilies.has(session.family)) score -= 5

      return { session, score }
    })
    .sort((a, b) => b.score - a.score || a.session.name.localeCompare(b.session.name))
}

// ─── Progression ─────────────────────────────────────────────────────────────

export function extractRecentRunningSessions(historicalSessions: Session[]): string[] {
  return getRecentCompletedRunningSessions(historicalSessions).map(s => deriveRunningFamilyFromSession(s))
}

function deriveRunningFamilyFromSession(session: Session): string {
  const rt = session.runningDetails?.runningType
  const title = (session.title ?? '').toLowerCase()
  const obj = (session.objective ?? '').toLowerCase()
  const combined = `${title} ${obj}`

  if (rt === 'long') return 'long_run'

  if (rt === 'intervals') {
    if (combined.includes('hill') || combined.includes('cuesta') || combined.includes('sprint')) return 'hill'
    if (combined.includes('speed') || combined.includes('strides') || combined.includes('economy')) return 'speed_economy'
    return 'intervals_vo2'
  }

  if (rt === 'tempo') {
    if (combined.includes('hill') || combined.includes('cuesta') || combined.includes('uphill')) return 'hill'
    if (
      combined.includes('race') ||
      combined.includes('carrera') ||
      combined.includes('activaci') ||
      combined.includes('hm') ||
      combined.includes('marath') ||
      combined.includes('específic')
    ) return 'race_specific'
    return 'tempo_threshold'
  }

  // z2 family derivation
  if (combined.includes('recup') || combined.includes('recovery') || combined.includes('trote suave')) return 'recovery'
  if (combined.includes('race') || (combined.includes('activaci') && combined.includes('carrera'))) return 'race_specific'
  if (combined.includes('stride') || combined.includes('economy') || combined.includes('activaci') || combined.includes('hill')) return 'speed_economy'
  return 'easy_aerobic'
}

export function deriveRunningProgressionState(context: RunningContext): RunningProgressionState {
  const runningSessions = getRecentCompletedRunningSessions(context.historicalSessions ?? [])

  const families: Record<string, RunningFamilyEntry> = {}

  for (const session of runningSessions) {
    const family = deriveRunningFamilyFromSession(session) as RunningSessionFamily
    const existing = families[family]
    if (!existing) {
      families[family] = { family, frequency: 1, lastDate: session.date }
    } else {
      existing.frequency += 1
    }
  }

  const currentFamily =
    runningSessions.length > 0
      ? (deriveRunningFamilyFromSession(runningSessions[0]) as RunningSessionFamily)
      : undefined

  return {
    intent: deriveRunningProgressionIntent(context, currentFamily, families),
    currentFamily,
    families,
  }
}

function getRecentCompletedRunningSessions(sessions: Session[]): Session[] {
  return [...sessions]
    .filter(
      s =>
        s.type === 'running' &&
        (s.status === 'completed' || s.status === 'adjusted') &&
        s.runningDetails != null,
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
    .slice(0, 6)
}

function deriveRunningProgressionIntent(
  context: RunningContext,
  currentFamily?: RunningSessionFamily,
  families: Record<string, RunningFamilyEntry> = {},
): RunningProgressionIntent {
  const isCriticalComp =
    context.competitionSoon &&
    context.daysToCompetition != null &&
    context.daysToCompetition <= 4

  if (context.phase === 'taper' || isCriticalComp || context.fatigueLevel >= 7) {
    return 'deload'
  }

  if (context.runningAcwr?.status === 'risk') {
    return 'deload'
  }

  const currentEntry = currentFamily ? families[currentFamily] : undefined
  if (currentEntry && currentEntry.frequency >= 2) {
    return 'rotate'
  }

  if (
    context.runningAcwr?.status === 'undertrained' &&
    context.fatigueLevel <= 5 &&
    !context.competitionSoon
  ) {
    return 'progress'
  }

  if (
    context.sportProfile === 'running_primary' &&
    (context.phase === 'build' || context.phase === 'peak') &&
    context.fatigueLevel <= 5
  ) {
    return 'progress'
  }

  return 'hold'
}

export function buildProgressedRunningNotes(
  session: RunningSessionDefinition,
  progressionState: RunningProgressionState,
  context: RunningContext,
): string {
  const isCriticalComp =
    context.competitionSoon &&
    context.daysToCompetition != null &&
    context.daysToCompetition <= 4

  if (context.phase === 'taper' || isCriticalComp) {
    return 'Mantener sensaciones sin acumular fatiga. Calidad sobre volumen.'
  }
  if (context.fatigueLevel >= 7) {
    return 'Fatiga alta: priorizar recuperación. Completar solo si el cuerpo lo permite; acortar si es necesario.'
  }

  if (context.runningAcwr?.status === 'risk') {
    const ratio = context.runningAcwr.ratio != null ? context.runningAcwr.ratio.toFixed(2) : 'sin ratio'
    return `ACWR de running alto (${ratio}) - usar version aligerada, bajar volumen y evitar sumar intensidad esta semana.`
  }

  switch (progressionState.intent) {
    case 'progress':
      return `Progresión sobre sesiones recientes — leve aumento de duración o densidad dentro de familia ${session.family}.`
    case 'deload':
      return 'Versión aligerada — reducir duración o simplificar estructura para gestionar fatiga acumulada.'
    case 'rotate':
      return `Cambio de familia tras repetición reciente — nuevo estímulo con ${session.name} para mantener adaptación.`
    case 'hold':
    default:
      return session.description
  }
}

export function summarizeRunningProgression(
  context: RunningContext,
  state?: RunningProgressionState,
): string {
  const s = state ?? deriveRunningProgressionState(context)
  const runningAcwrLabel =
    context.runningAcwr?.ratio != null
      ? ` ACWR running ${context.runningAcwr.ratio.toFixed(2)} (${context.runningAcwr.status}).`
      : context.runningAcwr?.status
        ? ` ACWR running ${context.runningAcwr.status}.`
        : ''
  if (!s.currentFamily) {
    return `Sin historial suficiente: usar variacion contextual limpia.${runningAcwrLabel}`.trim()
  }
  switch (s.intent) {
    case 'deload':
      return `Descargar familia ${s.currentFamily} con sesion suave o recovery.${runningAcwrLabel}`.trim()
    case 'progress':
      return `Continuar familia ${s.currentFamily} con progresion de carga o duracion.${runningAcwrLabel}`.trim()
    case 'rotate':
      return `Rotar desde familia ${s.currentFamily} - cambiar estimulo para evitar estancamiento.${runningAcwrLabel}`.trim()
    case 'hold':
    default:
      return `Mantener carga similar en o cerca de familia ${s.currentFamily}.${runningAcwrLabel}`.trim()
  }
}

function deriveRunningFocus(session: RunningSessionDefinition, context: RunningContext): string {
  if (context.phase === 'taper') {
    return `activación pre-competencia — ${session.name}`
  }
  if (context.sportProfile === 'sport_support') {
    return `aerobic conditioning — ${session.name}`
  }
  const familyLabel: Record<RunningSessionFamily, string> = {
    easy_aerobic: 'aerobic base',
    long_run: 'endurance',
    tempo_threshold: 'threshold development',
    intervals_vo2: 'VO2max',
    speed_economy: 'speed and economy',
    hill: 'strength-endurance',
    race_specific: 'race specificity',
    recovery: 'recovery',
  }
  return `${familyLabel[session.family] ?? session.family} — ${session.name}`
}

// ─── Smoke checks ────────────────────────────────────────────────────────────

export function runRunningSelectorSmokeChecks(): string[] {
  if (cachedRunningSelectorSmokeChecks) {
    return cachedRunningSelectorSmokeChecks
  }

  const outputs: string[] = []

  const primaryBase = selectRunningSession({
    phase: 'base',
    fatigueLevel: 4,
    recentSessions: ['easy_aerobic'],
    goal: 'desarrollar base aeróbica como corredor principal',
    sportProfile: 'running_primary',
    competitionSoon: false,
  })
  outputs.push(`running_primary_base=${primaryBase.session.name} (${primaryBase.session.runningType}) · intent=${primaryBase.progressionSummary?.split(' ')[0]}`)

  const primaryBuild = selectRunningSession({
    phase: 'build',
    fatigueLevel: 3,
    recentSessions: ['easy_aerobic', 'long_run'],
    goal: 'preparar 10K con foco en ritmo umbral y velocidad',
    sportProfile: 'running_primary',
    competitionSoon: false,
  })
  outputs.push(`running_primary_build=${primaryBuild.session.name} (${primaryBuild.session.runningType})`)

  const hybrid = selectRunningSession({
    phase: 'peak',
    fatigueLevel: 5,
    recentSessions: ['tempo_threshold'],
    goal: 'running complementario — squash como deporte principal',
    sportProfile: 'hybrid',
    primarySport: 'squash',
    competitionSoon: true,
    daysToCompetition: 5,
  })
  outputs.push(`hybrid_peak=${hybrid.session.name} (${hybrid.session.runningType})`)

  const support = selectRunningSession({
    phase: 'base',
    fatigueLevel: 7,
    recentSessions: ['easy_aerobic'],
    goal: 'running como apoyo aeróbico con fatiga alta',
    sportProfile: 'sport_support',
    primarySport: 'squash',
  })
  outputs.push(`sport_support_fatigue=${support.session.name} (${support.session.runningType})`)

  const competition = selectRunningSession({
    phase: 'taper',
    fatigueLevel: 4,
    recentSessions: ['tempo_threshold', 'long_run'],
    goal: 'llegar fresco a la carrera objetivo',
    sportProfile: 'running_primary',
    competitionSoon: true,
    daysToCompetition: 2,
  })
  outputs.push(`competition_soon=${competition.session.name} (${competition.session.runningType})`)

  const rotateCheck = selectRunningSession({
    phase: 'build',
    fatigueLevel: 4,
    recentSessions: ['tempo_threshold', 'tempo_threshold'],
    goal: 'variedad en semana de entrenamiento',
    sportProfile: 'running_primary',
    competitionSoon: false,
    historicalSessions: [],
  })
  outputs.push(`rotate=${rotateCheck.session.name} family=${rotateCheck.session.family}`)

  const acwrRisk = selectRunningSession({
    phase: 'build',
    fatigueLevel: 4,
    recentSessions: ['long_run'],
    goal: 'corredor hibrido con running cargado',
    sportProfile: 'hybrid',
    runningAcwr: { acuteLoad: 900, chronicLoad: 600, ratio: 1.5, status: 'risk', baselineWeeks: 3 },
    runningWeeklyLoad: { weekStart: '2026-04-06', totalLoad: 900, totalDurationMin: 180, totalDistanceKm: 32, sessionsCount: 4 },
    competitionSoon: false,
  })
  outputs.push(`acwr_risk=${acwrRisk.session.name} intent=${summarizeRunningProgression({ phase: 'build', fatigueLevel: 4, recentSessions: ['long_run'], goal: 'corredor hibrido con running cargado', sportProfile: 'hybrid', runningAcwr: { acuteLoad: 900, chronicLoad: 600, ratio: 1.5, status: 'risk', baselineWeeks: 3 }, competitionSoon: false }).split(' ')[0]}`)

  const acwrLimited = selectRunningSession({
    phase: 'build',
    fatigueLevel: 3,
    recentSessions: ['easy_aerobic'],
    goal: 'poca historia de running',
    sportProfile: 'hybrid',
    runningAcwr: { acuteLoad: 250, chronicLoad: 0, ratio: null, status: 'limited', baselineWeeks: 0 },
    competitionSoon: false,
  })
  outputs.push(`acwr_limited=${acwrLimited.session.name} (${acwrLimited.session.runningType})`)

  cachedRunningSelectorSmokeChecks = outputs
  return outputs
}

// TODO: cálculo fino de ritmos por zonas/umbral/histórico real del atleta.
// TODO: extension del helper cuantitativo de running a ritmos/zonas mas finas por historico real.
// TODO: integración profunda con pace targets del perfil del usuario.
// TODO: extender ACWR cuantitativo completo a squash y fuerza con umbrales por disciplina.
// TODO: soporte trail / pista / cross-training.
// TODO: taper avanzado por distancia objetivo.
