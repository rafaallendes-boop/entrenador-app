/**
 * Strength-specific prompt sections for the AI coach.
 */

import type { ChatContext, MacroPlanPhase } from '../../../types'
import { isCompetitionSquashMatch } from '../../../utils/squash'
import { todayISO } from '../../../utils/date'
import { buildStrengthLoadPack } from '../prompt/packs/quality/strengthLoad'
import { getAllowedPlanningSports, getPlanningPrimarySport } from '../../planningConstraints'
import {
  deriveStrengthExperienceLevel as deriveStrengthExperienceLevelFromProfile,
  deriveStrengthSportProfile as deriveStrengthSportProfileFromProfile,
  mapMacroPhaseToStrengthPhase as mapMacroPhaseToStrengthPhaseFromMacro,
} from '../../training/strengthContext'
import {
  extractRecentStrengthExercises,
  getTargetExerciseDensity,
  runStrengthSelectorSmokeChecks,
  selectStrengthSession,
  summarizeStrengthProgression,
  type StrengthContext,
  type StrengthPhase,
  type StrengthSelectionExercise,
  type StrengthSportProfile,
} from '../../training/strengthSelector'
import { getStrengthProgression } from '../../progressionInsights'
import { toModelFacingProposal } from '../../training/strengthExerciseProposal'
import {
  deriveFatigueLevel,
  diffDays,
  getPlannedSessions,
  getHistoricalSessions,
  getMacroPlan,
} from './shared'

// ─── Phase mapping ──────────────────────────────────────────────────────────

export function mapMacroPhaseToStrengthPhase(phase: MacroPlanPhase | undefined): StrengthPhase {
  return mapMacroPhaseToStrengthPhaseFromMacro(phase)
}

// ─── Context derivation ────────────────────────────────────────────────────

export function deriveStrengthSportProfile(context: ChatContext): StrengthSportProfile {
  return deriveStrengthSportProfileFromProfile(context.athleteProfile)
}

export function deriveStrengthExperienceLevel(context: ChatContext): 'beginner' | 'intermediate' | 'advanced' {
  return deriveStrengthExperienceLevelFromProfile(context.athleteProfile)
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
    sessionDurationMin: primarySport === 'strength' ? 65 : 60,
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

export const toCoachExerciseProposal = toModelFacingProposal

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
· Upper/Lower de 60 min: debe sentirse como una sesión real de preparador físico, no como lista mínima. Apunta a 7-9 ejercicios totales: 2 zona media + 4-5 fuerza/accesorios/correctivos + 0-1 cardio específico si aplica.
· Full body: combinación de variantes de press, jalón/remo y tren inferior.
· Warm-up de fuerza: puede ser mayormente movilidad/prep de tejidos y rango (gemelos, isquios, glúteos, aductores, cuádriceps, espalda alta, cadera, tobillo, torácica, hombro) más series de aproximación. No lo mezcles con zona media ni con trabajo principal.
· Preparación física para squash: prioriza potencia de baja dosis, fuerza unilateral/lateral, jalón/remo para hombro y core anti-rotación/estabilidad lateral.
· Estructura recomendada sport_support/squash: 1) warm-up/activación/movilidad, 2) zona media explícita, 3) fuerza principal, 4) unilateral/lateral, 5) tren superior (jalón, press o estabilidad de hombro), 6) cardio específico opcional de baja dosis, 7) cooldown/movilidad.
· Zona media no es opcional en sesiones normales de fuerza de 45+ min: incluye 1-2 ejercicios antes de la fuerza principal. Combina control anti-extensión/lumbo-pélvico (dead bug, plancha frontal, fitball plank) con anti-rotación/lateral (Pallof, plancha lateral, Copenhagen, chop controlado).
· En retorno de lesión: mantén la densidad de una sesión útil, pero con ejercicios seguros, RPE 6-7, técnica controlada, sin impacto agresivo ni volumen que genere DOMS innecesario.
· No cuentes un remo medio arrodillado o un lunge lateral como único trabajo de zona media aunque tengan demanda de tronco; si los usas, agrega igualmente una plancha/dead bug/Pallof/plancha lateral cuando la duración lo permita.
· Cardio específico opcional para squash va SIEMPRE al final, después de la fuerza: bici de asalto 30s on/30s off en bloque de 4 min, trotadora de aire 20s on/20s off en bloque de 4 min, o escalera/footwork como mini-serie de 2-3 ejercicios concretos. Para escalera/footwork NO uses "1x4 min": usa sets/reps tipo "2 pasadas por lado" o "2 pasadas". Usa 1 bloque por defecto; 2 bloques sólo si está fresco, sesión >=65 min y fase build/base sin competencia cercana.
· Potencia olímpica y pliometría agresiva: solo si el atleta es avanzado, está fresco y no hay competencia cercana. Siempre bajo volumen y calidad máxima.
· Escalera y footwork: úsalo como coordinación y timing de pies, no como cardio duro ni reemplazo de una sesión de squash.
· Realismo de cargas: no uses porcentajes de 1RM de barra como si fueran carga directa para mancuernas/kettlebells. Sentadilla goblet normalmente 16-40kg; sobre 40kg cámbiala por sentadilla frontal/trasera. Press/remo con mancuernas y búlgaras deben usar cargas implementables, no equivalentes de barra.

