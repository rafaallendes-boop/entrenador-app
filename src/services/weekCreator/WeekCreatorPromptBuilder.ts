import type { ChatContext, CoachSessionProposal, SupportedSport } from '../../types'
import { addDays, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ACTION_CONTRACTS } from '../ai/prompt/core/outputContract'
import { buildWeekCreatorSquashRules } from '../ai/prompt/packs/sports/squash'
import {
  renderWeekCreatorContractReminder,
  renderWeekCreatorTargetInstructions,
} from '../ai/prompt/renderers/proseSchema'
import { buildWeekCreatorStructuredSystemPrompt, buildWeekCreatorSystemPrompt } from '../week/prompts/weekPrompt'
import { deriveWeekCreatorAthleteTier, type WeekCreatorAthleteTier, type WeekCreatorEffectiveConfig } from './WeekCreatorConfig'
import { normalizeSport } from '../../utils/athlete'
import { isWhoopPrefilled } from '../readiness/dayLogPrefillSave'
import { resolveSquashWeeklyExposurePolicy } from '../planBuilder/squashWeeklyExposurePolicy'
import { renderLoadDirective, type LoadDirectiveDecision } from '../training/loadDirectivePolicy'
import { hasDeclaredRestrictionSignal } from '../training/strengthSafetyConstraints'
import {
  resolveWeekCreatorEventContext,
  type WeekCreatorEventContext,
} from './WeekCreatorEventContext'
import { computeRecentRpeStats, resolveWeekCreatorStrengthSources } from './weekCreatorExecutionSignals'

export interface WeekCreatorPromptInput {
  userMessage: string
  targetWeekStart: string
  planningStartDate?: string
  weekEndDate?: string
  config: WeekCreatorEffectiveConfig
  retryInstruction?: string
  strictFormatting?: boolean
  structuredOutput?: boolean
  /** Provider returns only the weekly architecture; sport details are hydrated locally. */
  skeletonOutput?: boolean
  /** Objetivos de la semana del plan activo (TrainingPlanWeek.weekObjectives), si existe. */
  weekObjectives?: string[]
  /** Decisión de carga de la operación; el engine la pasa. Un llamador aislado la deriva del dominio. */
  loadDecision?: LoadDirectiveDecision
}

export interface WeekCreatorPromptBuildResult {
  systemPrompt: string
  userPrompt: string
}

export function buildWeekCreatorPrompt(
  context: ChatContext,
  input: WeekCreatorPromptInput,
): WeekCreatorPromptBuildResult {
  const profile = context.athleteProfile

  const { config } = input
  const targetWeekSessions = selectSessionsForTargetWeek(context.plannedSessions ?? [], input.targetWeekStart)
  const recentHistory = [...(context.historicalSessions ?? [])]
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
    .slice(0, 6)
  const recentLogs = [...(context.weekDayLogs ?? [])]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4)
  const prioritySport = extractPrioritySport(input.userMessage, config.allowedSports)
  const createWeekContract = ACTION_CONTRACTS.create_week
  const planningStartDate = input.planningStartDate ?? input.targetWeekStart
  // Una sola decisión por operación: el engine la pasa; un llamador aislado la deriva del dominio.
  const loadDecision = input.loadDecision
    ?? resolveWeekCreatorStrengthSources(context, planningStartDate, Date.now()).loadDecision
  const weekEndDate = input.weekEndDate ?? addDaysIso(input.targetWeekStart, 6)
  const isPartialCurrentWeek = planningStartDate > input.targetWeekStart
  const eventContext = resolveWeekCreatorEventContext({
    profile,
    targetWeekStart: input.targetWeekStart,
    weekEndDate,
    planningStartDate,
    primarySport: config.primarySport,
  })

  const lines = [
    `Solicitud del usuario: ${input.userMessage}`,
    '',
    ...renderWeekCreatorTargetInstructions(createWeekContract, input.targetWeekStart, input.structuredOutput),
    isPartialCurrentWeek
      ? `La semana objetivo ya está en curso: programa sesiones solo desde ${planningStartDate} hasta ${weekEndDate}. No propongas sesiones en días pasados de esta semana.`
      : '',
    '',
    buildProfileSummaryV2(profile, config),
    buildGoalSummary(eventContext, config.primarySport),
    buildWeekObjectivesBlock(profile, input.weekObjectives),
    buildConfigSummary(config),
    buildAthleteLevelRules(config),
    buildPrioritySportSummary(prioritySport ?? config.primarySport, config, eventContext, profile),
    input.skeletonOutput ? '' : buildWeekCreatorSquashRules(config),
    input.skeletonOutput ? '' : buildStrengthStructureRules(config),
    !input.skeletonOutput && config.allowedSports.includes('strength')
      ? 'Si hay dos o más sesiones de fuerza, deben tener focos y ejercicios distintos; no repitas exactamente el mismo array exercises en más de una sesión.'
      : '',
    input.skeletonOutput && eventContext.phase !== 'race'
      ? ''
      : buildSquashPhaseContentGuide(config, eventContext),
    buildProgressionContext(recentHistory, recentLogs, loadDecision),
    buildCurrentWeekSessionsSummary(targetWeekSessions, input.targetWeekStart),
    buildRecentCoachAdviceSummary(context.recentMessages),
    context.athleteMemory?.trim() ? `## MEMORIA DEL COACH\n${context.athleteMemory.trim()}` : '',
    input.retryInstruction ? `## CORRECCIÓN DEL INTENTO ANTERIOR\n${input.retryInstruction}` : '',
    input.strictFormatting && !input.structuredOutput
      ? 'Modo estricto: si dudas, prioriza targetDate correcto, fechas válidas, número exacto de sesiones y detalles obligatorios por deporte antes que creatividad.'
      : '',
    '',
    `Regla final: crea una semana cerrada, ejecutable y compacta para ${formatWeekRangeLabel(planningStartDate, weekEndDate)}${isPartialCurrentWeek ? ` (semana calendario ${formatWeekRangeLabel(input.targetWeekStart)})` : ''}.`,
    '',
    input.structuredOutput ? '' : renderWeekCreatorContractReminder(createWeekContract, false),
  ].filter(Boolean)

  return {
    systemPrompt: input.structuredOutput
      ? buildWeekCreatorStructuredSystemPrompt()
      : buildWeekCreatorSystemPrompt(),
    userPrompt: lines.join('\n'),
  }
}

