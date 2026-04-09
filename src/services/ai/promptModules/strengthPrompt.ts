/**
 * Strength-specific prompt sections for the AI coach.
 */

import type { ChatContext, CoachExerciseProposal, MacroPlanPhase } from '../../../types'
import { isCompetitionSquashMatch } from '../../../utils/squash'
import { todayISO } from '../../../utils/date'
import { getAllowedPlanningSports, getPlanningPrimarySport } from '../../planningConstraints'
import {
  extractRecentStrengthExercises,
  runStrengthSelectorSmokeChecks,
  selectStrengthSession,
  summarizeStrengthProgression,
  type StrengthContext,
  type StrengthPhase,
  type StrengthSelectionExercise,
  type StrengthSportProfile,
} from '../../training/strengthSelector'
import { getStrengthProgression } from '../../progressionInsights'
import {
  deriveFatigueLevel,
  diffDays,
  getPlannedSessions,
  getHistoricalSessions,
  getMacroPlan,
} from './shared'

// ─── Phase mapping ──────────────────────────────────────────────────────────

export function mapMacroPhaseToStrengthPhase(phase: MacroPlanPhase | undefined): StrengthPhase {
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

// ─── Context derivation ────────────────────────────────────────────────────

export function deriveStrengthSportProfile(context: ChatContext): StrengthSportProfile {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  const primarySport = getPlanningPrimarySport(context.athleteProfile)

  if (primarySport === 'strength') return 'strength_primary'
  if (enabledSports.includes('strength') && enabledSports.length > 1) return 'hybrid'
  return 'sport_support'
}

export function deriveStrengthExperienceLevel(context: ChatContext): 'beginner' | 'intermediate' | 'advanced' {
  const sp = context.athleteProfile?.strengthProfile
  const filled = [sp?.benchPress1RM, sp?.squat1RM, sp?.deadlift1RM, sp?.overheadPress1RM]
    .filter((value) => value != null)
    .length

  if (filled >= 4) return 'advanced'
  if (filled >= 2) return 'intermediate'
  return 'beginner'
}

export function getStrengthSelectionContext(context: ChatContext): StrengthContext {
  const today = todayISO()
  const plannedSessions = getPlannedSessions(context)
  const historicalSessions = getHistoricalSessions(context)
  const macroPlan = getMacroPlan(context)
  const nextCompetitive = plannedSessions
    .filter((session) =>
      session.date >= today &&
      (session.type === 'squash' ? isCompetitionSquashMatch(session) : session.subtype === 'competitive'),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))[0]

  const competitionGap = nextCompetitive ? diffDays(today, nextCompetitive.date) : undefined
  const daysToCompetition = typeof competitionGap === 'number' ? competitionGap : undefined
  const competitionSoon = typeof daysToCompetition === 'number' && daysToCompetition <= 4
  const primarySport = getPlanningPrimarySport(context.athleteProfile)
  const goal = nextCompetitive?.title
    ?? context.athleteProfile?.mainGoal
    ?? context.currentWeekSummary?.objectives?.[0]
    ?? 'desarrollar una sesion de fuerza util y bien estructurada'

  return {
    fatigueLevel: deriveFatigueLevel(context),
    phase: mapMacroPhaseToStrengthPhase(macroPlan?.currentPhase),
    recentExercises: extractRecentStrengthExercises(historicalSessions),
    goal,
    sportProfile: deriveStrengthSportProfile(context),
    primarySport,
    experienceLevel: deriveStrengthExperienceLevel(context),
    sessionDurationMin: primarySport === 'strength' ? 65 : 50,
    competitionSoon,
    daysToCompetition,
    historicalSessions,
    strengthAcwr: context.loadAnalytics?.strengthAcwr,
  }
}

export type StrengthSelectionSummary = ReturnType<typeof buildStrengthSelectionSummary>

