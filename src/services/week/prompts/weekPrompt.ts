import type { AthleteProfile, PlanWizardConfig, SupportedSport } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { buildWeekCreatorCoachContract } from '../../ai/prompt/core/coachContract'
import { ACTION_CONTRACTS } from '../../ai/prompt/core/outputContract'
import { buildStrengthLoadPack } from '../../ai/prompt/packs/quality/strengthLoad'
import { renderActionAsProse } from '../../ai/prompt/renderers/proseSchema'
import { getExpectedSessionsForPlanWeek, getPlanWeekDateRange } from '../../planBuilder/dateRange'
import { renderPlanBuilderRecentContext, type PlanBuilderRecentContext } from '../../planBuilder/recentContextRender'

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
  const minimumSessions = requiredPrimarySessions(primarySport, week, expectedSessions)
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
  week: TrainingPlanWeek,
  sessionsPerWeek: number,
): number {
  const phase = week.phase
  if (phase === 'transition') return 0
  if (primarySport === 'squash' && (phase === 'build' || phase === 'peak')) {
    const loadedSupportSports = (['running', 'strength', 'cycling', 'mobility'] as SupportedSport[])
      .filter((sport) => (week.targetLoadBySport[sport] ?? 0) > 0)
      .length
    if (loadedSupportSports >= 2 && sessionsPerWeek >= 4) {
      return Math.max(2, Math.floor(sessionsPerWeek / 2))
    }
    return Math.max(2, Math.floor(sessionsPerWeek / 2) + 1)
  }
  if (phase === 'build' || phase === 'peak') return 1
  return 1
}

function briefPreviousWeek(previous: TrainingPlanWeek | undefined): string {
  if (!previous) return 'No hay semana previa (es la primera).'
  if (previous.sessions.length === 0) {
    return 'Semana previa aún sin detalle (generándose en paralelo): no clones estructuras típicas de la fase; varía drills y ejercicios.'
  }
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
    'Cada sesión debe ser válida: date ISO dentro de la semana, timeBlock AM/PM, sessionType permitido, title, objective, durationMin>=5 y rpe entero entre 1 y 10.',
    'Devuelve sólo el esqueleto semanal compacto. No incluyas exercises, squashDetails, cyclingDetails, mobilityDetails, intervalStructure, warmup ni cooldown: la app hidrata los detalles deportivos y agrega protocolos base al aceptar el plan.',
    'No devuelvas menos sesiones que las pedidas. Si una sesión queda incompleta, corrígela antes de responder.',
  ].join('\n')
}

export function buildWeekSystemPrompt(): string {
  return buildWeekSystemPromptBase({ mode: 'single', density: 'full' })
}

export function buildWeekCreatorSystemPrompt(): string {
  return buildWeekSystemPromptBase({ mode: 'standalone', density: 'minimal' })
}

/**
 * Week Creator always sends a JSON response schema in production. Keep this
 * instruction compact and let the schema remain the single field definition;
 * repeating the legacy <actions> contract here wastes input tokens and gives
 * the model two incompatible output formats to follow.
 */
export function buildWeekCreatorStructuredSystemPrompt(): string {
  return [
    'Eres un generador de semanas de entrenamiento.',
    'Responde SOLO con un objeto JSON que cumpla el responseSchema configurado por la app: sin markdown, texto adicional ni wrappers <actions>.',
    'Devuelve exactamente una create_week con el targetDate y la cantidad de sesiones solicitados.',
    'Respeta el rango de fechas, días y bloques AM/PM disponibles, deportes permitidos, carga, fatiga y restricciones médicas activas.',
    'Cada sesión debe ser ejecutable y válida según el schema. Si falta o sobra una sesión, o algún campo es inválido, corrígelo antes de responder; no omitas sesiones.',
    'Sé compacto: evita repetir reglas o narrar tu razonamiento dentro de reason, objective y weekObjectives.',
  ].join('\n')
}

