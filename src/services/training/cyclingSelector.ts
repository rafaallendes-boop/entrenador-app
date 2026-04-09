import type { Session } from '../../types'
import {
  CYCLING_SESSION_LIBRARY,
  type CyclingIntensity,
  type CyclingRole,
  type CyclingSessionDefinition,
  type CyclingSessionFamily,
} from './cyclingSessionLibrary'

export type CyclingPhase = 'base' | 'build' | 'peak' | 'taper' | 'race' | 'transition'
export type CyclingSportProfile = 'cycling_primary' | 'hybrid' | 'sport_support'

export interface CyclingContext {
  phase: CyclingPhase
  role: CyclingRole
  fatigueLevel: number
  sportProfile: CyclingSportProfile
  recentSessionIds: string[]
  goal?: string
  competitionSoon?: boolean
  daysToCompetition?: number
  historicalSessions?: Session[]
}

export type CyclingProgressionIntent = 'progress' | 'hold' | 'deload' | 'rotate'

export interface CyclingProgressionState {
  intent: CyclingProgressionIntent
  currentFamily?: CyclingSessionFamily
  recentFamilies: CyclingSessionFamily[]
}

export interface CyclingSelectionResult {
  focus: string
  session: {
    name: string
    category: string
    family: CyclingSessionFamily
    structure: string
    intensity: CyclingIntensity
    notes: string
  }
  progressionSummary: string
}

interface ScoredSession {
  session: CyclingSessionDefinition
  score: number
}

export function selectCyclingSession(context: CyclingContext): CyclingSelectionResult {
  const recentFamilies = new Set(context.recentSessionIds)
  const progressionState = deriveCyclingProgressionState(context)

  const byFatigue = filterByFatigue(CYCLING_SESSION_LIBRARY, context)
  const byPhase = filterByPhase(byFatigue, context)
  const byRole = filterByRole(byPhase, context)
  const withoutRecent = avoidRecentFamilies(byRole, recentFamilies)

  const pool = withoutRecent.length >= 2 ? withoutRecent : byRole
  const scored = scoreSessions(pool, context, recentFamilies, progressionState)
  const fallbackScored = scored.length > 0
    ? scored
    : scoreSessions(byFatigue, context, recentFamilies, progressionState)

  const selected =
    fallbackScored[0]?.session ??
    CYCLING_SESSION_LIBRARY.find((s) => s.id === 'easy_z2_base') ??
    CYCLING_SESSION_LIBRARY[0]

  const notes = buildCyclingNotes(selected, progressionState, context)
  const progressionSummary = summarizeCyclingProgression(context, progressionState)

  return {
    focus: deriveCyclingFocus(selected, context),
    session: {
      name: selected.name,
      category: selected.category,
      family: selected.family,
      structure: selected.typicalStructure,
      intensity: selected.intensity,
      notes,
    },
    progressionSummary,
  }
}

export function filterByFatigue(
  sessions: CyclingSessionDefinition[],
  context: CyclingContext,
): CyclingSessionDefinition[] {
  const isCriticalComp =
    context.competitionSoon &&
    context.daysToCompetition != null &&
    context.daysToCompetition <= 3

  if (isCriticalComp) {
    return sessions.filter((s) => s.intensity === 'low' || s.family === 'activation')
  }
  if (context.fatigueLevel >= 8) {
    return sessions.filter((s) => s.intensity === 'low')
  }
  if (context.fatigueLevel >= 6) {
    return sessions.filter((s) => s.intensity !== 'high')
  }
  return sessions
}

export function filterByPhase(
  sessions: CyclingSessionDefinition[],
  context: CyclingContext,
): CyclingSessionDefinition[] {
  switch (context.phase) {
    case 'taper':
      return sessions.filter(
        (s) =>
          !['intervals_vo2', 'long_ride', 'sprint_anaerobic'].includes(s.family) &&
          s.intensity !== 'high',
      )
    case 'peak':
      return sessions.filter(
        (s) =>
          s.intensity !== 'low' ||
          s.family === 'recovery' ||
          s.family === 'activation',
      )
    case 'race':
      return sessions.filter((s) => s.family === 'activation' || s.family === 'recovery')
    case 'base':
      return sessions.filter((s) => !['intervals_vo2', 'sprint_anaerobic'].includes(s.family))
    case 'transition':
      return sessions.filter(
        (s) => s.intensity !== 'high' && !['intervals_vo2', 'sprint_anaerobic'].includes(s.family),
      )
    case 'build':
    default:
      return sessions
  }
}

