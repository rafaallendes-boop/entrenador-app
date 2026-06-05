import type { ChatContext, CoachSessionProposal, SupportedSport } from '../../types'
import { addDays, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ACTION_CONTRACTS } from '../ai/prompt/core/outputContract'
import { buildWeekCreatorSquashRules } from '../ai/prompt/packs/sports/squash'
import {
  renderWeekCreatorContractReminder,
  renderWeekCreatorTargetInstructions,
} from '../ai/prompt/renderers/proseSchema'
import { buildWeekCreatorSystemPrompt } from '../week/prompts/weekPrompt'
import { deriveWeekCreatorAthleteTier, type WeekCreatorAthleteTier, type WeekCreatorEffectiveConfig } from './WeekCreatorConfig'
import { normalizeSport } from '../../utils/athlete'

export interface WeekCreatorPromptInput {
  userMessage: string
  targetWeekStart: string
  planningStartDate?: string
  weekEndDate?: string
  config: WeekCreatorEffectiveConfig
  retryInstruction?: string
  strictFormatting?: boolean
  structuredOutput?: boolean
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
  const goalEvent = resolveGoalEvent(profile)
  const prioritySport = extractPrioritySport(input.userMessage, config.allowedSports)
  const createWeekContract = ACTION_CONTRACTS.create_week
  const planningStartDate = input.planningStartDate ?? input.targetWeekStart
  const weekEndDate = input.weekEndDate ?? addDaysIso(input.targetWeekStart, 6)
  const isPartialCurrentWeek = planningStartDate > input.targetWeekStart

  const lines = [
    `Solicitud del usuario: ${input.userMessage}`,
    '',
    `Genera una sola semana para el lunes objetivo ${input.targetWeekStart}.`,
    ...renderWeekCreatorTargetInstructions(createWeekContract, input.targetWeekStart, input.structuredOutput),
    isPartialCurrentWeek
      ? `La semana objetivo ya está en curso: programa sesiones solo desde ${planningStartDate} hasta ${weekEndDate}. No propongas sesiones en días pasados de esta semana.`
      : '',
    '',
    buildProfileSummary(profile),
    buildGoalSummary(goalEvent, profile?.macroPlan?.currentPhase, profile?.macroPlan?.blockFocus, config.primarySport),
    buildConfigSummary(config),
    buildAthleteLevelRules(config),
    buildPrioritySportSummary(prioritySport, config),
    buildWeekCreatorSquashRules(config),
    buildStrengthStructureRules(config),
    buildCurrentWeekSessionsSummary(targetWeekSessions, input.targetWeekStart),
    buildRecentHistorySummary(recentHistory),
    buildRecentLogsSummary(recentLogs),
    buildRecentCoachAdviceSummary(context.recentMessages),
    profile?.coachMemory?.trim() ? `Memoria del coach relevante: ${profile.coachMemory.trim()}` : '',
    input.retryInstruction ? `Corrección del intento anterior:\n${input.retryInstruction}` : '',
    input.strictFormatting
      ? 'Modo estricto: si dudas, prioriza targetDate correcto, fechas válidas, número exacto de sesiones y detalles obligatorios por deporte antes que creatividad.'
      : '',
    '',
    'Si hay dos o más sesiones de fuerza, deben tener focos y ejercicios distintos; no repitas exactamente el mismo array exercises en más de una sesión.',
    '',
    renderWeekCreatorContractReminder(createWeekContract, input.structuredOutput),
    '',
    `Regla final: crea una semana cerrada, ejecutable y compacta para ${formatWeekRangeLabel(planningStartDate, weekEndDate)}${isPartialCurrentWeek ? ` (semana calendario ${formatWeekRangeLabel(input.targetWeekStart)})` : ''}.`,
  ].filter(Boolean)

