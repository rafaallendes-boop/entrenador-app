/**
 * Mobility-specific prompt sections for the AI coach.
 */

import type { ChatContext, MacroPlanPhase, Session } from '../../../types'
import { getAllowedPlanningSports, getPlanningPrimarySport } from '../../planningConstraints'
import {
  extractRecentMobilitySessions,
  selectMobilitySession,
  summarizeMobilitySelection,
  type MobilityContext,
  type MobilityPhase,
  type MobilitySelectionResult,
} from '../../training/mobilitySelector'
import { normalizeMobilityTargetStructure } from '../../training/mobilitySessionLibrary'
import {
  deriveFatigueLevel,
  getHistoricalSessions,
  getMacroPlan,
  getMacroPlanSportDetail,
} from './shared'

// ─── Phase mapping ──────────────────────────────────────────────────────────

export function mapMacroPhaseToMobilityPhase(phase: MacroPlanPhase | undefined): MobilityPhase {
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

export function getMobilitySportContext(context: ChatContext): 'squash' | 'running' | 'cycling' | 'strength' | 'general' {
  const primary = getPlanningPrimarySport(context.athleteProfile)
  if (primary === 'squash') return 'squash'
  if (primary === 'running') return 'running'
  if (primary === 'cycling') return 'cycling'
  if (primary === 'strength') return 'strength'
  return 'general'
}

export function getRecentCompletedSportContext(
  historicalSessions: Session[],
): 'squash' | 'running' | 'cycling' | 'strength' | undefined {
  const latestCompletedSession = [...historicalSessions]
    .filter(session =>
      (session.status === 'completed' || session.status === 'adjusted') &&
      ['squash', 'running', 'cycling', 'strength'].includes(session.type),
    )
    .sort((a, b) => {
      const dateSort = b.date.localeCompare(a.date)
      if (dateSort !== 0) return dateSort
      return b.updatedAt - a.updatedAt
    })[0]

  if (
    latestCompletedSession?.type === 'squash' ||
    latestCompletedSession?.type === 'running' ||
    latestCompletedSession?.type === 'cycling' ||
    latestCompletedSession?.type === 'strength'
  ) {
    return latestCompletedSession.type
  }

  return undefined
}

export function getMobilitySelectionContext(context: ChatContext): MobilityContext {
  const historicalSessions = getHistoricalSessions(context)
  const macroPlan = getMacroPlan(context)

  return {
    primarySport: getMobilitySportContext(context),
    phase: mapMacroPhaseToMobilityPhase(macroPlan?.currentPhase),
    recentSessionIds: extractRecentMobilitySessions(historicalSessions),
    postTrainingType: getRecentCompletedSportContext(historicalSessions),
    fatigueLevel: deriveFatigueLevel(context),
    historicalSessions,
  }
}

export function buildMobilitySelectionSummary(context: ChatContext): {
  selection: MobilitySelectionResult
  selectionContext: MobilityContext
} | null {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (!enabledSports.includes('mobility')) return null

  const selectionContext = getMobilitySelectionContext(context)
  return {
    selectionContext,
    selection: selectMobilitySession(selectionContext),
  }
}

// ─── Rules section ──────────────────────────────────────────────────────────

export function buildMobilityRulesSection(options?: { compact?: boolean }): string {
  if (options?.compact) {
    return `
MOVILIDAD — CONOCIMIENTO TÉCNICO:

Focos más útiles:
· Cadera y tobillo para squash, running y ciclismo.
· Hombro y torácica cuando hay raqueta, fuerza o mucha rigidez postural.
· Full body o recovery cuando la meta es descargar sin sumar fatiga.

Reglas prácticas:
· Post-sesión: 10-20min sobre las articulaciones más cargadas del día.
· Recuperación activa: 30-45min, RPE 3-4, nunca agotador.
· Pre-competencia o pre-entreno: movilidad activa y breve; evita estática pasiva larga.
· Una sesión pura de movilidad puede ir cualquier día y debe nombrar foco anatómico o contexto real.`
  }

  return `
MOVILIDAD — CONOCIMIENTO TÉCNICO:

Focos articulares por zona y deporte:
· Cadera — flexores (psoas, iliacus): crítico en running, ciclismo y squash (posición de ataque). Trabajar con couch stretch, hip flexor activo y estocadas lentas.
· Cadera — rotadores externos (piriforme, obturadores): limitante principal en sentadilla profunda y lunge con carga. CARs de cadera, figuras 4, rotación activa tumbado.
· Tobillo — dorsiflexión: crítico para lunge en squash, recepción en running y sentadilla. Movilización de tobillo en pared, dorsiflexión con banda, excéntrico de gemelo.
· Hombro — CARs (Controlled Articular Rotations): rango activo controlado en toda la circunferencia glenohumeral. Imprescindible en squash (impacto repetido con raqueta) y natación.
· Hombro — apertura torácica: remo en el suelo, apertura con foam roller, rotaciones torácicas en cuadrupedia.
· Columna torácica — rotación y extensión: limitante en todos los deportes de rotación (squash, golf, natación). Rotaciones en cuadrupedia, foam roller extensión torácica.

Cuándo programar movilidad:
· Post-fuerza: ideal, el músculo cálido retiene más rango.
· Pre-competencia: movilidad activa (dinámica, no estática pasiva sostenida). 10-15min máximo.
· Como sesión de recuperación activa: 30-45min de trabajo articular + movilidad pasiva. RPE 3-4, nunca agotador.
· Como bloque corto al final de otra sesión: 10-20min sobre las articulaciones más trabajadas del día.

Secuenciación y reglas:
· Sesión de movilidad pura puede ir cualquier día — no genera fatiga recuperable.
· Movilidad estática pasiva sostenida (>30s) NO antes de sesiones de fuerza o potencia — reduce pico de fuerza transitoriamente.
· Si el atleta tiene restricciones de tobillo o cadera: priorizar esas zonas antes de fuerza de piernas o sesiones técnicas que las requieran.
· Una semana de carga alta sin movilidad resulta en pérdida progresiva de rango — especialmente en flexores de cadera y torácica.`
}

// ─── Dynamic selection sections ─────────────────────────────────────────────

export function buildDynamicMobilitySelectionSection(
  context: ChatContext,
  summary = buildMobilitySelectionSummary(context),
): string {
  if (!summary) return ''

  const { selection, selectionContext } = summary
  const sportDetail = getMacroPlanSportDetail(context, 'mobility')
  const lines: string[] = ['SESIÓN SUGERIDA – MOVILIDAD']

  lines.push(`Deporte principal: ${selectionContext.primarySport} · fase ${selectionContext.phase}`)
  lines.push(`Sesión sugerida: ${selection.session.name} (${selection.session.typicalDuration})`)
  lines.push(`Foco: ${selection.session.focus.join(', ')}`)
  lines.push(`Estructura: ${normalizeMobilityTargetStructure(selection.session.typicalStructure)}`)
  if (sportDetail) {
    lines.push(`Macroplan mobility: ${sportDetail.weeklyIntent} · volumen ${sportDetail.volumeBias} · intensidad ${sportDetail.intensityBias}`)
  }
  lines.push(`Justificación: ${selection.rationale}`)
  lines.push(`Resumen: ${summarizeMobilitySelection(selection)}`)
  lines.push('La movilidad no genera fatiga recuperable — puede ir cualquier día. Prioriza las articulaciones más trabajadas del bloque actual.')

  return lines.join('\n')
}

export function inferMobilityPromptContext(summary: MobilitySelectionResult): string {
  const sessionId = summary.session.id
  if (sessionId === 'post_run_mobility') return 'post_run'
  if (sessionId === 'post_cycling_mobility') return 'post_cycling'
  if (sessionId === 'post_squash_mobility') return 'post_squash'
  if (sessionId === 'post_strength_reset') return 'post_strength'
  if (sessionId === 'pre_training_activation') return 'pre_training_activation'
  if (sessionId === 'recovery_mobility') return 'recovery'
  if (sessionId === 'full_body_flow' || sessionId === 'range_maintenance_reset') return 'full_body'
  return 'sport_specific'
}

export function buildDynamicMobilitySelectionSectionV2(
  context: ChatContext,
  summary = buildMobilitySelectionSummary(context),
  options?: { compact?: boolean },
): string {
  const base = options?.compact
    ? buildCompactMobilitySelectionSection(context, summary)
    : buildDynamicMobilitySelectionSection(context, summary)
  if (!summary) return base

  const { selection } = summary
  const addendum = [
    'DETALLE EXPLICITO PARA MOBILITY:',
    `- Usa mobilityDetails.context = "${inferMobilityPromptContext(selection)}"`,
    `- Usa mobilityDetails.focusAreas con focos derivados de la seleccion actual`,
    `- Usa mobilityDetails.targetStructure en español claro, con ejercicios y dosis: "Estocada larga con rotacion 5/lado + Flujo 90/90 de cadera 2 min/lado + Rotacion toracica 10/lado..."`,
    '- No uses nombres en ingles como World greatest stretch, child pose, ankle circles o thoracic rotation; traducelos.',
    '- Evita sesiones llamadas solo "Movilidad" sin contexto ni foco anatomico',
  ].join('\n')

  return `${base}\n${addendum}`
}

function buildCompactMobilitySelectionSection(
  context: ChatContext,
  summary = buildMobilitySelectionSummary(context),
): string {
  if (!summary) return ''

  const { selection, selectionContext } = summary
  const sportDetail = getMacroPlanSportDetail(context, 'mobility')
  const lines: string[] = ['SESIÓN SUGERIDA – MOVILIDAD']

  lines.push(`Deporte principal: ${selectionContext.primarySport} · fase ${selectionContext.phase}`)
  lines.push(`Sesión sugerida: ${selection.session.name} (${selection.session.typicalDuration})`)
  lines.push(`Foco: ${selection.session.focus.join(', ')}`)
  lines.push(`Estructura: ${normalizeMobilityTargetStructure(selection.session.typicalStructure)}`)
  if (sportDetail) {
    lines.push(`Macroplan mobility: ${sportDetail.weeklyIntent}`)
  }

  return lines.join('\n')
}