function buildStrengthStructureRules(config: WeekCreatorEffectiveConfig): string {
  if (!config.allowedSports.includes('strength')) return ''
  return [
    'Reglas de estructura para sesiones de fuerza:',
    '- Estructura preferida: warm-up/activación -> zona media -> fuerza principal -> accesorios/transferencia -> cardio específico opcional -> cooldown/movilidad.',
    '- Warm-up tipo preparador físico: puede ser principalmente movilidad/prep de tejidos y rango (foam roller o movilidad de gemelos, isquios, glúteos, aductores, cuádriceps, espalda alta, cadera, tobillo, torácica y hombro), más series de aproximación. No lo mezcles con zona media.',
    '- Para sesiones de 60 min busca densidad útil: 2 ejercicios de zona media + 4-5 ejercicios de fuerza/accesorios/correctivos + 0-1 bloque de cardio específico si aplica. No entregues sólo 2-3 ejercicios de fuerza para una sesión de una hora.',
    '- En sesiones de fuerza de 45+ min incluye zona media explícita con 1-2 ejercicios reales antes de la fuerza principal.',
    '- Zona media útil: dead bug, plancha frontal, fitball plank, Pallof press, plancha lateral, Copenhagen o chop controlado.',
    '- No cuentes un remo medio arrodillado, zancada o bisagra como único core aunque exija estabilidad; agrega una plancha/dead bug/Pallof/lateral cuando la duración lo permita.',
    '- Para squash, prioriza anti-extensión, anti-rotación y estabilidad lateral por encima de abdominales genéricos.',
    '- En retorno de lesión o fitness returning: conserva una estructura completa, pero usa RPE 6-7, tempo controlado, ejercicios de bajo riesgo y evita impacto agresivo o volumen que deje DOMS fuerte.',
    '- Cardio específico opcional va al final: si es bici de asalto 30s on/30s off o trotadora de aire 20s on/20s off, usa 1 bloque de 4 min; si es escalera/footwork, NO uses "1x4 min": entrega 2-3 ejercicios concretos de escalera con sets/reps tipo "2 pasadas por lado" o "2 pasadas".',
  ].join('\n')
}

