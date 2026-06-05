import type { AthleteProfile, PlanWizardConfig, SupportedSport } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { buildWeekCreatorCoachContract } from '../../ai/prompt/core/coachContract'
import { ACTION_CONTRACTS } from '../../ai/prompt/core/outputContract'
import { buildStrengthLoadPack } from '../../ai/prompt/packs/quality/strengthLoad'
import { renderActionAsProse } from '../../ai/prompt/renderers/proseSchema'
import { getExpectedSessionsForPlanWeek, getPlanWeekDateRange } from '../../planBuilder/dateRange'
import { renderPlanBuilderRecentContext, type PlanBuilderRecentContext } from '../../planBuilder/recentContext'

export interface WeekPromptInput {
  plan: TrainingPlan
  week: TrainingPlanWeek
  previousWeek?: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  retryInstruction?: string
  strictFormatting?: boolean
  outputFormat?: 'actions' | 'json'
  recentContext?: PlanBuilderRecentContext
}

export interface WeekBatchPromptInput {
  plan: TrainingPlan
  weeks: [TrainingPlanWeek, TrainingPlanWeek]
  previousWeek?: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  retryInstruction?: string
  strictFormatting?: boolean
  outputFormat?: 'actions' | 'json'
  recentContext?: PlanBuilderRecentContext
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

  const expectedSessions = getExpectedSessionsForPlanWeek(plan, week)
  const minimumSessions = requiredPrimarySessions(primarySport, week.phase, expectedSessions)
  const emphasis =
    week.phase === 'build' || week.phase === 'peak'
      ? ` ${primarySport} debe tener más protagonismo que los deportes de apoyo.`
      : ''

