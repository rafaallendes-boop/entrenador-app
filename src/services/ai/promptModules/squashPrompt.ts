/**
 * Squash-specific prompt sections for the AI coach.
 */

import type { ChatContext, MacroPlanPhase, SquashDrill } from '../../../types'
import { getRecentSquashCompetitiveExposure, isCompetitionSquashMatch } from '../../../utils/squash'
import { todayISO } from '../../../utils/date'
import { getAllowedPlanningSports } from '../../planningConstraints'
import {
  extractRecentSquashDrills,
  runSquashDrillSelectorSmokeChecks,
  selectSquashDrills,
  summarizeSquashProgression,
  type SquashSelectionContext,
  type SquashSelectionPhase,
} from '../../training/drillSelector'
import { getSquashMatchHistory } from '../../progressionInsights'
import {
  deriveFatigueLevel,
  diffDays,
  getPlannedSessions,
  getHistoricalSessions,
  getMacroPlan,
  addDaysToISO,
} from './shared'

// ─── Phase mapping ──────────────────────────────────────────────────────────

export function mapMacroPhaseToSquashPhase(phase: MacroPlanPhase | undefined): SquashSelectionPhase {
  switch (phase) {
    case 'build':
      return 'build'
    case 'peak':
      return 'peak'
    case 'race':
      return 'peak'
    case 'taper':
      return 'taper'
    case 'transition':
      return 'base'
    case 'base':
    default:
      return 'base'
  }
}

// ─── Context & selection ────────────────────────────────────────────────────

export function getSquashSelectionContext(context: ChatContext): SquashSelectionContext {
  const today = todayISO()
  const plannedSessions = getPlannedSessions(context)
  const historicalSessions = getHistoricalSessions(context)
  const macroPlan = getMacroPlan(context)
  const nextCompetitive = plannedSessions
    .filter(session =>
      isCompetitionSquashMatch(session) &&
      session.date >= today,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))[0]

  const competitionSoon = Boolean(nextCompetitive && (diffDays(today, nextCompetitive.date) ?? 99) <= 4)
  const goal = nextCompetitive?.title
    ?? context.athleteProfile?.mainGoal
    ?? context.currentWeekSummary?.objectives?.[0]
    ?? 'mejorar squash con sesiones variadas y utiles'

  return {
    fatigueLevel: deriveFatigueLevel(context),
    phase: mapMacroPhaseToSquashPhase(macroPlan?.currentPhase),
    recentDrills: extractRecentSquashDrills(historicalSessions),
    goal,
    competitionSoon,
    historicalSessions,
    squashAcwr: context.loadAnalytics?.squashAcwr,
  }
}

export type SquashSelectionSummary = ReturnType<typeof buildSquashSelectionSummary>