export function buildStrengthSelectionSummary(context: ChatContext) {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (!enabledSports.includes('strength')) return null

  const selectionContext = getStrengthSelectionContext(context)
  return {
    selectionContext,
    selection: selectStrengthSession(selectionContext),
  }
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

export function formatSelectedStrengthExercises(
  exercises: StrengthSelectionExercise[],
  limit = exercises.length,
): string {
  return exercises
    .slice(0, limit)
    .map((exercise) => `${exercise.name} ${exercise.sets}x${exercise.reps}${exercise.intensity ? ` (${exercise.intensity})` : ''}`)
    .join(' · ')
}

export function toCoachExerciseProposal(exercise: StrengthSelectionExercise): CoachExerciseProposal {
  return {
    name: exercise.name,
    sets: exercise.sets,
    reps: exercise.reps,
    group: exercise.group,
    notes: exercise.notes
      ? `${exercise.notes} [${exercise.intensity}]`
      : exercise.intensity,
  }
}

export function stringifyStrengthExercises(
  exercises: StrengthSelectionExercise[],
  limit = exercises.length,
): string {
  return exercises
    .slice(0, limit)
    .map((exercise) => JSON.stringify(toCoachExerciseProposal(exercise)))
    .join(',')
}

// ─── Rules section ──────────────────────────────────────────────────────────

export function buildStrengthRulesSection(): string {
  return `
FUERZA — CONOCIMIENTO TÉCNICO:
Estructura habitual:
· strength_primary: la fuerza es disciplina principal. Debe sentirse como una sesion real de pesas con lift principal, accesorios, trunk y una logica clara de progresion.
· hybrid: la fuerza debe construir rendimiento sin comerse la frescura de los otros deportes. Prioriza eficiencia, transferencia y fatiga controlada.
· sport_support: la fuerza complementa un deporte principal. Volumen moderado, transferencia alta y nada de destruir piernas innecesariamente.
· Upper: press banca/inclinado, remo, dominadas, press hombro, core. 4-5 ejercicios, 3-5 series.
· Lower: sentadilla, peso muerto o variante, hip thrust, lunge, core. 4-5 ejercicios, 3-5 series.
· Full body: combinación de variantes de press, jalón/remo y tren inferior.

Secuenciación fuerza:
· No hacer sesión de piernas pesada dentro de las 24h previas a una competencia o sesión técnica clave.
· DOMS de piernas + competencia = error de planificación — evitarlo siempre.
· En semana competitiva: sesión neural liviana (pocos sets, alta intensidad, sin volumen de DOMS).
· Movilidad post-fuerza mejora recuperación y flexibilidad funcional.
· Si fuerza es principal, prioriza estructura, progresion y calidad de los compounds antes que meter cardio o accesorios irrelevantes.
· Si fuerza es secundaria, ajusta el volumen para no interferir con el deporte principal y usa mas estabilidad, unilateral y trunk cuando convenga.
· Evita recetas universales de upper/lower sin mirar fase, fatiga, historial reciente y rol real de la fuerza para el atleta.`
}

// ─── Dynamic selection section ──────────────────────────────────────────────

export function buildDynamicStrengthSelectionSection(
  context: ChatContext,
  summary = buildStrengthSelectionSummary(context),
): string {
  if (!summary) return ''

  const { selection, selectionContext } = summary
  const lines: string[] = ['SELECCION DINAMICA DE FUERZA']

  lines.push(`Foco sugerido: ${selection.focus}`)
  lines.push(
    `Contexto selector: fase ${selectionContext.phase} · fatiga ${selectionContext.fatigueLevel}/10 · perfil ${selectionContext.sportProfile} · competencia cercana ${
      selectionContext.competitionSoon ? 'si' : 'no'
    }${selectionContext.primarySport ? ` · deporte principal ${selectionContext.primarySport}` : ''}`,
  )
  lines.push(`Continuidad: ${summarizeStrengthProgression(selectionContext)}`)
  if (selectionContext.strengthAcwr?.ratio != null) {
    lines.push(`Fuerza ACWR: ${selectionContext.strengthAcwr.ratio.toFixed(2)} (${selectionContext.strengthAcwr.status})`)
  }
  if (selectionContext.strengthAcwr?.status === 'risk') {
    lines.push('Fuerza: carga elevada — progression intent ajustado a deload.')
  }
  lines.push(`Ejercicios sugeridos ahora: ${formatSelectedStrengthExercises(selection.exercises)}`)
  lines.push(`Formato compatible actual: ${stringifyStrengthExercises(selection.exercises)}`)
  lines.push('Si fuerza es principal, esta seleccion manda como sesion real de pesas y no como complemento generico.')
  lines.push('Si fuerza es secundaria, manten la utilidad y controla interferencia con el deporte principal.')

  if (!import.meta.env.PROD) {
    const smoke = runStrengthSelectorSmokeChecks().slice(0, 3).join(' || ')
    lines.push(`Debug selector (dev): ${smoke}`)
  }

  return lines.join('\n')
}

// ─── Progression section ────────────────────────────────────────────────────

export function buildStrengthProgressionSection(context: ChatContext): string {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (!enabledSports.includes('strength')) return ''

  const progressions = getStrengthProgression(getHistoricalSessions(context), 4, 4)
  if (progressions.length === 0) return ''

  const lines: string[] = ['PROGRESIÓN DE FUERZA (sesiones completadas recientes)']

  for (const progression of progressions) {
    const trend = progression.entries
      .map((entry) => {
        const load = entry.weight != null ? `${entry.weight}kg` : ''
        return `${entry.sets}×${entry.reps}${load ? `@${load}` : ''}`
      })
      .join(' → ')
    lines.push(`· ${progression.exerciseLabel}: ${trend}`)
  }

  lines.push('')
  lines.push('Usa estos datos para proponer cargas concretas en la proxima sesion de fuerza. Si la tendencia sube, propone la carga siguiente logica (2-5% mas o misma carga con mas volumen). Si la carga se estanco, varia el esquema (series, reps, tempo).')
  lines.push('IMPORTANTE: cuando propongas ejercicios en <actions>, usa el campo weight con la carga real derivada de este historial o del 1RM declarado en el perfil.')

  return lines.join('\n')
}
