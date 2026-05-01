import type { AthleteProfile, PlanWizardConfig, SupportedSport } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'

export interface WeekPromptInput {
  plan: TrainingPlan
  week: TrainingPlanWeek
  previousWeek?: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  retryInstruction?: string
  strictFormatting?: boolean
}

export interface WeekBatchPromptInput {
  plan: TrainingPlan
  weeks: [TrainingPlanWeek, TrainingPlanWeek]
  previousWeek?: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  retryInstruction?: string
  strictFormatting?: boolean
}

const PHASE_LABEL: Record<string, string> = {
  base: 'Base',
  build: 'Build',
  peak: 'Peak',
  taper: 'Taper',
  race: 'Race',
  transition: 'Transition',
}

function getPrimarySport(plan: TrainingPlan): SupportedSport | undefined {
  return plan.macroSnapshot.sportDetails.find((detail) => detail.role === 'primary')?.sport
}

function buildPrimarySportRule(plan: TrainingPlan, week: TrainingPlanWeek): string[] {
  const primarySport = getPrimarySport(plan)
  if (!primarySport) return []

  const lines = [`- Deporte principal del objetivo: ${primarySport}`]

  if (week.phase === 'transition') {
    lines.push(`- Mantén ${primarySport} presente solo si aporta recuperación y continuidad suave.`)
    return lines
  }

  const minimumByPhase: Record<string, number> = {
    base: 1,
    build: primarySport === 'squash' ? 2 : 1,
    peak: primarySport === 'squash' ? 2 : 1,
    taper: 1,
    race: 1,
  }
  const minimumSessions = minimumByPhase[week.phase] ?? 1
  const emphasis =
    week.phase === 'build' || week.phase === 'peak'
      ? ` ${primarySport} debe tener más protagonismo que los deportes de apoyo.`
      : ''

  lines.push(`- Regla crítica: incluye al menos ${minimumSessions} sesión${minimumSessions > 1 ? 'es' : ''} de ${primarySport} dentro de esta semana.${emphasis}`)
  if (primarySport === 'squash' && plan.wizardConfig.sessionsPerWeek >= 5) {
    lines.push('- Como el objetivo principal es squash y la semana tiene alto volumen, squash debe ocupar la mayoría de las sesiones.')
  }
  return lines
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

const SESSION_SCHEMA_BLOCK_MINIMAL = [
  '',
  '═══ ESQUEMA DE SESIÓN ═══',
  'Campos obligatorios por sesión:',
  '  date: "YYYY-MM-DD" dentro de la semana objetivo',
  '  timeBlock: "AM" | "PM"',
  '  sessionType: "squash" | "running" | "cycling" | "strength" | "mobility" | "recovery" | "nutrition"',
  '  title: string no vacío',
  '  durationMin: número entero >= 5',
  '  objective: string corto',
  '  rpe: número 1-10 (opcional pero recomendado)',
  '',
  'Campos opcionales por deporte:',
  '  squash → subtype: "training" | "match" | "competitive" | "control" | "light"',
  '  running → runningType: "z2" | "tempo" | "intervals" | "long"',
  '',
  'NO incluyas squashDetails, exercises, cyclingDetails ni mobilityDetails.',
  'La app genera automáticamente estos detalles según el contexto del plan.',
  'Si los incluyes y son válidos, se conservarán (best-effort).',
  '',
  'warmup y cooldown son opcionales; el sistema genera protocolos base si se omiten.',
  '',
].join('\n')

const SESSION_SCHEMA_BLOCK_FULL = [
  '',
  '═══ ESQUEMA DE SESIÓN (OBLIGATORIO SEGUIR LITERAL) ═══',
  'Campos base por sesión:',
  '  date: "YYYY-MM-DD" dentro de la semana objetivo',
  '  timeBlock: "AM" | "PM"',
  '  sessionType: "squash" | "running" | "cycling" | "strength" | "mobility" | "recovery" | "nutrition"',
  '  title: string no vacío',
  '  durationMin: número entero >= 5',
  '  objective: string corto',
  '  rpe: número 1-10 (opcional pero recomendado)',
  '',
  'Detalles obligatorios por deporte (si faltan, la sesión se descarta):',
  '',
  'Para sessionType="squash":',
  '  subtype: "training" | "match" | "competitive" | "control" | "light"',
  '  squashDetails es OBLIGATORIO con esta forma exacta:',
  '    {',
  '      "trainingFocus": "technical" | "tactical" | "physical" | "conditioned_games",',
  '      "sessionMode": "drill_session" | "practice_match" | "competition_match",',
  '      "sessionKind": "technical" | "control" | "shadows" | "match" | "mixed",',
  '      "drills": [ {"name": string, "durationMin": number, "notes"?: string}, ... ]   // al menos 1 drill, drills no puede ir vacío',
  '    }',
  '  Regla: drills[] debe tener al menos un elemento, incluso en partidos (usa un bloque descriptivo).',
  '  Para subtype="match" o "competitive" usa sessionMode="practice_match" (entrenamiento) o "competition_match" (partido real) y sessionKind="match".',
  '  Si sessionKind="mixed", añade blocks[] con { "kind": "technical"|"control"|"shadows"|"match", "drills": [...], "durationMin": number } y replica los drills también en el array plano drills[] para compatibilidad.',
  '  trainingFocus NO acepta "control" ni "shadows" (esos son sessionKind). Para sesiones de control usa trainingFocus="technical" o "tactical".',
  '',
  'Para sessionType="cycling":',
  '  cyclingDetails es OBLIGATORIO: {"sessionCategory": string, "targetStructure": string, "intensityReference"?: string, "executionNotes"?: string}',
  '  Si es intervalos o tempo, puedes añadir runningType y targetPace/targetHr para referencia.',
  '',
  'Para sessionType="running":',
  '  runningType: "z2" | "tempo" | "intervals" | "long" (recomendado)',
  '  targetPaceMin / targetPaceMax: string "m:ss" (opcional)',
  '  targetHrMin / targetHrMax: number (opcional)',
  '  Si runningType="intervals" o "tempo", añade intervalStructure:',
  '    {"blocks": [{"label": string, "durationMin"?: number, "distanceKm"?: number, "repetitions"?: number, "targetPace"?: string, "notes"?: string}, ...]}',
  '',
  'Para sessionType="strength":',
  '  exercises es OBLIGATORIO: array de {"name": string, "sets": number, "reps": number | string, "weight"?: number, "group"?: "push"|"pull"|"legs"|"core"|"olympic"|"mobility"|"other", "notes"?: string}',
  '',
  'Para sessionType="mobility":',
  '  mobilityDetails es OBLIGATORIO: {"focusAreas": string[], "context": "post_run"|"post_cycling"|"post_squash"|"post_strength"|"pre_training_activation"|"recovery"|"full_body"|"sport_specific", "targetStructure": string, "executionNotes"?: string}',
  '',
  'Para sessionType="recovery" o "nutrition": no requiere detalles extra, pero mantén title/objective claros.',
  '',
  'warmup y cooldown son opcionales; el sistema genera protocolos base si se omiten. No gastes tokens en ellos salvo que aporten.',
  '',
].join('\n')

export function buildWeekSystemPromptMinimal(): string {
  return [
    'Eres el generador de una sola semana dentro de un plan por evento ya estructurado.',
    'Respondes EXCLUSIVAMENTE con un bloque <actions> JSON que contenga UNA acción create_week para la semana indicada.',
    'No explicas nada fuera del bloque <actions>. Nada de texto previo ni posterior.',
    'La acción create_week debe tener exactamente "type": "create_week" como campo discriminador. Incluye además: targetDate (lunes YYYY-MM-DD), reason, sessions[] y weekObjectives[].',
    'Respeta strictamente la fase indicada, objetivos de carga y deportes permitidos.',
    'Debes respetar exactamente el número de sesiones pedido por el wizard y todas deben quedar dentro de los días permitidos.',
    'Nunca devuelvas menos sesiones que las pedidas. Si una sesión queda incompleta o inválida, corrígela antes de responder; no la omitas.',
    'Cada sesión debe ser individualmente válida: fecha ISO real, timeBlock AM/PM, title, durationMin >= 5.',
    'No inventes sesiones fuera de los días permitidos. No dupliques misma fecha+timeBlock.',
    SESSION_SCHEMA_BLOCK_MINIMAL,
  ].join('\n')
}

export function buildWeekSystemPrompt(): string {
  return [
    'Eres el generador de una sola semana dentro de un plan por evento ya estructurado.',
    'Respondes EXCLUSIVAMENTE con un bloque <actions> JSON que contenga UNA acción create_week para la semana indicada.',
    'No explicas nada fuera del bloque <actions>. Nada de texto previo ni posterior.',
    'La acción create_week debe tener exactamente "type": "create_week" como campo discriminador. Incluye además: targetDate (lunes YYYY-MM-DD), reason, sessions[] y weekObjectives[].',
    'Respeta strictamente la fase indicada, objetivos de carga y deportes permitidos.',
    'Debes respetar exactamente el número de sesiones pedido por el wizard y todas deben quedar dentro de los días permitidos.',
    'Nunca devuelvas menos sesiones que las pedidas. Si una sesión queda incompleta o inválida, corrígela antes de responder; no la omitas.',
    'Cada sesión debe ser individualmente válida: fecha ISO real, timeBlock AM/PM, title, durationMin >= 5 y detalles obligatorios del deporte.',
    'No inventes sesiones fuera de los días permitidos. No dupliques misma fecha+timeBlock.',
    SESSION_SCHEMA_BLOCK_FULL,
    'Revisa dos veces antes de responder: cada squash lleva squashDetails válido con drills[] no vacío; cada cycling lleva cyclingDetails; cada mobility lleva mobilityDetails; cada strength lleva exercises[]. Si una sesión no cumple, corrígela — no la descartes.',
  ].join('\n')
}

export function buildWeekBatchSystemPromptMinimal(): string {
  return [
    'Eres el generador de DOS semanas consecutivas dentro de un plan por evento ya estructurado.',
    'Respondes EXCLUSIVAMENTE con un bloque <actions> JSON que contenga EXACTAMENTE DOS acciones create_week, una por cada lunes objetivo.',
    'No explicas nada fuera del bloque <actions>. Nada de texto previo ni posterior.',
    'Cada create_week debe tener exactamente "type": "create_week" como campo discriminador. Incluye además: targetDate (lunes YYYY-MM-DD), reason, sessions[] y weekObjectives[].',
    'Respeta estrictamente la fase indicada, objetivos de carga y deportes permitidos.',
    'Nunca devuelvas menos sesiones que las pedidas para una semana. Si una sesión queda incompleta o inválida, corrígela antes de responder; no la omitas.',
    'Cada sesión debe ser individualmente válida: fecha ISO real, timeBlock AM/PM, title, durationMin >= 5.',
    'No inventes sesiones fuera de los días permitidos. No dupliques misma fecha+timeBlock dentro de cada semana.',
    'Nunca mezcles sesiones de una semana dentro de la otra. targetDate y fechas deben coincidir exactamente con cada semana pedida.',
    SESSION_SCHEMA_BLOCK_MINIMAL,
  ].join('\n')
}

export function buildWeekBatchSystemPrompt(): string {
  return [
    'Eres el generador de DOS semanas consecutivas dentro de un plan por evento ya estructurado.',
    'Respondes EXCLUSIVAMENTE con un bloque <actions> JSON que contenga EXACTAMENTE DOS acciones create_week, una por cada lunes objetivo.',
    'No explicas nada fuera del bloque <actions>. Nada de texto previo ni posterior.',
    'Cada create_week debe tener exactamente "type": "create_week" como campo discriminador. Incluye además: targetDate (lunes YYYY-MM-DD), reason, sessions[] y weekObjectives[].',
    'Respeta estrictamente la fase indicada, objetivos de carga y deportes permitidos.',
    'Nunca devuelvas menos sesiones que las pedidas para una semana. Si una sesión queda incompleta o inválida, corrígela antes de responder; no la omitas.',
    'Cada sesión debe ser individualmente válida: fecha ISO real, timeBlock AM/PM, title, durationMin >= 5 y detalles obligatorios del deporte.',
    'No inventes sesiones fuera de los días permitidos. No dupliques misma fecha+timeBlock dentro de cada semana.',
    'Nunca mezcles sesiones de una semana dentro de la otra. targetDate y fechas deben coincidir exactamente con cada semana pedida.',
    SESSION_SCHEMA_BLOCK_FULL,
    'Revisa dos veces antes de responder: cada squash lleva squashDetails válido con drills[] no vacío; cada cycling lleva cyclingDetails; cada mobility lleva mobilityDetails; cada strength lleva exercises[]. Si una sesión no cumple, corrígela — no la descartes.',
  ].join('\n')
}

export function buildWeekUserPrompt(input: WeekPromptInput): string {
  const { plan, week, previousWeek, profile, wizardConfig, retryInstruction, strictFormatting } = input
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
    `- Regla crítica de cantidad: devuelve EXACTAMENTE ${wizardConfig.sessionsPerWeek} sesiones para esta semana.`,
    `- Duración por sesión: ${wizardConfig.sessionDurationMins} min`,
    `- Doble sesión permitido: ${wizardConfig.allowDoubleSession ? 'sí' : 'no'}`,
    wizardConfig.allowDoubleSession
      ? '- Puedes usar AM y PM el mismo día si ayuda a cumplir el volumen, sin duplicar el mismo bloque.'
      : '- Como doble sesión NO está permitido, reparte las sesiones entre días permitidos sin repetir un mismo día.',
    `- Nivel actual: ${wizardConfig.currentFitnessLevel} · Fatiga: ${wizardConfig.currentFatigue}`,
    `- Deportes permitidos: ${allowed.join(', ')}`,
    `- Carga objetivo por deporte: ${targetLoads}`,
    ...buildPrimarySportRule(plan, week),
    wizardConfig.injuryNotes ? `- Lesiones/restricciones: ${wizardConfig.injuryNotes}` : '',
    '',
    briefPreviousWeek(previousWeek),
    '',
    retryInstruction ? `Corrección del intento anterior:\n${retryInstruction}\n` : '',
    strictFormatting ? 'Modo estricto: si dudas, prioriza fechas válidas, targetDate correcto, sesiones completas y exactamente la cantidad pedida antes que creatividad.' : '',
    '',
    'Devuelve sólo el bloque <actions> con una única create_week para esta semana.',
  ].filter(Boolean).join('\n')
}