export function buildWeekBatchStructuredSystemPromptMinimal(): string {
  return [
    'Eres el generador de DOS semanas consecutivas dentro de un plan por evento ya estructurado.',
    'Responde SOLO con un objeto JSON que cumpla el responseSchema configurado por la app. Sin markdown, sin texto fuera, sin wrappers XML.',
    'El objeto debe tener actions[] con EXACTAMENTE DOS create_week, una por cada lunes objetivo.',
    'Cada create_week debe incluir type="create_week", targetDate (lunes YYYY-MM-DD), reason, sessions[] y weekObjectives[].',
    'Respeta el targetDate, rango válido, días permitidos, deportes permitidos y cantidad de sesiones pedida para cada semana.',
    'Cada sesión debe incluir date ISO, timeBlock AM/PM, sessionType, title, objective, durationMin>=5 y rpe entero entre 1 y 10.',
    'Devuelve sólo esqueletos semanales compactos. No incluyas exercises, squashDetails, cyclingDetails, mobilityDetails, intervalStructure, warmup ni cooldown: la app hidrata esos detalles.',
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
    'PERFIL DEL ATLETA',
    briefAthlete(profile),
    `Nivel de condición al iniciar el plan: ${wizardConfig.currentFitnessLevel} · Fatiga declarada al iniciar el plan: ${wizardConfig.currentFatigue}`,
    wizardConfig.injuryNotes
      ? `Lesiones/restricciones activas: ${wizardConfig.injuryNotes} — adapta cargas, evita movimientos de riesgo para la zona afectada y deja el ajuste explícito en objective o notes.`
      : '',
    '',
    ...buildWeekObjectivesSection(week),
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
      ? wizardConfig.doubleSessionDays?.length
        ? `- Días dobles AM/PM: ${wizardConfig.doubleSessionDays.join(', ')}. Otros días: máximo 1 sesión.`
        : '- Puedes usar AM y PM el mismo día si ayuda a cumplir el volumen, sin duplicar el mismo bloque.'
      : '- Como doble sesión NO está permitido, reparte las sesiones entre días permitidos sin repetir un mismo día.',
    ...buildDoubleSessionPreferenceRule(wizardConfig, week.phase),
    `- Deportes permitidos: ${allowed.join(', ')}`,
    `- Carga objetivo por deporte: ${targetLoads}`,
    ...buildTargetLoadMaterializationRules(plan, week, wizardConfig),
    ...buildPrimarySportRule(plan, week),
    ...buildRaceWeekRule(plan, week),
    ...buildSquashCompetitionRules(plan, week),
    ...buildSquashStrengthThemeRule(plan, wizardConfig),
    '',
    ...buildProgressionSection(previousWeek, week, wizardConfig),
    '',
    ...buildPhaseContentGuide(plan, week),
    '',
    renderPlanBuilderRecentContext(input.recentContext),
    '',
    retryInstruction ? `Corrección del intento anterior:\n${retryInstruction}\n` : '',
    strictFormatting ? 'Modo estricto: si dudas, prioriza fechas válidas, targetDate correcto, sesiones completas y exactamente la cantidad pedida antes que creatividad.' : '',
    outputFormat === 'json' ? '' : strengthStructureSection,
    outputFormat === 'json' ? '' : strengthLoadSection,
    '',
    outputFormat === 'json'
      ? 'Devuelve sólo un objeto JSON create_week para esta semana. No uses wrappers XML, markdown ni texto explicativo.'
      : 'Devuelve sólo el bloque <actions> con una única create_week para esta semana.',
  ].filter(Boolean).join('\n')
}

function buildWeekObjectivesSection(week: TrainingPlanWeek): string[] {
  if (week.weekObjectives.length === 0) return []
  return [
    'OBJETIVOS DE ESTA SEMANA',
    'Cada sesión debe contribuir a al menos uno de estos objetivos; úsalos para decidir tipo de estímulo, contenido y RPE.',
    ...week.weekObjectives.map((objective, index) => `${index + 1}. ${objective.goal}`),
  ]
}

function sumTargetLoads(loads: Record<string, number> | undefined): number {
  if (!loads) return 0
  return Object.values(loads).reduce((sum, load) => sum + (Number.isFinite(load) ? load : 0), 0)
}

