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

  const minimumSessions = requiredPrimarySessions(primarySport, week.phase, plan.wizardConfig.sessionsPerWeek)
  const emphasis =
    week.phase === 'build' || week.phase === 'peak'
      ? ` ${primarySport} debe tener más protagonismo que los deportes de apoyo.`
      : ''

  const sessionLabel = minimumSessions > 1 ? 'sesiones' : 'sesión'
  lines.push(`- Regla crítica: incluye al menos ${minimumSessions} ${sessionLabel} de ${primarySport} dentro de esta semana.${emphasis}`)
  if (primarySport === 'squash' && (week.phase === 'build' || week.phase === 'peak') && plan.wizardConfig.sessionsPerWeek >= 4) {
    lines.push(`- Para squash en fase ${week.phase} con ${plan.wizardConfig.sessionsPerWeek} sesiones, usa mayoría real de squash: mínimo ${minimumSessions} sesiones squash y máximo ${plan.wizardConfig.sessionsPerWeek - minimumSessions} accesorias.`)
  }
  return lines
}

function requiredPrimarySessions(
  primarySport: SupportedSport,
  phase: TrainingPlanWeek['phase'],
  sessionsPerWeek: number,
): number {
  if (phase === 'transition') return 0
  if (primarySport === 'squash' && (phase === 'build' || phase === 'peak')) {
    return Math.max(2, Math.floor(sessionsPerWeek / 2) + 1)
  }
  if (phase === 'build' || phase === 'peak') return 1
  return 1
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

export function buildWeekCreatorSystemPrompt(): string {
  return [
    'Eres un generador de semanas de entrenamiento.',
    'Puedes crear una semana standalone desde el chat o una semana alineada a un plan/evento cuando ese contexto exista.',
    'Respondes EXCLUSIVAMENTE con un bloque <actions> JSON que contenga UNA acción create_week para la semana indicada.',
    'Tu primer caracter debe ser "<" y tu último texto debe ser "</actions>".',
    'No explicas nada fuera del bloque <actions>. Nada de texto previo ni posterior.',
    'La acción create_week debe tener exactamente "type": "create_week" como campo discriminador. Incluye además: targetDate (lunes YYYY-MM-DD), reason, sessions[] y weekObjectives[].',
    'Formato obligatorio, reemplazando los valores por la semana solicitada: <actions>[{"type":"create_week","targetDate":"YYYY-MM-DD","reason":"...","sessions":[{"date":"YYYY-MM-DD","timeBlock":"AM","sessionType":"running","title":"...","durationMin":45,"objective":"...","rpe":5}],"weekObjectives":["..."]}]</actions>',
    'Respeta estrictamente la configuración disponible: días permitidos, número de sesiones, duración, deportes permitidos, fatiga, fitness y restricciones.',
    'Si no hay evento competitivo activo, planifica una semana general coherente con el perfil y la disponibilidad; no respondas con texto libre.',
    'Debes respetar exactamente el número de sesiones pedido por la configuración y todas deben quedar dentro de los días permitidos.',
    'Nunca devuelvas menos sesiones que las pedidas. Si una sesión queda incompleta o inválida, corrígela antes de responder; no la omitas.',
    'Cada sesión debe ser individualmente válida: fecha ISO real, timeBlock AM/PM, title y durationMin >= 5.',
    'No inventes sesiones fuera de los días permitidos. No dupliques misma fecha+timeBlock.',
    SESSION_SCHEMA_BLOCK_MINIMAL,
    'La app completará detalles deportivos avanzados cuando falten. Prioriza devolver una create_week parseable, completa y coherente.',
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
    ...buildRaceWeekRule(plan, week),
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
      ...buildRaceWeekRule(plan, week),
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

function buildRaceWeekRule(plan: TrainingPlan, week: TrainingPlanWeek): string[] {
  if (week.phase !== 'race') return []
  return [
    `- Regla crítica de semana Race: marca el evento principal el ${plan.macroSnapshot.goalEventDate} como sesión/competencia si cae dentro de esta semana.`,
    '- Incluye 1-2 activaciones cortas antes del evento en días permitidos previos al evento; no pongas toda la semana después del evento.',
    '- Después del evento usa solo recuperación o movilidad suave. El objetivo de la fase es llegar fresco al evento, no empezar el plan post-evento.',
  ]
}