export function filterByRole(
  sessions: CyclingSessionDefinition[],
  context: CyclingContext,
): CyclingSessionDefinition[] {
  return sessions.filter((s) => s.suitableRoles.includes(context.role))
}

export function avoidRecentFamilies(
  sessions: CyclingSessionDefinition[],
  recentFamilies: Set<string>,
): CyclingSessionDefinition[] {
  return sessions.filter((s) => !recentFamilies.has(s.family))
}

function scoreSessions(
  sessions: CyclingSessionDefinition[],
  context: CyclingContext,
  recentFamilies: Set<string>,
  progressionState: CyclingProgressionState,
): ScoredSession[] {
  const recentNonCyclingLoad = countRecentOtherSportSessions(context.historicalSessions ?? [])

  return sessions
    .map((session) => {
      let score = 0

      switch (context.phase) {
        case 'base':
          if (['z2_aerobic', 'long_ride'].includes(session.family)) score += 5
          if (session.family === 'sweetspot_tempo') score += 1
          if (['intervals_vo2', 'sprint_anaerobic'].includes(session.family)) score -= 5
          break
        case 'build':
          if (['sweetspot_tempo', 'intervals_vo2'].includes(session.family)) score += 5
          if (session.family === 'long_ride') score += 3
          if (session.family === 'z2_aerobic') score += 2
          break
        case 'peak':
          if (session.family === 'intervals_vo2') score += 4
          if (session.family === 'activation') score += 5
          if (session.family === 'sweetspot_tempo') score += 2
          if (session.family === 'long_ride') score -= 3
          break
        case 'taper':
          if (['activation', 'recovery', 'z2_aerobic'].includes(session.family)) score += 7
          if (session.id === 'race_week_openers' || session.id === 'pre_event_activation') score += 4
          if (['intervals_vo2', 'sprint_anaerobic'].includes(session.family)) score -= 10
          break
        case 'race':
          if (session.family === 'activation') score += 8
          if (session.family === 'recovery') score += 6
          break
        case 'transition':
          if (['recovery', 'z2_aerobic'].includes(session.family)) score += 6
          if (session.intensity === 'high') score -= 6
          break
      }

      if (context.role === 'support' || context.sportProfile === 'sport_support') {
        if (['z2_aerobic', 'recovery', 'activation'].includes(session.family)) score += 5
        if (session.id === 'support_aerobic_flush') score += 6
        if (session.id === 'controlled_tempo_support') score += 3
        if (session.intensity === 'high') score -= 8
        if (session.intensity === 'low') score += 3
      }

      if (context.sportProfile === 'cycling_primary') {
        if (session.progressionLevel != null) score += session.progressionLevel
        if (['sweetspot_tempo', 'intervals_vo2', 'long_ride'].includes(session.family)) score += 2
        if (session.id === 'build_over_under' && context.phase === 'build') score += 4
      }

      if (context.sportProfile === 'hybrid') {
        if (session.id === 'support_aerobic_flush') score += 4
        if (session.id === 'controlled_tempo_support') score += 2
        if (session.intensity === 'high') score -= 3
      }

      if (context.fatigueLevel >= 7) {
        if (session.intensity === 'low') score += 5
        if (session.id === 'post_competition_recovery') score += 3
        if (session.intensity === 'high') score -= 7
      }

      if (recentNonCyclingLoad >= 3 && context.role === 'support') {
        if (session.family === 'z2_aerobic' || session.family === 'recovery' || session.family === 'activation') score += 4
        if (session.intensity === 'high') score -= 10
        if (session.family === 'sweetspot_tempo') score -= 2
      }

      const inCurrentFamily = session.family === progressionState.currentFamily
      if (inCurrentFamily) {
        if (progressionState.intent === 'progress' && (session.progressionLevel ?? 1) > 1) score += 5
        if (progressionState.intent === 'rotate') score -= 8
        if (progressionState.intent === 'hold') score += 2
        if (progressionState.intent === 'deload' && session.intensity !== 'low') score -= 4
      }
      if (progressionState.intent === 'deload') {
        if (session.intensity === 'low') score += 4
        if (session.family === 'recovery') score += 4
        if (session.family === 'activation') score += 3
      }
      if (progressionState.intent === 'rotate' && !inCurrentFamily) score += 3

      if (recentFamilies.has(session.family)) score -= 5

      return { session, score }
    })
    .sort((a, b) => b.score - a.score || a.session.name.localeCompare(b.session.name))
}