  const sessionLabel = minimumSessions > 1 ? 'sesiones' : 'sesión'
  lines.push(`- Regla crítica: incluye al menos ${minimumSessions} ${sessionLabel} de ${primarySport} dentro de esta semana.${emphasis}`)
  if (primarySport === 'squash' && (week.phase === 'build' || week.phase === 'peak') && expectedSessions >= 4) {
    lines.push(`- Para squash en fase ${week.phase} con ${expectedSessions} sesiones efectivas, usa mayoría real de squash: mínimo ${minimumSessions} sesiones squash y máximo ${expectedSessions - minimumSessions} accesorias.`)
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

const SESSION_SCHEMA_BLOCK_MINIMAL = renderActionAsProse(ACTION_CONTRACTS.create_week, 'minimal')
const SESSION_SCHEMA_BLOCK_FULL = renderActionAsProse(ACTION_CONTRACTS.create_week, 'full')

type WeekSystemPromptMode = 'single' | 'standalone' | 'batch'
type WeekSystemPromptDensity = 'minimal' | 'full'

interface WeekSystemPromptOptions {
  mode: WeekSystemPromptMode
  density: WeekSystemPromptDensity
}

function buildWeekSystemPromptBase(options: WeekSystemPromptOptions): string {
  const fullSchema = options.density === 'full'
  const batchMode = options.mode === 'batch'
  const standaloneMode = options.mode === 'standalone'
  const lines = standaloneMode
    ? buildWeekCreatorCoachContract()
    : [
        batchMode
          ? 'Eres el generador de DOS semanas consecutivas dentro de un plan por evento ya estructurado.'
          : 'Eres el generador de una sola semana dentro de un plan por evento ya estructurado.',
        batchMode
          ? 'Respondes EXCLUSIVAMENTE con un bloque <actions> JSON que contenga EXACTAMENTE DOS acciones create_week, una por cada lunes objetivo.'
          : 'Respondes EXCLUSIVAMENTE con un bloque <actions> JSON que contenga UNA acción create_week para la semana indicada.',
        'No explicas nada fuera del bloque <actions>. Nada de texto previo ni posterior.',
        batchMode
          ? 'Cada create_week debe tener exactamente "type": "create_week" como campo discriminador. Incluye además: targetDate (lunes YYYY-MM-DD), reason, sessions[] y weekObjectives[].'
          : 'La acción create_week debe tener exactamente "type": "create_week" como campo discriminador. Incluye además: targetDate (lunes YYYY-MM-DD), reason, sessions[] y weekObjectives[].',
        batchMode
          ? 'Respeta estrictamente la fase indicada, objetivos de carga y deportes permitidos.'
          : 'Respeta strictamente la fase indicada, objetivos de carga y deportes permitidos.',
        batchMode
          ? 'Nunca devuelvas menos sesiones que las pedidas para una semana. Si una sesión queda incompleta o inválida, corrígela antes de responder; no la omitas.'
          : 'Debes respetar exactamente el número de sesiones pedido por el wizard y todas deben quedar dentro de los días permitidos.',
        batchMode
          ? `Cada sesión debe ser individualmente válida: fecha ISO real, timeBlock AM/PM, title, durationMin >= 5${fullSchema ? ' y detalles obligatorios del deporte' : ''}.`
          : 'Nunca devuelvas menos sesiones que las pedidas. Si una sesión queda incompleta o inválida, corrígela antes de responder; no la omitas.',
        batchMode
          ? 'No inventes sesiones fuera de los días permitidos. No dupliques misma fecha+timeBlock dentro de cada semana.'
          : `Cada sesión debe ser individualmente válida: fecha ISO real, timeBlock AM/PM, title, durationMin >= 5${fullSchema ? ' y detalles obligatorios del deporte' : ''}.`,
        batchMode
          ? 'Nunca mezcles sesiones de una semana dentro de la otra. targetDate y fechas deben coincidir exactamente con cada semana pedida.'
          : 'No inventes sesiones fuera de los días permitidos. No dupliques misma fecha+timeBlock.',
      ]

  // Batch mode: schema is delivered via responseSchema API parameter — no need to embed it in text.
  const schemaBlock = batchMode
    ? ''
    : fullSchema
      ? SESSION_SCHEMA_BLOCK_FULL
      : SESSION_SCHEMA_BLOCK_MINIMAL

  return [
    ...lines,
    schemaBlock,
    standaloneMode
      ? 'La app completará detalles deportivos avanzados cuando falten. Prioriza devolver una create_week parseable, completa y coherente.'
      : '',
    fullSchema && !batchMode
      ? 'Revisa dos veces antes de responder: cada squash lleva squashDetails válido con drills[] no vacío; cada cycling lleva cyclingDetails; cada mobility lleva mobilityDetails; cada strength lleva exercises[]. Si una sesión no cumple, corrígela — no la descartes.'
      : '',
  ].filter(Boolean).join('\n')
}

export function buildWeekSystemPromptMinimal(): string {
  return buildWeekSystemPromptBase({ mode: 'single', density: 'minimal' })
}

export function buildWeekStructuredSystemPromptMinimal(): string {
  return [
    'Eres el generador de una sola semana dentro de un plan por evento ya estructurado.',
    'Responde SOLO con un objeto JSON que cumpla el responseSchema configurado por la app. Sin markdown, sin texto fuera, sin wrappers XML.',
    'El objeto debe ser una create_week: type="create_week", targetDate (lunes YYYY-MM-DD), reason, sessions[] y weekObjectives[].',
    'Respeta exactamente el targetDate, el rango válido de fechas, los días permitidos, deportes permitidos y cantidad de sesiones pedida.',
    'Cada sesión debe ser válida: date ISO dentro de la semana, timeBlock AM/PM, sessionType permitido, title, objective y durationMin>=5.',
    'No devuelvas menos sesiones que las pedidas. Si una sesión queda incompleta, corrígela antes de responder.',
  ].join('\n')
}

export function buildWeekSystemPrompt(): string {
  return buildWeekSystemPromptBase({ mode: 'single', density: 'full' })
}

export function buildWeekCreatorSystemPrompt(): string {
  return buildWeekSystemPromptBase({ mode: 'standalone', density: 'minimal' })
}

export function buildWeekBatchStructuredSystemPromptMinimal(): string {
  return [
    'Eres el generador de DOS semanas consecutivas dentro de un plan por evento ya estructurado.',
    'Responde SOLO con un objeto JSON que cumpla el responseSchema configurado por la app. Sin markdown, sin texto fuera, sin wrappers XML.',
    'El objeto debe tener actions[] con EXACTAMENTE DOS create_week, una por cada lunes objetivo.',
    'Cada create_week debe incluir type="create_week", targetDate (lunes YYYY-MM-DD), reason, sessions[] y weekObjectives[].',
    'Respeta el targetDate, rango válido, días permitidos, deportes permitidos y cantidad de sesiones pedida para cada semana.',
    'Nunca mezcles sesiones de una semana dentro de la otra. Nunca devuelvas menos sesiones que las pedidas.',
  ].join('\n')
}

export function buildWeekBatchSystemPrompt(): string {
  return buildWeekSystemPromptBase({ mode: 'batch', density: 'full' })
}

export function buildWeekUserPrompt(input: WeekPromptInput): string {
  const { plan, week, previousWeek, profile, wizardConfig, retryInstruction, strictFormatting } = input
  const outputFormat = input.outputFormat ?? 'actions'
  const allowed = allowedSportsList(plan, wizardConfig)
  const validRange = getPlanWeekDateRange(plan, week)
  const expectedSessions = getExpectedSessionsForPlanWeek(plan, week)
  const targetLoads = Object.entries(week.targetLoadBySport)
    .map(([sport, load]) => `${sport}: ${load}`)
    .join(', ')
  const days = wizardConfig.trainingDays.join(', ')

  const allowsStrength = allowed.includes('strength')
  const strengthLoadSection = allowsStrength
    ? buildStrengthLoadPack({ strengthProfile: profile.strengthProfile })
    : ''
  const strengthStructureSection = allowsStrength ? buildStrengthStructureSection() : ''

  return [
    `Generar semana ${week.weekIndex + 1} de ${plan.totalWeeks} del plan "${plan.title}".`,
    `Evento principal: ${plan.macroSnapshot.goalEventDate} · Fase: ${PHASE_LABEL[week.phase] ?? week.phase}`,
    `Semana que empieza el lunes ${week.weekStartDate}.`,
    `Rango válido para sesiones de esta semana: ${validRange.startDate} a ${validRange.endDate}. No programes entrenamientos antes de ${validRange.startDate} ni después de ${validRange.endDate}.`,
    `Foco del bloque: ${plan.phases.find((p) => week.weekIndex >= p.startWeekIndex && week.weekIndex <= p.endWeekIndex)?.blockFocus ?? ''}`,
    '',
    briefAthlete(profile),
    '',
    `Configuración del wizard:`,
    `- Días permitidos: ${days}`,
    `- Sesiones por semana: ${wizardConfig.sessionsPerWeek}`,
    expectedSessions === wizardConfig.sessionsPerWeek
      ? `- Regla crítica de cantidad: devuelve EXACTAMENTE ${expectedSessions} sesiones para esta semana.`
      : `- Regla crítica de cantidad: esta semana tiene rango parcial; devuelve EXACTAMENTE ${expectedSessions} sesiones válidas, no ${wizardConfig.sessionsPerWeek}.`,
    `- Duración por sesión: ${wizardConfig.sessionDurationMins} min`,
    `- Doble sesión permitido: ${wizardConfig.allowDoubleSession ? 'sí' : 'no'}`,
    wizardConfig.allowDoubleSession
      ? '- Puedes usar AM y PM el mismo día si ayuda a cumplir el volumen, sin duplicar el mismo bloque.'
      : '- Como doble sesión NO está permitido, reparte las sesiones entre días permitidos sin repetir un mismo día.',
    ...buildDoubleSessionPreferenceRule(wizardConfig, week.phase),
    `- Nivel actual: ${wizardConfig.currentFitnessLevel} · Fatiga: ${wizardConfig.currentFatigue}`,
    `- Deportes permitidos: ${allowed.join(', ')}`,
    `- Carga objetivo por deporte: ${targetLoads}`,
    ...buildPrimarySportRule(plan, week),
    ...buildRaceWeekRule(plan, week),
    ...buildSquashCompetitionRules(plan, week),
    ...buildSquashStrengthThemeRule(plan, wizardConfig),
    wizardConfig.injuryNotes ? `- Lesiones/restricciones: ${wizardConfig.injuryNotes}` : '',
    '',
    briefPreviousWeek(previousWeek),
    '',
    renderPlanBuilderRecentContext(input.recentContext),
    '',
    retryInstruction ? `Corrección del intento anterior:\n${retryInstruction}\n` : '',
    strictFormatting ? 'Modo estricto: si dudas, prioriza fechas válidas, targetDate correcto, sesiones completas y exactamente la cantidad pedida antes que creatividad.' : '',
    strengthStructureSection,
    strengthLoadSection,
    '',
    outputFormat === 'json'
      ? 'Devuelve sólo un objeto JSON create_week para esta semana. No uses wrappers XML, markdown ni texto explicativo.'
      : 'Devuelve sólo el bloque <actions> con una única create_week para esta semana.',
  ].filter(Boolean).join('\n')
}

function buildDoubleSessionPreferenceRule(
  wizardConfig: PlanWizardConfig,
  phase: TrainingPlanWeek['phase'],
): string[] {
  if (!wizardConfig.allowDoubleSession) return []
  if (phase === 'race' || phase === 'taper' || wizardConfig.currentFatigue === 'overloaded') return []

  const hasEnoughVolumeForPreference = wizardConfig.sessionsPerWeek >= 5
  const canCreateRestDay = wizardConfig.sessionsPerWeek <= wizardConfig.trainingDays.length
  if (!hasEnoughVolumeForPreference || !canCreateRestDay) return []

  return [
    '- Preferencia de distribucion: como el usuario habilito doble sesion y hay volumen suficiente, usa al menos 1 dia doble AM/PM en esta semana y deja 1 dia permitido libre como descarga. Evita juntar dos estimulos duros el mismo dia; combina tecnica/skill con fuerza soporte, movilidad o aerobico suave.',
  ]
}

function buildSquashStrengthThemeRule(
  plan: TrainingPlan,
  wizardConfig: PlanWizardConfig,
): string[] {
  const primarySport = getPrimarySport(plan)
  const allowedSports = allowedSportsList(plan, wizardConfig)

  if (
    primarySport !== 'squash' ||
    !allowedSports.includes('strength') ||
    wizardConfig.sessionsPerWeek < 3
  ) {
    return []
  }

  return [
    '- Si esta semana asigna 3-4 sesiones de fuerza para el atleta de squash, distribuye los focos asi: dia de fuerza mas temprano -> olimpico + sentadilla; segundo dia de fuerza -> press + estocadas unilaterales; tercer dia -> peso muerto/hinge + cadena posterior; cuarto dia, si existe -> velocidad/footwork + plio ligera. Esta es una plantilla de referencia: si fase, fatiga o competencia lo desaconsejan, ajustala y explicita el cambio en objective o title.',
  ]
}

export function buildWeekBatchUserPrompt(input: WeekBatchPromptInput): string {
  const { plan, weeks, previousWeek, profile, wizardConfig, retryInstruction, strictFormatting } = input
  const outputFormat = input.outputFormat ?? 'actions'
  const allowed = allowedSportsList(plan, wizardConfig)
  const days = wizardConfig.trainingDays.join(', ')
  const primarySport = getPrimarySport(plan)
  const anyStrength = allowed.includes('strength')
    && weeks.some((w) => (w.targetLoadBySport.strength ?? 0) > 0)
  const weeksText = weeks.map((week) => {
    const validRange = getPlanWeekDateRange(plan, week)
    const expectedSessions = getExpectedSessionsForPlanWeek(plan, week)
    const targetLoads = Object.entries(week.targetLoadBySport)
      .map(([sport, load]) => `${sport}: ${load}`)
      .join(', ')
    const blockFocus = plan.phases.find((p) => week.weekIndex >= p.startWeekIndex && week.weekIndex <= p.endWeekIndex)?.blockFocus ?? ''
    const primarySportRule = buildPrimarySportRule(plan, week)
    return [
      `Semana ${week.weekIndex + 1}/${plan.totalWeeks}`,
      `- Lunes objetivo: ${week.weekStartDate}`,
      `- Rango válido de sesiones: ${validRange.startDate} a ${validRange.endDate}. No uses fechas fuera de ese rango.`,
      `- Cantidad efectiva para esta semana: EXACTAMENTE ${expectedSessions} sesiones.`,
      `- Fase: ${PHASE_LABEL[week.phase] ?? week.phase}`,
      `- Foco del bloque: ${blockFocus}`,
      `- Carga objetivo por deporte: ${targetLoads}`,
      `- Objetivos: ${week.weekObjectives.map((objective) => objective.goal).join(' | ')}`,
      ...primarySportRule,
      ...buildRaceWeekRule(plan, week),
      ...buildSquashCompetitionRules(plan, week),
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
    '- Regla crítica de cantidad: cada semana debe respetar su cantidad efectiva indicada abajo; si el rango es parcial puede ser menor que el valor base del wizard.',
    `- Duración por sesión: ${wizardConfig.sessionDurationMins} min`,
    `- Doble sesión permitido: ${wizardConfig.allowDoubleSession ? 'sí' : 'no'}`,
    wizardConfig.allowDoubleSession
      ? '- Puedes usar AM y PM el mismo día si ayuda a cumplir el volumen, sin duplicar el mismo bloque dentro de una semana.'
      : '- Como doble sesión NO está permitido, reparte las sesiones de cada semana entre días permitidos sin repetir un mismo día.',
    ...buildDoubleSessionPreferenceRule(wizardConfig, weeks[0].phase),
    `- Nivel actual: ${wizardConfig.currentFitnessLevel} · Fatiga: ${wizardConfig.currentFatigue}`,
    `- Deportes permitidos: ${allowed.join(', ')}`,
    primarySport ? `- Deporte principal transversal: ${primarySport}` : '',
    wizardConfig.injuryNotes ? `- Lesiones/restricciones: ${wizardConfig.injuryNotes}` : '',
    '',
    briefPreviousWeek(previousWeek),
    '',
    renderPlanBuilderRecentContext(input.recentContext),
    '',
    weeksText,
    '',
    retryInstruction ? `Corrección del intento anterior:\n${retryInstruction}\n` : '',
    strictFormatting ? 'Modo estricto: devuelve exactamente dos create_week, una por cada targetDate indicado, sin mezclar fechas entre semanas y con la cantidad exacta de sesiones válidas por semana.' : '',
    anyStrength ? buildStrengthStructureSection() : '',
    anyStrength ? buildStrengthLoadPack({ strengthProfile: profile.strengthProfile }) : '',
    '',
    outputFormat === 'json'
      ? 'Devuelve sólo un objeto JSON con actions[] y exactamente dos create_week, una para cada semana pedida. No uses wrappers XML, markdown ni texto explicativo.'
      : 'Devuelve sólo el bloque <actions> con exactamente dos create_week, una para cada semana pedida.',
  ].filter(Boolean).join('\n')
}

function buildStrengthStructureSection(): string {
  return [
    'ESTRUCTURA DE FUERZA',
    '- Para cada sesión de fuerza normal de 45+ min usa esta secuencia: warm-up/activación -> zona media -> fuerza principal -> accesorios/transferencia -> cardio específico opcional -> cooldown/movilidad.',
    '- Warm-up tipo preparador físico: puede ser principalmente movilidad/prep de tejidos y rango (foam roller o movilidad de gemelos, isquios, glúteos, aductores, cuádriceps, espalda alta, cadera, tobillo, torácica y hombro), más series de aproximación. No lo mezcles con zona media.',
    '- Para sesiones de 60 min busca densidad útil: 2 ejercicios de zona media + 4-5 ejercicios de fuerza/accesorios/correctivos + 0-1 cardio específico si aplica. No entregues sólo 2-3 ejercicios de fuerza para una sesión de una hora.',
    '- Zona media debe ser explícita y aparecer antes de los ejercicios principales: 1-2 ejercicios tipo dead bug, plancha frontal, Pallof, plancha lateral, Copenhagen, fitball plank o chop controlado.',
    '- No cuentes remos medio arrodillados, lunges o bisagras como único core aunque tengan demanda de tronco; si los usas, agrega un core real cuando la duración lo permita.',
    '- Para squash prioriza anti-extensión, anti-rotación y estabilidad lateral.',
    '- En retorno de lesión o fitness returning: conserva una estructura completa, pero usa RPE 6-7, tempo controlado, ejercicios de bajo riesgo y evita impacto agresivo o volumen que deje DOMS fuerte.',
    '- Cardio específico opcional va al final: escalera/footwork, bici de asalto 30s on/30s off por 4 min, o trotadora de aire 20s on/20s off por 4 min. Usa 1 bloque por defecto; 2 sólo si está fresco y la sesión dura 65+ min.',
  ].join('\n')
}

function buildRaceWeekRule(plan: TrainingPlan, week: TrainingPlanWeek): string[] {
  if (week.phase !== 'race') return []
  return [
    `- Regla crítica de semana Race: marca el evento principal el ${plan.macroSnapshot.goalEventDate} como sesión/competencia si cae dentro de esta semana.`,
    '- Si el deporte principal es squash, el día del evento debe ser squash match/competencia; no programes running/cycling ese mismo día.',
    '- Incluye 1-2 activaciones cortas antes del evento en días permitidos previos al evento; no pongas toda la semana después del evento.',
    '- Después del evento usa solo recuperación o movilidad suave. El objetivo de la fase es llegar fresco al evento, no empezar el plan post-evento.',
  ]
}

function buildSquashCompetitionRules(plan: TrainingPlan, week: TrainingPlanWeek): string[] {
  if (getPrimarySport(plan) !== 'squash') return []

  if (week.phase === 'build' || week.phase === 'peak') {
    return [
      '- Regla squash competitivo: running/cycling son soporte, no estímulo principal. Si incluyes running, debe ser Z2 corto <=45min, RPE <=5. No uses tempo, intervalos, long run ni test de carrera.',
      '- En peak de squash, la intensidad alta debe venir de squash específico: pressure drills, control bajo fatiga, patrones a la T, puntos condicionados o match-play controlado.',
    ]
  }

  if (week.phase === 'taper') {
    return [
      '- Regla taper squash: reduce de verdad la carga. Prioriza 2-3 toques de squash cortos/calidad, 0-1 fuerza neural corta, movilidad. Running sólo si es activación Z2/recovery <=25min RPE <=3; cycling evita salvo recuperación muy justificada.',
      '- No rellenes taper con dobles ligeros repetidos. Cada sesión debe tener un propósito competitivo claro: frescura, precisión, timing, movilidad o activación neural.',
    ]
  }

  if (week.phase === 'race') {
    return [
      '- Regla race squash: el evento manda. Devuelve una sesión squash match/competitive el día del torneo y, como máximo, movilidad/activación muy suave alrededor. No agregues running/cycling de soporte.',
    ]
  }

  return []
}
