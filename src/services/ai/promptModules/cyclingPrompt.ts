/**
 * Cycling-specific prompt sections for the AI coach.
 */

import type { ChatContext, MacroPlanPhase } from '../../../types'
import { todayISO } from '../../../utils/date'
import { getAllowedPlanningSports, getPlanningPrimarySport } from '../../planningConstraints'
import {
  extractRecentCyclingSessions,
  runCyclingSelectorSmokeChecks,
  selectCyclingSession,
  summarizeCyclingProgression,
  type CyclingContext,
  type CyclingPhase,
  type CyclingSelectionResult,
  type CyclingSportProfile,
} from '../../training/cyclingSelector'
import {
  deriveFatigueLevel,
  diffDays,
  getHistoricalSessions,
  getMacroPlan,
  getNextGoalEventForSport,
  addDaysToISO,
} from './shared'

// ─── Phase mapping ──────────────────────────────────────────────────────────

export function mapMacroPhaseToRunningPhaseForCycling(phase: MacroPlanPhase | undefined): CyclingPhase {
  switch (phase) {
    case 'build': return 'build'
    case 'peak': return 'peak'
    case 'taper': return 'taper'
    case 'race': return 'race'
    case 'transition': return 'transition'
    case 'base':
    default: return 'base'
  }
}

// ─── Context derivation ─────────────────────────────────────────────────────

export function deriveCyclingSportProfile(context: ChatContext): CyclingSportProfile {
  const primarySport = getPlanningPrimarySport(context.athleteProfile)
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (primarySport === 'cycling') return 'cycling_primary'
  if (enabledSports.includes('cycling') && enabledSports.length > 1) return 'hybrid'
  return 'sport_support'
}

export function getCyclingSelectionContext(context: ChatContext): CyclingContext {
  const today = todayISO()
  const historicalSessions = getHistoricalSessions(context)
  const macroPlan = getMacroPlan(context)
  const sportProfile = deriveCyclingSportProfile(context)
  const role = sportProfile === 'cycling_primary' ? 'primary' : 'support'

  const nextCyclingEvent = getNextGoalEventForSport(context, 'cycling')
  const competitionGap = nextCyclingEvent ? diffDays(today, nextCyclingEvent.date) : undefined
  const daysToCompetition = typeof competitionGap === 'number' ? competitionGap : undefined
  const competitionSoon = typeof daysToCompetition === 'number' && daysToCompetition <= 7

  return {
    phase: mapMacroPhaseToRunningPhaseForCycling(macroPlan?.currentPhase),
    role,
    fatigueLevel: deriveFatigueLevel(context),
    sportProfile,
    recentSessionIds: extractRecentCyclingSessions(historicalSessions),
    goal: context.athleteProfile?.mainGoal
      ?? context.currentWeekSummary?.objectives?.[0]
      ?? 'entrenamiento ciclista variado y bien estructurado',
    competitionSoon,
    daysToCompetition,
    historicalSessions,
  }
}

export function buildCyclingSelectionSummary(context: ChatContext): {
  selection: CyclingSelectionResult
  selectionContext: CyclingContext
} | null {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (!enabledSports.includes('cycling')) return null

  const selectionContext = getCyclingSelectionContext(context)
  return {
    selectionContext,
    selection: selectCyclingSession(selectionContext),
  }
}

// ─── Rules section ──────────────────────────────────────────────────────────

export function buildCyclingRulesSection(): string {
  return `
CICLISMO — CONOCIMIENTO TÉCNICO:

Tipos de sesión y contenido esperado:
· Z2 bici aeróbico: ritmo aeróbico cómodo, FC baja, cadencia 80-90rpm. Base aeróbica con bajo impacto articular. Sostenible indefinidamente, útil como recuperación activa entre sesiones de otro deporte.
· Tempo/sweetspot: intensidad sostenida al 88-94% de FTP o RPE 6-7. Mejora umbral sin el daño muscular del running. Series de 15-30min con recuperación activa.
· Intervalos VO2max: series de 3-8min a alta intensidad (>100% FTP o RPE 8-9), recuperación activa entre series. No más de 3 bloques en sesión.
· Long ride: 60-180min al ritmo aeróbico sostenido. Fondo, tolerancia metabólica y resistencia mental. Exige nutrición en ruta si supera 90min.

Cadencia y técnica:
· Cadencia baja (<70rpm): más demanda muscular, más fuerza, útil en subidas cortas o fuerza específica.
· Cadencia alta (>95rpm): más demanda cardiorrespiratoria, menos fatiga muscular. Entrenamiento de pedaling suave.
· Cadencia objetivo habitual: 80-95rpm. Mantenerla en Z2 reduce riesgo de DOMS en piernas.

Indoor vs outdoor:
· Indoor (rodillo/trainer): más control de potencia e intensidad, menor tiempo efectivo. Sin coste de paradas. Ideal para intervalos controlados.
· Outdoor (ruta/gravel): más variabilidad, mayor demanda técnica, nutrición/hidratación más compleja. Esfuerzo real mayor que el percibido en rodillo.

Secuenciación ciclismo:
· Menor impacto articular que running — útil como complemento o recuperación activa entre días duros.
· Si combina con fuerza de piernas el mismo día: bici primero (o separar por >6h).
· No apilar long ride (>90min) con fuerza de piernas en el mismo día ni en días consecutivos sin recuperación.
· Long ride requiere 24-36h de recuperación antes de sesión exigente de otro deporte (running tempo, squash intenso).
· Si hay competencia o evento clave: Z2 bici corto (30-45min) puede ser activación previa ideal sin generar fatiga.
· Intervalos VO2max en bici tienen un "costo de piernas" real — planificar como si fuera sesión de fuerza respecto al día siguiente.

Cruce de fatiga con running:
· Bici y running comparten adaptación aeróbica central (corazón, pulmones) — pueden apilarse sin conflicto en Z2.
· A alta intensidad, comparten fatiga de cuádriceps y glúteos — no apilar intervalos bici + tempo running en días seguidos.
· Z2 bici es el cross-training aeróbico ideal cuando hay molestias de running que contraindican correr.`
}