export function extractRecentCyclingSessions(historicalSessions: Session[]): string[] {
  const cyclingSessions = [...historicalSessions]
    .filter(
      (s) =>
        s.type === 'cycling' &&
        (s.status === 'completed' || s.status === 'adjusted'),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
    .slice(0, 6)

  return cyclingSessions.map((s) => deriveCyclingFamilyFromSession(s))
}

function deriveCyclingFamilyFromSession(session: Session): string {
  const title = (session.title ?? '').toLowerCase()
  const obj = (session.objective ?? '').toLowerCase()
  const details = `${session.cyclingDetails?.sessionCategory ?? ''} ${session.cyclingDetails?.sessionFamily ?? ''}`.toLowerCase()
  const combined = `${title} ${obj} ${details}`

  if (combined.includes('recovery') || combined.includes('recupera') || combined.includes('suave')) {
    return 'recovery'
  }
  if (combined.includes('activaci') || combined.includes('activation') || combined.includes('openers') || combined.includes('pre-event') || combined.includes('pre race')) {
    return 'activation'
  }
  if (combined.includes('long ride') || combined.includes('rodaje largo') || combined.includes('fondo')) {
    return 'long_ride'
  }
  if (combined.includes('vo2') || combined.includes('interval') || combined.includes('serie') || combined.includes('alta intensidad')) {
    return 'intervals_vo2'
  }
  if (combined.includes('sprint') || combined.includes('anaerob') || combined.includes('potencia maxima')) {
    return 'sprint_anaerobic'
  }
  if (combined.includes('sweetspot') || combined.includes('tempo') || combined.includes('umbral') || combined.includes('threshold') || combined.includes('over under')) {
    return 'sweetspot_tempo'
  }
  return 'z2_aerobic'
}

export function deriveCyclingProgressionState(context: CyclingContext): CyclingProgressionState {
  const cyclingSessions = [...(context.historicalSessions ?? [])]
    .filter(
      (s) =>
        s.type === 'cycling' &&
        (s.status === 'completed' || s.status === 'adjusted'),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6)

  const familyCounts: Partial<Record<CyclingSessionFamily, number>> = {}
  for (const s of cyclingSessions) {
    const family = deriveCyclingFamilyFromSession(s) as CyclingSessionFamily
    familyCounts[family] = (familyCounts[family] ?? 0) + 1
  }

  const currentFamily =
    cyclingSessions.length > 0
      ? (deriveCyclingFamilyFromSession(cyclingSessions[0]) as CyclingSessionFamily)
      : undefined

  const recentFamilies = cyclingSessions.map(
    (s) => deriveCyclingFamilyFromSession(s) as CyclingSessionFamily,
  )

  const intent = deriveCyclingProgressionIntent(context, currentFamily, familyCounts)
  return { intent, currentFamily, recentFamilies }
}

function deriveCyclingProgressionIntent(
  context: CyclingContext,
  currentFamily?: CyclingSessionFamily,
  familyCounts: Partial<Record<CyclingSessionFamily, number>> = {},
): CyclingProgressionIntent {
  const isCriticalComp =
    context.competitionSoon &&
    context.daysToCompetition != null &&
    context.daysToCompetition <= 3

  if (context.phase === 'taper' || context.phase === 'race' || isCriticalComp || context.fatigueLevel >= 7) {
    return 'deload'
  }

  if (currentFamily && (familyCounts[currentFamily] ?? 0) >= 2) {
    return 'rotate'
  }

  if (
    context.sportProfile === 'cycling_primary' &&
    (context.phase === 'build' || context.phase === 'peak') &&
    context.fatigueLevel <= 5
  ) {
    return 'progress'
  }

  return 'hold'
}

export function buildCyclingNotes(
  session: CyclingSessionDefinition,
  progressionState: CyclingProgressionState,
  context: CyclingContext,
): string {
  const isCriticalComp =
    context.competitionSoon &&
    context.daysToCompetition != null &&
    context.daysToCompetition <= 3

  if (context.phase === 'taper' || isCriticalComp || session.family === 'activation') {
    return 'Mantener sensaciones sin acumular fatiga. Cadencia fluida y piernas despiertas, sin perseguir potencia.'
  }
  if (context.fatigueLevel >= 7 || session.family === 'recovery') {
    return 'Fatiga alta: priorizar soltura y circulacion. Si el cuerpo sigue pesado, acortar o dejar solo recovery spin.'
  }
  if (context.role === 'support') {
    return `Ciclismo como apoyo aerobico. ${session.description} Debe sumar condicion sin robar frescura al deporte principal.`
  }

  switch (progressionState.intent) {
    case 'progress':
      return `Progresion sobre sesiones recientes. Leve aumento de duracion, densidad o control dentro de familia ${session.family}.`
    case 'deload':
      return 'Version aligerada. Reducir duracion o simplificar estructura para gestionar fatiga acumulada.'
    case 'rotate':
      return `Cambio de familia desde ${progressionState.currentFamily ?? 'anterior'} para mantener adaptacion sin repetir siempre el mismo estimulo.`
    case 'hold':
    default:
      return session.description
  }
}

export function summarizeCyclingProgression(
  context: CyclingContext,
  state?: CyclingProgressionState,
): string {
  const resolved = state ?? deriveCyclingProgressionState(context)

  if (!resolved.currentFamily) {
    return 'Sin historial suficiente: usar variacion contextual limpia.'
  }

  switch (resolved.intent) {
    case 'deload':
      return `Descargar familia ${resolved.currentFamily} con salida suave, recovery o activacion.`
    case 'progress':
      return `Continuar familia ${resolved.currentFamily} con progresion de carga o densidad.`
    case 'rotate':
      return `Rotar desde familia ${resolved.currentFamily} para cambiar estimulo y evitar estancamiento.`
    case 'hold':
    default:
      return `Mantener carga similar en o cerca de familia ${resolved.currentFamily}.`
  }
}

function deriveCyclingFocus(session: CyclingSessionDefinition, context: CyclingContext): string {
  if (context.phase === 'taper' || context.phase === 'race') {
    return `activacion y frescura - ${session.name}`
  }
  if (context.role === 'support') {
    return `soporte aerobico controlado - ${session.name}`
  }

  const familyLabel: Record<CyclingSessionFamily, string> = {
    z2_aerobic: 'base aerobica',
    long_ride: 'resistencia',
    sweetspot_tempo: 'desarrollo de umbral',
    intervals_vo2: 'potencia aerobica',
    sprint_anaerobic: 'potencia anaerobica',
    recovery: 'recuperacion',
    activation: 'activacion',
  }

  return `${familyLabel[session.family] ?? session.family} - ${session.name}`
}

function countRecentOtherSportSessions(historicalSessions: Session[]): number {
  return historicalSessions
    .filter(
      (session) =>
        session.type !== 'cycling' &&
        session.type !== 'mobility' &&
        (session.status === 'completed' || session.status === 'adjusted'),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt)
    .slice(0, 4)
    .length
}

export function runCyclingSelectorSmokeChecks(): string[] {
  const outputs: string[] = []

  const primaryBase = selectCyclingSession({
    phase: 'base',
    role: 'primary',
    fatigueLevel: 4,
    sportProfile: 'cycling_primary',
    recentSessionIds: ['z2_aerobic'],
    competitionSoon: false,
  })
  outputs.push(`primary_base=${primaryBase.session.name} (${primaryBase.session.family})`)

  const supportBuild = selectCyclingSession({
    phase: 'build',
    role: 'support',
    fatigueLevel: 5,
    sportProfile: 'sport_support',
    recentSessionIds: ['z2_aerobic'],
    competitionSoon: false,
  })
  outputs.push(`support_build=${supportBuild.session.name} (${supportBuild.session.family})`)

  const taperFatigue = selectCyclingSession({
    phase: 'taper',
    role: 'primary',
    fatigueLevel: 7,
    sportProfile: 'cycling_primary',
    recentSessionIds: ['sweetspot_tempo', 'intervals_vo2'],
    competitionSoon: true,
    daysToCompetition: 3,
  })
  outputs.push(`taper_fatigue=${taperFatigue.session.name} intent=${taperFatigue.progressionSummary.split(' ')[0]}`)

  return outputs
}