function buildPrioritySportSummary(
  prioritySport: SupportedSport | undefined,
  config: WeekCreatorEffectiveConfig,
  eventContext: WeekCreatorEventContext,
  profile: ChatContext['athleteProfile'],
): string {
  if (!prioritySport) return ''
  const sessionsPerWeek = config.sessionsPerWeek
  const minimumPrioritySessions = prioritySport === 'squash'
    ? getSquashMinimumSessions({ ...config, primarySport: 'squash' }) ?? Math.floor(sessionsPerWeek / 2) + 1
    : Math.floor(sessionsPerWeek / 2) + 1
  return [
    `Prioridad explícita del usuario: ${prioritySport}.`,
    `- Mantén ${prioritySport} como foco principal de la semana dentro de los deportes permitidos.`,
    `- Con ${sessionsPerWeek} sesiones semanales, incluye al menos ${minimumPrioritySessions} sesiones de ${prioritySport} y máximo ${sessionsPerWeek - minimumPrioritySessions} accesorias.`,
    '- Esta prioridad no cambia el contrato de salida: debes devolver una sola acción create_week válida.',
    ...buildHardPrimaryMatchesRuleForWeekCreator(prioritySport, config, eventContext, profile),
  ].join('\n')
}

/** Misma decisión de exposición que el repair, incluidos sus vetos. */
function buildHardPrimaryMatchesRuleForWeekCreator(
  prioritySport: SupportedSport,
  config: WeekCreatorEffectiveConfig,
  eventContext: WeekCreatorEventContext,
  profile: ChatContext['athleteProfile'],
): string[] {
  const exposure = resolveSquashWeeklyExposurePolicy({
    primarySport: prioritySport,
    hasSquashGoalEvent: normalizeSport(eventContext.goalEvent?.sport ?? '') === 'squash',
    phase: eventContext.phase,
    currentFatigue: config.currentFatigue,
    partnerAvailability: profile?.planWizardConfig?.partnerAvailability,
    hasMedicalRestriction: [profile?.planWizardConfig?.injuryNotes,
      profile?.recoveryProfile?.currentInjuries, profile?.recoveryProfile?.restrictions]
      .some((value) => Boolean(value?.trim())),
    sessionsPerWeek: config.sessionsPerWeek,
    targetHardPrimaryMatches: config.targetHardPrimaryMatches,
  })
  if (!exposure.ensure || !exposure.declaredMatchCount) return []
  return [exposure.targetRpe >= 8
    ? `- Partidos duros objetivo esta semana: ${exposure.declaredMatchCount}. Cuentan sólo sesiones de partido real con RPE 8 o más.`
    : `- Meta de partidos ajustada por fase/fatiga: ${exposure.declaredMatchCount} exposición competitiva a RPE ${exposure.targetRpe}; no fuerces partidos duros.`]
}

function extractPrioritySport(
  userMessage: string,
  allowedSports: SupportedSport[],
): SupportedSport | undefined {
  const normalized = userMessage.toLowerCase()
  const labels: Record<SupportedSport, RegExp> = {
    squash: /\bsquash\b/,
    running: /\b(running|correr|corrida|trote)\b/,
    cycling: /\b(cycling|ciclismo|bici|bicicleta)\b/,
    strength: /\b(strength|fuerza|pesas)\b/,
    mobility: /\b(mobility|movilidad)\b/,
  }

  return allowedSports.find((sport) =>
    /\bpriori[zt]/.test(normalized) && labels[sport].test(normalized),
  )
}

function buildProfileSummaryV2(
  profile: ChatContext['athleteProfile'],
  config: WeekCreatorEffectiveConfig,
): string {
  const athleteTier = deriveWeekCreatorAthleteTier(config)
  if (!profile) {
    return [
      '## PERFIL DEL ATLETA',
      'Perfil no configurado; usa solo los defaults conservadores entregados.',
      `- Nivel operativo: ${athleteTier}`,
      `- Estado de forma y fatiga: fitness ${config.currentFitnessLevel} · fatiga ${config.currentFatigue}`,
      buildRestrictionSummary(undefined, config),
    ].filter(Boolean).join('\n')
  }

  const primarySport = profile.sportContext?.primarySport ?? profile.primarySport ?? config.primarySport
  const lines = [
    '## PERFIL DEL ATLETA',
    profile.name ? `- Nombre: ${profile.name}` : '',
    profile.age ? `- Edad: ${profile.age}` : '',
    profile.weightKg ? `- Peso: ${profile.weightKg}kg` : '',
    primarySport ? `- Deporte principal: ${primarySport}` : '',
    profile.mainGoal ? `- Objetivo principal: ${profile.mainGoal}` : '',
    profile.secondaryGoal ? `- Objetivo secundario: ${profile.secondaryGoal}` : '',
    profile.performanceLimiter?.trim()
      ? `- Limitante de rendimiento a trabajar: ${profile.performanceLimiter.trim()} — incluye estímulos que lo ataquen de forma progresiva cuando la fase lo permita.`
      : '',
    `- Nivel operativo: ${athleteTier}`,
    config.competitiveLevel ? `- Nivel competitivo: ${config.competitiveLevel}` : '',
    config.trainingPriority ? `- Prioridad de entrenamiento: ${config.trainingPriority}` : '',
    `- Estado de forma y fatiga: fitness ${config.currentFitnessLevel} · fatiga ${config.currentFatigue}`,
    buildStrengthProfileSummary(profile),
    buildRestrictionSummary(profile, config),
  ].filter(Boolean)

  return lines.join('\n')
}