export function buildSquashSelectionSummary(context: ChatContext) {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (!enabledSports.includes('squash')) return null

  const selectionContext = getSquashSelectionContext(context)
  return {
    selectionContext,
    selection: selectSquashDrills(selectionContext),
  }
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

export function formatSelectedSquashDrills(drills: SquashDrill[], limit = drills.length): string {
  return drills
    .slice(0, limit)
    .map((drill) => `${drill.name}${drill.durationMin ? ` ${drill.durationMin}min` : ''}`)
    .join(' · ')
}

export function stringifySquashDrills(drills: SquashDrill[]): string {
  return drills
    .map((drill) => JSON.stringify(drill))
    .join(',')
}

// ─── Rules section ──────────────────────────────────────────────────────────

export function buildSquashRulesSection(): string {
  return `
SQUASH — CONOCIMIENTO TÉCNICO (usa esto para dar respuestas expertas, no genéricas):

Tipos de sesión y contenido esperado en el campo objective:
· training técnico: bloques de drives (paralelo y cruzado, profundidad y longitud), voleas de presión desde media pista, salidas de pared (boast a zona corta, nick de esquina), dejadas y drops. 2-3 focos de 15-20min con intención clara.
· training táctico: patrones de juego (largo-corto, presión de fondo, ataque desde T), juegos condicionados (solo paralelo, solo largo, dos botes prohibidos, inicio en boasted ball, zona prohibida). Especificar condición y objetivo del patrón.
· training físico-específico: ghosting (4 esquinas o 6 puntos, con o sin raqueta), RSA repetidos cortos 10-15s con recuperación incompleta, multiball alta intensidad, desplazamientos específicos (lunge, split step, recuperación al T). Especificar series y ratio trabajo/descanso.
· control: peloteo de calidad técnica a intensidad baja-media, foco en ejecución limpia sin presión de resultado. Ideal día previo a partido o en semanas de carga alta.
· match con squashDetails.sessionMode="practice_match": partido de entrenamiento o match-play. Usarlo en build/peak para trabajar táctica, presión, toma de decisiones y ritmo real.
· match con squashDetails.sessionMode="competition_match" o subtype competitive: partido real de competición. Anotar rival si se conoce.

CUANDO USAR PRACTICE_MATCH:
· build o peak
· objetivo relacionado a partido, táctica real, presión, toma de decisiones o rendimiento competitivo
· sin competencia inmediata
· sin fatiga alta

CUANDO NO USAR PRACTICE_MATCH:
· taper liviano
· alta fatiga
· semana de recuperación
· cuando ya hay un partido real muy cercano

Secuenciación squash:
· No dos sesiones de intensidad alta seguidas.
· Día previo a partido → control o descanso activo, nunca intenso.
· Post-partido exigente → 24-48h de recuperación antes de volver a intensidad.
· Semana con torneo: reducir volumen total, mantener 1-2 activaciones cortas pre-evento.

REGLAS DE SEMANA COMPETITIVA Y PRE-TORNEO:
· Si hay partido importante o torneo en 2-3 dias, prioriza frescura sobre volumen.
· Ultimas 48h pre-partido: nada de fuerza pesada, nada de RSA duro, nada de running tempo largo.
· Ultimas 24h pre-partido: control tecnico, movilidad, activacion corta o descanso activo.
· En semana con torneo, reduce 30-50% del volumen accesorio y conserva solo 1-2 estimulos de calidad.
· Si hay varios partidos en la misma semana, el running pasa a rol de recuperacion, no de desarrollo.
· Despues de un partido duro: primero recuperacion, luego tecnica/control, y recien despues intensidad.
· Si el usuario pide llegar fresco, competir bien o descargar, debes planificar taper real, no solo bajar un poco el RPE.

Preparación física para squash:
· Fuerza: tren inferior (sentadilla, hip thrust, lunge con carga) + core rotacional + upper body (remo, press, dominadas). Priorizar potencia y estabilidad sobre hipertrofia pura.
· Running: Z2 sostenido mejora directamente la recuperación para rendir en cancha. Intervalos cortos (RSA-like) complementan el ghosting.
· Movilidad crítica: cadera (flexores, rotadores), tobillo (dorsiflexión) y hombro (CARs, apertura). Son los tres más limitantes en squash.`
}

// ─── Dynamic selection section ──────────────────────────────────────────────

export function buildDynamicSquashSelectionSection(
  context: ChatContext,
  summary = buildSquashSelectionSummary(context),
): string {
  if (!summary) return ''

  const { selection, selectionContext } = summary
  const lines: string[] = ['SELECCION DINAMICA DE DRILLS (squash)']

  lines.push(`Foco sugerido: ${selection.trainingFocus}`)
  lines.push(
    `Contexto selector: fase ${selectionContext.phase} · fatiga ${selectionContext.fatigueLevel}/10 · competencia cercana ${
      selectionContext.competitionSoon ? 'si' : 'no'
    } · objetivo "${selectionContext.goal}"`,
  )
  lines.push(`Continuidad: ${summarizeSquashProgression(selectionContext)}`)
  if (selectionContext.squashAcwr?.ratio != null) {
    lines.push(`Squash ACWR: ${selectionContext.squashAcwr.ratio.toFixed(2)} (${selectionContext.squashAcwr.status})`)
  }
  if (selectionContext.squashAcwr?.status === 'risk') {
    lines.push('Squash: carga elevada — progression intent ajustado a deload.')
  }
  lines.push(`Drills sugeridos ahora: ${formatSelectedSquashDrills(selection.drills)}`)
  lines.push(`Formato compatible actual: ${stringifySquashDrills(selection.drills)}`)
  lines.push('Usa esta seleccion como base prioritaria para las sesiones squash nuevas o actualizadas.')
  lines.push('Si ajustas una sesion squash, intenta mantener este foco y variar solo por restricciones del dia, equipamiento o feedback reciente.')
  lines.push('Si el contexto es build/peak competitivo sin competencia inmediata, puedes convertir la sesion squash principal en subtype "match" con squashDetails.sessionMode "practice_match".')
  lines.push('Si la exposicion reciente a match-play ya es alta, rota hacia control tecnico, tactica o activacion en vez de repetir otro practice_match.')

  if (!import.meta.env.PROD) {
    const smoke = runSquashDrillSelectorSmokeChecks().slice(0, 2).join(' || ')
    lines.push(`Debug selector (dev): ${smoke}`)
  }

  return lines.join('\n')
}

// ─── Match history section ──────────────────────────────────────────────────

export function buildSquashMatchHistorySection(context: ChatContext): string {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (!enabledSports.includes('squash')) return ''

  const historicalSessions = getHistoricalSessions(context)
  const completedMatches = getSquashMatchHistory(historicalSessions, 6)
  const recentExposure = getRecentSquashCompetitiveExposure(historicalSessions, 6)

  if (completedMatches.length === 0) return ''

  const lines: string[] = ['HISTORIAL DE PARTIDOS RECIENTES (squash)']
  lines.push(`Exposicion reciente: ${recentExposure.practiceMatchCount} practice match / ${recentExposure.competitionMatchCount} competencia real.`)

  for (const match of completedMatches) {
    const parts: string[] = [match.date]
    parts.push(match.competitiveRole === 'practice_match' ? 'practice match' : 'competencia')
    if (match.opponent) parts.push(`vs ${match.opponent}`)
    if (match.result) parts.push(match.result === 'win' ? '✓ ganó' : '✗ perdió')
    if (match.gamesWon != null || match.gamesLost != null) {
      parts.push(`${match.gamesWon ?? '?'}-${match.gamesLost ?? '?'} games`)
    }
    const rpe = match.actualRpe != null ? ` · RPE real ${match.actualRpe}` : ''
    lines.push(`· ${parts.join(' · ')}${rpe}`)
  }

  const wins = completedMatches.filter((match) => match.result === 'win').length
  const losses = completedMatches.filter((match) => match.result === 'loss').length
  if (wins + losses > 0) {
    lines.push(`Balance reciente: ${wins}V ${losses}D en ${wins + losses} partidos registrados.`)
  }

  lines.push('Usa este historial para ajustar el foco tecnico y la confianza del atleta: racha negativa → mas trabajo de control y tactica; racha positiva → mantener estimulos, no sobrecargar.')

  return lines.join('\n')
}

// ─── Week examples ──────────────────────────────────────────────────────────

export function buildSquashCreateWeekExample(opts: {
  weekStart: string
  hasRunning: boolean
  hasStrength: boolean
  squashBaseObjective: string
  squashBaseSelection: ReturnType<typeof selectSquashDrills>
  squashBaseDrillsJson: string
  squashControlSelection: ReturnType<typeof selectSquashDrills>
  squashControlDrillsJson: string
  strengthSupportSelection: ReturnType<typeof import('../../training/strengthSelector').selectStrengthSession>
  strengthSupportExercisesJson: string
  z2min: string
  z2max: string
  tempoMin: string
  tempoMax: string
}): string {
  const {
    weekStart,
    hasRunning,
    hasStrength,
    squashBaseObjective,
    squashBaseSelection,
    squashBaseDrillsJson,
    squashControlSelection,
    squashControlDrillsJson,
    strengthSupportSelection,
    strengthSupportExercisesJson,
    z2min,
    z2max,
    tempoMin,
    tempoMax,
  } = opts

  const objectives = [
    '"mantener base squash"',
    hasRunning ? '"sostener aeróbico running"' : null,
    hasStrength ? '"mantener fuerza de apoyo"' : null,
    '"llegar fresco al fin de semana"',
  ].filter(Boolean).join(',')

  const sessions = [
    `{"date":"${addDaysToISO(weekStart, 0)}","timeBlock":"PM","sessionType":"squash","title":"Squash entrenamiento estructurado","durationMin":75,"rpe":7,"objective":"${squashBaseObjective}","subtype":"training","squashDetails":{"trainingFocus":"${squashBaseSelection.trainingFocus}","sessionMode":"drill_session","drills":[${squashBaseDrillsJson}]}}`,
    hasRunning
      ? `{"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"AM","sessionType":"running","title":"Running Z2","durationMin":50,"rpe":6,"objective":"base aeróbica — ritmo cómodo, respiración nasal","runningType":"z2","targetPaceMin":"${z2min}","targetPaceMax":"${z2max}"}`
      : null,
    hasStrength
      ? `{"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza estructurada","durationMin":60,"rpe":6,"objective":"${strengthSupportSelection.focus}","exercises":[${strengthSupportExercisesJson}]}`
      : `{"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"PM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"cadera, tobillo y columna"}`,
    `{"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"PM","sessionType":"squash","title":"Partido de entrenamiento con foco tactico","durationMin":60,"rpe":7,"objective":"Aplicar decision tactica y gestion de ritmo en partido de entrenamiento sin llegar a carga competitiva real.","subtype":"match","squashDetails":{"trainingFocus":"${squashControlSelection.trainingFocus}","sessionMode":"practice_match","drills":[${squashControlDrillsJson}]}}`,
    hasRunning
      ? `{"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"running","title":"Running tempo","durationMin":45,"rpe":7,"objective":"umbral aeróbico — mantener ritmo sostenido","runningType":"tempo","targetPaceMin":"${tempoMin}","targetPaceMax":"${tempoMax}"}`
      : null,
    hasStrength
      ? `{"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"AM","sessionType":"strength","title":"Fuerza de apoyo — base squash","durationMin":55,"rpe":6,"objective":"${strengthSupportSelection.focus}","exercises":[${strengthSupportExercisesJson}]}`
      : `{"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"AM","sessionType":"recovery","title":"Recuperación activa","durationMin":25,"rpe":3,"objective":"descarga y movilidad ligera"}`,
  ].filter(Boolean).join(',\n    ')

  return `<actions>
[{"type":"create_week",
  "weekObjectives":[${objectives}],
  "sessions":[
    ${sessions}
  ],
  "reason":"semana base de squash con solo disciplinas permitidas por la planificación actual"}]
</actions>`
}

export function buildCompetitiveSquashWeekExample(opts: {
  weekStart: string
  hasRunning: boolean
  hasStrength: boolean
  squashCompetitiveObjective: string
  squashCompetitiveSelection: ReturnType<typeof selectSquashDrills>
  squashCompetitiveDrillsJson: string
  strengthSupportSelection: ReturnType<typeof import('../../training/strengthSelector').selectStrengthSession>
  strengthSupportExercisesJson: string
  z2min: string
  z2max: string
}): string {
  const {
    weekStart,
    hasRunning,
    hasStrength,
    squashCompetitiveObjective,
    squashCompetitiveSelection,
    squashCompetitiveDrillsJson,
    strengthSupportSelection,
    strengthSupportExercisesJson,
    z2min,
    z2max,
  } = opts

  const sessions = [
    `{"date":"${addDaysToISO(weekStart, 0)}","timeBlock":"PM","sessionType":"squash","title":"Partido de entrenamiento con foco tactico","durationMin":65,"rpe":7,"objective":"${squashCompetitiveObjective}","subtype":"match","squashDetails":{"trainingFocus":"${squashCompetitiveSelection.trainingFocus}","sessionMode":"practice_match","drills":[${squashCompetitiveDrillsJson}]}}`,
    hasRunning
      ? `{"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"AM","sessionType":"running","title":"Running Z2 corto","durationMin":30,"rpe":4,"objective":"Recuperacion aerobica sin fatigar","runningType":"z2","targetPaceMin":"${z2min}","targetPaceMax":"${z2max}"}`
      : null,
    hasStrength
      ? `{"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza neural liviana","durationMin":40,"rpe":5,"objective":"${strengthSupportSelection.focus}","exercises":[${strengthSupportExercisesJson}]}`
      : null,
    `{"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"PM","sessionType":"squash","title":"Squash control pre-partido","durationMin":50,"rpe":5,"objective":"Timing, precisión, pies y sensaciones. Nada de desgaste.","subtype":"control","squashDetails":{"trainingFocus":"${squashCompetitiveSelection.trainingFocus}","sessionMode":"drill_session","drills":[${squashCompetitiveDrillsJson}]}}`,
    `{"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"PM","sessionType":"squash","title":"Partido objetivo","durationMin":60,"rpe":8,"objective":"Competir fresco y con buena toma de T","subtype":"match","squashDetails":{"trainingFocus":"${squashCompetitiveSelection.trainingFocus}","sessionMode":"competition_match","drills":[${squashCompetitiveDrillsJson}]}}`,
  ].filter(Boolean).join(',\n    ')

  return `<actions>
[{"type":"create_week",
  "weekObjectives":["llegar fresco al partido","mantener timing de squash","evitar fatiga secundaria"],
  "sessions":[
    ${sessions}
  ],
  "reason":"semana competitiva con taper para llegar fresco al partido objetivo"}]
</actions>`
}
