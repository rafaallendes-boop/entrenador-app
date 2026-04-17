import type { AthleteProfile, PlanWizardConfig, SupportedSport } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'

export interface WeekPromptInput {
  plan: TrainingPlan
  week: TrainingPlanWeek
  previousWeek?: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
}

const PHASE_LABEL: Record<string, string> = {
  base: 'Base',
  build: 'Build',
  peak: 'Peak',
  taper: 'Taper',
  race: 'Race',
  transition: 'Transition',
}

function briefPreviousWeek(previous: TrainingPlanWeek | undefined): string {
  if (!previous || previous.sessions.length === 0) return 'No hay semana previa (es la primera).'
  const lines = previous.sessions.map((s) =>
    `  - ${s.date} ${s.timeBlock} · ${s.sessionType}${s.subtype ? `/${s.subtype}` : ''} · ${s.title} · ${s.durationMin}min${s.rpe ? ` · RPE ${s.rpe}` : ''}`,
  )
  return `Semana previa (resumen):\n${lines.join('\n')}`
}

function briefAthlete(profile: AthleteProfile): string {
  const parts: string[] = []
  if (profile.name) parts.push(`Atleta: ${profile.name}`)
  if (profile.age) parts.push(`Edad: ${profile.age}`)
  if (profile.weightKg) parts.push(`Peso: ${profile.weightKg}kg`)
  if (profile.sportContext?.primarySport) parts.push(`Deporte principal: ${profile.sportContext.primarySport}`)
  if (profile.mainGoal) parts.push(`Objetivo: ${profile.mainGoal}`)
  return parts.join(' · ') || 'Perfil mínimo'
}

function allowedSportsList(plan: TrainingPlan, wizardConfig: PlanWizardConfig): SupportedSport[] {
  const fromContext = (plan.macroSnapshot.sportDetails.map((d) => d.sport)) as SupportedSport[]
  return Array.from(new Set<SupportedSport>([...fromContext, ...wizardConfig.complementarySports]))
}

export function buildWeekSystemPrompt(): string {
  return [
    'Eres el generador de una sola semana dentro de un plan por evento ya estructurado.',
    'Respondes EXCLUSIVAMENTE con un bloque <actions> JSON que contenga UNA acción create_week para la semana indicada.',
    'No explicas nada fuera del bloque <actions>. Nada de texto previo ni posterior.',
    'La acción create_week debe incluir: type, targetDate (lunes de la semana), reason corto, sessions[] y weekObjectives[].',
    'Cada sesión incluye: date (YYYY-MM-DD dentro de la semana), timeBlock (AM/PM), sessionType, title, durationMin, objective. Añade subtype/runningType/squashDetails/cyclingDetails/mobilityDetails/exercises/intervalStructure cuando aporten.',
    'Respeta strictamente la fase indicada, objetivos de carga y deportes permitidos.',
    'No inventes sesiones fuera de los días permitidos. No dupliques misma fecha+timeBlock.',
  ].join('\n')
}

export function buildWeekUserPrompt(input: WeekPromptInput): string {
  const { plan, week, previousWeek, profile, wizardConfig } = input
  const allowed = allowedSportsList(plan, wizardConfig)
  const targetLoads = Object.entries(week.targetLoadBySport)
    .map(([sport, load]) => `${sport}: ${load}`)
    .join(', ')
  const days = wizardConfig.trainingDays.join(', ')

  return [
    `Generar semana ${week.weekIndex + 1} de ${plan.totalWeeks} del plan "${plan.title}".`,
    `Evento principal: ${plan.macroSnapshot.goalEventDate} · Fase: ${PHASE_LABEL[week.phase] ?? week.phase}`,
    `Semana que empieza el lunes ${week.weekStartDate}.`,
    `Foco del bloque: ${plan.phases.find((p) => week.weekIndex >= p.startWeekIndex && week.weekIndex <= p.endWeekIndex)?.blockFocus ?? ''}`,
    '',
    briefAthlete(profile),
    '',
    `Configuración del wizard:`,
    `- Días permitidos: ${days}`,
    `- Sesiones por semana: ${wizardConfig.sessionsPerWeek}`,
    `- Duración por sesión: ${wizardConfig.sessionDurationMins} min`,
    `- Doble sesión permitido: ${wizardConfig.allowDoubleSession ? 'sí' : 'no'}`,
    `- Nivel actual: ${wizardConfig.currentFitnessLevel} · Fatiga: ${wizardConfig.currentFatigue}`,
    `- Deportes permitidos: ${allowed.join(', ')}`,
    `- Carga objetivo por deporte: ${targetLoads}`,
    wizardConfig.injuryNotes ? `- Lesiones/restricciones: ${wizardConfig.injuryNotes}` : '',
    '',
    briefPreviousWeek(previousWeek),
    '',
    'Devuelve sólo el bloque <actions> con una única create_week para esta semana.',
  ].filter(Boolean).join('\n')
}