export function buildWeekBatchUserPrompt(input: WeekBatchPromptInput): string {
  const { plan, weeks, previousWeek, profile, wizardConfig, retryInstruction, strictFormatting } = input
  const allowed = allowedSportsList(plan, wizardConfig)
  const days = wizardConfig.trainingDays.join(', ')
  const primarySport = getPrimarySport(plan)
  const weeksText = weeks.map((week) => {
    const targetLoads = Object.entries(week.targetLoadBySport)
      .map(([sport, load]) => `${sport}: ${load}`)
      .join(', ')
    const blockFocus = plan.phases.find((p) => week.weekIndex >= p.startWeekIndex && week.weekIndex <= p.endWeekIndex)?.blockFocus ?? ''
    const primarySportRule = buildPrimarySportRule(plan, week)
    return [
      `Semana ${week.weekIndex + 1}/${plan.totalWeeks}`,
      `- Lunes objetivo: ${week.weekStartDate}`,
      `- Fase: ${PHASE_LABEL[week.phase] ?? week.phase}`,
      `- Foco del bloque: ${blockFocus}`,
      `- Carga objetivo por deporte: ${targetLoads}`,
      `- Objetivos: ${week.weekObjectives.map((objective) => objective.goal).join(' | ')}`,
      ...primarySportRule,
    ].join('\n')
  }).join('\n\n')

  return [
    `Generar dos semanas consecutivas del plan "${plan.title}".`,
    `Evento principal: ${plan.macroSnapshot.goalEventDate}.`,
    '',
    briefAthlete(profile),
    '',
    'Configuración del wizard:',
    `- Días permitidos: ${days}`,
    `- Sesiones por semana: ${wizardConfig.sessionsPerWeek}`,
    `- Regla crítica de cantidad: cada semana debe tener EXACTAMENTE ${wizardConfig.sessionsPerWeek} sesiones.`,
    `- Duración por sesión: ${wizardConfig.sessionDurationMins} min`,
    `- Doble sesión permitido: ${wizardConfig.allowDoubleSession ? 'sí' : 'no'}`,
    wizardConfig.allowDoubleSession
      ? '- Puedes usar AM y PM el mismo día si ayuda a cumplir el volumen, sin duplicar el mismo bloque dentro de una semana.'
      : '- Como doble sesión NO está permitido, reparte las sesiones de cada semana entre días permitidos sin repetir un mismo día.',
    `- Nivel actual: ${wizardConfig.currentFitnessLevel} · Fatiga: ${wizardConfig.currentFatigue}`,
    `- Deportes permitidos: ${allowed.join(', ')}`,
    primarySport ? `- Deporte principal transversal: ${primarySport}` : '',
    wizardConfig.injuryNotes ? `- Lesiones/restricciones: ${wizardConfig.injuryNotes}` : '',
    '',
    briefPreviousWeek(previousWeek),
    '',
    weeksText,
    '',
    retryInstruction ? `Corrección del intento anterior:\n${retryInstruction}\n` : '',
    strictFormatting ? 'Modo estricto: devuelve exactamente dos create_week, una por cada targetDate indicado, sin mezclar fechas entre semanas y con la cantidad exacta de sesiones válidas por semana.' : '',
    '',
    'Devuelve sólo el bloque <actions> con exactamente dos create_week, una para cada semana pedida.',
  ].filter(Boolean).join('\n')
}
