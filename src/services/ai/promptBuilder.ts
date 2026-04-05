/**
 * Builds rich, context-aware system prompts for the AI coach.
 *
 * Design goals:
 * - Coach is primarily a PLANNER, secondarily a conversational advisor
 * - Include enough context (week dates, sessions, profile) for concrete actions
 * - Teach the model ALL available action types including create_week and add_session
 * - When the user asks for an action, the model MUST respond with structured actions
 */

import type { ChatContext, Session, SupportedSport } from '../../types'
import { todayISO, currentWeekStartISO } from '../../utils/date'
import {
  getAthleteDisplayName,
  getAthleteSportsSummary,
  getEnabledSports,
  getPrimarySportNormalized,
  includesSport,
} from '../../utils/athlete'
import { classifyDayLoad, getDayNutrition, getLoadTypeLabel } from '../nutritionEngine'

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

// ─── Entry point ──────────────────────────────────────────────────────────────

export function buildCoachSystemPrompt(context: ChatContext): string {
  const sections: string[] = [
    buildPersonaSection(context),
    buildAthleteProfileSection(context),
    buildCoachMemorySection(context),
    buildFatigueSection(context),
    buildHybridSection(context),
    buildCompetitionSection(context),
    buildCompetitionLoadSection(context),
    buildImplicitPrioritySection(context),
    buildNutritionContextSection(context),
    buildWeekSection(context),
    buildSessionsSection(context.recentSessions),
    buildWeekDayLogsSection(context),
    buildTodaySection(context),
    buildResponseInstructions(context.recentSessions, context),
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
· Z2 puede ir cualquier día como herramienta de recuperación activa sin comprometer otros deportes.`
}

function buildStrengthRulesSection(): string {
  return `
FUERZA — CONOCIMIENTO TÉCNICO:
Estructura habitual:
· Upper: press banca/inclinado, remo, dominadas, press hombro, core. 4-5 ejercicios, 3-5 series.
· Lower: sentadilla, peso muerto o variante, hip thrust, lunge, core. 4-5 ejercicios, 3-5 series.
· Full body: combinación de variantes de press, jalón/remo y tren inferior.

Secuenciación fuerza:
· No hacer sesión de piernas pesada dentro de las 24h previas a una competencia o sesión técnica clave.
· DOMS de piernas + competencia = error de planificación — evitarlo siempre.
· En semana competitiva: sesión neural liviana (pocos sets, alta intensidad, sin volumen de DOMS).
· Movilidad post-fuerza mejora recuperación y flexibilidad funcional.`
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
  const enabledSports = getEnabledSports(context.athleteProfile)
  const primarySport = getPrimarySportNormalized(context.athleteProfile)

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

  const todaySessions = context.recentSessions.filter(s => s.date === today && s.status !== 'skipped')
  const sessionCount = todaySessions.length

  // Use the canonical classifier from nutritionEngine
  const loadType = classifyDayLoad(todaySessions)
  const rec = getDayNutrition(todaySessions)

  // Check for upcoming competitive session in next 2 days (for víspera protocol — any sport)
  const upcomingMatch = context.recentSessions.find(s =>
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

  const lines: string[] = ['═══ PERFIL DEL ATLETA ═══']

  // Basic
  const basicParts: string[] = []
  if (p.age) basicParts.push(`${p.age} años`)
  if (p.weightKg) basicParts.push(`${p.weightKg} kg`)
  if (basicParts.length > 0) lines.push(`Atleta: ${basicParts.join(' · ')}`)

  // Sport & goals
  if (p.primarySport) lines.push(`Deporte principal: ${p.primarySport}`)
  if (p.secondarySports?.length) lines.push(`Deportes secundarios: ${p.secondarySports.join(', ')}`)
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
  const today = todayISO()
  const enabledSports = getEnabledSports(context.athleteProfile)
  if (enabledSports.length < 2) return ''

  const futureSessions = context.recentSessions.filter(session => session.date >= today)

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

  const primarySport = getPrimarySportNormalized(context.athleteProfile)
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
  const upcomingCompetitive = [...context.recentSessions]
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
  const competitiveSessions = context.recentSessions.filter(session =>
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

function buildImplicitPrioritySection(context: ChatContext): string {
  const today = todayISO()
  const upcomingCompetitive = context.recentSessions
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

function buildResponseInstructions(sessions: Session[], context: ChatContext): string {
  const today = todayISO()

  // Week dates — use summary weekStartDate or compute from today
  const weekStart = context.currentWeekSummary?.weekStartDate ?? currentWeekStartISO()
  const weekDates = buildWeekDatesList(weekStart)

  // Sport context — use normalized helpers with legacy fallback
  const enabledSports = getEnabledSports(context.athleteProfile)
  const primarySportNorm = getPrimarySportNormalized(context.athleteProfile)
  // Fallback for legacy free-text when sportContext not yet configured
  const primarySportLabel = primarySportNorm
    ?? context.athleteProfile?.primarySport?.trim()
    ?? 'deporte principal'
  const playsSquash = enabledSports.includes('squash') || includesSport(context.athleteProfile, 'squash')
  const hasRunning = enabledSports.includes('running') || includesSport(context.athleteProfile, 'running')
  const hasStrength = enabledSports.includes('strength') || includesSport(context.athleteProfile, 'strength') || includesSport(context.athleteProfile, 'fuerza') || includesSport(context.athleteProfile, 'pesas')
  const hasCycling = enabledSports.includes('cycling') || includesSport(context.athleteProfile, 'cycling') || includesSport(context.athleteProfile, 'bicicleta')
  const hasMobility = enabledSports.includes('mobility') || includesSport(context.athleteProfile, 'mobility') || includesSport(context.athleteProfile, 'movilidad')

  const SPORT_SESSION_COUNTS: Partial<Record<string, string>> = {
    squash: '2-3 sesiones/semana',
    running: '2-3 sesiones/semana',
    strength: '1-2 sesiones/semana',
    mobility: '1 sesión/semana',
    cycling: '1-2 sesiones/semana',
  }

  // Sport priority line — built from actual enabled sports
  const activeSportList = enabledSports.length > 0
    ? enabledSports
    : [
        playsSquash ? 'squash' : null,
        hasRunning ? 'running' : null,
        hasStrength ? 'strength' : null,
        hasMobility ? 'mobility' : null,
        hasCycling ? 'cycling' : null,
      ].filter(Boolean) as string[]

  const sportPriority = activeSportList.length > 0
    ? activeSportList.map(s => `${s} (${SPORT_SESSION_COUNTS[s] ?? '1-2 sesiones/semana'})`).join(' > ')
    : `${primarySportLabel} (2-3 sesiones/semana)`

  // Dynamic strength weights from profile (75% for hypertrophy/volume, 85% for strength)
  const sp = context.athleteProfile?.strengthProfile
  const w = {
    bench75: sp?.benchPress1RM ? Math.round(sp.benchPress1RM * 0.75) : 80,
    bench85: sp?.benchPress1RM ? Math.round(sp.benchPress1RM * 0.85) : 90,
    row75: sp?.deadlift1RM ? Math.round(sp.deadlift1RM * 0.55) : 60,  // barbell row ~55% of deadlift
    ohp75: sp?.overheadPress1RM ? Math.round(sp.overheadPress1RM * 0.75) : 50,
    squat75: sp?.squat1RM ? Math.round(sp.squat1RM * 0.75) : 90,
    squat85: sp?.squat1RM ? Math.round(sp.squat1RM * 0.85) : 102,
    deadlift75: sp?.deadlift1RM ? Math.round(sp.deadlift1RM * 0.75) : 110,
  }

  // Dynamic running paces from profile
  const rp = context.athleteProfile?.runningProfile
  const z2min = rp?.z2PaceMin ?? '5:30'
  const z2max = rp?.z2PaceMax ?? '6:00'
  const tempoMin = rp?.thresholdPace ? addSecsToPace(rp.thresholdPace, -10) : '4:40'
  const tempoMax = rp?.thresholdPace ?? '5:00'
  const longRunPaceStr = rp?.longRunPace ?? rp?.easyPaceMax ?? '6:00'
  const intervalPaceStr = rp?.fiveKTime ? deriveIntervalPace(rp.fiveKTime) : '4:15'

  // Lower body strength loads
  const hipThrust85 = sp?.squat1RM ? Math.round(sp.squat1RM * 0.85) : 100
  const lunge45 = sp?.squat1RM ? Math.round(sp.squat1RM * 0.45) : 55

  // Planned session IDs for modification actions
  const plannedSessionLines = sessions
    .filter(s => s.status === 'planned' && s.date >= today)
    .slice(0, 10)
    .map(s => `  [${s.id.slice(0, 8)}] ${getDayName(s.date)} ${s.timeBlock} · ${SESSION_TYPE_ES[s.type] ?? s.type} "${s.title}"`)
    .join('\n')

  const baseWeekTemplate = playsSquash
    ? `    Lun PM: squash entrenamiento tecnico 75min RPE7 - drives paralelo/cruzado, voleas de presion, juego condicionado solo largo
    Mar AM: running Z2 50min RPE6 (ritmo ${z2min}-${z2max}/km)
    Mie PM: fuerza upper 60min RPE7 (press banca ${w.bench75}kg, remo ${w.row75}kg, dominadas, press hombro ${w.ohp75}kg, core rotacional)
    Jue PM: squash control 60min RPE6 - peloteo de calidad, drives y dejadas, tecnica limpia sin presion
    Vie PM: running tempo 45min RPE7 (ritmo ${tempoMin}-${tempoMax}/km)
    Sab AM: fuerza lower 50min RPE7 (sentadilla ${w.squat75}kg, hip thrust ${hipThrust85}kg, lunge ${lunge45}kg, core) - semana base; movilidad 30min si semana competitiva
    Dom: descanso`
    : hasCycling
      ? `    Lun PM: ciclismo Z2 70min RPE6 (base aerobica, cadencia 80-90rpm)
    Mar PM: fuerza upper 55min RPE7 (press banca ${w.bench75}kg, remo ${w.row75}kg, dominadas, press hombro ${w.ohp75}kg, core)
    Mie: movilidad 30min RPE4 (cadera, tobillo, columna)
    Jue AM: ciclismo intervalos 45min RPE7-8 (series 4-6min a alta intensidad con recuperacion activa)
    Vie PM: fuerza lower 50min RPE7 (sentadilla ${w.squat75}kg, hip thrust ${hipThrust85}kg, lunge ${lunge45}kg, core)
    Sab AM: ciclismo long ride 90min RPE6 (fondo aerobico sostenido)
    Dom: descanso`
      : hasRunning
        ? `    Lun AM: running Z2 50min RPE6 (ritmo ${z2min}-${z2max}/km)
    Mar PM: fuerza upper 60min RPE7 (press banca ${w.bench75}kg, remo ${w.row75}kg, dominadas, press hombro ${w.ohp75}kg, core rotacional)
    Mie: movilidad 30min RPE4 (cadera, tobillo, hombro)
    Jue AM: running tempo 45min RPE7 (ritmo ${tempoMin}-${tempoMax}/km)
    Vie PM: fuerza lower 50min RPE7 (sentadilla ${w.squat75}kg, hip thrust ${hipThrust85}kg, lunge ${lunge45}kg, core)
    Sab AM: running long 60-75min RPE6 (ritmo ${longRunPaceStr}/km)
    Dom: descanso`
        : hasStrength
          ? `    Lun PM: fuerza upper 60min RPE7 (press banca ${w.bench75}kg, remo ${w.row75}kg, dominadas, press hombro ${w.ohp75}kg, core rotacional)
    Mar: movilidad 30min RPE4
    Mie PM: fuerza lower 60min RPE7 (sentadilla ${w.squat75}kg, hip thrust ${hipThrust85}kg, lunge ${lunge45}kg, RDL, core)
    Jue: recuperacion activa 25min RPE3
    Vie PM: fuerza full body 50min RPE7 (circuito press, remo, sentadilla frontal, core rotacional)
    Sab: movilidad 30min RPE4
    Dom: descanso`
          : `    Lun PM: sesion principal de ${primarySportLabel} 60-75min RPE6-7
    Mar: movilidad 30min RPE4
    Mie PM: fuerza general 45-60min RPE6-7 (segun restricciones y equipamiento)
    Jue: recuperacion activa 25-35min RPE3-4
    Vie PM: sesion especifica de ${primarySportLabel} 50-70min RPE6
    Sab: movilidad o activacion tecnica 20-30min RPE3-4
    Dom: descanso`

  return `═══ INSTRUCCIONES DEL COACH-PLANNER ═══

REGLAS CRÍTICAS:
1. Si el usuario pide "crear semana", "armar semana", "planificar semana", "dame la propuesta", "dame un plan", "dame la semana", "construye la semana", "hazme la semana", "qué hacemos esta semana", "propuesta de semana" → DEBES responder con create_week. No solo texto. No describas el plan y luego pidas confirmación — créalo directamente.
2. Si el usuario pide "agregar sesión", "pon un X el día Y", "agrega X" → DEBES responder con add_session. No solo texto.
3. Si el usuario pide "cambia los ejercicios", "agrégale X", "reemplaza", "mejora la propuesta", "incorpora X", "agrega running", "agrega squash", "baja squash", "sube running" o redistribuir la semana → DEBES priorizar update_session, move_session, replace_session_type o delete_session sobre add_session cuando la intención sea reemplazar o ajustar lo ya existente. No acumules sesiones o ejercicios viejos si la idea es sustituirlos.
4. Si falta contexto → asume valores razonables para el atleta y explícalo en 1 frase.
5. Si no hay sesiones en la semana → crea una semana base COMPLETA sin pedir confirmación.
6. NUNCA respondas con solo texto cuando se pidió una acción. Si describiste el plan en texto, DEBES incluir el bloque <actions> al final en la misma respuesta.

PERFIL BASE DEL ATLETA (defaults para propuestas):
- Prioridad: ${sportPriority}
- Semana base típica:
${baseWeekTemplate}

SEMANA COMPETITIVA Y PRE-TORNEO:
- Si aparece un partido o torneo, el objetivo principal pasa a ser rendir fresco en cancha.
- Si faltan 2 dias o menos para competir, evita agregar sesiones que dejen DOMS o fatiga metabolica alta.
- Fuerza en semana competitiva: volumen bajo, foco neural/estabilidad, nunca pesada pegada al partido.
- Running en semana competitiva: Z2 corto o activacion; evita tempo o intervalos largos salvo que esten lejos del partido.
- Pre-competencia (deporte principal): sesion tecnica corta o activacion especifica; no sesiones largas de desgaste.${playsSquash ? '\n- Squash pre-partido: control tecnico, precision, sensaciones, T, largo-corto, activacion de pies; no sesiones de RSA ni carga fisica alta.' : ''}
- Si el usuario menciona torneo, liga, rival, cuadro o fin de semana competitivo, debes responder como coach en taper, no como semana base normal.
- El deporte accesorio en semana competitiva no debe quitar frescura a la sesion objetivo del deporte principal.
- Si hay competencia objetivo, prioriza cardio recovery o Z2 corto; deja intensidad alta fuera de la ventana sensible.
- Si hay varias competencias, distingue entre sesion objetivo inmediata y carga secundaria; protege primero la inmediata.
- Un control no compite por prioridad con un match o competitive; usalo como ajuste tecnico o activacion.
- Un match o competitive mas cercano manda sobre cualquier desarrollo de running de esa misma ventana.

FECHA HOY: ${today}
${weekDates}

CARGAS Y RITMOS DE REFERENCIA (aplica estos valores en todas las propuestas de running y fuerza):
Running:
  · Z2: ${z2min}–${z2max} /km  · Tempo/umbral: ${tempoMin}–${tempoMax} /km  · Intervalos VO2max: ${intervalPaceStr} /km  · Long run: ${longRunPaceStr} /km
Fuerza upper:
  · Press banca ${w.bench75}kg (75%) / ${w.bench85}kg (85%)  · Remo con barra ${w.row75}kg  · Press hombro ${w.ohp75}kg (75%)
Fuerza lower:
  · Sentadilla ${w.squat75}kg (75%) / ${w.squat85}kg (85%)  · Peso muerto ${w.deadlift75}kg (75%)  · Hip thrust ${hipThrust85}kg  · Lunge ${lunge45}kg

SESIONES PLANIFICADAS (IDs para acciones de modificación):
${plannedSessionLines || '  (ninguna — la semana está vacía)'}

═══ ACCIONES DISPONIBLES ═══

Para CREAR una semana completa:
  create_week — campos: sessions (array con TODOS los detalles), weekObjectives (array de strings), reason

Para AGREGAR una sesión individual:
  add_session — campos: targetDate, timeBlock, sessionType, title, durationMin, rpe?, objective?, subtype?, runningType?, targetPaceMin?, targetPaceMax?, targetHrMin?, targetHrMax?, exercises?, reason

Para ACTUALIZAR sesión existente (tipo, detalles, ejercicios, título, objetivo, RPE, duración):
  update_session — campos: sessionId, reason + uno o más de: newType, subtype, newTitle, newObjective, newRpe, newDurationMin, runningType, targetPaceMin, targetPaceMax, targetHrMin, targetHrMax, squashDetails, exercises (array completo — reemplaza todo)

Para otras modificaciones (requieren sessionId):
  skip_session        — sessionId, reason
  change_rpe          — sessionId, newRpe (1-10), reason
  shorten_session     — sessionId, newDurationMin, reason
  lengthen_session    — sessionId, newDurationMin, reason
  move_session        — sessionId, targetDate (YYYY-MM-DD), reason
  replace_session_type— sessionId, newType (squash|running|cycling|strength|mobility|recovery), reason
  insert_recovery     — targetDate (YYYY-MM-DD), reason
  delete_session      — sessionId, reason

REGLA DE ORO PARA AJUSTAR UNA SEMANA YA EXISTENTE:
- Si el usuario pide subir una disciplina y bajar otra, primero modifica, mueve o elimina sesiones existentes; solo usa add_session cuando de verdad quieres aumentar el total semanal.
- Si cambias una sesión de squash a running, o de running a fuerza, debes reemplazar el contenido incompatible anterior; no dejes ejercicios o detalles viejos mezclados.

═══ ESQUEMA COMPLETO DE SESIÓN (para create_week y add_session) ═══

Campos base:
  date: "YYYY-MM-DD"         ← fecha absoluta obligatoria
  timeBlock: "AM" | "PM"
  sessionType: "squash" | "running" | "cycling" | "strength" | "mobility" | "recovery"
  title: "nombre"            ← ej: "Squash entrenamiento", "Running Z2", "Fuerza upper"
  durationMin: número
  rpe: número 1-10
  objective: "objetivo de sesión"
  subtype: squash → "training"|"match"|"competitive"|"control"|"light"

Para squash training o control (agrega en la sesión cuando hay drills concretos):
  squashDetails: {
    trainingFocus: "technical"|"tactical"|"physical"|"conditioned_games",
    drills: [
      {"name":"Drives paralelo y cruzado","durationMin":20,"notes":"a zonas, profundidad y longitud"},
      {"name":"Voleas de presión","durationMin":15,"notes":"desde media pista, ataque al frente"},
      {"name":"Juego condicionado solo largo","durationMin":20}
    ]
  }

Para running y cycling (agrega en la sesión):
  runningType: "z2"|"tempo"|"intervals"|"long"
  targetPaceMin: "5:30"      ← ritmo mínimo /km (running) o min/km referencia (cycling)
  targetPaceMax: "6:00"      ← ritmo máximo /km
  targetHrMin: 140           ← FC objetivo (opcional)
  targetHrMax: 155

Para fuerza y movilidad (agrega array exercises en la sesión):
  exercises: [
    {"name":"Nombre","sets":4,"reps":8,"weight":80,"group":"push|pull|legs|core|olympic|mobility|other"},
    {"name":"Nombre","sets":3,"reps":"30s","mobilityFocus":"hip|ankle|shoulder|spine|knee|full_body"}
  ]

═══ FORMATO DE RESPUESTA ═══

Mensaje conversacional: directo y concreto. SIN JSON, SIN tags.
Luego el bloque <actions> AL FINAL (sin code fences, sin backticks):

<actions>
[{"type":"TIPO",...,"reason":"motivo"}]
</actions>

EJEMPLO — crear semana completa con detalle:
<actions>
[{"type":"create_week",
  "weekObjectives":["mantener base squash","sostener aeróbico running","llegar fresco al fin de semana"],
  "sessions":[
    {"date":"${addDaysToISO(weekStart, 0)}","timeBlock":"PM","sessionType":"squash","title":"Squash técnico — drives y juego condicionado","durationMin":75,"rpe":7,"objective":"Técnico con cierre táctico. Intensidad progresiva.","subtype":"training","squashDetails":{"trainingFocus":"technical","drills":[{"name":"Drives paralelo y cruzado","durationMin":20,"notes":"a zonas, profundidad y longitud"},{"name":"Voleas de presión","durationMin":20,"notes":"desde media pista, ataque y defensa"},{"name":"Juego condicionado solo largo","durationMin":20,"notes":"presión de fondo, control del T"}]}},
    {"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"AM","sessionType":"running","title":"Running Z2","durationMin":50,"rpe":6,"objective":"base aeróbica — ritmo cómodo, respiración nasal","runningType":"z2","targetPaceMin":"${z2min}","targetPaceMax":"${z2max}"},
    {"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza upper","durationMin":60,"rpe":7,"objective":"fuerza tren superior — volumen al 75% 1RM","exercises":[
      {"name":"Press banca","sets":4,"reps":8,"weight":${w.bench75},"group":"push"},
      {"name":"Remo con barra","sets":4,"reps":8,"weight":${w.row75},"group":"pull"},
      {"name":"Dominadas","sets":3,"reps":"max","group":"pull"},
      {"name":"Press hombro","sets":3,"reps":10,"weight":${w.ohp75},"group":"push"},
      {"name":"Core rotacional","sets":3,"reps":15,"group":"core"}
    ]},
    {"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"PM","sessionType":"squash","title":"Squash control — peloteo y dejadas","durationMin":60,"rpe":6,"objective":"Técnica limpia sin presión de resultado. Mitad de semana.","subtype":"control","squashDetails":{"trainingFocus":"technical","drills":[{"name":"Drives profundos","durationMin":20,"notes":"foco en longitud y consistencia"},{"name":"Dejadas y drops","durationMin":20,"notes":"de ambos lados, toque suave"},{"name":"Peloteo libre","durationMin":15,"notes":"ejecución limpia, sin presión"}]}},
    {"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"running","title":"Running tempo","durationMin":45,"rpe":7,"objective":"umbral aeróbico — mantener ritmo sostenido","runningType":"tempo","targetPaceMin":"${tempoMin}","targetPaceMax":"${tempoMax}"},
    {"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"AM","sessionType":"strength","title":"Fuerza lower — base squash","durationMin":55,"rpe":7,"objective":"tren inferior para potencia y estabilidad en cancha — sentadilla, hip thrust, lunge y core","exercises":[
      {"name":"Sentadilla","sets":4,"reps":6,"weight":${w.squat75},"group":"legs"},
      {"name":"Hip thrust","sets":3,"reps":10,"weight":${hipThrust85},"group":"legs"},
      {"name":"Lunge con mancuernas","sets":3,"reps":8,"weight":${lunge45},"group":"legs"},
      {"name":"RDL unilateral","sets":2,"reps":8,"group":"legs"},
      {"name":"Core rotacional","sets":3,"reps":12,"group":"core"}
    ]}
  ],
  "reason":"semana base equilibrada — upper martes, lower sábado, con cargas reales del perfil"}]
</actions>

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
<actions>
[{"type":"create_week",
  "weekObjectives":["llegar fresco al partido","mantener timing de squash","evitar fatiga secundaria"],
  "sessions":[
    {"date":"${addDaysToISO(weekStart, 0)}","timeBlock":"PM","sessionType":"squash","title":"Squash táctico controlado","durationMin":65,"rpe":6,"objective":"Patrones largo-corto y control del T, sin fatiga alta.","subtype":"training","squashDetails":{"trainingFocus":"tactical","drills":[{"name":"Patrones largo-corto","durationMin":20,"notes":"salida desde T, recuperar posicion"},{"name":"Juego condicionado solo paralelo","durationMin":20,"notes":"orden y profundidad"},{"name":"Cierre con precision a objetivos","durationMin":15,"notes":"ritmo controlado"}]}},
    {"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"AM","sessionType":"running","title":"Running Z2 corto","durationMin":30,"rpe":4,"objective":"Recuperacion aerobica sin fatigar","runningType":"z2","targetPaceMin":"${z2min}","targetPaceMax":"${z2max}"},
    {"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza neural liviana","durationMin":40,"rpe":5,"objective":"Activacion y estabilidad sin DOMS — foco neural, sin DOMS, pocas series","exercises":[
      {"name":"Sentadilla","sets":3,"reps":3,"weight":${w.squat85},"group":"legs"},
      {"name":"Lunge con mancuernas","sets":2,"reps":5,"weight":${lunge45},"group":"legs"},
      {"name":"Remo con barra","sets":3,"reps":6,"weight":${w.row75},"group":"pull"},
      {"name":"Core rotacional","sets":2,"reps":10,"group":"core"}
    ]},
    {"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"PM","sessionType":"squash","title":"Squash control pre-partido","durationMin":50,"rpe":5,"objective":"Timing, precision, pies y sensaciones. Nada de desgaste.","subtype":"control","squashDetails":{"trainingFocus":"technical","drills":[{"name":"Drives a zonas","durationMin":15,"notes":"limpio y suelto"},{"name":"Voleas de control","durationMin":15,"notes":"timing y mano"},{"name":"Activacion de pies al T","durationMin":10,"notes":"corto, rapido, fresco"}]}},
    {"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"PM","sessionType":"squash","title":"Partido objetivo","durationMin":60,"rpe":8,"objective":"Competir fresco y con buena toma de T","subtype":"match"}
  ],
  "reason":"semana competitiva con taper para llegar fresco al partido objetivo"}]
</actions>`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

