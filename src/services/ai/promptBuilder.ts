/**
 * Builds rich, context-aware system prompts for the AI coach.
 *
 * Design goals:
 * - Coach is primarily a PLANNER, secondarily a conversational advisor
 * - Include enough context (week dates, sessions, profile) for concrete actions
 * - Teach the model ALL available action types including create_week and add_session
 * - When the user asks for an action, the model MUST respond with structured actions
 */

import type { ChatContext, CoachExerciseProposal, MacroPlanPhase, Session, SupportedSport, SquashDrill } from '../../types'
import { todayISO, currentWeekStartISO } from '../../utils/date'
import {
  getAthleteDisplayName,
  getAthleteSportsSummary,
  getPrimarySportNormalized,
  getSecondarySportsNormalized,
  getSportPrioritySummary,
} from '../../utils/athlete'
import { getAllowedPlanningSports, getPlanningPrimarySport } from '../planningConstraints'
import { classifyDayLoad, getDayNutrition, getLoadTypeLabel } from '../nutritionEngine'
import { computeMacroPlan, getPrimaryGoalEvent, getPhaseLabel, formatWeeksRemaining } from '../macroPlan'
import {
  extractRecentSquashDrills,
  runSquashDrillSelectorSmokeChecks,
  selectSquashDrills,
  summarizeSquashProgression,
  type SquashSelectionContext,
  type SquashSelectionPhase,
} from '../training/drillSelector'
import {
  extractRecentStrengthExercises,
  runStrengthSelectorSmokeChecks,
  selectStrengthSession,
  summarizeStrengthProgression,
  type StrengthContext,
  type StrengthPhase,
  type StrengthSelectionExercise,
  type StrengthSportProfile,
} from '../training/strengthSelector'
import {
  extractRecentRunningSessions,
  runRunningSelectorSmokeChecks,
  selectRunningSession,
  summarizeRunningProgression,
  type RunningContext,
  type RunningPhase,
  type RunningSelectionResult,
  type RunningSportProfile,
} from '../training/runningSelector'

const SQUASH_SUBTYPE_ES: Record<string, string> = {
  training: 'entrenamiento', match: 'partido', competitive: 'competitivo',
  control: 'control', light: 'suave',
}
const RUNNING_TYPE_ES: Record<string, string> = {
  z2: 'Z2 aeróbico', tempo: 'tempo', intervals: 'intervalos', long: 'long run',
}
const SESSION_TYPE_ES: Record<string, string> = {
  squash: 'squash', running: 'running', strength: 'fuerza',
  mobility: 'movilidad', recovery: 'recuperación', nutrition: 'nutrición',
}
const STATUS_ES: Record<string, string> = {
  planned: 'planificado', completed: 'completado', adjusted: 'ajustado', skipped: 'saltado',
}
const DAY_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DAY_FULL_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function getAllContextSessions(context: ChatContext): Session[] {
  const merged = new Map<string, Session>()

  for (const session of context.recentSessions ?? []) merged.set(session.id, session)
  for (const session of context.plannedSessions ?? []) merged.set(session.id, session)
  for (const session of context.historicalSessions ?? []) merged.set(session.id, session)

  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

function getPlannedSessions(context: ChatContext): Session[] {
  if (context.plannedSessions && context.plannedSessions.length > 0) {
    return [...context.plannedSessions].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
  }

  const today = todayISO()
  return getAllContextSessions(context).filter(session => session.date >= today)
}

function getHistoricalSessions(context: ChatContext): Session[] {
  if (context.historicalSessions && context.historicalSessions.length > 0) {
    return [...context.historicalSessions].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
  }

  const today = todayISO()
  return getAllContextSessions(context).filter(
    session => session.status !== 'planned' || session.date < today,
  )
}

import { getSquashMatchHistory, getStrengthProgression } from '../progressionInsights'

function mapMacroPhaseToSquashPhase(phase: MacroPlanPhase | undefined): SquashSelectionPhase {
  switch (phase) {
    case 'build':
      return 'build'
    case 'peak':
      return 'peak'
    case 'taper':
    case 'race':
      return 'taper'
    case 'transition':
      return 'base'
    case 'base':
    default:
      return 'base'
  }
}

function deriveSquashFatigueLevel(context: ChatContext): number {
  const dayLog = context.dayLog
  if (!dayLog) return 4

  let score = 4
  if (dayLog.energyLevel != null && dayLog.energyLevel <= 3) score += 2
  else if (dayLog.energyLevel != null && dayLog.energyLevel <= 5) score += 1
  if (dayLog.painLevel != null && dayLog.painLevel >= 6) score += 3
  else if (dayLog.painLevel != null && dayLog.painLevel >= 3) score += 1
  if (dayLog.sleepHours != null && dayLog.sleepHours < 6) score += 2
  else if (dayLog.sleepHours != null && dayLog.sleepHours < 7) score += 1
  if (dayLog.rpeActual != null && dayLog.rpeActual >= 8) score += 2
  else if (dayLog.rpeActual != null && dayLog.rpeActual >= 6) score += 1

  return Math.max(1, Math.min(10, score))
}

function deriveStrengthFatigueLevel(context: ChatContext): number {
  return deriveSquashFatigueLevel(context)
}

function mapMacroPhaseToStrengthPhase(phase: MacroPlanPhase | undefined): StrengthPhase {
  switch (phase) {
    case 'build':
      return 'build'
    case 'peak':
      return 'peak'
    case 'taper':
    case 'race':
      return 'taper'
    case 'transition':
      return 'transition'
    case 'base':
    default:
      return 'base'
  }
}

function deriveStrengthSportProfile(context: ChatContext): StrengthSportProfile {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  const primarySport = getPlanningPrimarySport(context.athleteProfile)

  if (primarySport === 'strength') return 'strength_primary'
  if (enabledSports.includes('strength') && enabledSports.length > 1) return 'hybrid'
  return 'sport_support'
}

function deriveStrengthExperienceLevel(context: ChatContext): 'beginner' | 'intermediate' | 'advanced' {
  const sp = context.athleteProfile?.strengthProfile
  const filled = [sp?.benchPress1RM, sp?.squat1RM, sp?.deadlift1RM, sp?.overheadPress1RM]
    .filter((value) => value != null)
    .length

  if (filled >= 4) return 'advanced'
  if (filled >= 2) return 'intermediate'
  return 'beginner'
}

function mapMacroPhaseToRunningPhase(phase: MacroPlanPhase | undefined): RunningPhase {
  switch (phase) {
    case 'build':
      return 'build'
    case 'peak':
      return 'peak'
    case 'taper':
    case 'race':
      return 'taper'
    case 'transition':
      return 'transition'
    case 'base':
    default:
      return 'base'
  }
}

function deriveRunningSportProfile(context: ChatContext): RunningSportProfile {
  const primarySport = getPlanningPrimarySport(context.athleteProfile)
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)

  if (primarySport === 'running') return 'running_primary'
  if (enabledSports.includes('running') && enabledSports.length > 1) return 'hybrid'
  return 'sport_support'
}

function getRunningSelectionContext(context: ChatContext): RunningContext {
  const today = todayISO()
  const plannedSessions = getPlannedSessions(context)
  const historicalSessions = getHistoricalSessions(context)
  const macroPlan = computeMacroPlan(context.athleteProfile)
  const nextCompetitive = plannedSessions
    .filter(
      session =>
        session.date >= today &&
        (session.subtype === 'match' || session.subtype === 'competitive'),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))[0]

  const competitionGap = nextCompetitive ? diffDays(today, nextCompetitive.date) : undefined
  const daysToCompetition = typeof competitionGap === 'number' ? competitionGap : undefined
  const competitionSoon = typeof daysToCompetition === 'number' && daysToCompetition <= 7
  const primarySport = getPlanningPrimarySport(context.athleteProfile)
  const goal =
    context.athleteProfile?.mainGoal ??
    context.currentWeekSummary?.objectives?.[0] ??
    'desarrollar sesiones de running variadas y bien estructuradas'

  return {
    fatigueLevel: deriveSquashFatigueLevel(context),
    phase: mapMacroPhaseToRunningPhase(macroPlan?.currentPhase),
    recentSessions: extractRecentRunningSessions(historicalSessions),
    goal,
    sportProfile: deriveRunningSportProfile(context),
    primarySport: primarySport ?? undefined,
    competitionSoon,
    daysToCompetition,
    historicalSessions,
    runningAcwr: context.loadAnalytics?.runningAcwr,
    runningWeeklyLoad: context.loadAnalytics?.runningWeeklyLoads?.[0],
  }
}

function buildRunningSelectionSummary(context: ChatContext): {
  selection: RunningSelectionResult
  selectionContext: RunningContext
} | null {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (!enabledSports.includes('running')) return null

  const selectionContext = getRunningSelectionContext(context)
  return {
    selectionContext,
    selection: selectRunningSession(selectionContext),
  }
}

function getSquashSelectionContext(context: ChatContext): SquashSelectionContext {
  const today = todayISO()
  const plannedSessions = getPlannedSessions(context)
  const historicalSessions = getHistoricalSessions(context)
  const macroPlan = computeMacroPlan(context.athleteProfile)
  const nextCompetitive = plannedSessions
    .filter(session =>
      session.type === 'squash' &&
      (session.subtype === 'match' || session.subtype === 'competitive') &&
      session.date >= today,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))[0]

  const competitionSoon = Boolean(nextCompetitive && (diffDays(today, nextCompetitive.date) ?? 99) <= 4)
  const goal = nextCompetitive?.title
    ?? context.athleteProfile?.mainGoal
    ?? context.currentWeekSummary?.objectives?.[0]
    ?? 'mejorar squash con sesiones variadas y utiles'

  return {
    fatigueLevel: deriveSquashFatigueLevel(context),
    phase: mapMacroPhaseToSquashPhase(macroPlan?.currentPhase),
    recentDrills: extractRecentSquashDrills(historicalSessions),
    goal,
    competitionSoon,
    historicalSessions,
    squashAcwr: context.loadAnalytics?.squashAcwr,
  }
}

function buildSquashSelectionSummary(context: ChatContext): {
  selection: ReturnType<typeof selectSquashDrills>
  selectionContext: SquashSelectionContext
} | null {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (!enabledSports.includes('squash')) return null

  const selectionContext = getSquashSelectionContext(context)
  return {
    selectionContext,
    selection: selectSquashDrills(selectionContext),
  }
}

function getStrengthSelectionContext(context: ChatContext): StrengthContext {
  const today = todayISO()
  const plannedSessions = getPlannedSessions(context)
  const historicalSessions = getHistoricalSessions(context)
  const macroPlan = computeMacroPlan(context.athleteProfile)
  const nextCompetitive = plannedSessions
    .filter((session) =>
      session.date >= today &&
      (session.subtype === 'match' || session.subtype === 'competitive'),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))[0]

  const competitionGap = nextCompetitive ? diffDays(today, nextCompetitive.date) : undefined
  const daysToCompetition = typeof competitionGap === 'number' ? competitionGap : undefined
  const competitionSoon = typeof daysToCompetition === 'number' && daysToCompetition <= 4
  const primarySport = getPlanningPrimarySport(context.athleteProfile)
  const goal = nextCompetitive?.title
    ?? context.athleteProfile?.mainGoal
    ?? context.currentWeekSummary?.objectives?.[0]
    ?? 'desarrollar una sesion de fuerza util y bien estructurada'

  return {
    fatigueLevel: deriveStrengthFatigueLevel(context),
    phase: mapMacroPhaseToStrengthPhase(macroPlan?.currentPhase),
    recentExercises: extractRecentStrengthExercises(historicalSessions),
    goal,
    sportProfile: deriveStrengthSportProfile(context),
    primarySport,
    experienceLevel: deriveStrengthExperienceLevel(context),
    sessionDurationMin: primarySport === 'strength' ? 65 : 50,
    competitionSoon,
    daysToCompetition,
    historicalSessions,
    strengthAcwr: context.loadAnalytics?.strengthAcwr,
  }
}

function buildStrengthSelectionSummary(context: ChatContext): {
  selection: ReturnType<typeof selectStrengthSession>
  selectionContext: StrengthContext
} | null {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (!enabledSports.includes('strength')) return null

  const selectionContext = getStrengthSelectionContext(context)
  return {
    selectionContext,
    selection: selectStrengthSession(selectionContext),
  }
}

type SquashSelectionSummary = ReturnType<typeof buildSquashSelectionSummary>
type StrengthSelectionSummary = ReturnType<typeof buildStrengthSelectionSummary>

function formatSelectedSquashDrills(drills: SquashDrill[], limit = drills.length): string {
  return drills
    .slice(0, limit)
    .map((drill) => `${drill.name}${drill.durationMin ? ` ${drill.durationMin}min` : ''}`)
    .join(' · ')
}

function stringifySquashDrills(drills: SquashDrill[]): string {
  return drills
    .map((drill) => JSON.stringify(drill))
    .join(',')
}

function formatSelectedStrengthExercises(
  exercises: StrengthSelectionExercise[],
  limit = exercises.length,
): string {
  return exercises
    .slice(0, limit)
    .map((exercise) => `${exercise.name} ${exercise.sets}x${exercise.reps}${exercise.intensity ? ` (${exercise.intensity})` : ''}`)
    .join(' · ')
}

function toCoachExerciseProposal(exercise: StrengthSelectionExercise): CoachExerciseProposal {
  return {
    name: exercise.name,
    sets: exercise.sets,
    reps: exercise.reps,
    group: exercise.group,
    notes: exercise.notes
      ? `${exercise.notes} [${exercise.intensity}]`
      : exercise.intensity,
  }
}