  return {
    systemPrompt: buildWeekCreatorSystemPrompt(),
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

function buildPrioritySportSummary(prioritySport: SupportedSport | undefined, config: WeekCreatorEffectiveConfig): string {
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
  ].join('\n')
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

function buildProfileSummary(profile: ChatContext['athleteProfile']): string {
  if (!profile) return 'Perfil: no configurado; usa solo los defaults conservadores entregados.'

  const parts: string[] = []
  if (profile.name) parts.push(`Atleta: ${profile.name}`)
  if (profile.age) parts.push(`Edad: ${profile.age}`)
  if (profile.weightKg) parts.push(`Peso: ${profile.weightKg}kg`)
  if (profile.sportContext?.primarySport) parts.push(`Deporte principal declarado: ${profile.sportContext.primarySport}`)
  if (profile.mainGoal) parts.push(`Objetivo principal: ${profile.mainGoal}`)
  if (profile.secondaryGoal) parts.push(`Objetivo secundario: ${profile.secondaryGoal}`)
  return parts.length > 0 ? parts.join(' · ') : 'Perfil: disponible pero mínimo.'
}

function buildGoalSummary(
  goalEvent: { title?: string; date?: string; sport?: string } | undefined,
  currentPhase: string | undefined,
  blockFocus: string | undefined,
  primarySport: SupportedSport | undefined,
): string {
  const parts: string[] = []
  const goalSport = goalEvent?.sport ? normalizeSport(goalEvent.sport) : undefined
  if (goalEvent?.title || goalEvent?.date) {
    const eventLabel = goalSport && primarySport && goalSport !== primarySport
      ? 'Evento heredado/de plan anterior'
      : 'Evento objetivo'
    parts.push(`${eventLabel}: ${goalEvent?.title ?? 'objetivo principal'}${goalEvent?.date ? ` (${goalEvent.date})` : ''}`)
  }
  if (goalEvent?.sport) parts.push(`Deporte del objetivo: ${goalEvent.sport}`)
  if (goalSport && primarySport && goalSport !== primarySport) {
    parts.push(`Deporte principal declarado actual: ${primarySport}`)
    parts.push(`No uses el evento ${goalSport} como restricción dura si el usuario pide una semana de ${primarySport}.`)
  }
  if (currentPhase) parts.push(`Fase actual: ${currentPhase}`)
  if (blockFocus) parts.push(`Foco del bloque: ${blockFocus}`)
  return parts.length > 0
    ? parts.join(' · ')
    : 'No hay evento competitivo activo; planifica una semana de entrenamiento general coherente con el perfil.'
}

function buildConfigSummary(config: WeekCreatorEffectiveConfig): string {
  const squashMinimum = getSquashMinimumSessions(config)
  const supportSlots = squashMinimum ? Math.max(0, config.sessionsPerWeek - squashMinimum) : 0
  const doubleSessionDays = config.doubleSessionDays ?? []
  const athleteTier = deriveWeekCreatorAthleteTier(config)
  const lines = [
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
      ? '- Como las sesiones superan los días disponibles, debes usar al menos una doble sesión en un día marcado como doble.'
      : '',
    `- Deportes permitidos: ${config.allowedSports.join(', ')}`,
    config.primarySport ? `- Deporte principal a mantener presente: ${config.primarySport}` : '',
    `- Nivel operativo del atleta: ${athleteTier}${config.competitiveLevel ? ` · competitivo ${config.competitiveLevel}` : ''}${config.trainingPriority ? ` · prioridad ${config.trainingPriority}` : ''}`,
    squashMinimum
      ? `- Regla de distribución squash: con ${config.sessionsPerWeek} sesiones, incluye al menos ${squashMinimum} sesiones squash y evita dos squash el mismo día si hay deportes de soporte disponibles.`
      : '',
    squashMinimum && supportSlots > 0 && config.allowedSports.some((sport) => sport !== 'squash')
      ? `- Usa ${supportSlots === 1 ? 'el 1 cupo accesorio' : `los ${supportSlots} cupos accesorios`} con deportes de soporte permitidos (${config.allowedSports.filter((sport) => sport !== 'squash').slice(0, supportSlots).join(', ')}); no los reemplaces por más squash.`
      : '',
    `- Estado inicial: fitness ${config.currentFitnessLevel} · fatiga ${config.currentFatigue}`,
    config.scheduleConstraints?.trim() ? `- Restricciones horarias: ${config.scheduleConstraints.trim()}` : '',
    config.injuryNotes?.trim() ? `- Restricciones: ${config.injuryNotes.trim()}` : '',
  ].filter(Boolean)

  return lines.join('\n')
}

function buildAthleteLevelRules(config: WeekCreatorEffectiveConfig): string {
  const tier = deriveWeekCreatorAthleteTier(config)
  const base = [
    'Reglas por nivel del atleta:',
    ...buildTierRules(tier, config),
    '- El nivel nunca permite ignorar fatiga, lesiones, restricciones horarias, días permitidos ni número exacto de sesiones.',
  ]
  return base.join('\n')
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
    return `No hay sesiones planificadas actualmente dentro de la semana objetivo ${targetWeekStart}.`
  }

  const lines = sessions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
    .map((session) => {
      const details = summarizeExistingSessionDetails(session)
      return `- ${session.date} ${session.timeBlock} · ${session.type} · ${session.title} · ${session.durationMin}min${details ? ` · ${details}` : ''}`
    })

  return [
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

function buildRecentHistorySummary(sessions: ChatContext['historicalSessions']): string {
  if (!sessions || sessions.length === 0) {
    return 'No hay historial reciente relevante disponible.'
  }

  const lines = sessions.map((session) =>
    `- ${session.date} ${session.timeBlock} · ${session.type} · ${session.title} · ${session.durationMin}min${session.rpe ? ` · RPE ${session.rpe}` : ''}`,
  )

  return ['Historial reciente útil:', ...lines].join('\n')
}

function buildRecentLogsSummary(logs: ChatContext['weekDayLogs']): string {
  if (!logs || logs.length === 0) {
    return 'No hay day logs recientes para usar como restricción.'
  }

  const lines = logs.map((log) => {
    const parts = [
      log.generalNotes?.trim(),
      log.energyLevel != null ? `energía ${log.energyLevel}/10` : '',
      log.painLevel != null ? `dolor ${log.painLevel}/10` : '',
      log.sleepHours != null ? `sueño ${log.sleepHours}h` : '',
      log.rpeActual != null ? `RPE real ${log.rpeActual}/10` : '',
    ].filter(Boolean)
    return `- ${log.date}: ${parts.join(' · ')}`
  })

  return ['Day logs recientes:', ...lines].join('\n')
}

function buildRecentCoachAdviceSummary(messages: ChatContext['recentMessages']): string {
  const coachMessages = (messages ?? [])
    .filter((message) => message.role === 'coach' && message.content.trim().length > 0)
    .slice(-2)

  if (coachMessages.length === 0) return ''

  return [
    'Consejos recientes del coach que debes intentar respetar si no contradicen la configuración:',
    ...coachMessages.map((message) => `- ${clipForPrompt(message.content, 420)}`),
  ].join('\n')
}

function clipForPrompt(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`
}

function resolveGoalEvent(profile: ChatContext['athleteProfile']) {
  if (!profile) return undefined
  const goalEventId = profile.planWizardConfig?.goalEventId
  if (goalEventId) {
    const selected = profile.goalEvents?.find((event) => event.id === goalEventId)
    if (selected) return selected
  }
  return profile.goalEvents?.find((event) => event.priority === 'primary') ?? profile.goalEvents?.[0]
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