// ─── Dynamic selection sections ─────────────────────────────────────────────

export function buildDynamicCyclingSelectionSection(
  context: ChatContext,
  summary = buildCyclingSelectionSummary(context),
): string {
  if (!summary) return ''

  const { selection, selectionContext } = summary
  const lines: string[] = ['SESIÓN SUGERIDA – CICLISMO']

  lines.push(`Perfil: ${selectionContext.sportProfile} · rol ${selectionContext.role}`)
  lines.push(`Foco: ${selection.focus}`)
  lines.push(
    `Contexto selector: fase ${selectionContext.phase} · fatiga ${selectionContext.fatigueLevel}/10 · competencia cercana ${
      selectionContext.competitionSoon ? 'si' : 'no'
    }`,
  )
  lines.push(`Continuidad: ${summarizeCyclingProgression(selectionContext)}`)
  lines.push(`Sesión sugerida: ${selection.session.name} — ${selection.session.structure} — intensidad ${selection.session.intensity}`)
  if (selection.session.notes) lines.push(`Nota: ${selection.session.notes}`)
  lines.push('Si ciclismo es deporte principal, esta selección manda como sesión real con continuidad y progresión.')
  lines.push('Si ciclismo es soporte, controla la carga para no interferir con el deporte principal.')

  if (!import.meta.env.PROD) {
    const smoke = runCyclingSelectorSmokeChecks().slice(0, 2).join(' || ')
    lines.push(`Debug selector (dev): ${smoke}`)
  }

  return lines.join('\n')
}

export function buildDynamicCyclingSelectionSectionV2(
  context: ChatContext,
  summary = buildCyclingSelectionSummary(context),
): string {
  const base = buildDynamicCyclingSelectionSection(context, summary)
  if (!summary) return base

  const { selection } = summary
  const addendum = [
    'DETALLE EXPLICITO PARA CYCLING:',
    `- Usa cyclingDetails.sessionCategory = "${selection.session.category}"`,
    `- Usa cyclingDetails.sessionFamily = "${selection.session.family}"`,
    `- Usa cyclingDetails.targetStructure con la estructura sugerida y no inventes una generica`,
    `- Usa cyclingDetails.executionNotes para explicar dosificacion o rol dentro de la semana`,
  ].join('\n')

  return `${base}\n${addendum}`
}

// ─── Week example ───────────────────────────────────────────────────────────

export function buildCyclingCreateWeekExample(opts: {
  weekStart: string
  hasStrength: boolean
  strengthBaseSelection: { focus: string }
  strengthSupportSelection: { focus: string }
  strengthSupportExercisesJson: string
}): string {
  const {
    weekStart,
    hasStrength,
    strengthBaseSelection,
    strengthSupportSelection,
    strengthSupportExercisesJson,
  } = opts

  const objectives = [
    '"construir base aeróbica ciclismo"',
    hasStrength ? '"mantener fuerza complementaria"' : null,
    '"fondo largo fin de semana"',
  ].filter(Boolean).join(',')

  const sessions = [
    `{"date":"${addDaysToISO(weekStart, 0)}","timeBlock":"PM","sessionType":"cycling","title":"Ciclismo Z2","durationMin":70,"rpe":6,"objective":"base aeróbica, cadencia 80-90rpm"}`,
    hasStrength
      ? `{"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza estructurada","durationMin":55,"rpe":7,"objective":"${strengthBaseSelection.focus}","exercises":[${strengthSupportExercisesJson}]}`
      : `{"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"PM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"cadera, tobillo y columna"}`,
    `{"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"AM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"cadera, tobillo y columna"}`,
    `{"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"AM","sessionType":"cycling","title":"Ciclismo intervalos","durationMin":45,"rpe":8,"objective":"series 4-6min a alta intensidad con recuperación activa"}`,
    hasStrength
      ? `{"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza de apoyo","durationMin":50,"rpe":6,"objective":"${strengthSupportSelection.focus}","exercises":[${strengthSupportExercisesJson}]}`
      : `{"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"recovery","title":"Recuperación activa","durationMin":25,"rpe":3,"objective":"bajar fatiga y sostener disponibilidad"}`,
    `{"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"AM","sessionType":"cycling","title":"Ciclismo long ride","durationMin":90,"rpe":6,"objective":"fondo aeróbico sostenido"}`,
  ].join(',\n    ')

  return `<actions>
[{"type":"create_week",
  "weekObjectives":[${objectives}],
  "sessions":[
    ${sessions}
  ],
  "reason":"semana base ciclismo con solo disciplinas permitidas por la planificación actual"}]
</actions>`
}