Secuenciación fuerza:
· No hacer sesión de piernas pesada dentro de las 24h previas a una competencia o sesión técnica clave.
· DOMS de piernas + competencia = error de planificación — evitarlo siempre.
· En semana competitiva: sesión neural liviana (pocos sets, alta intensidad, sin volumen de DOMS).
· Con fatiga alta o competencia cercana, evita olímpicos, depth/drop jumps, jump squats cargados y volumen pesado de piernas; deja activación, core, movilidad y patrones controlados.
· Movilidad post-fuerza mejora recuperación y flexibilidad funcional.
· Si fuerza es principal, prioriza estructura, progresion y calidad de los compounds antes que meter cardio o accesorios irrelevantes.
· Si fuerza es secundaria, ajusta el volumen para no interferir con el deporte principal y usa mas estabilidad, unilateral y trunk cuando convenga.
· Evita recetas universales de upper/lower sin mirar fase, fatiga, historial reciente y rol real de la fuerza para el atleta.
· Notas tecnicas: cada ejercicio principal de fuerza debe incluir una nota corta tipo cue en notes. Usa solo estos patrones: "Control y amplitud en el descenso", "Salir explosivo", "Peso considera mancuernas (2)", "No subir carga si se pierde postura", "Control posicion de la cadera".`
}

// ─── Dynamic selection section ──────────────────────────────────────────────

export function buildDynamicStrengthSelectionSection(
  context: ChatContext,
  summary = buildStrengthSelectionSummary(context),
): string {
  if (!summary) return ''

  const { selection, selectionContext } = summary
  const density = getTargetExerciseDensity(selectionContext)
  const durationMin = selectionContext.sessionDurationMin ?? 50
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
  lines.push(`Densidad esperada: ${density.min}-${density.max} ejercicios para ${durationMin} min (target ${density.target}).`)
  lines.push(`No entregues menos de ${density.min} ejercicios salvo fatiga >=8, taper estricto, competencia inminente o sesion declarada corta (<30 min); si bajas de ese minimo, justificalo explicitamente.`)
  lines.push('Orden de bloque recomendado: warm-up/protocolos -> zona media -> fuerza principal -> accesorios/transferencia -> cardio especifico opcional -> cooldown.')
  lines.push('Respeta la duracion objetivo: mas ejercicios no significa inflar series, sino repartir mejor activacion, zona media, principal, transferencia y cierre.')
  lines.push('Zona media esperada: en sesiones de 45+ min incluye 1-2 ejercicios core reales (plancha/dead bug/Pallof/plancha lateral/Copenhagen), no solo ejercicios que demandan estabilidad de forma indirecta.')
    lines.push('Cardio especifico opcional: si aplica para squash y hay frescura, usa escalera/footwork como 2-3 ejercicios con pasadas, o 1 bloque de bici de asalto 30/30 o trotadora de aire 20/20 al final; no lo mezcles con fuerza principal.')
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

// ─── Load prescription section ──────────────────────────────────────────────

export function buildStrengthLoadPrescriptionSection(context: ChatContext): string {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (!enabledSports.includes('strength')) return ''
  return buildStrengthLoadPack({ strengthProfile: context.athleteProfile?.strengthProfile })
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
