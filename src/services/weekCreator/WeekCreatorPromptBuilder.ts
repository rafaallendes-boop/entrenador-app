import type { ChatContext, CoachSessionProposal } from '../../types'
import { addDays, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { buildWeekSystemPrompt } from '../week/prompts/weekPrompt'
import type { WeekCreatorEffectiveConfig } from './WeekCreatorConfig'

export interface WeekCreatorPromptInput {
  userMessage: string
  targetWeekStart: string
  config: WeekCreatorEffectiveConfig
  retryInstruction?: string
  strictFormatting?: boolean
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

  const lines = [
    `Solicitud del usuario: ${input.userMessage}`,
    '',
    `Genera una sola semana completa para el lunes objetivo ${input.targetWeekStart}.`,
    `Debes devolver EXACTAMENTE una acción create_week con targetDate=${input.targetWeekStart}.`,
    `No devuelvas texto conversacional fuera de <actions>.`,
    '',
    buildProfileSummary(profile),
    buildGoalSummary(goalEvent, profile?.macroPlan?.currentPhase, profile?.macroPlan?.blockFocus),
    buildConfigSummary(config),
    buildCurrentWeekSessionsSummary(targetWeekSessions, input.targetWeekStart),
    buildRecentHistorySummary(recentHistory),
    buildRecentLogsSummary(recentLogs),
    profile?.coachMemory?.trim() ? `Memoria del coach relevante: ${profile.coachMemory.trim()}` : '',
    input.retryInstruction ? `Corrección del intento anterior:\n${input.retryInstruction}` : '',
    input.strictFormatting
      ? 'Modo estricto: si dudas, prioriza targetDate correcto, fechas válidas, número exacto de sesiones y detalles obligatorios por deporte antes que creatividad.'
      : '',
    '',
    'Si hay dos o más sesiones de fuerza, deben tener focos y ejercicios distintos; no repitas exactamente el mismo array exercises en más de una sesión.',
    '',
    `Regla final: crea una semana cerrada, ejecutable y compacta para ${formatWeekRangeLabel(input.targetWeekStart)}.`,
  ].filter(Boolean)

  return {
    systemPrompt: buildWeekSystemPrompt(),
    userPrompt: lines.join('\n'),
  }
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
): string {
  const parts: string[] = []
  if (goalEvent?.title || goalEvent?.date) {
    parts.push(`Evento objetivo: ${goalEvent?.title ?? 'objetivo principal'}${goalEvent?.date ? ` (${goalEvent.date})` : ''}`)
  }
  if (goalEvent?.sport) parts.push(`Deporte del objetivo: ${goalEvent.sport}`)
  if (currentPhase) parts.push(`Fase actual: ${currentPhase}`)
  if (blockFocus) parts.push(`Foco del bloque: ${blockFocus}`)
  return parts.length > 0
    ? parts.join(' · ')
    : 'No hay evento competitivo activo; planifica una semana de entrenamiento general coherente con el perfil.'
}

function buildConfigSummary(config: WeekCreatorEffectiveConfig): string {
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
    `- Sesiones por semana: ${config.sessionsPerWeek}`,
    `- Duración por sesión: ${config.sessionDurationMins} min`,
    `- Doble sesión permitido: ${config.allowDoubleSession ? 'sí' : 'no'}`,
    `- Deportes permitidos: ${config.allowedSports.join(', ')}`,
    config.primarySport ? `- Deporte principal a mantener presente: ${config.primarySport}` : '',
    `- Estado inicial: fitness ${config.currentFitnessLevel} · fatiga ${config.currentFatigue}`,
    config.injuryNotes?.trim() ? `- Restricciones: ${config.injuryNotes.trim()}` : '',
  ].filter(Boolean)

  return lines.join('\n')
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
    .map((session) => `- ${session.date} ${session.timeBlock} · ${session.type} · ${session.title} · ${session.durationMin}min`)

  return [
    `Sesiones ya planificadas dentro de la semana objetivo ${targetWeekStart}:`,
    ...lines,
    'Puedes reorganizar la semana completa, pero mantén una distribución coherente con esta base si aporta estabilidad.',
  ].join('\n')
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

function formatWeekRangeLabel(targetWeekStart: string): string {
  const start = new Date(`${targetWeekStart}T00:00:00.000Z`)
  const end = addDays(start, 6)
  return `${format(start, 'd MMM', { locale: es })} - ${format(end, 'd MMM', { locale: es })}`
}

export function summarizeWeekCreatorAction(action: { sessions?: CoachSessionProposal[] } | undefined): string {
  const sessionCount = action?.sessions?.length ?? 0
  if (sessionCount === 0) return 'Te preparé una propuesta de semana para revisar.'
  const sessionLabel = sessionCount === 1 ? 'sesión' : 'sesiones'
  return `Te preparé una semana con ${sessionCount} ${sessionLabel}. Revísala y, si te hace sentido, aplícala.`
}
