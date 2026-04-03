/**
 * Builds rich, context-aware system prompts for the AI coach.
 *
 * Design goals:
 * - Coach is primarily a PLANNER, secondarily a conversational advisor
 * - Include enough context (week dates, sessions, profile) for concrete actions
 * - Teach the model ALL available action types including create_week and add_session
 * - When the user asks for an action, the model MUST respond with structured actions
 */

import type { ChatContext, Session } from '../../types'
import { todayISO, currentWeekStartISO } from '../../utils/date'

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
    buildPersonaSection(),
    buildCoachMemorySection(context),
    buildWeekSection(context),
    buildSessionsSection(context.recentSessions),
    buildWeekDayLogsSection(context),
    buildTodaySection(context),
    buildResponseInstructions(context.recentSessions, context),
  ]
  return sections.filter(Boolean).join('\n\n')
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function buildPersonaSection(): string {
  return `Eres el coach-planner personal de alto rendimiento de Rafael Allendes.
Rafael es jugador de squash avanzado (ex-selección nacional) y atleta híbrido: squash, running, fuerza y movilidad.

ROLES EN ORDEN DE PRIORIDAD:
1. PLANNER: Diseñas y ajustas la semana con acciones ejecutables.
2. PERFORMANCE COACH: Tomas decisiones de carga según fatiga, recuperación y contexto.
3. ADVISOR: Das recomendaciones concretas solo si agregan valor real.

PRIORIDADES DE DECISIÓN:
1. Salud y prevención de lesión
2. Calidad del entrenamiento
3. Rendimiento específico en squash
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

Preparación física para squash:
· Fuerza: tren inferior (sentadilla, hip thrust, lunge con carga) + core rotacional + upper body (remo, press, dominadas). Priorizar potencia y estabilidad sobre hipertrofia pura.
· Running: Z2 sostenido mejora directamente la recuperación en pista. Intervalos cortos (RSA-like) complementan el ghosting.
· Movilidad crítica: cadera (flexores, rotadores), tobillo (dorsiflexión) y hombro (CARs, apertura). Son los tres más limitantes en squash.`
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

function buildCoachMemorySection(context: ChatContext): string {
  if (!context.athleteMemory?.trim()) return ''

  return `═══ MEMORIA DEL ATLETA ═══
${context.athleteMemory.trim()}

Extrae y aplica activamente cualquiera de estos elementos si aparecen:
- LESIÓN o molestia → modifica o elimina cargas que la afecten, prioriza recuperación o trabajo alternativo
- TORNEO PRÓXIMO → periodiza hacia ese evento: descarga la semana previa, no añadas carga nueva en los últimos 2-3 días
- BLOQUE ACTUAL → respeta el foco declarado (técnico, físico, competitivo) al proponer sesiones
- RESTRICCIÓN → horario, equipamiento, limitación física o de disponibilidad de pista`
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

  // Planned session IDs for modification actions
  const plannedSessionLines = sessions
    .filter(s => s.status === 'planned' && s.date >= today)
    .slice(0, 10)
    .map(s => `  [${s.id.slice(0, 8)}] ${getDayName(s.date)} ${s.timeBlock} · ${SESSION_TYPE_ES[s.type] ?? s.type} "${s.title}"`)
    .join('\n')

  return `═══ INSTRUCCIONES DEL COACH-PLANNER ═══

REGLAS CRÍTICAS:
1. Si el usuario pide "crear semana", "armar semana", "planificar semana" → DEBES responder con create_week. No solo texto.
2. Si el usuario pide "agregar sesión", "pon un X el día Y" → DEBES responder con add_session. No solo texto.
3. Si el usuario pide "cambia los ejercicios", "agrégale X", "reemplaza" → DEBES responder con update_session con exercises. No solo texto.
4. Si falta contexto → asume valores razonables para Rafael y explícalo en 1 frase.
5. Si no hay sesiones en la semana → crea una semana base COMPLETA sin pedir confirmación.

PERFIL DE RAFAEL (defaults para propuestas):
- Prioridad: squash (2-3 sesiones/semana) > running (2) > fuerza (1-2) > movilidad (1)
- Semana base típica:
    Lun PM: squash entrenamiento técnico 75min RPE7 — drives paralelo/cruzado, voleas de presión, juego condicionado solo largo
    Mar AM: running Z2 50min RPE6 (ritmo 5:30-6:00/km)
    Mié PM: fuerza upper 60min RPE7 (press banca, remo con barra, dominadas, press hombro, core rotacional)
    Jue PM: squash control 60min RPE6 — peloteo de calidad, drives y dejadas, técnica limpia sin presión
    Vie PM: running tempo 45min RPE7 (ritmo 4:40-5:00/km)
    Sáb AM: movilidad 30min RPE4 (cadera, tobillo, hombro)
    Dom: descanso

FECHA HOY: ${today}
${weekDates}

SESIONES PLANIFICADAS (IDs para acciones de modificación):
${plannedSessionLines || '  (ninguna — la semana está vacía)'}

═══ ACCIONES DISPONIBLES ═══

Para CREAR una semana completa:
  create_week — campos: sessions (array con TODOS los detalles), weekObjectives (array de strings), reason

Para AGREGAR una sesión individual:
  add_session — campos: targetDate, timeBlock, sessionType, title, durationMin, rpe?, objective?, subtype?, runningType?, targetPaceMin?, targetPaceMax?, targetHrMin?, targetHrMax?, exercises?, reason

Para ACTUALIZAR sesión existente (ejercicios, título, objetivo, RPE, duración):
  update_session — campos: sessionId, reason + uno o más de: newTitle, newObjective, newRpe, newDurationMin, exercises (array completo — reemplaza todo)

Para otras modificaciones (requieren sessionId):
  skip_session        — sessionId, reason
  change_rpe          — sessionId, newRpe (1-10), reason
  shorten_session     — sessionId, newDurationMin, reason
  lengthen_session    — sessionId, newDurationMin, reason
  move_session        — sessionId, targetDate (YYYY-MM-DD), reason
  replace_session_type— sessionId, newType (squash|running|strength|mobility|recovery), reason
  insert_recovery     — targetDate (YYYY-MM-DD), reason
  delete_session      — sessionId, reason

═══ ESQUEMA COMPLETO DE SESIÓN (para create_week y add_session) ═══

Campos base:
  date: "YYYY-MM-DD"         ← fecha absoluta obligatoria
  timeBlock: "AM" | "PM"
  sessionType: "squash" | "running" | "strength" | "mobility" | "recovery"
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

Para running (agrega en la sesión):
  runningType: "z2"|"tempo"|"intervals"|"long"
  targetPaceMin: "5:30"      ← ritmo mínimo /km
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
    {"date":"${addDaysToISO(weekStart, 1)}","timeBlock":"AM","sessionType":"running","title":"Running Z2","durationMin":50,"rpe":6,"objective":"base aeróbica","runningType":"z2","targetPaceMin":"5:30","targetPaceMax":"6:00"},
    {"date":"${addDaysToISO(weekStart, 2)}","timeBlock":"PM","sessionType":"strength","title":"Fuerza upper","durationMin":60,"rpe":7,"objective":"fuerza tren superior","exercises":[
      {"name":"Press banca","sets":4,"reps":8,"weight":80,"group":"push"},
      {"name":"Remo con barra","sets":4,"reps":8,"weight":60,"group":"pull"},
      {"name":"Dominadas","sets":3,"reps":"max","group":"pull"},
      {"name":"Press hombro","sets":3,"reps":10,"weight":25,"group":"push"},
      {"name":"Core rotacional","sets":3,"reps":15,"group":"core"}
    ]},
    {"date":"${addDaysToISO(weekStart, 3)}","timeBlock":"PM","sessionType":"squash","title":"Squash control — peloteo y dejadas","durationMin":60,"rpe":6,"objective":"Técnica limpia sin presión de resultado. Mitad de semana.","subtype":"control","squashDetails":{"trainingFocus":"technical","drills":[{"name":"Drives profundos","durationMin":20,"notes":"foco en longitud y consistencia"},{"name":"Dejadas y drops","durationMin":20,"notes":"de ambos lados, toque suave"},{"name":"Peloteo libre","durationMin":15,"notes":"ejecución limpia, sin presión"}]}},
    {"date":"${addDaysToISO(weekStart, 4)}","timeBlock":"PM","sessionType":"running","title":"Running tempo","durationMin":45,"rpe":7,"objective":"umbral aeróbico","runningType":"tempo","targetPaceMin":"4:40","targetPaceMax":"5:00"},
    {"date":"${addDaysToISO(weekStart, 5)}","timeBlock":"AM","sessionType":"mobility","title":"Movilidad integral","durationMin":30,"rpe":4,"objective":"prevención y recuperación","exercises":[
      {"name":"Hip flexor stretch","sets":2,"reps":"60s","mobilityFocus":"hip"},
      {"name":"Ankle circles","sets":2,"reps":"30s","mobilityFocus":"ankle"},
      {"name":"Shoulder CARs","sets":2,"reps":"30s","mobilityFocus":"shoulder"}
    ]}
  ],
  "reason":"semana base equilibrada para Rafael"}]
</actions>

EJEMPLO — update_session con ejercicios:
<actions>
[{"type":"update_session","sessionId":"ID_DE_8_CHARS","newObjective":"fuerza tren superior con énfasis en empuje","exercises":[
  {"name":"Press banca","sets":5,"reps":5,"weight":85,"group":"push"},
  {"name":"Press inclinado","sets":3,"reps":8,"weight":70,"group":"push"},
  {"name":"Dominadas con lastre","sets":4,"reps":6,"weight":10,"group":"pull"},
  {"name":"Remo Pendlay","sets":3,"reps":8,"weight":65,"group":"pull"},
  {"name":"Planchas","sets":3,"reps":"45s","group":"core"}
],"reason":"ejercicios más intensos según solicitud"}]
</actions>`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