function buildLoadDirective(
  previousWeek: TrainingPlanWeek | undefined,
  week: TrainingPlanWeek,
  wizardConfig: PlanWizardConfig,
): string {
  if (week.phase === 'race') {
    return 'CONSERVAR energía: el evento manda. Solo activaciones suaves alrededor del torneo, nada pesado.'
  }
  if (week.phase === 'taper') {
    return 'REDUCIR carga de verdad: baja el volumen 30-40% respecto a la semana previa, conserva toques cortos de intensidad/timing y prioriza frescura.'
  }
  if (week.phase === 'transition') {
    return 'RECUPERAR: actividad suave y agradable, RPE <= 5 en todo, sin presión de volumen ni intensidad.'
  }
  const previousTotal = previousWeek ? sumTargetLoads(previousWeek.targetLoadBySport) : 0
  // Tratamos como "primera semana" solo cuando no hay semana previa o su carga
  // objetivo es nula. Una semana previa sin sesiones detalladas todavía (puede
  // pasar en generación paralela) igual aporta su carga objetivo para fijar la
  // directiva de progresión.
  if (!previousWeek || previousTotal <= 0) {
    const startsLoaded = wizardConfig.currentFatigue === 'loaded' || wizardConfig.currentFatigue === 'overloaded'
    return startsLoaded
      ? 'Primera semana con el atleta cargado: arranca conservador (RPE 6 máximo en lo duro, volumen contenido) y prioriza calidad técnica sobre acumulación.'
      : 'Primera semana del plan: carga moderada (RPE 6-7), prioriza técnica y adaptación, y deja margen real para progresar en las semanas siguientes.'
  }
  const currentTotal = sumTargetLoads(week.targetLoadBySport)
  if (previousTotal > 0 && currentTotal <= previousTotal * 0.85) {
    return `BAJAR carga: el plan marca descarga esta semana (carga objetivo total ${currentTotal} vs ${previousTotal} de la previa). Reduce volumen ~20-30% y baja 1 punto de RPE; mantén solo estímulos de calidad.`
  }
  if (previousTotal > 0 && currentTotal >= previousTotal * 1.1) {
    return `SUBIR carga: el plan marca progresión esta semana (carga objetivo total ${currentTotal} vs ${previousTotal} de la previa). Incrementa volumen o intensidad un escalón respecto a la semana previa, no ambos a la vez.`
  }
  return 'MANTENER con progresión ligera: conserva la estructura que funcionó la semana previa y ajusta un solo parámetro (algo más de densidad, precisión o carga puntual).'
}

function buildProgressionSection(
  previousWeek: TrainingPlanWeek | undefined,
  week: TrainingPlanWeek,
  wizardConfig: PlanWizardConfig,
): string[] {
  const lines = ['PROGRESIÓN RESPECTO A LA SEMANA PREVIA']
  if (previousWeek && previousWeek.phase !== week.phase) {
    lines.push(`Cambio de fase: ${PHASE_LABEL[previousWeek.phase] ?? previousWeek.phase} -> ${PHASE_LABEL[week.phase] ?? week.phase}. El carácter de las sesiones debe reflejar la fase nueva, no repetir la anterior.`)
  }
  lines.push(`Directiva de carga: ${buildLoadDirective(previousWeek, week, wizardConfig)}`)
  lines.push('No clones las sesiones de la semana previa: conserva lo que progresa y varía drills, ejercicios y estímulos.')
  lines.push(briefPreviousWeek(previousWeek))
  return lines
}