function buildStrengthProfileSummary(profile: NonNullable<ChatContext['athleteProfile']>): string {
  const strength = profile.strengthProfile
  if (!strength) return ''

  const references = [
    strength.squat1RM != null ? `Back Squat/Sentadilla ${strength.squat1RM}kg 1RM` : '',
    strength.benchPress1RM != null ? `Bench Press ${strength.benchPress1RM}kg 1RM` : '',
    strength.deadlift1RM != null ? `Deadlift/Trap Bar ref. ${strength.deadlift1RM}kg 1RM` : '',
    strength.overheadPress1RM != null ? `Overhead Press ${strength.overheadPress1RM}kg 1RM` : '',
    strength.pullUpMaxReps != null ? `Dominadas max ${strength.pullUpMaxReps} reps` : '',
  ].filter(Boolean)

  if (references.length === 0 && !strength.notes?.trim()) return ''

  return [
    references.length > 0 ? `- Cargas históricas: ${references.join(' · ')}` : '',
    strength.notes?.trim() ? `- Notas de fuerza: ${strength.notes.trim()}` : '',
  ].filter(Boolean).join('\n')
}

function buildRestrictionSummary(
  profile: ChatContext['athleteProfile'],
  config: WeekCreatorEffectiveConfig,
): string {
  // `currentInjuries` es el campo que llena el onboarding: sin él, el modelo no
  // veía la lesión que el filtro determinista sí aplicaba. Una ausencia
  // explícita ("Ninguna.") no es una restricción y no se envía.
  const sources = [
    profile?.recoveryProfile?.currentInjuries?.trim(),
    profile?.recoveryProfile?.restrictions?.trim(),
    config.injuryNotes?.trim(),
  ].filter((value): value is string => Boolean(value) && hasDeclaredRestrictionSignal({ restrictions: value }))

  // Concatena ambas fuentes; descarta solo duplicados textuales (mismo contenido).
  const seen = new Set<string>()
  const restrictions = sources.filter((value) => {
    const key = value.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (restrictions.length === 0) return ''
  return `- ⚠️ Restricciones activas: ${restrictions.join(' · ')}. Adapta carga, ejercicios, impactos y RPE a estas restricciones.`
}

function buildGoalSummary(
  eventContext: WeekCreatorEventContext,
  primarySport: SupportedSport | undefined,
): string {
  const parts: string[] = []
  const goalEvent = eventContext.goalEvent
  if (!goalEvent) {
    return '## OBJETIVO COMPETITIVO\nNo hay evento competitivo activo; planifica una semana de entrenamiento general coherente con el perfil.'
  }
  const goalSport = goalEvent?.sport ? normalizeSport(goalEvent.sport) : undefined
  if (goalEvent && eventContext.window) {
    const eventLabel = goalSport && primarySport && goalSport !== primarySport
      ? 'Evento heredado/de plan anterior'
      : 'Evento objetivo'
    const range = eventContext.window.startDate === eventContext.window.endDate
      ? eventContext.window.startDate
      : `${eventContext.window.startDate} a ${eventContext.window.endDate}`
    parts.push(`${eventLabel}: ${goalEvent.title ?? 'objetivo principal'} (${range})`)
    if (eventContext.window.keyDate) parts.push(`Día clave/ancla: ${eventContext.window.keyDate}`)
    // Un evento heredado de otro deporte no gobierna esta semana: anunciarlo
    // como "campeonato en curso" contradice la fase declarada y la propia
    // instrucción de no tratarlo como restricción dura.
    if (eventContext.timing && eventContext.appliesToPrimarySport) {
      const timingLabel = eventContext.timing === 'active'
        ? 'campeonato en curso'
        : eventContext.timing === 'upcoming' ? 'próximo' : 'terminado'
      parts.push(`Timing para esta semana: ${eventContext.timing} (${timingLabel})`)
    }
  }
  if (goalEvent?.sport) parts.push(`Deporte del objetivo: ${goalEvent.sport}`)
  if (goalSport && primarySport && goalSport !== primarySport) {
    parts.push(`Deporte principal declarado actual: ${primarySport}`)
    parts.push(`No uses el evento ${goalSport} como restricción dura si el usuario pide una semana de ${primarySport}.`)
  }
  parts.push(`Fase para la semana objetivo: ${eventContext.phase}`)
  parts.push(`Foco del bloque: ${eventContext.blockFocus}`)
  if (eventContext.timing === 'active' && eventContext.appliesToPrimarySport) {
    parts.push('La ventana sigue activa: NO describas esta semana como post-evento ni transición aunque el inicio ya haya pasado.')
  }
  return parts.length > 0
    ? ['## OBJETIVO COMPETITIVO', parts.join(' · ')].join('\n')
    : '## OBJETIVO COMPETITIVO\nNo hay evento competitivo activo; planifica una semana de entrenamiento general coherente con el perfil.'
}

function buildConfigSummary(config: WeekCreatorEffectiveConfig): string {
  const squashMinimum = getSquashMinimumSessions(config)
  const supportSlots = squashMinimum ? Math.max(0, config.sessionsPerWeek - squashMinimum) : 0
  const doubleSessionDays = config.doubleSessionDays ?? []
  const lines = [
    '## CONFIGURACIÓN DE SESIONES',
    config.configSource === 'wizard'
      ? 'Configuración del plan activo (usar como guía fuerte):'
      : config.configSource === 'schedule'
        ? 'Configuración derivada del perfil y disponibilidad:'
        : 'Configuración por defaults conservadores:',
    config.configSource === 'defaults'
      ? '⚠ Sin perfil configurado: usa una semana base conservadora (3 sesiones, sin dobles, duración 60min, solo deporte principal).'
      : '',
    `- Días permitidos: ${config.trainingDays.join(', ')}`,
    doubleSessionDays.length > 0
      ? `- Días con doble sesión posible: ${doubleSessionDays.join(', ')}. Si usas doble sesión, usa solo esos días y separa AM/PM.`
      : '',
    `- Sesiones por semana: ${config.sessionsPerWeek}`,
    `- Duración por sesión: ${config.sessionDurationMins} min`,
    `- Doble sesión permitido: ${config.allowDoubleSession ? 'sí' : 'no'}`,
    config.allowDoubleSession && config.sessionsPerWeek > config.trainingDays.length
      ? `- Para ubicar ${config.sessionsPerWeek} sesiones en ${config.trainingDays.length} días, debes usar al menos ${config.sessionsPerWeek - config.trainingDays.length} doble(s) AM/PM en días autorizados.`
      : '',
    `- Deportes permitidos: ${config.allowedSports.join(', ')}`,
    config.primarySport ? `- Deporte principal a mantener presente: ${config.primarySport}` : '',
    squashMinimum
      ? `- Regla de distribución squash: con ${config.sessionsPerWeek} sesiones, incluye al menos ${squashMinimum} sesiones squash y evita dos squash el mismo día si hay deportes de soporte disponibles.`
      : '',
    squashMinimum && supportSlots > 0 && config.allowedSports.some((sport) => sport !== 'squash')
      ? `- Usa ${supportSlots === 1 ? 'el 1 cupo accesorio' : `los ${supportSlots} cupos accesorios`} con deportes de soporte permitidos (${config.allowedSports.filter((sport) => sport !== 'squash').slice(0, supportSlots).join(', ')}); no los reemplaces por más squash.`
      : '',
    config.scheduleConstraints?.trim() ? `- Restricciones horarias: ${config.scheduleConstraints.trim()}` : '',
  ].filter(Boolean)

  return lines.join('\n')
}

function buildAthleteLevelRules(config: WeekCreatorEffectiveConfig): string {
  const tier = deriveWeekCreatorAthleteTier(config)
  const base = [
    '## REGLAS POR NIVEL DEL ATLETA',
    ...buildTierRules(tier, config),
    '- El nivel nunca permite ignorar fatiga, lesiones, restricciones horarias, días permitidos ni número exacto de sesiones.',
  ]
  return base.join('\n')
}

function buildWeekObjectivesBlock(
  profile: ChatContext['athleteProfile'],
  planWeekObjectives: string[] | undefined,
): string {
  // Fuente primaria: objetivos de la TrainingPlanWeek del plan activo (resueltos por el engine).
  // Fallback: intención semanal por deporte del macro plan.
  const objectives = planWeekObjectives?.length
    ? planWeekObjectives
    : deriveMacroWeeklyIntents(profile)
  if (objectives.length === 0) return ''

  return [
    '## OBJETIVOS DE LA SEMANA',
    'Cada sesión debe conectarse a al menos uno de estos objetivos. Úsalos para determinar tipo de estímulo, RPE y contenido.',
    ...objectives.map((objective, index) => `${index + 1}. ${objective}`),
  ].join('\n')
}

function deriveMacroWeeklyIntents(profile: ChatContext['athleteProfile']): string[] {
  const details = profile?.macroPlan?.sportDetails ?? []
  return details
    .map((detail) => {
      const intent = detail.weeklyIntent?.trim()
      return intent ? `${detail.sport}: ${intent}` : ''
    })
    .filter(Boolean)
}

function buildSquashPhaseContentGuide(
  config: WeekCreatorEffectiveConfig,
  eventContext: WeekCreatorEventContext,
): string {
  if (
    config.primarySport !== 'squash'
    || !eventContext.goalEvent
    || !eventContext.appliesToPrimarySport
  ) return ''

  const phase = eventContext.phase

  const guides: Record<typeof phase, string[]> = {
    base: [
      '- Squash: técnica fundamental, ghosting básico y rallies cooperativos. RPE 5-6.',
      '- Evita presión de resultado; busca calidad de golpeo, desplazamiento limpio y tolerancia de tejidos.',
    ],
    build: [
      '- Squash: pressure drills, puntos condicionados y trabajo a la T.',
      '- Incluye al menos 1 match-play controlado en la semana si la fatiga lo permite. RPE 7-8.',
      '- Ese match-play debe ser un único partido al mejor de 5 juegos, sin games o partidos condicionados adicionales.',
    ],
    peak: [
      '- Squash: presión bajo fatiga, simulación de partido y control emocional.',
      '- Apunta a 3-4 sesiones de squash por semana si la configuración lo permite.',
      '- Respeta mínimo 12h entre squash intenso y gimnasio pesado.',
    ],
    taper: [
      '- Squash: 2-3 toques cortos de calidad. Sin squash exhaustivo.',
      '- Fuerza: 0-1 sesión neural corta; nada que genere DOMS.',
    ],
    race: [
      eventContext.anchorInsidePlanningWindow
        ? `- Inserta UNA sola ancla squash match/competitive el ${eventContext.anchorDate}; no agregues otro match-play.`
        : eventContext.anchorInsideTargetWeek
          ? `- El ancla ${eventContext.anchorDate} ya pasó dentro de esta semana parcial; NO la recrees.`
          : `- El ancla única ${eventContext.anchorDate} cae en otra semana; NO inventes una competencia en ésta.`,
      '- Como máximo 2 apoyos: activación 10-20min RPE 2-4, toque technical 20-30min RPE 3-4 con partner o recuperación/movilidad 15-30min RPE 1-3.',
      '- Prohibido: fuerza pesada, running de calidad, cycling de carga y match-play extra durante toda la ventana.',
      eventContext.anchorInsidePlanningWindow
        ? `- No programes una segunda sesión el día clave ${eventContext.anchorDate}.`
        : '',
    ],
    transition: [
      '- Recuperación activa. RPE <= 5 en todo.',
      '- Usa squash suave solo como continuidad técnica o disfrute, no como carga.',
    ],
  }

  return [`## GUÍA DE CONTENIDO — FASE ${phase.toUpperCase()}`, ...guides[phase]].join('\n')
}

function buildTierRules(
  tier: WeekCreatorAthleteTier,
  config: WeekCreatorEffectiveConfig,
): string[] {
  const squashPrimary = config.primarySport === 'squash' || config.allowedSports.includes('squash')
  switch (tier) {
    case 'elite':
      return [
        '- Nivel elite/profesional: evita semanas genéricas. Cada sesión principal debe tener un foco táctico/técnico claro y transferencia real al rendimiento.',
        squashPrimary ? '- Squash elite: prioriza presión controlada, toma de la T, patrones largo-corto, ataque/defensa y juegos condicionados; usa control básico solo como soporte, activación o descarga.' : '',
        '- Fuerza elite: si hay fuerza, usa transferencia deportiva concreta (potencia lateral, desaceleración, rotación/anti-rotación, unilateral) y evita rutinas genéricas de gimnasio.',
        '- Running/cycling elite cuando no son deporte principal: deben ser soporte aeróbico o recuperación, no competir con la calidad del deporte principal.',
      ].filter(Boolean)
    case 'advanced':
      return [
        '- Nivel avanzado: usa menos educación básica y más intención de entrenamiento; combina técnica con toma de decisión, presión o aplicación competitiva.',
        squashPrimary ? '- Squash avanzado: no abuses de solo drives/control aislado; al menos una sesión de la semana debe transferir a rally, presión o juego condicionado si la fatiga lo permite.' : '',
        '- Fuerza avanzada: prioriza patrones atléticos y específicos antes que full-body genérico.',
      ].filter(Boolean)
    case 'competitive':
      return [
        '- Nivel competitivo: progresión clara pero sostenible; mezcla técnica sólida, control y una dosis de aplicación específica.',
        squashPrimary ? '- Squash competitivo: incluye técnica y control, pero evita que toda la semana sea repetición aislada sin contexto de juego.' : '',
      ].filter(Boolean)
    case 'foundation':
      return [
        '- Nivel retorno/bajo de forma: reduce complejidad, riesgo e impacto; prioriza consistencia, técnica limpia y tolerancia de tejidos.',
        '- Evita sesiones de alta presión, potencia avanzada o match-play intenso salvo que el usuario lo pida explícitamente y la fatiga sea baja.',
      ]
    case 'recreational':
    default:
      return [
        '- Nivel recreativo/general: prioriza adherencia, técnica clara y carga comprensible antes que complejidad competitiva.',
      ]
  }
}

function getSquashMinimumSessions(config: WeekCreatorEffectiveConfig): number | undefined {
  if (config.primarySport !== 'squash' || config.sessionsPerWeek < 4) return undefined
  const majorityTarget = Math.floor(config.sessionsPerWeek / 2) + 1
  const hasSupportSports = config.allowedSports.some((sport) => sport !== 'squash')
  return hasSupportSports
    ? Math.min(majorityTarget, Math.max(1, config.trainingDays.length))
    : majorityTarget
}

function buildCurrentWeekSessionsSummary(
  sessions: ChatContext['plannedSessions'],
  targetWeekStart: string,
): string {
  if (!sessions || sessions.length === 0) {
    return `## SEMANA ACTUAL\nNo hay sesiones planificadas actualmente dentro de la semana objetivo ${targetWeekStart}.`
  }

  const lines = sessions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
    .map((session) => {
      const details = summarizeExistingSessionDetails(session)
      return `- ${session.date} ${session.timeBlock} · ${session.type} · ${session.title} · ${session.durationMin}min${details ? ` · ${details}` : ''}`
    })

  return [
    '## SEMANA ACTUAL',
    `Sesiones ya planificadas dentro de la semana objetivo ${targetWeekStart}:`,
    ...lines,
    'Puedes reorganizar la semana completa, pero no repitas exactamente los mismos drills o ejercicios si ya hay focos creados.',
  ].join('\n')
}

function summarizeExistingSessionDetails(
  session: NonNullable<ChatContext['plannedSessions']>[number],
): string {
  if (session.type === 'squash' && session.squashDetails) {
    const blockKinds = session.squashDetails.blocks
      ?.map((block) => block.kind)
      .filter(Boolean)
      .join('+')
    const drills = [
      ...(session.squashDetails.drills ?? []),
      ...((session.squashDetails.blocks ?? []).flatMap((block) => block.drills ?? [])),
    ]
      .map((drill) => drill.name)
      .filter(Boolean)
      .slice(0, 5)
    return [
      session.squashDetails.sessionKind ? `kind ${session.squashDetails.sessionKind}` : '',
      blockKinds ? `bloques ${blockKinds}` : '',
      drills.length > 0 ? `drills ${drills.join(', ')}` : '',
    ].filter(Boolean).join(' · ')
  }

  if (session.type === 'strength' && Array.isArray(session.exercises) && session.exercises.length > 0) {
    return `ejercicios ${session.exercises.map((exercise) => exercise.name).slice(0, 6).join(', ')}`
  }

  return ''
}

function buildProgressionContext(
  sessions: ChatContext['historicalSessions'],
  logs: ChatContext['weekDayLogs'],
  loadDecision: LoadDirectiveDecision,
): string {
  const rpeStats = computeRecentRpeStats(sessions)
  const sessionLines = sessions && sessions.length > 0
    ? sessions.map((session) => {
      const rpe = session.actualRpe ?? session.rpe
      return `- ${session.date} ${session.timeBlock} · ${session.type} · ${session.title} · ${session.durationMin}min${rpe ? ` · RPE ${rpe}` : ''}`
    })
    : ['- Sin historial reciente de sesiones.']
  const logLines = logs && logs.length > 0
    ? logs.map(formatDayLogLine)
    : ['- Sin day logs recientes.']

  return [
    '## PROGRESIÓN Y DIRECTIVA DE CARGA',
    `Directiva de carga: ${buildLoadDirective(loadDecision, sessions)}`,
    'Historial de sesiones:',
    ...sessionLines,
    rpeStats.count > 0
      ? `RPE promedio reciente: ${formatDecimal(rpeStats.average)}/10 (${rpeStats.count} sesiones con RPE).`
      : 'RPE promedio reciente: no disponible.',
    'Day logs recientes:',
    ...logLines,
  ].join('\n')
}

function buildLoadDirective(decision: LoadDirectiveDecision, sessions: ChatContext['historicalSessions']): string {
  const rendered = renderLoadDirective(decision)
  if (rendered) return rendered

  // Caminos propios de Week Creator que el policy no cubre porque son de
  // arranque, no de ejecución.
  if (!sessions || sessions.length === 0) {
    return 'INICIAR CON CARGA CONSERVADORA — sin historial previo. RPE 6-7.'
  }
  return 'MANTENER PROGRESIÓN NORMAL — fatiga normal, sin señales de alerta.'
}


function formatDayLogLine(log: NonNullable<ChatContext['weekDayLogs']>[number]): string {
  const parts = [
    log.generalNotes?.trim(),
    log.energyLevel != null ? `energía ${log.energyLevel}/10` : '',
    log.painLevel != null ? `dolor ${log.painLevel}/10` : '',
    log.sleepHours != null ? `sueño ${log.sleepHours}h` : '',
    log.rpeActual != null && !isWhoopPrefilled(log, 'rpeActual') ? `esfuerzo ${log.rpeActual}/10` : '',
  ].filter(Boolean)
  return `- ${log.date}: ${parts.length > 0 ? parts.join(' · ') : 'sin métricas accionables'}`
}

function formatDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function buildRecentCoachAdviceSummary(messages: ChatContext['recentMessages']): string {
  const coachMessages = (messages ?? [])
    .filter((message) => message.role === 'coach' && message.content.trim().length > 0)
    .slice(-2)

  if (coachMessages.length === 0) return ''

  return [
    '## CONSEJOS RECIENTES DEL COACH',
    'Consejos recientes de RallyIQ que debes intentar respetar si no contradicen la configuración:',
    ...coachMessages.map((message) => `- ${clipForPrompt(message.content, 420)}`),
  ].join('\n')
}

function clipForPrompt(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`
}

function selectSessionsForTargetWeek(
  sessions: NonNullable<ChatContext['plannedSessions']>,
  targetWeekStart: string,
) {
  const weekStartTs = new Date(`${targetWeekStart}T00:00:00.000Z`).getTime()
  const weekEndExclusive = weekStartTs + (7 * 24 * 60 * 60 * 1000)

  return sessions.filter((session) => {
    const ts = new Date(`${session.date}T00:00:00.000Z`).getTime()
    return ts >= weekStartTs && ts < weekEndExclusive
  })
}

function addDaysIso(date: string, days: number): string {
  const start = new Date(`${date}T00:00:00.000Z`)
  return addDays(start, days).toISOString().slice(0, 10)
}

function formatWeekRangeLabel(startDate: string, endDate?: string): string {
  const start = new Date(`${startDate}T00:00:00.000Z`)
  const end = endDate ? new Date(`${endDate}T00:00:00.000Z`) : addDays(start, 6)
  return `${format(start, 'd MMM', { locale: es })} - ${format(end, 'd MMM', { locale: es })}`
}

export function summarizeWeekCreatorAction(action: { sessions?: CoachSessionProposal[] } | undefined): string {
  const sessionCount = action?.sessions?.length ?? 0
  if (sessionCount === 0) return 'Te preparé una propuesta de semana para revisar.'
  const sessionLabel = sessionCount === 1 ? 'sesión' : 'sesiones'
  return `Te preparé una semana con ${sessionCount} ${sessionLabel}. Revísala y, si te hace sentido, aplícala.`
}