function stringifyStrengthExercises(
  exercises: StrengthSelectionExercise[],
  limit = exercises.length,
): string {
  return exercises
    .slice(0, limit)
    .map((exercise) => JSON.stringify(toCoachExerciseProposal(exercise)))
    .join(',')
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function buildCoachSystemPrompt(context: ChatContext): string {
  const plannedSessions = getPlannedSessions(context)
  const squashSummary = buildSquashSelectionSummary(context)
  const strengthSummary = buildStrengthSelectionSummary(context)
  const runningSummary = buildRunningSelectionSummary(context)

  const sections: string[] = [
    buildPersonaSection(context),
    buildAthleteProfileSection(context),
    buildMacroPlanSection(context),
    buildPlanWizardSection(context),
    buildCoachMemorySection(context),
    buildFatigueSection(context),
    buildHybridSection(context),
    buildCompetitionSection(context),
    buildCompetitionLoadSection(context),
    buildLoadAnalyticsSection(context),
    buildImplicitPrioritySection(context),
    buildSquashMatchHistorySection(context),
    buildDynamicSquashSelectionSection(context, squashSummary),
    buildDynamicStrengthSelectionSection(context, strengthSummary),
    buildDynamicRunningSelectionSection(context, runningSummary),
    buildStrengthProgressionSection(context),
    buildNutritionContextSection(context),
    buildWeekSection(context),
    buildSessionsSection(plannedSessions),
    buildWeekDayLogsSection(context),
    buildTodaySection(context),
    buildResponseInstructionsSection(plannedSessions, context, squashSummary, strengthSummary),
  ]
  return sections.filter(Boolean).join('\n\n')
}

// ─── Sport-specific rule sections ─────────────────────────────────────────────

function buildSquashRulesSection(): string {
  return `
SQUASH — CONOCIMIENTO TÉCNICO (usa esto para dar respuestas expertas, no genéricas):

Tipos de sesión y contenido esperado en el campo objective:
· training técnico: bloques de drives (paralelo y cruzado, profundidad y longitud), voleas de presión desde media pista, salidas de pared (boast a zona corta, nick de esquina), dejadas y drops. 2-3 focos de 15-20min con intención clara.
· training táctico: patrones de juego (largo-corto, presión de fondo, ataque desde T), juegos condicionados (solo paralelo, solo largo, dos botes prohibidos, inicio en boasted ball, zona prohibida). Especificar condición y objetivo del patrón.
· training físico-específico: ghosting (4 esquinas o 6 puntos, con o sin raqueta), RSA repetidos cortos 10-15s con recuperación incompleta, multiball alta intensidad, desplazamientos específicos (lunge, split step, recuperación al T). Especificar series y ratio trabajo/descanso.
· control: peloteo de calidad técnica a intensidad baja-media, foco en ejecución limpia sin presión de resultado. Ideal día previo a partido o en semanas de carga alta.
· match/competitive: partido real de competición. Anotar rival si se conoce.

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

function buildRunningRulesSection(): string {
  return `
RUNNING — CONOCIMIENTO TÉCNICO:
Tipos de sesión:
· Z2 aeróbico: ritmo conversacional, FC baja, totalmente sostenible. Base aeróbica y recuperación activa.
· Tempo/umbral: ritmo sostenido al 85-90% de esfuerzo. No más de 40-50 min continuos sin recuperación.
· Intervalos VO2max: series cortas de alta intensidad (4-8min), con recuperación activa entre series.
· Long run: 60-120min al ritmo easy/Z2. Clave para base aeróbica y tolerancia.

Secuenciación running:
· No apilar dos sesiones de alta intensidad (tempo o intervalos) en días consecutivos.
· Long run requiere 48h de recuperación antes de sesión exigente de otro deporte.
· Si hay competencia clave (cualquier deporte), corta el tempo y los intervalos 5+ días antes.
· Z2 puede ir cualquier día como herramienta de recuperación activa sin comprometer otros deportes.

PERFIL DEPORTIVO EN RUNNING:
· running_primary: running es el deporte central del atleta. Tratar con continuidad y especificidad real de entrenamiento competitivo. No usar como cardio complementario. Priorizar progresión, variación de estímulos y coherencia entre sesiones.
· hybrid: running convive con otras disciplinas (squash, fuerza, ciclismo). Priorizar eficiencia por sesión. Controlar fatiga cruzada. Preferir calidad sobre volumen cuando hay carga de otro deporte.
· sport_support: running como herramienta aeróbica o complemento del deporte principal. Sesiones cortas, baja interferencia. Z2, strides y recovery preferidos. Evitar interferir con la frescura del deporte principal.`
}

function buildStrengthRulesSection(): string {
  return `
FUERZA — CONOCIMIENTO TÉCNICO:
Estructura habitual:
· strength_primary: la fuerza es disciplina principal. Debe sentirse como una sesion real de pesas con lift principal, accesorios, trunk y una logica clara de progresion.
· hybrid: la fuerza debe construir rendimiento sin comerse la frescura de los otros deportes. Prioriza eficiencia, transferencia y fatiga controlada.
· sport_support: la fuerza complementa un deporte principal. Volumen moderado, transferencia alta y nada de destruir piernas innecesariamente.
· Upper: press banca/inclinado, remo, dominadas, press hombro, core. 4-5 ejercicios, 3-5 series.
· Lower: sentadilla, peso muerto o variante, hip thrust, lunge, core. 4-5 ejercicios, 3-5 series.
· Full body: combinación de variantes de press, jalón/remo y tren inferior.

Secuenciación fuerza:
· No hacer sesión de piernas pesada dentro de las 24h previas a una competencia o sesión técnica clave.
· DOMS de piernas + competencia = error de planificación — evitarlo siempre.
· En semana competitiva: sesión neural liviana (pocos sets, alta intensidad, sin volumen de DOMS).
· Movilidad post-fuerza mejora recuperación y flexibilidad funcional.
· Si fuerza es principal, prioriza estructura, progresion y calidad de los compounds antes que meter cardio o accesorios irrelevantes.
· Si fuerza es secundaria, ajusta el volumen para no interferir con el deporte principal y usa mas estabilidad, unilateral y trunk cuando convenga.
· Evita recetas universales de upper/lower sin mirar fase, fatiga, historial reciente y rol real de la fuerza para el atleta.`
}

function buildMobilityRulesSection(): string {
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

function buildCyclingRulesSection(): string {
  return `
CICLISMO — CONOCIMIENTO TÉCNICO:

Tipos de sesión y contenido esperado:
· Z2 bici aeróbico: ritmo aeróbico cómodo, FC baja, cadencia 80-90rpm. Base aeróbica con bajo impacto articular. Sostenible indefinidamente, útil como recuperación activa entre sesiones de otro deporte.
· Tempo/sweetspot: intensidad sostenida al 88-94% de FTP o RPE 6-7. Mejora umbral sin el daño muscular del running. Series de 15-30min con recuperación activa.
· Intervalos VO2max: series de 3-8min a alta intensidad (>100% FTP o RPE 8-9), recuperación activa entre series. No más de 3 bloques en sesión.
· Long ride: 60-180min al ritmo aeróbico sostenido. Fondo, tolerancia metabólica y resistencia mental. Exige nutrición en ruta si supera 90min.

Cadencia y técnica:
· Cadencia baja (<70rpm): más demanda muscular, más fuerza, útil en subidas cortas o fuerza específica.
· Cadencia alta (>95rpm): más demanda cardiorrespiratoria, menos fatiga muscular. Entrenamiento de pedaling suave.
· Cadencia objetivo habitual: 80-95rpm. Mantenerla en Z2 reduce riesgo de DOMS en piernas.

Indoor vs outdoor:
· Indoor (rodillo/trainer): más control de potencia e intensidad, menor tiempo efectivo. Sin coste de paradas. Ideal para intervalos controlados.
· Outdoor (ruta/gravel): más variabilidad, mayor demanda técnica, nutrición/hidratación más compleja. Esfuerzo real mayor que el percibido en rodillo.

Secuenciación ciclismo:
· Menor impacto articular que running — útil como complemento o recuperación activa entre días duros.
· Si combina con fuerza de piernas el mismo día: bici primero (o separar por >6h).
· No apilar long ride (>90min) con fuerza de piernas en el mismo día ni en días consecutivos sin recuperación.
· Long ride requiere 24-36h de recuperación antes de sesión exigente de otro deporte (running tempo, squash intenso).
· Si hay competencia o evento clave: Z2 bici corto (30-45min) puede ser activación previa ideal sin generar fatiga.
· Intervalos VO2max en bici tienen un "costo de piernas" real — planificar como si fuera sesión de fuerza respecto al día siguiente.

Cruce de fatiga con running:
· Bici y running comparten adaptación aeróbica central (corazón, pulmones) — pueden apilarse sin conflicto en Z2.
· A alta intensidad, comparten fatiga de cuádriceps y glúteos — no apilar intervalos bici + tempo running en días seguidos.
· Z2 bici es el cross-training aeróbico ideal cuando hay molestias de running que contraindican correr.`
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function buildPersonaSection(context: ChatContext): string {
  const athleteName = getAthleteDisplayName(context.athleteProfile, 'este atleta')
  const sportsSummary = getAthleteSportsSummary(context.athleteProfile)
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  const primarySport = getPlanningPrimarySport(context.athleteProfile) ?? getPrimarySportNormalized(context.athleteProfile)

  const sportDisplay = sportsSummary || 'disciplinas no configuradas'
  const primaryDisplay = primarySport ?? context.athleteProfile?.primarySport?.trim() ?? 'deporte principal'

  const sportSections = [
    enabledSports.includes('squash')   ? buildSquashRulesSection()   : '',
    enabledSports.includes('running')  ? buildRunningRulesSection()  : '',
    enabledSports.includes('strength') ? buildStrengthRulesSection() : '',
    enabledSports.includes('mobility') ? buildMobilityRulesSection() : '',
    enabledSports.includes('cycling')  ? buildCyclingRulesSection()  : '',
  ].filter(Boolean).join('\n')

  return `Eres el coach-planner personal de alto rendimiento de ${athleteName}.
${athleteName} es un atleta híbrido orientado a ${sportDisplay}.

ROLES EN ORDEN DE PRIORIDAD:
1. PLANNER: Diseñas y ajustas la semana con acciones ejecutables.
2. PERFORMANCE COACH: Tomas decisiones de carga según fatiga, recuperación y contexto.
3. ADVISOR: Das recomendaciones concretas solo si agregan valor real.

PRIORIDADES DE DECISIÓN:
1. Salud y prevención de lesión
2. Calidad del entrenamiento
3. Rendimiento específico en ${primaryDisplay}
4. Volumen total

REGLAS:
- Si hay fatiga alta, baja volumen o intensidad.
- Si hay dolor o lesión, prioriza recuperación activa, movilidad, activación, trabajo técnico, upper body y cardio suave si aplica.
- Si hay sesión clave al día siguiente, el día previo debe ser liviano.
- No acumules fatiga inútil.

ESTILO:
- Directo y conciso.
- Si falta contexto, asume algo razonable y dilo brevemente.
- Si el usuario pide crear o modificar el plan, usa <actions>.
- Nunca respondas solo con texto cuando se pidió una acción.
- Responde siempre en español.
${sportSections}`
}

function buildNutritionContextSection(context: ChatContext): string {
  const np = context.athleteProfile?.nutritionProfile
  const weightKg = context.athleteProfile?.weightKg
  const today = todayISO()
  const allSessions = getAllContextSessions(context)

  const todaySessions = allSessions.filter(s => s.date === today && s.status !== 'skipped')
  const sessionCount = todaySessions.length

  // Use the canonical classifier from nutritionEngine
  const loadType = classifyDayLoad(todaySessions)
  const rec = getDayNutrition(todaySessions)

  // Check for upcoming competitive session in next 2 days (for víspera protocol — any sport)
  const upcomingMatch = getPlannedSessions(context).find(s =>
    s.date > today &&
    s.date <= addDaysToISO(today, 2) &&
    (s.subtype === 'match' || s.subtype === 'competitive'),
  )

  const lines: string[] = ['═══ NUTRICIÓN Y HIDRATACIÓN ═══']

  // Body composition context from profile
  if (np || weightKg) {
    const bodyLines: string[] = []
    if (weightKg) bodyLines.push(`peso actual ${weightKg}kg`)
    if (np?.goalBodyWeightKg) bodyLines.push(`objetivo ${np.goalBodyWeightKg}kg`)
    if (np?.fatMassPct != null) bodyLines.push(`grasa ${np.fatMassPct}%`)
    if (np?.fatMassGoalPct != null) bodyLines.push(`objetivo grasa ${np.fatMassGoalPct}%`)
    if (np?.muscleMassKg != null) bodyLines.push(`muscular ${np.muscleMassKg}kg`)
    if (np?.muscleMassGoalKg != null) bodyLines.push(`objetivo muscular ${np.muscleMassGoalKg}kg`)
    if (bodyLines.length > 0) lines.push(`Composición corporal: ${bodyLines.join(' · ')}`)
  }

  // Protein target from profile or derived from weight
  const proteinTarget = np?.proteinTargetG ?? (weightKg ? Math.round(weightKg * 2.0) : null)
  if (proteinTarget) lines.push(`Proteína diaria objetivo: ~${proteinTarget}g`)

  // Hydration: base from profile + dynamic by sessions
  const waterBase = np?.dailyWaterLiters ?? 2.5
  const waterTotal = waterBase + sessionCount * 0.8
  lines.push(
    sessionCount > 0
      ? `Hidratación: ${waterBase}L base + ~${(sessionCount * 0.8).toFixed(1)}L por entrenamiento = ~${waterTotal.toFixed(1)}L total hoy`
      : `Hidratación: ${waterBase}L (día sin entrenamiento)`,
  )

  // Load type + engine recommendations
  lines.push('')
  lines.push(`Carga de hoy: ${getLoadTypeLabel(loadType)}`)
  lines.push(`Foco: ${rec.dailyFocus}`)
  lines.push(`Hidratación recomendada: ${rec.hydration}`)

  if (rec.preWorkout) lines.push(`Pre-entreno: ${rec.preWorkout}`)
  if (rec.postWorkout) lines.push(`Post-entreno: ${rec.postWorkout}`)

  lines.push('Estructura del día:')
  lines.push(`  · Desayuno: ${rec.breakfast}`)
  lines.push(`  · Almuerzo: ${rec.lunch}`)
  lines.push(`  · Merienda: ${rec.snack}`)
  lines.push(`  · Cena: ${rec.dinner}`)
  if (rec.preTraining) lines.push(`  · Colación pre-entreno: ${rec.preTraining}`)
  if (rec.postTraining) lines.push(`  · Colación post-entreno: ${rec.postTraining}`)

  // Víspera de competencia
  if (loadType !== 'match' && upcomingMatch) {
    lines.push('')
    lines.push(`VÍSPERA DE COMPETENCIA (partido el ${upcomingMatch.date}):`)
    lines.push('· Cena: carga de carbohidratos — proteína blanca + 3 porciones de cereal (papa/arroz/pasta) + ensalada.')
    lines.push('· Solo carnes blancas desde 2 días antes. Sin alcohol en la semana previa.')
    lines.push('· Sin alimentos meteorizantes (legumbres, brócoli, coliflor, choclo, condimentos fuertes).')
  }

  // Intolerances / free text notes
  if (np?.notes?.trim()) {
    lines.push('')
    lines.push(`Preferencias / restricciones: ${np.notes.trim()}`)
  }

  lines.push('')
  lines.push('Usa este contexto nutricional cuando el usuario pregunte sobre comidas, recuperación, energía o composición corporal. Si el usuario no pregunta de nutrición, no lo menciones salvo que sea directamente relevante a la sesión del día.')

  return lines.join('\n')
}

function buildWeekSection(context: ChatContext): string {
  const { currentWeekSummary: s } = context
  if (!s) return ''

  const lines: string[] = ['═══ SEMANA EN CURSO ═══']

  const weekStart = formatDateShort(s.weekStartDate)
  lines.push(`Semana: ${weekStart} (7 días)`)

  const adh = s.adherencePct != null ? ` (${s.adherencePct}%)` : ''
  lines.push(`Adherencia global: ${s.completedSessions}/${s.plannedSessions} sesiones${adh}`)
  lines.push(`Volumen completado: ${formatMin(s.completedMinutes)} de ${formatMin(s.plannedMinutes)} planificados`)

  const disciplines: string[] = []
  if (s.plannedSquashSessions) {
    disciplines.push(`Squash ${s.squashSessions}/${s.plannedSquashSessions}`)
  } else if (s.squashSessions) {
    disciplines.push(`Squash ${s.squashSessions} completadas`)
  }
  if (s.plannedRunningSessions) {
    disciplines.push(`Running ${s.runningSessions}/${s.plannedRunningSessions}`)
  } else if (s.runningSessions) {
    disciplines.push(`Running ${s.runningSessions} completadas`)
  }
  if (s.plannedStrengthSessions) {
    disciplines.push(`Fuerza ${s.strengthSessions}/${s.plannedStrengthSessions}`)
  } else if (s.strengthSessions) {
    disciplines.push(`Fuerza ${s.strengthSessions} completadas`)
  }
  if (disciplines.length > 0) lines.push(disciplines.join('  ·  '))

  if (s.avgActualRpe != null) lines.push(`RPE real promedio: ${s.avgActualRpe.toFixed(1)}/10`)
  else if (s.avgRpe != null) lines.push(`RPE planificado promedio: ${s.avgRpe.toFixed(1)}/10`)

  if (s.objectives && s.objectives.length > 0) {
    lines.push(`Objetivos semana: ${s.objectives.join(' / ')}`)
  }

  return lines.join('\n')
}

function buildAthleteProfileSection(context: ChatContext): string {
  const p = context.athleteProfile
  if (!p) return ''
  const primarySport = getPrimarySportNormalized(p)
  const secondarySports = getSecondarySportsNormalized(p)
  const sportPrioritySummary = getSportPrioritySummary(p)

  const lines: string[] = ['═══ PERFIL DEL ATLETA ═══']

  // Basic
  const basicParts: string[] = []
  if (p.age) basicParts.push(`${p.age} años`)
  if (p.weightKg) basicParts.push(`${p.weightKg} kg`)
  if (basicParts.length > 0) lines.push(`Atleta: ${basicParts.join(' · ')}`)

  // Sport & goals
  if (primarySport) lines.push(`Deporte principal: ${primarySport}`)
  if (secondarySports.length) lines.push(`Deportes secundarios: ${secondarySports.join(', ')}`)
  if (sportPrioritySummary) lines.push(`Prioridad deportiva: ${sportPrioritySummary}`)
  if (p.mainGoal) lines.push(`Objetivo principal: ${p.mainGoal}`)
  if (p.secondaryGoal) lines.push(`Objetivo secundario: ${p.secondaryGoal}`)

  // Running profile
  const r = p.runningProfile
  if (r) {
    const runLines: string[] = []
    if (r.fiveKTime) runLines.push(`5K: ${r.fiveKTime}`)
    if (r.tenKTime) runLines.push(`10K: ${r.tenKTime}`)
    if (r.halfMarathonTime) runLines.push(`Media maratón: ${r.halfMarathonTime}`)
    if (r.z2PaceMin || r.z2PaceMax) {
      const z2 = [r.z2PaceMin, r.z2PaceMax].filter(Boolean).join('–')
      runLines.push(`Ritmo Z2: ${z2} /km`)
    }
    if (r.easyPaceMin || r.easyPaceMax) {
      const easy = [r.easyPaceMin, r.easyPaceMax].filter(Boolean).join('–')
      runLines.push(`Ritmo easy: ${easy} /km`)
    }
    if (r.thresholdPace) runLines.push(`Umbral: ${r.thresholdPace} /km`)
    if (r.longRunPace) runLines.push(`Long run: ${r.longRunPace} /km`)
    if (r.notes) runLines.push(`Nota running: ${r.notes}`)
    if (runLines.length > 0) lines.push(`Running — ${runLines.join(' · ')}`)
  }

  // Strength profile
  const s = p.strengthProfile
  if (s) {
    const strLines: string[] = []
    if (s.benchPress1RM) strLines.push(`press banca ${s.benchPress1RM}kg`)
    if (s.squat1RM) strLines.push(`sentadilla ${s.squat1RM}kg`)
    if (s.deadlift1RM) strLines.push(`peso muerto ${s.deadlift1RM}kg`)
    if (s.overheadPress1RM) strLines.push(`press hombro ${s.overheadPress1RM}kg`)
    if (s.pullUpMaxReps) strLines.push(`dominadas ${s.pullUpMaxReps} reps`)
    if (s.notes) strLines.push(`nota: ${s.notes}`)
    if (strLines.length > 0) lines.push(`Fuerza (1RM ref) — ${strLines.join(' · ')}`)
  }

  // Recovery & restrictions
  const rec = p.recoveryProfile
  if (rec) {
    if (rec.currentInjuries?.trim()) lines.push(`Lesión/molestia actual: ${rec.currentInjuries.trim()}`)
    if (rec.restrictions?.trim()) lines.push(`Restricciones: ${rec.restrictions.trim()}`)
    if (rec.previousInjuries?.trim()) lines.push(`Lesiones previas: ${rec.previousInjuries.trim()}`)
  }

  // Schedule
  const sch = p.scheduleProfile
  if (sch) {
    if (sch.availableDays?.length) lines.push(`Disponibilidad: ${sch.availableDays.join(', ')}`)
    if (sch.doubleSessionDays?.length) lines.push(`Doble sesión posible: ${sch.doubleSessionDays.join(', ')}`)
    if (sch.constraints?.trim()) lines.push(`Restricción horaria: ${sch.constraints.trim()}`)
  }

  // Strength % guidelines — only if 1RM data exists
  if (s) {
    const pctLines: string[] = []
    if (s.benchPress1RM) pctLines.push(`press banca: ~${Math.round(s.benchPress1RM * 0.75)}kg al 75%, ~${Math.round(s.benchPress1RM * 0.85)}kg al 85%`)
    if (s.squat1RM) pctLines.push(`sentadilla: ~${Math.round(s.squat1RM * 0.75)}kg al 75%, ~${Math.round(s.squat1RM * 0.85)}kg al 85%`)
    if (s.deadlift1RM) pctLines.push(`peso muerto: ~${Math.round(s.deadlift1RM * 0.75)}kg al 75%, ~${Math.round(s.deadlift1RM * 0.85)}kg al 85%`)
    if (s.overheadPress1RM) pctLines.push(`press hombro: ~${Math.round(s.overheadPress1RM * 0.75)}kg al 75%, ~${Math.round(s.overheadPress1RM * 0.85)}kg al 85%`)
    if (pctLines.length > 0) {
      lines.push(`Cargas de referencia (usa estos valores en exercises.weight, ajusta según objetivo del día):`)
      pctLines.forEach(l => lines.push(`  · ${l}`))
    }
  }

  if (lines.length === 1) return '' // only header, no data
  lines.push('')
  lines.push('Usa este perfil para proponer ritmos realistas, cargas de fuerza por % del 1RM y priorizar el deporte principal al armar la semana.')
  return lines.join('\n')
}

function buildMacroPlanSection(context: ChatContext): string {
  const profile = context.athleteProfile
  const macroPlan = computeMacroPlan(profile)
  if (!macroPlan) return ''

  const event = getPrimaryGoalEvent(profile)
  const eventTitle = event?.title ?? 'evento principal'

  const lines: string[] = ['═══ MACRO PLAN ═══']
  lines.push(`Evento principal: ${eventTitle} (${macroPlan.goalEventDate})`)
  lines.push(`Fase actual: ${getPhaseLabel(macroPlan.currentPhase)}`)
  lines.push(`Semanas restantes: ${formatWeeksRemaining(macroPlan.weeksRemaining)}`)
  lines.push(`Foco del bloque: ${macroPlan.blockFocus}`)
  lines.push('')
  lines.push('REGLAS MACRO PLAN:')
  lines.push('- Usa esta información para ajustar recomendaciones de carga, volumen e intensidad.')
  lines.push('- NO redefinas fases ni crees bloques arbitrarios. Las fases son input del sistema.')
  lines.push('- Si estás en taper o race, prioriza frescura sobre desarrollo.')
  lines.push('- Si estás en base o build, puedes progresar volumen e intensidad normalmente.')
  lines.push('- Si estás en transición (post-evento), prioriza recuperación activa y reset.')

  return lines.join('\n')
}

function buildPlanWizardSection(context: ChatContext): string {
  const config = context.athleteProfile?.planWizardConfig
  if (!config) return ''

  const DAY_ES: Record<string, string> = {
    monday: 'lunes', tuesday: 'martes', wednesday: 'miércoles', thursday: 'jueves',
    friday: 'viernes', saturday: 'sábado', sunday: 'domingo',
  }
  const SPORT_ES: Record<string, string> = {
    squash: 'squash', running: 'running', strength: 'fuerza',
    mobility: 'movilidad', cycling: 'ciclismo',
  }
  const FITNESS_ES: Record<string, string> = {
    fit: 'en buena forma', normal: 'normal (base sólida)',
    returning: 'volviendo de descanso o lesión', low: 'bajo de forma',
  }
  const FATIGUE_ES: Record<string, string> = {
    fresh: 'descansado', normal: 'normal', loaded: 'cargado', overloaded: 'muy cargado',
  }

  const days = config.trainingDays.map(d => DAY_ES[d] ?? d).join(', ')
  const complementary = config.complementarySports.map(s => SPORT_ES[s] ?? s).join(', ')
  const allowedSports = getAllowedPlanningSports(context.athleteProfile).map((sport) => SPORT_ES[sport] ?? sport).join(', ')

  const lines: string[] = ['═══ CONFIGURACIÓN DEL PLAN ═══']
  lines.push('El atleta configuró su plan de competencia con los siguientes parámetros:')
  if (days) lines.push(`- Días de entrenamiento: ${days}`)
  lines.push(`- Sesiones por semana: ${config.sessionsPerWeek}`)
  lines.push(`- Duración por sesión: ${config.sessionDurationMins} min`)
  lines.push(`- Doble sesión: ${config.allowDoubleSession ? 'sí, cuando sea necesario' : 'no'}`)
  if (complementary) lines.push(`- Deportes complementarios: ${complementary}`)
  if (allowedSports) lines.push(`- Deportes permitidos para este plan: ${allowedSports}`)
  if (config.currentFitnessLevel) lines.push(`- Forma física al inicio: ${FITNESS_ES[config.currentFitnessLevel] ?? config.currentFitnessLevel}`)
  if (config.currentFatigue) lines.push(`- Fatiga al inicio: ${FATIGUE_ES[config.currentFatigue] ?? config.currentFatigue}`)
  if (config.injuryNotes?.trim()) lines.push(`- Molestias/restricciones: ${config.injuryNotes.trim()}`)
  lines.push('')
  lines.push('REGLAS: Respeta la distribución semanal acordada. Adapta la carga a la condición inicial del atleta.')
  lines.push('REGLA CRÍTICA: usa SOLO los deportes permitidos para este plan. No agregues running, fuerza, ciclismo u otro deporte si no están explícitamente permitidos aquí, aunque existan en el perfil histórico del atleta.')

  return lines.join('\n')
}

function buildCoachMemorySection(context: ChatContext): string {
  if (!context.athleteMemory?.trim()) return ''

  return `═══ MEMORIA DEL ATLETA ═══
${context.athleteMemory.trim()}

Extrae y aplica activamente cualquiera de estos elementos si aparecen:
- LESIÓN o molestia → modifica o elimina cargas que la afecten, prioriza recuperación o trabajo alternativo
- TORNEO PRÓXIMO → periodiza hacia ese evento: descarga la semana previa, no añadas carga nueva en los últimos 2-3 días
- BLOQUE ACTUAL → respeta el foco declarado (técnico, físico, competitivo) al proponer sesiones
- RESTRICCIÓN → horario, equipamiento, limitación física o disponibilidad de cancha`
}

function buildFatigueSection(context: ChatContext): string {
  const lines: string[] = ['â•â•â• FATIGA Y RECUPERACION â•â•â•']
  const indicators: string[] = []

  const summary = context.currentWeekSummary
  if (summary?.avgActualRpe != null) indicators.push(`RPE real semanal ${summary.avgActualRpe.toFixed(1)}/10`)
  if (summary?.avgSleep != null) indicators.push(`sueÃ±o promedio ${summary.avgSleep.toFixed(1)}h`)
  if (summary?.avgEnergy != null) indicators.push(`energÃ­a promedio ${summary.avgEnergy.toFixed(1)}/10`)

  const logs = (context.weekDayLogs ?? []).filter(log =>
    log.sleepHours != null ||
    log.energyLevel != null ||
    log.painLevel != null ||
    log.rpeActual != null,
  )

  const lowSleepDays = logs.filter(log => (log.sleepHours ?? 99) < 6.5).length
  const lowEnergyDays = logs.filter(log => (log.energyLevel ?? 99) <= 5).length
  const highPainDays = logs.filter(log => (log.painLevel ?? -1) >= 4).length
  const highRpeDays = logs.filter(log => (log.rpeActual ?? -1) >= 8).length

  if (lowSleepDays > 0) indicators.push(`${lowSleepDays} dia(s) con sueÃ±o < 6.5h`)
  if (lowEnergyDays > 0) indicators.push(`${lowEnergyDays} dia(s) con energÃ­a <= 5/10`)
  if (highPainDays > 0) indicators.push(`${highPainDays} dia(s) con dolor >= 4/10`)
  if (highRpeDays > 0) indicators.push(`${highRpeDays} dia(s) con RPE real >= 8/10`)

  if (indicators.length > 0) lines.push(`SeÃ±ales observadas: ${indicators.join(' Â· ')}`)
  else lines.push('Sin seÃ±ales semanales suficientes. Si falta data, usa un taper conservador cuando haya competencia cercana.')

  lines.push('InterpretaciÃ³n obligatoria:')
  lines.push('- Fatiga alta si coinciden 2 o mÃ¡s seÃ±ales: sueÃ±o bajo, energÃ­a baja, dolor elevado, RPE real alto.')
  lines.push('- Si la fatiga es alta y hay competencia cercana, baja volumen antes que solo bajar RPE.')
  lines.push('- Si la fatiga es moderada, conserva solo 1 estÃ­mulo de calidad y limpia lo accesorio.')
  lines.push('- Si la recuperaciÃ³n es buena, puedes mantener calidad, pero sin romper las reglas de taper.')

  return lines.join('\n')
}

function buildHybridSection(context: ChatContext): string {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (enabledSports.length < 2) return ''

  const futureSessions = getPlannedSessions(context)

  const SPORT_ES: Record<SupportedSport, string> = {
    squash: 'Squash', running: 'Running', strength: 'Fuerza',
    mobility: 'Movilidad', cycling: 'Ciclismo',
  }

  const TYPE_MAP: Record<SupportedSport, string[]> = {
    squash: ['squash'], running: ['running'], strength: ['strength'],
    mobility: ['mobility'], cycling: ['cycling'],
  }

  const activeSports = enabledSports.filter(sport =>
    futureSessions.some(s => TYPE_MAP[sport].includes(s.type)),
  )

  if (activeSports.length < 2) return ''

  const primarySport = getPlanningPrimarySport(context.athleteProfile) ?? getPrimarySportNormalized(context.athleteProfile)
  const competitiveSessions = futureSessions.filter(
    s => s.subtype === 'match' || s.subtype === 'competitive',
  )

  const lines: string[] = [`HYBRID ${activeSports.map(s => SPORT_ES[s]).join(' + ')}`]

  for (const sport of activeSports) {
    const count = futureSessions.filter(s => TYPE_MAP[sport].includes(s.type)).length
    lines.push(`${SPORT_ES[sport]} futuro: ${count} sesion(es)`)
  }

  if (competitiveSessions.length > 0) {
    lines.push(`Contexto: ${competitiveSessions.length} sesion(es) competitiva(s) proximas.`)
    lines.push('Reglas obligatorias del bloque hibrido:')
    lines.push('- La competencia mas cercana es la sesion objetivo inmediata; las demas son secundarias.')
    if (primarySport) {
      lines.push(`- Las sesiones de ${SPORT_ES[primarySport]} en semana competitiva mandan sobre el volumen accesorio.`)
    }
    lines.push('- No pongas sesiones de alta intensidad dentro de las 48h previas a la competencia objetivo.')
    lines.push('- Si hay sesion intensa en un deporte, la sesion cercana del otro debe ser Z2 corto, control o recovery.')
    lines.push('- Si la fatiga acumulada es alta, recorta los deportes accesorios antes que tocar la sesion objetivo.')
  } else {
    lines.push('Reglas obligatorias del bloque hibrido:')
    lines.push('- Semana mixta sin competencia: usa los deportes secundarios para construir base sin romper la calidad del principal.')
    lines.push('- Evita apilar sesiones de alta intensidad de distintos deportes en dias consecutivos si no hay buena recuperacion.')
    lines.push('- Si haces un estimulo de calidad en un deporte, el siguiente dia en el otro debe ser tecnico/control o estar suficientemente separado.')
  }

  return lines.join('\n')
}

// Returns sport-specific vocabulary for competition context (match, venue, performance label)
function getCompetitionSportTerms(sessionType: string): { event: string; venue: string; readiness: string } {
  switch (sessionType) {
    case 'squash':
      return { event: 'partido', venue: 'cancha', readiness: 'sensaciones en cancha' }
    case 'running':
      return { event: 'carrera', venue: 'largada', readiness: 'sensaciones de carrera' }
    case 'cycling':
      return { event: 'evento de ciclismo', venue: 'salida', readiness: 'sensaciones en bici' }
    case 'strength':
      return { event: 'competencia de fuerza', venue: 'plataforma', readiness: 'rendimiento en plataforma' }
    default:
      return { event: 'competencia', venue: 'competencia', readiness: 'rendimiento en la competencia' }
  }
}

function buildCompetitionSection(context: ChatContext): string {
  const today = todayISO()
  const upcomingCompetitive = [...getPlannedSessions(context)]
    .filter(session =>
      session.date >= today &&
      (session.subtype === 'match' || session.subtype === 'competitive'),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))

  if (upcomingCompetitive.length === 0) return ''

  const nextCompetitive = upcomingCompetitive[0]
  const nextGapDays = diffDays(today, nextCompetitive.date)
  const terms = getCompetitionSportTerms(nextCompetitive.type)
  const lines: string[] = ['═══ CONTEXTO COMPETITIVO ═══']

  lines.push(`Próximo ${terms.event}: ${nextCompetitive.date} ${nextCompetitive.timeBlock} · ${nextCompetitive.title}`)
  if (typeof nextGapDays === 'number') {
    if (nextGapDays === 0) lines.push(`Ventana competitiva: hoy es día de ${terms.event}.`)
    else if (nextGapDays === 1) lines.push('Ventana competitiva: falta 1 día.')
    else lines.push(`Ventana competitiva: faltan ${nextGapDays} días.`)
  }

  if (upcomingCompetitive.length > 1) {
    lines.push(`Sesiones competitivas próximas: ${upcomingCompetitive.length}. Maneja la carga como microciclo competitivo.`)
  }

  lines.push('Interpretación obligatoria:')
  lines.push(`- Si faltan 0-2 días, prioriza activación, control y frescura para el ${terms.event}.`)
  lines.push('- Si faltan 3-5 días, permite 1 estímulo de calidad y luego baja carga.')
  lines.push(`- Si hay múltiples ${terms.event}s, evita meter fatiga secundaria innecesaria.`)

  return lines.join('\n')
}

function buildCompetitionLoadSection(context: ChatContext): string {
  const today = todayISO()
  const competitiveSessions = getAllContextSessions(context).filter(session =>
    session.subtype === 'match' || session.subtype === 'competitive',
  )

  if (competitiveSessions.length === 0) return ''

  const recentCompetitive = competitiveSessions.filter(session => {
    const gap = diffDays(session.date, today)
    return gap != null && gap >= 0 && gap <= 10
  })
  const nextCompetitive = competitiveSessions
    .filter(session => session.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))[0]

  if (recentCompetitive.length === 0 && !nextCompetitive) return ''

  const terms = getCompetitionSportTerms(nextCompetitive?.type ?? recentCompetitive[0]?.type ?? '')
  const lines: string[] = ['CARGA COMPETITIVA']

  if (recentCompetitive.length > 0) {
    lines.push(`En los ultimos 10 dias hubo ${recentCompetitive.length} sesion(es) competitiva(s) de ${terms.event}.`)
  }
  if (nextCompetitive) {
    lines.push(`El proximo ${terms.event} objetivo inmediato es ${nextCompetitive.date} ${nextCompetitive.timeBlock}.`)
  }

  lines.push('Reglas obligatorias:')
  lines.push(`- Si vienes de varias ${terms.event}s recientes, trata la semana como acumulacion competitiva y no como semana normal de desarrollo.`)
  lines.push(`- Los controles y competencias secundarias no justifican fatiga extra antes del ${terms.event} objetivo inmediato.`)
  lines.push(`- Si ya hubo carga competitiva alta y aparecen senales de fatiga, descarga antes y conserva solo lo que mejora ${terms.readiness}.`)

  return lines.join('\n')
}

function buildLoadAnalyticsSection(context: ChatContext): string {
  const analytics = context.loadAnalytics
  if (!analytics || analytics.weeks.length === 0) return ''
  const runningLoad = analytics.runningWeeklyLoads?.[0]
  const runningAcwr = analytics.runningAcwr

  const SPORT_ES: Record<string, string> = {
    squash: 'Squash', running: 'Running', cycling: 'Ciclismo',
    strength: 'Fuerza', mobility: 'Movilidad',
  }
  const TREND_ES: Record<string, string> = {
    increasing: 'subiendo', stable: 'estable', decreasing: 'bajando',
  }

  const lines: string[] = ['══ CARGA HISTÓRICA POR DISCIPLINA (últimas semanas) ══']

  for (const week of analytics.weeks) {
    const isCurrentWeek = week === analytics.weeks[0]
    const label = isCurrentWeek ? 'Sem actual' : `Sem -${analytics.weeks.indexOf(week)}`
    const disciplineParts = week.disciplines
      .filter(d => d.plannedSessions > 0 || d.completedSessions > 0)
      .map(d => {
        const name = SPORT_ES[d.type] ?? d.type
        return `${name} ${d.completedSessions}/${d.plannedSessions} (${d.completedMinutes}min)`
      })
    const rpeStr = week.avgActualRpe != null ? ` · RPE ${week.avgActualRpe}` : ''
    const loadStr = week.totalWeightedLoad > 0 ? ` · Carga ${Math.round(week.totalWeightedLoad)}` : ''
    lines.push(
      `${label} [${week.weekStart}]: ${disciplineParts.join(' · ')} | Adherencia ${week.adherencePct}%${rpeStr}${loadStr}`,
    )
  }

  lines.push('')
  lines.push(`Tendencia general: ${TREND_ES[analytics.overallTrend]}`)
  if (analytics.weeks[0].runningMinutes > 0 || analytics.weeks[1]?.runningMinutes > 0) {
    lines.push(`Tendencia running: ${TREND_ES[analytics.runningTrend]}`)
  }
  lines.push(`Tendencia adherencia: ${TREND_ES[analytics.adherenceTrend]}`)

  if (analytics.acwr) {
    const acwr = analytics.acwr
    lines.push('')
    lines.push(`ACWR actual: ${acwr.ratio.toFixed(2)} · aguda ${Math.round(acwr.acute)} · cronica ${Math.round(acwr.chronic)} · baseline ${acwr.baselineWeeks} semana(s)`)

    if (acwr.baselineLimited) {
      lines.push('ACWR con baseline limitada: usalo solo como senal direccional, no como regla rigida.')
      lines.push('Si el atleta se siente bien y no hay competencia cercana, puedes progresar con prudencia.')
    } else if (acwr.zone === 'risk') {
      lines.push('ACWR en zona de riesgo: no agregues volumen ni intensidad extra salvo que el usuario pida una descarga muy puntual con razon clara.')
      lines.push('Prioriza reducir carga, mantener tecnica, recovery, movilidad y llegar fresco a sesiones clave.')
    } else if (acwr.zone === 'undertrained') {
      lines.push('ACWR en zona baja: puedes progresar la carga si no hay senales de fatiga, dolor o taper competitivo.')
      lines.push('La progresion debe ser gradual y sin apilar dos dias duros seguidos.')
    } else {
      lines.push('ACWR en zona razonable: manten una progresion moderada y evita cambios bruscos de volumen.')
    }
  } else {
    lines.push('ACWR no disponible todavia: no hay baseline suficiente de semanas previas con carga.')
  }

  lines.push('Usa esta informacion para ajustar la carga propuesta: si la carga viene alta, no sumes mas volumen; si viene baja y el atleta esta recuperado, puedes progresar.')

  if (runningLoad && runningLoad.sessionsCount > 0) {
    const distanceStr = runningLoad.totalDistanceKm != null
      ? `${runningLoad.totalDistanceKm} km`
      : `${runningLoad.totalDurationMin ?? 0} min`
    const ratioStr = runningAcwr.ratio != null ? runningAcwr.ratio.toFixed(2) : 'sin ratio'
    lines.push(`Running cuantitativo: ${distanceStr} en ${runningLoad.sessionsCount} sesion(es) - carga ${Math.round(runningLoad.totalLoad)} - ACWR running ${ratioStr} (${runningAcwr.status})`)
    if (runningAcwr.status === 'risk') {
      lines.push('Senal running: descarga running primero y no castigues squash o fuerza si esos deportes siguen estables.')
    } else if (runningAcwr.status === 'undertrained') {
      lines.push('Senal running: puedes progresar running si la fase y la fatiga lo permiten.')
    } else if (runningAcwr.status === 'limited') {
      lines.push('Senal running: historial insuficiente; usa esta capa solo como apoyo y manten la logica contextual actual.')
    }
  }

  // ACWR por disciplina — permite decisiones independientes por deporte
  const byDisc = analytics.acwrByDiscipline
  if (byDisc) {
    const ZONE_ES: Record<string, string> = {
      undertrained: 'baja', optimal: 'optima', risk: 'riesgo', limited: 'insuf',
    }
    const disciplineLines: string[] = []
    for (const sport of ['squash', 'running', 'strength'] as const) {
      const d = byDisc[sport]
      if (d.acuteLoad > 0) {
        const ratioStr = d.ratio != null ? d.ratio.toFixed(2) : 'sin ratio'
        disciplineLines.push(`${sport === 'strength' ? 'Fuerza' : sport.charAt(0).toUpperCase() + sport.slice(1)}: ${ratioStr} (${ZONE_ES[d.status]})`)
      }
    }
    if (disciplineLines.length > 0) {
      lines.push('')
      lines.push(`ACWR por deporte: ${disciplineLines.join(' · ')}`)
      lines.push('Usa estos ratios para decidir por deporte de forma independiente: puedes bajar running sin tocar squash, mantener fuerza aunque squash este alto, etc.')
    }
  }

  return lines.join('\n')
}

function buildImplicitPrioritySection(context: ChatContext): string {
  const today = todayISO()
  const upcomingCompetitive = getPlannedSessions(context)
    .filter(session =>
      session.date >= today &&
      (session.subtype === 'match' || session.subtype === 'competitive'),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))

  if (upcomingCompetitive.length === 0) return ''

  const memory = `${context.athleteMemory ?? ''} ${context.recentMessages?.map(message => message.content).join(' ') ?? ''}`.toLowerCase()
  const ranked = upcomingCompetitive
    .map(session => ({ session, score: scoreCompetitivePriority(session, memory, today) }))
    .sort((a, b) =>
      b.score - a.score ||
      a.session.date.localeCompare(b.session.date) ||
      a.session.timeBlock.localeCompare(b.session.timeBlock),
    )

  const top = ranked[0]
  if (!top || top.score <= 0) return ''

  const reasons = explainPrioritySignals(top.session, memory, today)
  const lines: string[] = ['PRIORIDAD COMPETITIVA IMPLICITA']

  lines.push(`Si el usuario no declara el evento principal, asume como prioridad actual: ${top.session.date} ${top.session.timeBlock} · ${top.session.title}.`)
  if (reasons.length > 0) {
    lines.push(`Senales detectadas: ${reasons.join(' · ')}`)
  }

  lines.push('Reglas obligatorias:')
  lines.push('- Usa esta competencia como referencia principal para taper, running accesorio y limpieza de fatiga.')
  lines.push('- Si otra competencia aparece despues, tratala como secundaria salvo que memoria o mensajes indiquen explicitamente que es el objetivo mayor.')
  lines.push('- Si la memoria menciona torneo objetivo, rival clave, liga o evento importante, eso pesa mas que una simple cercania de fecha.')

  return lines.join('\n')
}

/**
 * Surfaces recent squash match results so the coach knows the athlete's
 * competitive form, opponents faced and scores — context that shapes taper
 * and tactical focus decisions.
 */
function buildSquashMatchHistorySection(context: ChatContext): string {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (!enabledSports.includes('squash')) return ''

  const completedMatches = getSquashMatchHistory(getHistoricalSessions(context), 6)

  if (completedMatches.length === 0) return ''

  const lines: string[] = ['HISTORIAL DE PARTIDOS RECIENTES (squash)']

  for (const match of completedMatches) {
    const parts: string[] = [match.date]
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

function buildDynamicSquashSelectionSection(
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

  if (!import.meta.env.PROD) {
    const smoke = runSquashDrillSelectorSmokeChecks().slice(0, 2).join(' || ')
    lines.push(`Debug selector (dev): ${smoke}`)
  }

  return lines.join('\n')
}

function buildDynamicStrengthSelectionSection(
  context: ChatContext,
  summary = buildStrengthSelectionSummary(context),
): string {
  if (!summary) return ''

  const { selection, selectionContext } = summary
  const lines: string[] = ['SELECCION DINAMICA DE FUERZA']

  lines.push(`Foco sugerido: ${selection.focus}`)
  lines.push(
    `Contexto selector: fase ${selectionContext.phase} · fatiga ${selectionContext.fatigueLevel}/10 · perfil ${selectionContext.sportProfile} · competencia cercana ${
      selectionContext.competitionSoon ? 'si' : 'no'
    }${selectionContext.primarySport ? ` · deporte principal ${selectionContext.primarySport}` : ''}`,
  )
  lines.push(`Continuidad: ${summarizeStrengthProgression(selectionContext)}`)
  if (selectionContext.strengthAcwr?.ratio != null) {
    lines.push(`Fuerza ACWR: ${selectionContext.strengthAcwr.ratio.toFixed(2)} (${selectionContext.strengthAcwr.status})`)
  }
  if (selectionContext.strengthAcwr?.status === 'risk') {
    lines.push('Fuerza: carga elevada — progression intent ajustado a deload.')
  }
  lines.push(`Ejercicios sugeridos ahora: ${formatSelectedStrengthExercises(selection.exercises)}`)
  lines.push(`Formato compatible actual: ${stringifyStrengthExercises(selection.exercises)}`)
  lines.push('Si fuerza es principal, esta seleccion manda como sesion real de pesas y no como complemento generico.')
  lines.push('Si fuerza es secundaria, manten la utilidad y controla interferencia con el deporte principal.')

  if (!import.meta.env.PROD) {
    const smoke = runStrengthSelectorSmokeChecks().slice(0, 3).join(' || ')
    lines.push(`Debug selector (dev): ${smoke}`)
  }

  return lines.join('\n')
}

function buildDynamicRunningSelectionSection(
  context: ChatContext,
  summary = buildRunningSelectionSummary(context),
): string {
  if (!summary) return ''

  const { selection, selectionContext } = summary
  const lines: string[] = ['SELECCION DINAMICA DE RUNNING']

  lines.push(`Perfil: ${selectionContext.sportProfile}`)
  lines.push(`Foco sugerido: ${selection.focus}`)
  lines.push(
    `Contexto selector: fase ${selectionContext.phase} · fatiga ${selectionContext.fatigueLevel}/10 · perfil ${selectionContext.sportProfile} · competencia cercana ${
      selectionContext.competitionSoon ? 'si' : 'no'
    }${selectionContext.primarySport ? ` · deporte principal ${selectionContext.primarySport}` : ''}`,
  )
  if (selectionContext.runningWeeklyLoad?.sessionsCount) {
    const weeklyVolume = selectionContext.runningWeeklyLoad.totalDistanceKm != null
      ? `${selectionContext.runningWeeklyLoad.totalDistanceKm} km`
      : `${selectionContext.runningWeeklyLoad.totalDurationMin ?? 0} min`
    const acwrRatio = selectionContext.runningAcwr?.ratio != null
      ? selectionContext.runningAcwr.ratio.toFixed(2)
      : 'sin ratio'
    lines.push(`Running ACWR: ${acwrRatio} (${selectionContext.runningAcwr?.status ?? 'limited'})`)
    lines.push(`Weekly running load: ${weeklyVolume} / ${selectionContext.runningWeeklyLoad.sessionsCount} sesiones`)
  }
  lines.push(`Continuidad: ${summarizeRunningProgression(selectionContext)}`)
  lines.push(`Sesion sugerida: ${selection.session.name} — ${selection.session.structure} — intensidad ${selection.session.intensity}`)
  lines.push(`runningType compatible: ${selection.session.runningType}`)
  if (selection.session.notes) lines.push(`Nota: ${selection.session.notes}`)
  if (selectionContext.runningAcwr?.status === 'risk') {
    lines.push('Running progression intent adjusted to deload por carga especifica de running.')
  }
  lines.push('Si running es deporte principal, esta seleccion manda como sesion de entrenamiento real con continuidad y no como cardio generico.')
  lines.push('Si running es complemento, controla la carga para no interferir con el deporte principal.')

  if (!import.meta.env.PROD) {
    const smoke = runRunningSelectorSmokeChecks().slice(0, 2).join(' || ')
    lines.push(`Debug selector (dev): ${smoke}`)
  }

  return lines.join('\n')
}

/**
 * Aggregates exercise weight progression from recent completed strength sessions.
 * Groups by exercise name and shows the last values chronologically so the coach
 * can propose concrete loads — not just generic "moderate weight".
 */
function buildStrengthProgressionSection(context: ChatContext): string {
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  if (!enabledSports.includes('strength')) return ''

  const progressions = getStrengthProgression(getHistoricalSessions(context), 4, 4)
  if (progressions.length === 0) return ''

  const lines: string[] = ['PROGRESIÓN DE FUERZA (sesiones completadas recientes)']

  for (const progression of progressions) {
    const trend = progression.entries
      .map((entry) => {
        const load = entry.weight != null ? `${entry.weight}kg` : ''
        return `${entry.sets}×${entry.reps}${load ? `@${load}` : ''}`
      })
      .join(' → ')
    lines.push(`· ${progression.exerciseLabel}: ${trend}`)
  }

  lines.push('')
  lines.push('Usa estos datos para proponer cargas concretas en la proxima sesion de fuerza. Si la tendencia sube, propone la carga siguiente logica (2-5% mas o misma carga con mas volumen). Si la carga se estanco, varia el esquema (series, reps, tempo).')
  lines.push('IMPORTANTE: cuando propongas ejercicios en <actions>, usa el campo weight con la carga real derivada de este historial o del 1RM declarado en el perfil.')

  return lines.join('\n')
}

function buildSessionsSection(sessions: Session[]): string {
  const today = todayISO()
  const futureSessions = sessions.filter(s => s.date >= today)

  const lines: string[] = ['═══ SESIONES DISPONIBLES (HOY Y FUTURO) ═══']

  if (futureSessions.length === 0) {
    lines.push('⚠ No hay sesiones planificadas para esta semana.')
    lines.push('→ Si el usuario pide crear una semana, usa la acción create_week con sesiones concretas.')
    lines.push('→ Usa los días de la semana actual indicados en las instrucciones.')
    return lines.join('\n')
  }

  lines.push('(IDs incluidos — úsalos en las acciones si propones cambios)')

  const sorted = [...futureSessions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock)
  )

  for (const s of sorted) {
    const dayName = getDayName(s.date)
    const type = SESSION_TYPE_ES[s.type] ?? s.type
    const subtype = s.subtype ? ` (${SQUASH_SUBTYPE_ES[s.subtype] ?? s.subtype})` : ''
    const status = STATUS_ES[s.status] ?? s.status
    const rpe = s.rpe != null ? ` RPE${s.actualRpe ?? s.rpe}${s.actualRpe != null ? ' real' : ''}` : ''
    const duration = `${s.actualDurationMin ?? s.durationMin}min`
    const flag = s.status === 'completed' ? '✓' : s.status === 'skipped' ? '✗' : s.status === 'adjusted' ? '~' : '○'
    const matchMeta = formatMatchMeta(s)

    lines.push(`${flag} [${s.id.slice(0, 8)}] ${dayName} ${s.timeBlock} · ${type}${subtype} "${s.title}" · ${duration}${rpe} · ${status}${matchMeta}`)

    if (s.squashDetails) {
      const focus = s.squashDetails.trainingFocus
      const focusLabel: Record<string, string> = { technical: 'técnico', tactical: 'táctico', physical: 'físico', conditioned_games: 'juegos condicionados' }
      const drillStr = s.squashDetails.drills.map(d => d.durationMin ? `${d.name} ${d.durationMin}min` : d.name).join(', ')
      lines.push(`   ↳ ${focusLabel[focus] ?? focus}: ${drillStr}`)
    }

    if (s.runningDetails) {
      const rd = s.runningDetails
      const runType = RUNNING_TYPE_ES[rd.runningType] ?? rd.runningType
      const pace = rd.targetPaceMin
        ? `${rd.targetPaceMin}${rd.targetPaceMax ? `–${rd.targetPaceMax}` : ''} /km`
        : null
      const hr = rd.targetHrMin ? `FC ${rd.targetHrMin}–${rd.targetHrMax ?? '?'} bpm` : null
      const details = [runType, pace, hr].filter(Boolean).join(' · ')
      if (details) lines.push(`   ↳ ${details}`)
    }

    if (s.exercises && s.exercises.length > 0) {
      const exStr = s.exercises
        .slice(0, 6)
        .map(ex => {
          const w = ex.weight ? ` ${ex.weight}kg` : ''
          return `${ex.name} ${ex.sets}×${ex.reps}${w}`
        })
        .join(', ')
      lines.push(`   ↳ ${exStr}${s.exercises.length > 6 ? ` +${s.exercises.length - 6} más` : ''}`)
    }

    if (s.completionNotes) {
      lines.push(`   ↳ Nota post: "${s.completionNotes.slice(0, 80)}"`)
    }
  }

  return lines.join('\n')
}

function buildTodaySection(context: ChatContext): string {
  const { dayLog } = context
  const today = todayISO()

  const lines: string[] = [`═══ HOY (${formatDateShort(today)}) ═══`]

  if (!dayLog) {
    lines.push('Sin registro diario todavía.')
    return lines.join('\n')
  }

  if (dayLog.sleepHours != null) {
    const qual = dayLog.sleepQuality != null ? ` · Calidad ${dayLog.sleepQuality}/5` : ''
    lines.push(`Sueño: ${dayLog.sleepHours}h${qual}`)
  }
  if (dayLog.energyLevel != null) lines.push(`Energía: ${dayLog.energyLevel}/10`)
  if (dayLog.painLevel != null) {
    const pain = dayLog.painLevel === 0 ? 'Sin dolor' : `${dayLog.painLevel}/10`
    const notes = dayLog.painNotes ? ` – ${dayLog.painNotes}` : ''
    lines.push(`Dolor: ${pain}${notes}`)
  }
  if (dayLog.rpeActual != null) lines.push(`RPE real hoy: ${dayLog.rpeActual}/10`)
  if (dayLog.postSessionComment) {
    lines.push(`Comentario: "${dayLog.postSessionComment.slice(0, 120)}"`)
  }
  if (dayLog.generalNotes) {
    lines.push(`Notas día: "${dayLog.generalNotes.slice(0, 120)}"`)
  }

  return lines.join('\n')
}

function buildWeekDayLogsSection(context: ChatContext): string {
  const logs = context.weekDayLogs
    ?.filter(log =>
      log.sleepHours != null ||
      log.energyLevel != null ||
      log.painLevel != null ||
      log.rpeActual != null ||
      log.postSessionComment ||
      log.generalNotes ||
      log.bodyWeight != null
    )

  if (!logs || logs.length === 0) return ''

  const lines: string[] = ['═══ REGISTROS DE LA SEMANA ═══']
  for (const log of logs) {
    const parts: string[] = []
    if (log.sleepHours != null) parts.push(`sueño ${log.sleepHours}h`)
    if (log.energyLevel != null) parts.push(`energía ${log.energyLevel}/10`)
    if (log.painLevel != null) parts.push(`dolor ${log.painLevel}/10`)
    if (log.rpeActual != null) parts.push(`RPE real ${log.rpeActual}/10`)
    if (log.bodyWeight != null) parts.push(`peso ${log.bodyWeight}kg`)
    if (log.postSessionComment) parts.push(`post: "${log.postSessionComment.slice(0, 80)}"`)
    if (log.generalNotes) parts.push(`nota: "${log.generalNotes.slice(0, 80)}"`)
    lines.push(`${log.date} · ${parts.join(' · ')}`)
  }

  return lines.join('\n')
}

interface ResponsePromptContext {
  today: string
  weekStart: string
  weekDates: string
  primary?: SupportedSport
  primarySportLabel: string
  sportPriority: string
  playsSquash: boolean
  hasRunning: boolean
  hasStrength: boolean
  hasCycling: boolean
  hasMobility: boolean
  plannedSessionLines: string
  z2min: string
  z2max: string
  tempoMin: string
  tempoMax: string
  longRunPaceStr: string
  intervalPaceStr: string
  w: {
    bench75: number
    bench85: number
    row75: number
    ohp75: number
    squat75: number
    squat85: number
    deadlift75: number
  }
  hipThrust85: number
  lunge45: number
  squashSummary: SquashSelectionSummary
  strengthSummary: StrengthSelectionSummary
  squashBaseSelection: ReturnType<typeof selectSquashDrills>
  squashCompetitiveSelection: ReturnType<typeof selectSquashDrills>
  squashControlSelection: ReturnType<typeof selectSquashDrills>
  squashTemplateSummary: string
  squashBaseDrillsJson: string
  squashControlDrillsJson: string
  squashCompetitiveDrillsJson: string
  squashBaseObjective: string
  squashCompetitiveObjective: string
  strengthBaseSelection: ReturnType<typeof selectStrengthSession>
  strengthSupportSelection: ReturnType<typeof selectStrengthSession>
  strengthPrimarySelection: ReturnType<typeof selectStrengthSession>
  strengthPrimaryFollowUpSelection: ReturnType<typeof selectStrengthSession>
  strengthBaseSummary: string
  strengthBaseExercisesJson: string
  strengthSupportExercisesJson: string
  strengthPrimaryExercisesJson: string
  strengthPrimaryFollowUpExercisesJson: string
}

function buildResponsePromptContext(
  sessions: Session[],
  context: ChatContext,
  squashSummary: SquashSelectionSummary,
  strengthSummary: StrengthSelectionSummary,
): ResponsePromptContext {
  const today = todayISO()
  const weekStart = context.currentWeekSummary?.weekStartDate ?? currentWeekStartISO()
  const weekDates = buildWeekDatesList(weekStart)
  const enabledSports = getAllowedPlanningSports(context.athleteProfile)
  const primarySportNorm = getPlanningPrimarySport(context.athleteProfile) ?? getPrimarySportNormalized(context.athleteProfile)
  const primarySportLabel = primarySportNorm
    ?? context.athleteProfile?.primarySport?.trim()
    ?? 'deporte principal'
  const playsSquash = enabledSports.includes('squash')
  const hasRunning = enabledSports.includes('running')
  const hasStrength = enabledSports.includes('strength')
  const hasCycling = enabledSports.includes('cycling')
  const hasMobility = enabledSports.includes('mobility')

  const SPORT_SESSION_COUNTS: Partial<Record<string, string>> = {
    squash: '2-3 sesiones/semana',
    running: '2-3 sesiones/semana',
    strength: '1-2 sesiones/semana',
    mobility: '1 sesión/semana',
    cycling: '1-2 sesiones/semana',
  }

  const activeSportList = enabledSports.length > 0
    ? enabledSports
    : [
        playsSquash ? 'squash' : null,
        hasRunning ? 'running' : null,
        hasStrength ? 'strength' : null,
        hasCycling ? 'cycling' : null,
      ].filter(Boolean) as string[]

  const sportPriority = activeSportList.length > 0
    ? activeSportList.map(s => `${s} (${SPORT_SESSION_COUNTS[s] ?? '1-2 sesiones/semana'})`).join(' > ')
    : `${primarySportLabel} (2-3 sesiones/semana)`

  const sp = context.athleteProfile?.strengthProfile
  const w = {
    bench75: sp?.benchPress1RM ? Math.round(sp.benchPress1RM * 0.75) : 80,
    bench85: sp?.benchPress1RM ? Math.round(sp.benchPress1RM * 0.85) : 90,
    row75: sp?.deadlift1RM ? Math.round(sp.deadlift1RM * 0.55) : 60,
    ohp75: sp?.overheadPress1RM ? Math.round(sp.overheadPress1RM * 0.75) : 50,
    squat75: sp?.squat1RM ? Math.round(sp.squat1RM * 0.75) : 90,
    squat85: sp?.squat1RM ? Math.round(sp.squat1RM * 0.85) : 102,
    deadlift75: sp?.deadlift1RM ? Math.round(sp.deadlift1RM * 0.75) : 110,
  }

  const rp = context.athleteProfile?.runningProfile
  const z2min = rp?.z2PaceMin ?? '5:30'
  const z2max = rp?.z2PaceMax ?? '6:00'
  const tempoMin = rp?.thresholdPace ? addSecsToPace(rp.thresholdPace, -10) : '4:40'
  const tempoMax = rp?.thresholdPace ?? '5:00'
  const longRunPaceStr = rp?.longRunPace ?? rp?.easyPaceMax ?? '6:00'
  const intervalPaceStr = rp?.fiveKTime ? deriveIntervalPace(rp.fiveKTime) : '4:15'

  const hipThrust85 = sp?.squat1RM ? Math.round(sp.squat1RM * 0.85) : 100
  const lunge45 = sp?.squat1RM ? Math.round(sp.squat1RM * 0.45) : 55
  const plannedSessionLines = sessions
    .filter(s => s.status === 'planned' && s.date >= today)
    .slice(0, 10)
    .map(s => `  [${s.id.slice(0, 8)}] ${getDayName(s.date)} ${s.timeBlock} · ${SESSION_TYPE_ES[s.type] ?? s.type} "${s.title}"`)
    .join('\n')

  const primary = getPlanningPrimarySport(context.athleteProfile)
  const squashSelection = squashSummary?.selection
  const squashSelectorContext = squashSummary?.selectionContext
  const strengthSelection = strengthSummary?.selection
  const strengthSelectorContext = strengthSummary?.selectionContext

  const squashBaseSelection = squashSelection ?? selectSquashDrills({
    fatigueLevel: 4,
    phase: 'build',
    recentDrills: [],
    goal: 'desarrollar control, precision y presion en squash',
    competitionSoon: false,
  })
  const squashCompetitiveSelection = selectSquashDrills({
    fatigueLevel: Math.max(squashSelectorContext?.fatigueLevel ?? 4, 4),
    phase: 'taper',
    recentDrills: squashSelectorContext?.recentDrills ?? [],
    goal: 'llegar fresco al partido objetivo y afinar timing en squash',
    competitionSoon: true,
  })
  const squashControlSelection = selectSquashDrills({
    fatigueLevel: Math.max(squashSelectorContext?.fatigueLevel ?? 4, 5),
    phase: squashSelectorContext?.competitionSoon ? 'taper' : 'base',
    recentDrills: squashBaseSelection.drills.map(drill => drill.name),
    goal: 'limpiar tecnica, timing y control sin cargar de mas',
    competitionSoon: squashSelectorContext?.competitionSoon ?? false,
  })
  const squashTemplateSummary = formatSelectedSquashDrills(squashBaseSelection.drills, 3)
  const squashBaseDrillsJson = stringifySquashDrills(squashBaseSelection.drills.slice(0, 3))
  const squashControlDrillsJson = stringifySquashDrills(squashControlSelection.drills.slice(0, 3))
  const squashCompetitiveDrillsJson = stringifySquashDrills(squashCompetitiveSelection.drills.slice(0, 3))
  const squashBaseObjective = squashBaseSelection.trainingFocus === 'tactical'
    ? 'Tactico con cierre tecnico. Intensidad progresiva.'
    : squashBaseSelection.trainingFocus === 'physical'
      ? 'Fisico-especifico con control tecnico. Intensidad progresiva.'
      : 'Tecnico con cierre tactico. Intensidad progresiva.'
  const squashCompetitiveObjective = `Sesion ${squashCompetitiveSelection.trainingFocus} de ajuste, precision y timing sin fatiga alta.`
  const strengthBaseSelection = strengthSelection ?? selectStrengthSession({
    fatigueLevel: 4,
    phase: 'build',
    recentExercises: [],
    goal: 'desarrollar una sesion de fuerza completa y util',
    sportProfile: primary === 'strength' ? 'strength_primary' : 'hybrid',
    primarySport: primary,
    experienceLevel: 'intermediate',
    sessionDurationMin: primary === 'strength' ? 65 : 55,
    competitionSoon: false,
  })
  const strengthSupportSelection = selectStrengthSession({
    fatigueLevel: Math.max(strengthSelectorContext?.fatigueLevel ?? 4, 4),
    phase: strengthSelectorContext?.competitionSoon ? 'taper' : 'base',
    recentExercises: strengthSelectorContext?.recentExercises ?? strengthBaseSelection.exercises.map((exercise) => exercise.name),
    goal: 'fuerza de apoyo con fatiga controlada',
    sportProfile: primary === 'strength' ? 'hybrid' : 'sport_support',
    primarySport: primary,
    experienceLevel: strengthSelectorContext?.experienceLevel ?? 'intermediate',
    sessionDurationMin: 45,
    competitionSoon: strengthSelectorContext?.competitionSoon ?? false,
    daysToCompetition: strengthSelectorContext?.daysToCompetition,
  })
  const strengthPrimarySelection = selectStrengthSession({
    fatigueLevel: strengthSelectorContext?.fatigueLevel ?? 4,
    phase: strengthSelectorContext?.phase ?? 'build',
    recentExercises: strengthSelectorContext?.recentExercises ?? [],
    goal: 'desarrollar fuerza principal de pesas',
    sportProfile: 'strength_primary',
    primarySport: 'strength',
    experienceLevel: strengthSelectorContext?.experienceLevel ?? 'intermediate',
    sessionDurationMin: 65,
    competitionSoon: false,
  })
  const strengthPrimaryFollowUpSelection = selectStrengthSession({
    fatigueLevel: strengthSelectorContext?.fatigueLevel ?? 4,
    phase: strengthSelectorContext?.phase === 'taper' ? 'base' : strengthSelectorContext?.phase ?? 'build',
    recentExercises: strengthPrimarySelection.exercises.map((exercise) => exercise.name),
    goal: 'variar la segunda sesion de fuerza principal sin repetir lift central',
    sportProfile: 'strength_primary',
    primarySport: 'strength',
    experienceLevel: strengthSelectorContext?.experienceLevel ?? 'intermediate',
    sessionDurationMin: 60,
    competitionSoon: false,
  })
  const strengthBaseSummary = formatSelectedStrengthExercises(strengthBaseSelection.exercises, 3)
  const strengthBaseExercisesJson = stringifyStrengthExercises(strengthBaseSelection.exercises, 5)
  const strengthSupportExercisesJson = stringifyStrengthExercises(strengthSupportSelection.exercises, 4)
  const strengthPrimaryExercisesJson = stringifyStrengthExercises(strengthPrimarySelection.exercises, 5)
  const strengthPrimaryFollowUpExercisesJson = stringifyStrengthExercises(strengthPrimaryFollowUpSelection.exercises, 4)

  return {
    today,
    weekStart,
    weekDates,
    primary,
    primarySportLabel,
    sportPriority,
    playsSquash,
    hasRunning,
    hasStrength,
    hasCycling,
    hasMobility,
    plannedSessionLines,
    z2min,
    z2max,
    tempoMin,
    tempoMax,
    longRunPaceStr,
    intervalPaceStr,
    w,
    hipThrust85,
    lunge45,
    squashSummary,
    strengthSummary,
    squashBaseSelection,
    squashCompetitiveSelection,
    squashControlSelection,
    squashTemplateSummary,
    squashBaseDrillsJson,
    squashControlDrillsJson,
    squashCompetitiveDrillsJson,
    squashBaseObjective,
    squashCompetitiveObjective,
    strengthBaseSelection,
    strengthSupportSelection,
    strengthPrimarySelection,
    strengthPrimaryFollowUpSelection,
    strengthBaseSummary,
    strengthBaseExercisesJson,
    strengthSupportExercisesJson,
    strengthPrimaryExercisesJson,
    strengthPrimaryFollowUpExercisesJson,
  }
}

function buildResponseInstructions(
  sessions: Session[],
  context: ChatContext,
  promptContext: ResponsePromptContext = buildResponsePromptContext(
    sessions,
    context,
    buildSquashSelectionSummary(context),
    buildStrengthSelectionSummary(context),
  ),
): string {
  const {
    today,
    weekStart,
    weekDates,
    sportPriority,
    playsSquash,
    hasRunning,
    hasStrength,
    hasCycling,
    plannedSessionLines,
    z2min,
    z2max,
    tempoMin,
    tempoMax,
    longRunPaceStr,
    w,
    squashBaseDrillsJson,
    strengthBaseSelection,
    strengthSupportSelection,
    strengthPrimarySelection,
    strengthPrimaryFollowUpSelection,
    strengthBaseExercisesJson,
    strengthSupportExercisesJson,
    strengthPrimaryExercisesJson,
    strengthPrimaryFollowUpExercisesJson,
  } = promptContext
  const baseWeekTemplate = buildBaseWeekTemplate(promptContext)
  const allowedSessionTypes = [
    playsSquash ? 'squash' : null,
    hasRunning ? 'running' : null,
    hasCycling ? 'cycling' : null,
    hasStrength ? 'strength' : null,
    'mobility',
    'recovery',
  ].filter(Boolean).join('|')
  const titleExamples = [
    playsSquash ? '"Squash entrenamiento"' : null,
    hasRunning ? '"Running Z2"' : null,
    hasCycling ? '"Ciclismo Z2"' : null,
    hasStrength ? '"Fuerza upper"' : null,
  ].filter(Boolean).join(', ')
  const runningOrCyclingLabel = hasRunning && hasCycling ? 'running y cycling' : hasRunning ? 'running' : 'cycling'

  return `═══ INSTRUCCIONES DEL COACH-PLANNER ═══

REGLAS CRÍTICAS:
1. Si el usuario pide "crear semana", "armar semana", "planificar semana", "dame la propuesta", "dame un plan", "dame la semana", "construye la semana", "hazme la semana", "qué hacemos esta semana", "propuesta de semana" → DEBES responder con create_week. No solo texto. No describas el plan y luego pidas confirmación — créalo directamente.
2. Si el usuario pide "agregar sesión", "pon un X el día Y", "agrega X" → DEBES responder con add_session. No solo texto.
3. Si el usuario pide "cambia los ejercicios", "agrégale X", "reemplaza", "mejora la propuesta", "incorpora X", "agrega running", "agrega squash", "baja squash", "sube running" o redistribuir la semana → DEBES priorizar update_session, move_session, replace_session_type o delete_session sobre add_session cuando la intención sea reemplazar o ajustar lo ya existente. No acumules sesiones o ejercicios viejos si la idea es sustituirlos.
4. Si falta contexto → asume valores razonables para el atleta y explícalo en 1 frase.
5. Si no hay sesiones en la semana → crea una semana base COMPLETA sin pedir confirmación.
6. NUNCA respondas con solo texto cuando se pidió una acción. Si describiste el plan en texto, DEBES incluir el bloque <actions> al final en la misma respuesta.
7. SOLO puedes usar deportes permitidos por la planificación actual: ${getAllowedPlanningSports(context.athleteProfile).join(', ') || 'sin restricción explícita'}. Si running no está en esa lista, NO lo agregues.

PERFIL BASE DEL ATLETA (defaults para propuestas):
- Prioridad: ${sportPriority}
- Semana base típica:
${baseWeekTemplate}

SEMANA COMPETITIVA Y PRE-TORNEO:
- Si aparece un partido o torneo, el objetivo principal pasa a ser rendir fresco en cancha.
- Si faltan 2 dias o menos para competir, evita agregar sesiones que dejen DOMS o fatiga metabolica alta.
- Fuerza en semana competitiva: volumen bajo, foco neural/estabilidad, nunca pesada pegada al partido.
${hasRunning ? '- Running en semana competitiva: Z2 corto o activacion; evita tempo o intervalos largos salvo que esten lejos del partido.' : ''}
- Pre-competencia (deporte principal): sesion tecnica corta o activacion especifica; no sesiones largas de desgaste.${playsSquash ? '\n- Squash pre-partido: control tecnico, precision, sensaciones, T, largo-corto, activacion de pies; no sesiones de RSA ni carga fisica alta.' : ''}
- Si el usuario menciona torneo, liga, rival, cuadro o fin de semana competitivo, debes responder como coach en taper, no como semana base normal.
- El deporte accesorio en semana competitiva no debe quitar frescura a la sesion objetivo del deporte principal.
- Si hay competencia objetivo, prioriza cardio recovery o Z2 corto; deja intensidad alta fuera de la ventana sensible.
- Si hay varias competencias, distingue entre sesion objetivo inmediata y carga secundaria; protege primero la inmediata.
- Un control no compite por prioridad con un match o competitive; usalo como ajuste tecnico o activacion.
${hasRunning ? '- Un match o competitive mas cercano manda sobre cualquier desarrollo de running de esa misma ventana.' : ''}
- Si el deporte principal es fuerza, trata la fuerza como disciplina principal: lift central, accesorios coherentes, trunk y progresion real.
- Si la fuerza no es principal, ajusta el volumen para que complemente al deporte objetivo y no robe frescura.
- No uses la misma receta de pesas para todos: decide entre fuerza, hipertrofia, potencia, estabilidad o recovery segun fase, fatiga, historial y rol de la fuerza.

FECHA HOY: ${today}
${weekDates}
${buildDynamicPromptSelectionSections(promptContext)}

${buildReferenceLoadSection(promptContext)}

SESIONES PLANIFICADAS (IDs para acciones de modificación):
${plannedSessionLines || '  (ninguna — la semana está vacía)'}

═══ ACCIONES DISPONIBLES ═══

Para CREAR una semana completa:
  create_week — campos: sessions (array con TODOS los detalles), weekObjectives (array de strings), reason

Para AGREGAR una sesión individual:
  add_session — campos: targetDate, timeBlock, sessionType, title, durationMin, rpe?, objective?, subtype?${hasRunning || hasCycling ? ', runningType?, targetPaceMin?, targetPaceMax?, targetHrMin?, targetHrMax?' : ''}${hasStrength ? ', exercises?' : ', exercises?'} , reason

Para ACTUALIZAR sesión existente (tipo, detalles, ejercicios, título, objetivo, RPE, duración):
  update_session — campos: sessionId, reason + uno o más de: newType, subtype, newTitle, newObjective, newRpe, newDurationMin${hasRunning || hasCycling ? ', runningType, targetPaceMin, targetPaceMax, targetHrMin, targetHrMax' : ''}, squashDetails, exercises (array completo — reemplaza todo)

Para otras modificaciones (requieren sessionId):
  skip_session        — sessionId, reason
  change_rpe          — sessionId, newRpe (1-10), reason
  shorten_session     — sessionId, newDurationMin, reason
  lengthen_session    — sessionId, newDurationMin, reason
  move_session        — sessionId, targetDate (YYYY-MM-DD), reason
  replace_session_type— sessionId, newType (${allowedSessionTypes}), reason
  insert_recovery     — targetDate (YYYY-MM-DD), reason
  delete_session      — sessionId, reason

REGLA DE ORO PARA AJUSTAR UNA SEMANA YA EXISTENTE:
- Si el usuario pide subir una disciplina y bajar otra, primero modifica, mueve o elimina sesiones existentes; solo usa add_session cuando de verdad quieres aumentar el total semanal.
${hasRunning || hasStrength ? '- Si cambias una sesión entre disciplinas permitidas, debes reemplazar el contenido incompatible anterior; no dejes ejercicios o detalles viejos mezclados.' : ''}

═══ ESQUEMA COMPLETO DE SESIÓN (para create_week y add_session) ═══

Campos base:
  date: "YYYY-MM-DD"         ← fecha absoluta obligatoria
  timeBlock: "AM" | "PM"
  sessionType: ${allowedSessionTypes.split('|').map((type) => `"${type}"`).join(' | ')}
  title: "nombre"            ← ej: ${titleExamples}
  durationMin: número
  rpe: número 1-10
  objective: "objetivo de sesión"
  subtype: squash → "training"|"match"|"competitive"|"control"|"light"

Para squash training o control (agrega en la sesión cuando hay drills concretos):
  squashDetails: {
    trainingFocus: "technical"|"tactical"|"physical"|"conditioned_games",
    drills: [
      ${squashBaseDrillsJson}
    ]
  }

${hasRunning || hasCycling ? `Para ${runningOrCyclingLabel} (agrega en la sesión):
  runningType: "z2"|"tempo"|"intervals"|"long"
  targetPaceMin: "5:30"      ← ritmo mínimo /km (running) o min/km referencia (cycling)
  targetPaceMax: "6:00"      ← ritmo máximo /km
  targetHrMin: 140           ← FC objetivo (opcional)
  targetHrMax: 155` : ''}

Para fuerza y movilidad (agrega array exercises en la sesión):
  exercises: [
    {"name":"Nombre","sets":4,"reps":8,"weight":80,"group":"push|pull|legs|core|olympic|mobility|other"},
    {"name":"Nombre","sets":3,"reps":"30s","mobilityFocus":"hip|ankle|shoulder|spine|knee|full_body"}
  ]
  Para fuerza: usa la selección dinámica como base; si quieres explicitar intensidad, hazlo dentro de notes sin crear un campo nuevo.

═══ FORMATO DE RESPUESTA ═══

Mensaje conversacional: directo y concreto. SIN JSON, SIN tags.
Luego el bloque <actions> AL FINAL (sin code fences, sin backticks):

<actions>
[{"type":"TIPO",...,"reason":"motivo"}]
</actions>

EJEMPLO — crear semana completa con detalle:
${(() => {
  const exampleSport: string = getPlanningPrimarySport(context.athleteProfile) ?? context.athleteProfile?.sportContext?.primarySport ?? 'squash'
  if (exampleSport === 'running') return buildRunningCreateWeekExample(promptContext)
  if (exampleSport === 'cycling') return buildCyclingCreateWeekExample(promptContext)
  if (exampleSport === 'running') {
    return `<actions>
[{"type":"create_week",
  "weekObjectives":["construir base aeróbica running","mantener fuerza complementaria","recuperación activa"],
  "sessions":[
    {"date":"${addDaysToISO(weekStart, 0)}","timeBlock":"AM","sessionType":"running","title":"Running Z2","durationMin":50,"rpe":6,"objective":"base aeróbica — ritmo cómodo, respiración nasal","runningType":"z2","targetPaceMin":"${z2min}","targetPaceMax":"${z2max}"},
    {"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza estructurada","durationMin":60,"rpe":7,"objective":"${strengthBaseSelection.focus}","exercises":[${strengthSupportExercisesJson}]},
    {"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"AM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"cadera, tobillo y hombro"},
    {"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"AM","sessionType":"running","title":"Running tempo","durationMin":45,"rpe":7,"objective":"umbral aeróbico — mantener ritmo sostenido","runningType":"tempo","targetPaceMin":"${tempoMin}","targetPaceMax":"${tempoMax}"},
    {"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza de apoyo","durationMin":50,"rpe":6,"objective":"${strengthSupportSelection.focus}","exercises":[${strengthSupportExercisesJson}]},
    {"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"AM","sessionType":"running","title":"Running long","durationMin":70,"rpe":6,"objective":"fondo largo — ritmo aeróbico sostenido","runningType":"long","targetPaceMin":"${longRunPaceStr}","targetPaceMax":"${longRunPaceStr}"}
  ],
  "reason":"semana base running — Z2 lunes, tempo jueves, long sábado, con fuerza complementaria"}]
</actions>`
  } else if (exampleSport === 'cycling') {
    return `<actions>
[{"type":"create_week",
  "weekObjectives":["construir base aeróbica ciclismo","mantener fuerza complementaria","fondo largo fin de semana"],
  "sessions":[
    {"date":"${addDaysToISO(weekStart, 0)}","timeBlock":"PM","sessionType":"cycling","title":"Ciclismo Z2","durationMin":70,"rpe":6,"objective":"base aeróbica, cadencia 80-90rpm"},
    {"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza estructurada","durationMin":55,"rpe":7,"objective":"${strengthBaseSelection.focus}","exercises":[${strengthSupportExercisesJson}]},
    {"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"AM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"cadera, tobillo y columna"},
    {"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"AM","sessionType":"cycling","title":"Ciclismo intervalos","durationMin":45,"rpe":8,"objective":"series 4-6min a alta intensidad con recuperación activa"},
    {"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza de apoyo","durationMin":50,"rpe":6,"objective":"${strengthSupportSelection.focus}","exercises":[${strengthSupportExercisesJson}]},
    {"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"AM","sessionType":"cycling","title":"Ciclismo long ride","durationMin":90,"rpe":6,"objective":"fondo aeróbico sostenido"}
  ],
  "reason":"semana base ciclismo — Z2 lunes, intervalos jueves, long ride sábado, con fuerza complementaria"}]
</actions>`
  } else if (exampleSport === 'strength') {
    return `<actions>
[{"type":"create_week",
  "weekObjectives":["desarrollar fuerza upper + lower","movilidad complementaria","recuperación activa"],
  "sessions":[
    {"date":"${addDaysToISO(weekStart, 0)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza principal A","durationMin":60,"rpe":7,"objective":"${strengthPrimarySelection.focus}","exercises":[${strengthPrimaryExercisesJson}]},
    {"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"AM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"cadera, tobillo y columna"},
    {"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza principal B","durationMin":60,"rpe":7,"objective":"${strengthPrimaryFollowUpSelection.focus}","exercises":[${strengthPrimaryFollowUpExercisesJson}]},
    {"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"AM","sessionType":"recovery","title":"Recuperación activa","durationMin":25,"rpe":3,"objective":"recuperación y circulación"},
    {"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza full body estructurada","durationMin":50,"rpe":6,"objective":"${strengthBaseSelection.focus}","exercises":[${strengthBaseExercisesJson}]},
    {"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"AM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"movilidad general — cadera, hombro y columna"}
  ],
  "reason":"semana base fuerza — upper lunes, lower miércoles, full body viernes, con movilidad complementaria"}]
</actions>`
  } else {
    return buildSquashCreateWeekExample(promptContext)
  }
})()}

EJEMPLO — update_session con ejercicios:
<actions>
[{"type":"update_session","sessionId":"ID_DE_8_CHARS","newObjective":"fuerza tren superior con énfasis en fuerza — 85% 1RM","exercises":[
  {"name":"Press banca","sets":5,"reps":5,"weight":${w.bench85},"group":"push"},
  {"name":"Press inclinado","sets":3,"reps":8,"weight":${w.bench75},"group":"push"},
  {"name":"Dominadas con lastre","sets":4,"reps":6,"weight":10,"group":"pull"},
  {"name":"Remo con barra","sets":3,"reps":8,"weight":${w.row75},"group":"pull"},
  {"name":"Planchas","sets":3,"reps":"45s","group":"core"}
],"reason":"ejercicios más intensos según solicitud"}]
</actions>

EJEMPLO — microciclo competitivo con partido el sábado:
${buildCompetitiveSquashWeekExample(promptContext)}`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildBaseWeekTemplate(promptContext: ResponsePromptContext): string {
  const {
    primary,
    primarySportLabel,
    playsSquash,
    hasRunning,
    hasStrength,
    hasCycling,
    strengthBaseSummary,
    strengthPrimarySelection,
    squashTemplateSummary,
    z2min,
    z2max,
    tempoMin,
    tempoMax,
    longRunPaceStr,
  } = promptContext

  if (primary === 'cycling' || (!primary && hasCycling && !playsSquash && !hasRunning)) {
    return `    Lun PM: ciclismo Z2 70min RPE6 (base aerobica, cadencia 80-90rpm)
    ${hasStrength ? `Mar PM: fuerza estructurada 55min RPE7 (${strengthBaseSummary})` : 'Mar: movilidad 30min RPE4 (cadera, tobillo, columna)'}
    Mie: movilidad 30min RPE4 (cadera, tobillo, columna)
    Jue AM: ciclismo intervalos 45min RPE7-8 (series 4-6min a alta intensidad con recuperacion activa)
    ${hasStrength ? 'Vie PM: fuerza de apoyo 50min RPE6-7 (selector fuerza: controlar fatiga de piernas)' : 'Vie: recuperacion activa 25min RPE3'}
    Sab AM: ciclismo long ride 90min RPE6 (fondo aerobico sostenido)
    Dom: descanso`
  }

  if (primary === 'running' || (!primary && hasRunning && !playsSquash)) {
    return `    Lun AM: running Z2 50min RPE6 (ritmo ${z2min}-${z2max}/km)
    ${hasStrength ? `Mar PM: fuerza estructurada 60min RPE7 (${strengthBaseSummary})` : 'Mar: movilidad 30min RPE4 (cadera, tobillo, hombro)'}
    Mie: movilidad 30min RPE4 (cadera, tobillo, hombro)
    Jue AM: running tempo 45min RPE7 (ritmo ${tempoMin}-${tempoMax}/km)
    ${hasStrength ? 'Vie PM: fuerza de apoyo 50min RPE6-7 (selector fuerza: controlar interferencia)' : 'Vie: recuperacion activa 25min RPE3'}
    Sab AM: running long 60-75min RPE6 (ritmo ${longRunPaceStr}/km)
    Dom: descanso`
  }

  if (primary === 'strength' || (!primary && hasStrength && !playsSquash && !hasRunning && !hasCycling)) {
    return `    Lun PM: fuerza principal 60-70min RPE7 (${formatSelectedStrengthExercises(strengthPrimarySelection.exercises, 4)})
    Mar: movilidad 30min RPE4
    Mie PM: fuerza principal 60min RPE7 (variacion estructurada sin repetir lift central)
    Jue: recuperacion activa 25min RPE3
    Vie PM: fuerza full body 50-60min RPE6-7 (power o trunk segun fase)
    Sab: movilidad 30min RPE4
    Dom: descanso`
  }

  if (playsSquash) {
    const lines = [
      `    Lun PM: squash entrenamiento tecnico 75min RPE7 - ${squashTemplateSummary}`,
      hasRunning
        ? `    Mar AM: running Z2 50min RPE6 (ritmo ${z2min}-${z2max}/km)`
        : hasStrength
          ? `    Mar PM: fuerza estructurada 55-60min RPE6-7 (${strengthBaseSummary})`
          : '    Mar: movilidad 30min RPE4',
      hasStrength
        ? `    Mie PM: fuerza estructurada 55-60min RPE6-7 (${strengthBaseSummary})`
        : '    Mie: recuperacion activa 25-30min RPE3-4',
      '    Jue PM: squash control 60min RPE6 - selector squash: variar bloque sin repetir drills recientes',
      hasRunning
        ? `    Vie PM: running tempo 45min RPE7 (ritmo ${tempoMin}-${tempoMax}/km)`
        : '    Vie: movilidad 30min RPE4',
      hasStrength
        ? '    Sab AM: fuerza de apoyo 45-55min RPE6-7 (selector fuerza: transferencia y trunk) - semana base; movilidad 30min si semana competitiva'
        : '    Sab: activacion tecnica o recovery 20-30min RPE3-4',
      '    Dom: descanso',
    ]
    return lines.join('\n')
  }

  return `    Lun PM: sesion principal de ${primarySportLabel} 60-75min RPE6-7
    Mar: movilidad 30min RPE4
    Mie PM: fuerza general 45-60min RPE6-7 (segun restricciones y equipamiento)
    Jue: recuperacion activa 25-35min RPE3-4
    Vie PM: sesion especifica de ${primarySportLabel} 50-70min RPE6
    Sab: movilidad o activacion tecnica 20-30min RPE3-4
    Dom: descanso`
}

function buildSquashCreateWeekExample(promptContext: ResponsePromptContext): string {
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
  } = promptContext

  const objectives = [
    '"mantener base squash"',
    hasRunning ? '"sostener aeróbico running"' : null,
    hasStrength ? '"mantener fuerza de apoyo"' : null,
    '"llegar fresco al fin de semana"',
  ].filter(Boolean).join(',')

  const sessions = [
    `{"date":"${addDaysToISO(weekStart, 0)}","timeBlock":"PM","sessionType":"squash","title":"Squash entrenamiento estructurado","durationMin":75,"rpe":7,"objective":"${squashBaseObjective}","subtype":"training","squashDetails":{"trainingFocus":"${squashBaseSelection.trainingFocus}","drills":[${squashBaseDrillsJson}]}}`,
    hasRunning
      ? `{"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"AM","sessionType":"running","title":"Running Z2","durationMin":50,"rpe":6,"objective":"base aeróbica — ritmo cómodo, respiración nasal","runningType":"z2","targetPaceMin":"${z2min}","targetPaceMax":"${z2max}"}`
      : null,
    hasStrength
      ? `{"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza estructurada","durationMin":60,"rpe":6,"objective":"${strengthSupportSelection.focus}","exercises":[${strengthSupportExercisesJson}]}`
      : `{"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"PM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"cadera, tobillo y columna"}`,
    `{"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"PM","sessionType":"squash","title":"Squash control estructurado","durationMin":60,"rpe":6,"objective":"Sesión de control técnico para consolidar timing y precisión sin exceso de carga.","subtype":"control","squashDetails":{"trainingFocus":"${squashControlSelection.trainingFocus}","drills":[${squashControlDrillsJson}]}}`,
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

function buildRunningCreateWeekExample(promptContext: ResponsePromptContext): string {
  const {
    weekStart,
    hasStrength,
    z2min,
    z2max,
    tempoMin,
    tempoMax,
    longRunPaceStr,
    strengthBaseSelection,
    strengthSupportSelection,
    strengthSupportExercisesJson,
  } = promptContext

  const objectives = [
    '"construir base aeróbica running"',
    hasStrength ? '"mantener fuerza complementaria"' : null,
    '"recuperación activa"',
  ].filter(Boolean).join(',')

  const sessions = [
    `{"date":"${addDaysToISO(weekStart, 0)}","timeBlock":"AM","sessionType":"running","title":"Running Z2","durationMin":50,"rpe":6,"objective":"base aeróbica — ritmo cómodo, respiración nasal","runningType":"z2","targetPaceMin":"${z2min}","targetPaceMax":"${z2max}"}`,
    hasStrength
      ? `{"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza estructurada","durationMin":60,"rpe":7,"objective":"${strengthBaseSelection.focus}","exercises":[${strengthSupportExercisesJson}]}`
      : `{"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"PM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"cadera, tobillo y hombro"}`,
    `{"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"AM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"cadera, tobillo y hombro"}`,
    `{"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"AM","sessionType":"running","title":"Running tempo","durationMin":45,"rpe":7,"objective":"umbral aeróbico — mantener ritmo sostenido","runningType":"tempo","targetPaceMin":"${tempoMin}","targetPaceMax":"${tempoMax}"}`,
    hasStrength
      ? `{"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza de apoyo","durationMin":50,"rpe":6,"objective":"${strengthSupportSelection.focus}","exercises":[${strengthSupportExercisesJson}]}`
      : `{"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"recovery","title":"Recuperación activa","durationMin":25,"rpe":3,"objective":"bajar fatiga y sostener disponibilidad"}`,
    `{"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"AM","sessionType":"running","title":"Running long","durationMin":70,"rpe":6,"objective":"fondo largo — ritmo aeróbico sostenido","runningType":"long","targetPaceMin":"${longRunPaceStr}","targetPaceMax":"${longRunPaceStr}"}`,
  ].join(',\n    ')

  return `<actions>
[{"type":"create_week",
  "weekObjectives":[${objectives}],
  "sessions":[
    ${sessions}
  ],
  "reason":"semana base running con solo disciplinas permitidas por la planificación actual"}]
</actions>`
}

function buildCyclingCreateWeekExample(promptContext: ResponsePromptContext): string {
  const {
    weekStart,
    hasStrength,
    strengthBaseSelection,
    strengthSupportSelection,
    strengthSupportExercisesJson,
  } = promptContext

  const objectives = [
    '"construir base aeróbica ciclismo"',
    hasStrength ? '"mantener fuerza complementaria"' : null,
    '"fondo largo fin de semana"',
  ].filter(Boolean).join(',')

  const sessions = [
    `{"date":"${addDaysToISO(weekStart, 0)}","timeBlock":"PM","sessionType":"cycling","title":"Ciclismo Z2","durationMin":70,"rpe":6,"objective":"base aeróbica, cadencia 80-90rpm"}`,
    hasStrength
      ? `{"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza estructurada","durationMin":55,"rpe":7,"objective":"${strengthBaseSelection.focus}","exercises":[${strengthSupportExercisesJson}]}`
      : `{"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"PM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"cadera, tobillo y columna"}`,
    `{"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"AM","sessionType":"mobility","title":"Movilidad","durationMin":30,"rpe":4,"objective":"cadera, tobillo y columna"}`,
    `{"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"AM","sessionType":"cycling","title":"Ciclismo intervalos","durationMin":45,"rpe":8,"objective":"series 4-6min a alta intensidad con recuperación activa"}`,
    hasStrength
      ? `{"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza de apoyo","durationMin":50,"rpe":6,"objective":"${strengthSupportSelection.focus}","exercises":[${strengthSupportExercisesJson}]}`
      : `{"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"recovery","title":"Recuperación activa","durationMin":25,"rpe":3,"objective":"bajar fatiga y sostener disponibilidad"}`,
    `{"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"AM","sessionType":"cycling","title":"Ciclismo long ride","durationMin":90,"rpe":6,"objective":"fondo aeróbico sostenido"}`,
  ].join(',\n    ')

  return `<actions>
[{"type":"create_week",
  "weekObjectives":[${objectives}],
  "sessions":[
    ${sessions}
  ],
  "reason":"semana base ciclismo con solo disciplinas permitidas por la planificación actual"}]
</actions>`
}

function buildCompetitiveSquashWeekExample(promptContext: ResponsePromptContext): string {
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
  } = promptContext

  const sessions = [
    `{"date":"${addDaysToISO(weekStart, 0)}","timeBlock":"PM","sessionType":"squash","title":"Squash táctico controlado","durationMin":65,"rpe":6,"objective":"${squashCompetitiveObjective}","subtype":"training","squashDetails":{"trainingFocus":"${squashCompetitiveSelection.trainingFocus}","drills":[${squashCompetitiveDrillsJson}]}}`,
    hasRunning
      ? `{"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"AM","sessionType":"running","title":"Running Z2 corto","durationMin":30,"rpe":4,"objective":"Recuperacion aerobica sin fatigar","runningType":"z2","targetPaceMin":"${z2min}","targetPaceMax":"${z2max}"}`
      : null,
    hasStrength
      ? `{"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza neural liviana","durationMin":40,"rpe":5,"objective":"${strengthSupportSelection.focus}","exercises":[${strengthSupportExercisesJson}]}`
      : null,
    `{"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"PM","sessionType":"squash","title":"Squash control pre-partido","durationMin":50,"rpe":5,"objective":"Timing, precisión, pies y sensaciones. Nada de desgaste.","subtype":"control","squashDetails":{"trainingFocus":"${squashCompetitiveSelection.trainingFocus}","drills":[${squashCompetitiveDrillsJson}]}}`,
    `{"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"PM","sessionType":"squash","title":"Partido objetivo","durationMin":60,"rpe":8,"objective":"Competir fresco y con buena toma de T","subtype":"match"}`,
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

function buildDynamicPromptSelectionSections(promptContext: ResponsePromptContext): string {
  const sections: string[] = []
  const squashSelection = promptContext.squashSummary?.selection
  const squashSelectorContext = promptContext.squashSummary?.selectionContext
  const strengthSelection = promptContext.strengthSummary?.selection
  const strengthSelectorContext = promptContext.strengthSummary?.selectionContext

  if (squashSelection && squashSelectorContext) {
    sections.push(`SQUASH DINAMICO (usa esto como base de contenido, no inventes siempre los mismos drills):
- Foco sugerido actual: ${squashSelection.trainingFocus}
- Drills base seleccionados: ${formatSelectedSquashDrills(squashSelection.drills)}
- Justificacion: fase ${squashSelectorContext.phase}, fatiga ${squashSelectorContext.fatigueLevel}/10, competencia cercana ${squashSelectorContext.competitionSoon ? 'si' : 'no'}
- Continuidad: ${summarizeSquashProgression(squashSelectorContext)}`)
  }

  if (strengthSelection && strengthSelectorContext) {
    sections.push(`FUERZA DINAMICA (usa esto como base de contenido, no caigas en rutinas genericas):
- Foco sugerido actual: ${strengthSelection.focus}
- Ejercicios base seleccionados: ${formatSelectedStrengthExercises(strengthSelection.exercises)}
- Justificacion: fase ${strengthSelectorContext.phase}, fatiga ${strengthSelectorContext.fatigueLevel}/10, perfil ${strengthSelectorContext.sportProfile}, competencia cercana ${strengthSelectorContext.competitionSoon ? 'si' : 'no'}
- Continuidad: ${summarizeStrengthProgression(strengthSelectorContext)}`)
  }

  return sections.length > 0 ? `\n${sections.join('\n\n')}` : ''
}

function buildReferenceLoadSection(promptContext: ResponsePromptContext): string {
  const {
    z2min,
    z2max,
    tempoMin,
    tempoMax,
    intervalPaceStr,
    longRunPaceStr,
    w,
    hipThrust85,
    lunge45,
  } = promptContext

  return `CARGAS Y RITMOS DE REFERENCIA (aplica estos valores en todas las propuestas de running y fuerza):
Running:
  · Z2: ${z2min}–${z2max} /km  · Tempo/umbral: ${tempoMin}–${tempoMax} /km  · Intervalos VO2max: ${intervalPaceStr} /km  · Long run: ${longRunPaceStr} /km
Fuerza upper:
  · Press banca ${w.bench75}kg (75%) / ${w.bench85}kg (85%)  · Remo con barra ${w.row75}kg  · Press hombro ${w.ohp75}kg (75%)
Fuerza lower:
  · Sentadilla ${w.squat75}kg (75%) / ${w.squat85}kg (85%)  · Peso muerto ${w.deadlift75}kg (75%)  · Hip thrust ${hipThrust85}kg  · Lunge ${lunge45}kg`
}

function buildResponseInstructionsSection(
  sessions: Session[],
  context: ChatContext,
  squashSummary: SquashSelectionSummary = buildSquashSelectionSummary(context),
  strengthSummary: StrengthSelectionSummary = buildStrengthSelectionSummary(context),
): string {
  const promptContext = buildResponsePromptContext(sessions, context, squashSummary, strengthSummary)
  return buildResponseInstructions(sessions, context, promptContext)
}

/**
 * Derives interval/VO2max pace from 5K time.
 * 5K time "MM:SS" → pace per km = total_seconds / 5, formatted as "M:SS".
 */
function deriveIntervalPace(fiveKTime: string): string {
  try {
    const parts = fiveKTime.split(':').map(Number)
    const totalSecs = parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1]
    const paceSecs = Math.round(totalSecs / 5)
    const m = Math.floor(paceSecs / 60)
    const s = paceSecs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  } catch {
    return '4:15'
  }
}

/** Adds `secs` seconds to a "M:SS" pace string. Returns adjusted pace. */
function addSecsToPace(pace: string, secs: number): string {
  try {
    const [m, s] = pace.split(':').map(Number)
    const total = m * 60 + s + secs
    const mm = Math.floor(total / 60)
    const ss = total % 60
    return `${mm}:${ss.toString().padStart(2, '0')}`
  } catch {
    return pace
  }
}

function buildWeekDatesList(weekStart: string): string {
  const lines = ['DÍAS DE LA SEMANA ACTUAL:']
  for (let i = 0; i < 7; i++) {
    const date = addDaysToISO(weekStart, i)
    const dayName = getDayFullName(date)
    lines.push(`  ${date} (${dayName})`)
  }
  return lines.join('\n')
}

function addDaysToISO(isoDate: string, days: number): string {
  try {
    const [y, mo, d] = isoDate.split('-').map(Number)
    const date = new Date(y, mo - 1, d + days)
    const yy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    return `${yy}-${mm}-${dd}`
  } catch {
    return isoDate
  }
}

function formatMin(min: number): string {
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

function formatDateShort(iso: string): string {
  if (!iso) return ''
  try {
    const [y, mo, d] = iso.split('-').map(Number)
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
    return `${d} ${months[mo - 1]} ${y}`
  } catch {
    return iso
  }
}

function getDayName(iso: string): string {
  try {
    const [y, mo, d] = iso.split('-').map(Number)
    const day = new Date(y, mo - 1, d).getDay()
    return `${DAY_ES[day]} ${d}`
  } catch {
    return iso
  }
}

function getDayFullName(iso: string): string {
  try {
    const [y, mo, d] = iso.split('-').map(Number)
    const day = new Date(y, mo - 1, d).getDay()
    return DAY_FULL_ES[day]
  } catch {
    return iso
  }
}

function formatMatchMeta(session: Session): string {
  if (session.type !== 'squash' || (session.subtype !== 'match' && session.subtype !== 'competitive')) {
    return ''
  }

  const parts: string[] = []
  if (session.opponent) parts.push(`vs ${session.opponent}`)
  if (session.matchResult) parts.push(session.matchResult === 'win' ? 'ganó' : 'perdió')
  if (session.gamesWon != null || session.gamesLost != null) {
    parts.push(`games ${session.gamesWon ?? '?'}-${session.gamesLost ?? '?'}`)
  }
  if (session.location) parts.push(`en ${session.location}`)

  return parts.length > 0 ? ` · ${parts.join(' · ')}` : ''
}

function scoreCompetitivePriority(session: Session, memory: string, today: string): number {
  let score = 0
  const daysAway = diffDays(today, session.date)
  const haystack = `${session.title} ${session.objective ?? ''} ${session.opponent ?? ''} ${session.notes ?? ''}`.toLowerCase()

  if (daysAway != null) {
    if (daysAway <= 1) score += 5
    else if (daysAway <= 3) score += 4
    else if (daysAway <= 5) score += 3
    else score += 1
  }

  if (session.subtype === 'competitive') score += 2
  if (session.opponent) score += 1

  const strongKeywords = ['torneo', 'liga', 'cuadro', 'final', 'semifinal', 'ranking', 'objetivo', 'importante']
  const mediumKeywords = ['match', 'partido', 'competencia', 'rival']

  if (strongKeywords.some(keyword => haystack.includes(keyword))) score += 3
  else if (mediumKeywords.some(keyword => haystack.includes(keyword))) score += 1

  if (memory) {
    if (session.opponent && memory.includes(session.opponent.toLowerCase())) score += 2
    if (strongKeywords.some(keyword => memory.includes(keyword) && haystack.includes(keyword))) score += 3
    if (memory.includes(session.date)) score += 2
  }

  return score
}

function explainPrioritySignals(session: Session, memory: string, today: string): string[] {
  const reasons: string[] = []
  const daysAway = diffDays(today, session.date)
  const haystack = `${session.title} ${session.objective ?? ''} ${session.opponent ?? ''} ${session.notes ?? ''}`.toLowerCase()

  if (daysAway != null) {
    if (daysAway <= 1) reasons.push('muy cercana en el calendario')
    else if (daysAway <= 3) reasons.push('cercana en el calendario')
  }
  if (session.subtype === 'competitive') reasons.push('marcada como competitive')
  if (session.opponent) reasons.push(`rival definido: ${session.opponent}`)
  if (['torneo', 'liga', 'final', 'ranking', 'objetivo'].some(keyword => haystack.includes(keyword))) {
    reasons.push('titulo u objetivo con senal competitiva fuerte')
  }
  if (memory && session.opponent && memory.includes(session.opponent.toLowerCase())) {
    reasons.push('memoria reciente menciona el rival')
  }
  if (memory && memory.includes(session.date)) {
    reasons.push('memoria reciente menciona la fecha')
  }

  return reasons
}

function diffDays(fromISODate: string, toISODate: string): number | null {
  try {
    const from = new Date(`${fromISODate}T00:00:00`)
    const to = new Date(`${toISODate}T00:00:00`)
    const ms = to.getTime() - from.getTime()
    return Math.round(ms / (24 * 60 * 60 * 1000))
  } catch {
    return null
  }
}