function buildPhaseContentGuide(plan: TrainingPlan, week: TrainingPlanWeek): string[] {
  if (getPrimarySport(plan) !== 'squash') return []

  const guides: Partial<Record<TrainingPlanWeek['phase'], string[]>> = {
    base: [
      'Squash: técnica fundamental, patrones de movimiento, ghosting básico y rallies cooperativos. RPE 5-6, sin presión de resultado.',
      'Fuerza: adaptación y aprendizaje de movimientos, RPE 6-7; prioriza rango de movimiento sobre carga.',
      'Aeróbico: Z2 exclusivamente, construir base sin comprometer la recuperación.',
    ],
    build: [
      'Squash: intensidad progresiva. Incluye pressure drills, puntos condicionados, trabajo a la T y al menos 1 match-play controlado en la semana.',
      'Fuerza: cargas progresivas semana a semana con un componente explosivo (saltos, cargadas o high pulls). RPE 7-8.',
      'Variedad: no repitas el mismo drill principal de squash dos sesiones seguidas; alterna ejes técnico/táctico/físico.',
    ],
    peak: [
      'Squash: máxima especificidad. Pressure drills bajo fatiga, simulación de partido, puntos clave con presión de marcador. La intensidad alta viene del squash, no del cardio accesorio.',
      'Fuerza: volumen moderado e intensidad puntual alta, foco en potencia y explosividad. Nada que genere DOMS profundo.',
      'Recuperación: separa al menos 12h entre squash intenso y fuerza pesada.',
    ],
    taper: [
      'Squash: 2-3 toques cortos de calidad centrados en timing, precisión y sensaciones. Sin sesiones exhaustivas.',
      'Fuerza: 0-1 sesión neural corta (<= 45 min, pocas series, cargas moderadas movidas rápido). No generes DOMS.',
      'Cada sesión necesita un propósito competitivo claro: frescura, precisión, activación o movilidad.',
    ],
    transition: [
      'Recuperación activa: actividad suave y variada, RPE <= 5 en todo, sin estructura exigente.',
    ],
  }

  const guide = guides[week.phase]
  if (!guide) return []
  return [`GUÍA DE CONTENIDO — FASE ${(PHASE_LABEL[week.phase] ?? week.phase).toUpperCase()}`, ...guide]
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

  const allowedDoubleDays = wizardConfig.doubleSessionDays?.length
    ? ` solo en: ${wizardConfig.doubleSessionDays.join(', ')}`
    : ''

  return [
    `- Preferencia: usa 1 dia doble AM/PM${allowedDoubleDays} y deja 1 dia permitido libre. No juntes dos estimulos duros.`,
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
      ...buildTargetLoadMaterializationRules(plan, week, wizardConfig),
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
      ? wizardConfig.doubleSessionDays?.length
        ? `- Días dobles AM/PM: ${wizardConfig.doubleSessionDays.join(', ')}. Otros días: máximo 1 sesión.`
        : '- Puedes usar AM y PM el mismo día si ayuda a cumplir el volumen, sin duplicar el mismo bloque dentro de una semana.'
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
    anyStrength && outputFormat !== 'json' ? buildStrengthStructureSection() : '',
    anyStrength && outputFormat !== 'json' ? buildStrengthLoadPack({ strengthProfile: profile.strengthProfile }) : '',
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
    '- Cardio específico opcional va al final: bici de asalto 30s on/30s off por 4 min, trotadora de aire 20s on/20s off por 4 min, o escalera/footwork como 2-3 ejercicios concretos con sets/reps tipo "2 pasadas por lado". Para escalera/footwork NO uses "1x4 min". Usa 1 bloque por defecto; 2 sólo si está fresco y la sesión dura 65+ min.',
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

function buildTargetLoadMaterializationRules(
  plan: TrainingPlan,
  week: TrainingPlanWeek,
  wizardConfig: PlanWizardConfig,
): string[] {
  const allowed = allowedSportsList(plan, wizardConfig)
  if (
    !allowed.includes('running')
    || (week.targetLoadBySport.running ?? 0) <= 0
    || week.phase === 'race'
    || week.phase === 'transition'
  ) {
    return []
  }

  return [
    `- running=${week.targetLoadBySport.running}: 1 sessionType="running"; no squash drill.`,
  ]
}

function buildSquashCompetitionRules(plan: TrainingPlan, week: TrainingPlanWeek): string[] {
  if (getPrimarySport(plan) !== 'squash') return []

  if (week.phase === 'build' || week.phase === 'peak') {
    return [
      '- Regla squash competitivo: running/cycling son soporte, no estímulo principal. Si incluyes running, debe ser Z2 corto <=45min, RPE <=5. No uses tempo, intervalos, long run ni test de carrera.',
      '- En peak de squash, la intensidad alta debe venir de squash específico: pressure drills, control bajo fatiga, patrones a la T, puntos condicionados o match-play controlado.',
      '- Match/simulación => sessionMode practice_match/competition_match + sessionKind match; no drill_session.',
      '- No repitas drills; rota familias.',
      '- Usa nombres exactos de drills de squash del catálogo/sugerencias del prompt. No inventes nombres nuevos para conceptos similares; si quieres presión de marcador usa un drill existente de puntos condicionados o match-play.',
    ]
  }

  if (week.phase === 'taper') {
    return [
      '- Regla taper squash: reduce de verdad la carga. Prioriza 2-3 toques de squash cortos/calidad, 0-1 fuerza neural corta, movilidad. Running sólo si es activación Z2/recovery <=25min RPE <=3; cycling evita salvo recuperación muy justificada.',
      '- Match taper: solo 3+ dias antes del evento. Ultimas 48h: NO match-play; solo activación/control/timing, RPE <=4.',
      '- No repitas drills.',
      '- No rellenes taper con dobles ligeros repetidos. Cada sesión debe tener un propósito competitivo claro: frescura, precisión, timing, movilidad o activación neural.',
      '- Usa nombres exactos de drills de squash del catálogo/sugerencias del prompt para evitar que la reparación automática reemplace la intención original.',
    ]
  }

  if (week.phase === 'race') {
    return [
      '- Regla race squash: el evento manda. Devuelve una sesión squash match/competitive el día del torneo y, como máximo, movilidad/activación muy suave alrededor. No agregues running/cycling de soporte.',
    ]
  }

  return []
}
