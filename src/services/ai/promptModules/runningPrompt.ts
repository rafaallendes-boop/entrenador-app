/**
 * Running-specific prompt sections for the AI coach.
 */

import type { ChatContext, MacroPlanPhase } from '../../../types'
import { isCompetitionSquashMatch } from '../../../utils/squash'
import { todayISO } from '../../../utils/date'
import { getAllowedPlanningSports, getPlanningPrimarySport } from '../../planningConstraints'
import {
  extractRecentRunningSessions,
  runRunningSelectorSmokeChecks,
  selectRunningSession,
  summarizeRunningProgression,
  type RunningContext,
  type RunningPhase,
  type RunningSelectionResult,
  type RunningSportProfile,
} from '../../training/runningSelector'
import {
  deriveFatigueLevel,
  diffDays,
  getPlannedSessions,
  getHistoricalSessions,
  getMacroPlan,
  addDaysToISO,
} from './shared'

// ─── Phase mapping ──────────────────────────────────────────────────────────

export function mapMacroPhaseToRunningPhase(phase: MacroPlanPhase | undefined): RunningPhase {
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

// ─── Context derivation ─────────────────────────────────────────────────────

export function deriveRunningSportProfile(context: ChatContext): RunningSportProfile {
  const primarySport = getPlanningPrimarySport(context.athleteProfile)
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)

  if (primarySport === 'running') return 'running_primary'
  if (enabledSports.includes('running') && enabledSports.length > 1) return 'hybrid'
  return 'sport_support'
}

export function getRunningSelectionContext(context: ChatContext): RunningContext {
  const today = todayISO()
  const plannedSessions = getPlannedSessions(context)
  const historicalSessions = getHistoricalSessions(context)
  const macroPlan = getMacroPlan(context)
  const nextCompetitive = plannedSessions
    .filter(
      session =>
        session.date >= today &&
        (session.type === 'squash' ? isCompetitionSquashMatch(session) : session.subtype === 'competitive'),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))[0]

  const competitionGap = nextCompetitive ? diffDays(today, nextCompetitive.date) : undefined
  const daysToCompetition = typeof competitionGap === 'number' ? competitionGap : undefined
  const competitionSoon = typeof daysToCompetition === 'number' && daysToCompetition <= 7
  const primarySport = getPlanningPrimarySport(context.athleteProfile)
  const goal =
    context.athleteProfile?.mainGoal ??
    context.currentWeekSummary?.objectives?.[0] ??
    'desarrollar sesiones de running variadas y bien estructuradas'

  return {
    fatigueLevel: deriveFatigueLevel(context),
    phase: mapMacroPhaseToRunningPhase(macroPlan?.currentPhase),
    recentSessions: extractRecentRunningSessions(historicalSessions),
    goal,
    sportProfile: deriveRunningSportProfile(context),
    primarySport: primarySport ?? undefined,
    competitionSoon,
    daysToCompetition,
    historicalSessions,
    runningAcwr: context.loadAnalytics?.runningAcwr,
    runningWeeklyLoad: context.loadAnalytics?.runningWeeklyLoads?.[0],
  }
}

export function buildRunningSelectionSummary(context: ChatContext): {
  selection: RunningSelectionResult
  selectionContext: RunningContext
} | null {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (!enabledSports.includes('running')) return null

  const selectionContext = getRunningSelectionContext(context)
  return {
    selectionContext,
    selection: selectRunningSession(selectionContext),
  }
}

// ─── Rules section ──────────────────────────────────────────────────────────

export function buildRunningRulesSection(): string {
  return `
RUNNING — CONOCIMIENTO TÉCNICO:
Tipos de sesión:
· Z2 aeróbico: ritmo conversacional, FC baja, totalmente sostenible. Base aeróbica y recuperación activa.
· Tempo/umbral: ritmo sostenido al 85-90% de esfuerzo. No más de 40-50 min continuos sin recuperación.
· Intervalos VO2max: series cortas de alta intensidad (4-8min), con recuperación activa entre series.
· Long run: 60-120min al ritmo easy/Z2. Clave para base aeróbica y tolerancia.

Secuenciación running:
· No apilar dos sesiones de alta intensidad (tempo o intervalos) en días consecutivos.
· Long run requiere 48h de recuperación antes de sesión exigente de otro deporte.
· Si hay competencia clave (cualquier deporte), corta el tempo y los intervalos 5+ días antes.
· Z2 puede ir cualquier día como herramienta de recuperación activa sin comprometer otros deportes.

PERFIL DEPORTIVO EN RUNNING:
· running_primary: running es el deporte central del atleta. Tratar con continuidad y especificidad real de entrenamiento competitivo. No usar como cardio complementario. Priorizar progresión, variación de estímulos y coherencia entre sesiones.
· hybrid: running convive con otras disciplinas (squash, fuerza, ciclismo). Priorizar eficiencia por sesión. Controlar fatiga cruzada. Preferir calidad sobre volumen cuando hay carga de otro deporte.
· sport_support: running como herramienta aeróbica o complemento del deporte principal. Sesiones cortas, baja interferencia. Z2, strides y recovery preferidos. Evitar interferir con la frescura del deporte principal.`
}

// ─── Dynamic selection section ──────────────────────────────────────────────

export function buildDynamicRunningSelectionSection(
  context: ChatContext,
  summary = buildRunningSelectionSummary(context),
): string {
  if (!summary) return ''

  const { selection, selectionContext } = summary
  const lines: string[] = ['SELECCION DINAMICA DE RUNNING']

  lines.push(`Perfil: ${selectionContext.sportProfile}`)
  lines.push(`Foco sugerido: ${selection.focus}`)
  lines.push(
    `Contexto selector: fase ${selectionContext.phase} · fatiga ${selectionContext.fatigueLevel}/10 · perfil ${selectionContext.sportProfile} · competencia cercana ${
      selectionContext.competitionSoon ? 'si' : 'no'
    }${selectionContext.primarySport ? ` · deporte principal ${selectionContext.primarySport}` : ''}`,
  )
  if (selectionContext.runningAcwr) {
    const acwrRatio = selectionContext.runningAcwr?.ratio != null
      ? selectionContext.runningAcwr.ratio.toFixed(2)
      : 'sin ratio'
    lines.push(`Running ACWR: ${acwrRatio} (${selectionContext.runningAcwr?.status ?? 'limited'})`)
  }
  if (selectionContext.runningWeeklyLoad?.sessionsCount) {
    const weeklyVolume = selectionContext.runningWeeklyLoad.totalDistanceKm != null
      ? `${selectionContext.runningWeeklyLoad.totalDistanceKm} km`
      : `${selectionContext.runningWeeklyLoad.totalDurationMin ?? 0} min`
    lines.push(`Weekly running load: ${weeklyVolume} / ${selectionContext.runningWeeklyLoad.sessionsCount} sesiones`)
  }
  lines.push(`Continuidad: ${summarizeRunningProgression(selectionContext)}`)
  lines.push(`Sesion sugerida: ${selection.session.name} — ${selection.session.structure} — intensidad ${selection.session.intensity}`)
  lines.push(`runningType compatible: ${selection.session.runningType}`)
  if (selection.session.notes) lines.push(`Nota: ${selection.session.notes}`)
  if (selectionContext.runningAcwr?.status === 'risk') {
    lines.push('Running progression intent adjusted to deload por carga especifica de running.')
  }
  lines.push('Si running es deporte principal, esta seleccion manda como sesion de entrenamiento real con continuidad y no como cardio generico.')
  lines.push('Si running es complemento, controla la carga para no interferir con el deporte principal.')

  if (!import.meta.env.PROD) {
    const smoke = runRunningSelectorSmokeChecks().slice(0, 2).join(' || ')
    lines.push(`Debug selector (dev): ${smoke}`)
  }

  return lines.join('\n')
}

// ─── Week example ───────────────────────────────────────────────────────────

export function buildRunningCreateWeekExample(opts: {
  weekStart: string
  hasStrength: boolean
  z2min: string
  z2max: string
  tempoMin: string
  tempoMax: string
  longRunPaceStr: string
  strengthBaseSelection: { focus: string }
  strengthSupportExercisesJson: string
}): string {
  const {
    weekStart,
    hasStrength,
    z2min,
    z2max,
    tempoMin,
    tempoMax,
    longRunPaceStr,
    strengthBaseSelection,
    strengthSupportExercisesJson,
  } = opts

  const objectives = [
    '"construir base aeróbica running"',
    hasStrength ? '"mantener fuerza complementaria"' : null,
    '"recuperación activa"',
  ].filter(Boolean).join(',')

  const sessions = [
    `{"date":"${addDaysToISO(weekStart, 0)}","timeBlock":"AM","sessionType":"running","title":"Running Z2","durationMin":50,"rpe":6,"objective":"base aeróbica — ritmo cómodo, respiración nasal","runningType":"z2","targetPaceMin":"${z2min}","targetPaceMax":"${z2max}"}`,
    hasStrength
      ? `{"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza estructurada","durationMin":60,"rpe":7,"objective":"${strengthBaseSelection.focus}","exercises":[${strengthSupportExercisesJson}]}`
      : `{"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"PM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"cadera, tobillo y hombro"}`,
    `{"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"AM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"cadera, tobillo y hombro"}`,
    `{"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"AM","sessionType":"running","title":"Running tempo","durationMin":45,"rpe":7,"objective":"umbral aeróbico — mantener ritmo sostenido","runningType":"tempo","targetPaceMin":"${tempoMin}","targetPaceMax":"${tempoMax}"}`,
    hasStrength
      ? `{"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza de apoyo","durationMin":50,"rpe":6,"objective":"${strengthBaseSelection.focus}","exercises":[${strengthSupportExercisesJson}]}`
      : `{"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"recovery","title":"Recuperación activa","durationMin":25,"rpe":3,"objective":"bajar fatiga y sostener disponibilidad"}`,
    `{"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"AM","sessionType":"running","title":"Running long","durationMin":70,"rpe":6,"objective":"fondo largo — ritmo aeróbico sostenido","runningType":"long","targetPaceMin":"${longRunPaceStr}","targetPaceMax":"${longRunPaceStr}"}`,
  ].join(',\n    ')

  return `<actions>
[{"type":"create_week",
  "weekObjectives":[${objectives}],
  "sessions":[
    ${sessions}
  ],
  "reason":"semana base running con solo disciplinas permitidas por la planificación actual"}]
</actions>`
}
