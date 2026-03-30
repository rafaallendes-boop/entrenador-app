/**
 * Builds rich, context-aware system prompts for the AI coach.
 *
 * Design goals:
 * - Include enough context that the model can give specific, non-generic advice
 * - Keep the prompt efficient (avoid sending unnecessary tokens)
 * - Always include session IDs so the model can reference them in action proposals
 * - Instruct the model on the <actions> response format
 */

import type { ChatContext, Session } from '../../types'
import { todayISO } from '../../utils/date'

const SQUASH_SUBTYPE_ES: Record<string, string> = {
  training: 'entrenamiento', match: 'partido', competitive: 'competitivo',
  control: 'control', light: 'suave',
}
const RUNNING_TYPE_ES: Record<string, string> = {
  z2: 'Z2 aerÃ³bico', tempo: 'tempo', intervals: 'intervalos', long: 'long run',
}
const SESSION_TYPE_ES: Record<string, string> = {
  squash: 'squash', running: 'running', strength: 'fuerza',
  mobility: 'movilidad', recovery: 'recuperaciÃ³n', nutrition: 'nutriciÃ³n',
}
const STATUS_ES: Record<string, string> = {
  planned: 'planificado', completed: 'completado', adjusted: 'ajustado', skipped: 'saltado',
}
const DAY_ES = ['Dom', 'Lun', 'Mar', 'MiÃ©', 'Jue', 'Vie', 'SÃ¡b']

// â”€â”€â”€ Entry point â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function buildCoachSystemPrompt(context: ChatContext): string {
  const sections: string[] = [
    buildPersonaSection(),
    buildWeekSection(context),
    buildSessionsSection(context.recentSessions),
    buildTodaySection(context),
    buildRecentChatHistory(context.recentMessages),
    buildResponseInstructions(context.recentSessions),
  ]
  return sections.filter(Boolean).join('\n\n')
}

// â”€â”€â”€ Sections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildPersonaSection(): string {
  return `Eres el coach personal de alto rendimiento de Rafael Allendes. Rafael es jugador de squash avanzado (ex-selecciÃ³n nacional) que tambiÃ©n entrena running, fuerza y movilidad de forma estructurada.

Tu estilo de comunicaciÃ³n:
- Directo y concreto. Sin generalidades de fitness.
- Hablas como alguien que lleva meses siguiendo su historial.
- Si propones algo, das el "por quÃ©" en una frase.
- Si no tienes suficiente contexto, preguntas algo especÃ­fico.
- Responde siempre en espaÃ±ol.`
}

function buildWeekSection(context: ChatContext): string {
  const { currentWeekSummary: s } = context
  if (!s) return ''

  const lines: string[] = ['â”â”â” SEMANA EN CURSO â”â”â”']

  // Dates
  const weekStart = formatDateShort(s.weekStartDate)
  lines.push(`Semana: ${weekStart} (7 dÃ­as)`)

  // Global adherence
  const adh = s.adherencePct != null ? ` (${s.adherencePct}%)` : ''
  lines.push(`Adherencia global: ${s.completedSessions}/${s.plannedSessions} sesiones${adh}`)

  // Volume
  lines.push(`Volumen completado: ${formatMin(s.completedMinutes)} de ${formatMin(s.plannedMinutes)} planificados`)

  // Per-discipline adherence (only if we have planned data)
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
  if (disciplines.length > 0) lines.push(disciplines.join('  Â·  '))

  // RPE
  if (s.avgActualRpe != null) lines.push(`RPE real promedio: ${s.avgActualRpe.toFixed(1)}/10`)
  else if (s.avgRpe != null) lines.push(`RPE planificado promedio: ${s.avgRpe.toFixed(1)}/10`)

  // Coach objectives
  if (s.objectives && s.objectives.length > 0) {
    lines.push(`Objetivos semana: ${s.objectives.join(' / ')}`)
  }

  return lines.join('\n')
}

function buildSessionsSection(sessions: Session[]): string {
  // Filtro "Lazy Context": omitimos las sesiones de dÃ­as anteriores para ahorrar tokens.
  const today = todayISO()
  const futureSessions = sessions.filter(s => s.date >= today)

  if (futureSessions.length === 0) return ''

  const lines: string[] = ['â”â”â” SESIONES DISPONIBLES (HOY Y FUTURO) â”â”â”']
  lines.push('(IDs incluidos â€” Ãºsalos en las acciones si propones cambios)')

  // Sort by date then timeBlock
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
    const flag = s.status === 'completed' ? 'âœ“' : s.status === 'skipped' ? 'âœ—' : s.status === 'adjusted' ? '~' : 'â—‹'
    const matchMeta = formatMatchMeta(s)

    lines.push(`${flag} [${s.id.slice(0, 8)}] ${dayName} ${s.timeBlock} · ${type}${subtype} "${s.title}" · ${duration}${rpe} · ${status}${matchMeta}`)

    // Running details
    if (s.runningDetails) {
      const rd = s.runningDetails
      const runType = RUNNING_TYPE_ES[rd.runningType] ?? rd.runningType
      const pace = rd.targetPaceMin
        ? `${rd.targetPaceMin}${rd.targetPaceMax ? `â€“${rd.targetPaceMax}` : ''} /km`
        : null
      const hr = rd.targetHrMin ? `FC ${rd.targetHrMin}â€“${rd.targetHrMax ?? '?'} bpm` : null
      const details = [runType, pace, hr].filter(Boolean).join(' Â· ')
      if (details) lines.push(`   â†³ ${details}`)
    }

    // Exercises (strength/mobility)
    if (s.exercises && s.exercises.length > 0) {
      const exStr = s.exercises
        .slice(0, 6) // cap at 6 to avoid token bloat
        .map(ex => {
          const w = ex.weight ? ` ${ex.weight}kg` : ''
          return `${ex.name} ${ex.sets}Ã—${ex.reps}${w}`
        })
        .join(', ')
      lines.push(`   â†³ ${exStr}${s.exercises.length > 6 ? ` +${s.exercises.length - 6} mÃ¡s` : ''}`)
    }

    // Completion notes
    if (s.completionNotes) {
      lines.push(`   â†³ Nota post: "${s.completionNotes.slice(0, 80)}"`)
    }
  }

  return lines.join('\n')
}

function buildTodaySection(context: ChatContext): string {
  const { dayLog } = context
  const today = todayISO()

  const lines: string[] = [`â”â”â” HOY (${formatDateShort(today)}) â”â”â”`]

  if (!dayLog) {
    lines.push('Sin registro diario todavÃ­a.')
    return lines.join('\n')
  }

  if (dayLog.sleepHours != null) {
    const qual = dayLog.sleepQuality != null ? ` Â· Calidad ${dayLog.sleepQuality}/5` : ''
    lines.push(`SueÃ±o: ${dayLog.sleepHours}h${qual}`)
  }
  if (dayLog.energyLevel != null) lines.push(`EnergÃ­a: ${dayLog.energyLevel}/10`)
  if (dayLog.painLevel != null) {
    const pain = dayLog.painLevel === 0 ? 'Sin dolor' : `${dayLog.painLevel}/10`
    const notes = dayLog.painNotes ? ` â€” ${dayLog.painNotes}` : ''
    lines.push(`Dolor: ${pain}${notes}`)
  }
  if (dayLog.rpeActual != null) lines.push(`RPE real hoy: ${dayLog.rpeActual}/10`)
  if (dayLog.postSessionComment) {
    lines.push(`Comentario: "${dayLog.postSessionComment.slice(0, 120)}"`)
  }
  if (dayLog.generalNotes) {
    lines.push(`Notas dÃ­a: "${dayLog.generalNotes.slice(0, 120)}"`)
  }

  return lines.join('\n')
}

function buildRecentChatHistory(messages?: {role: string, content: string}[]): string {
  if (!messages || messages.length === 0) return ''
  const lines = ['â”â”â” HISTORIAL RECIENTE â”â”â”']
  for (const m of messages) {
    const isCoach = m.role === 'coach'
    lines.push(`${isCoach ? 'Coach' : 'Atleta'}: "${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}"`)
  }
  return lines.join('\n')
}

function buildResponseInstructions(sessions: Session[]): string {
  const plannedIds = sessions
    .filter(s => s.status === 'planned')
    .map(s => s.id.slice(0, 8))
    .slice(0, 8)
    .join(', ')

  const actionDocs = `Tipos de acciÃ³n disponibles:
- skip_session: {sessionId, reason}
- change_rpe: {sessionId, newRpe, reason}
- shorten_session: {sessionId, newDurationMin, reason}
- lengthen_session: {sessionId, newDurationMin, reason}
- move_session: {sessionId, targetDate (YYYY-MM-DD), reason}
- replace_session_type: {sessionId, newType (squash|running|strength|mobility|recovery), reason}
- insert_recovery: {targetDate (YYYY-MM-DD), reason}`

  const idHint = plannedIds
    ? `IDs de sesiones planificadas (para acciones): ${plannedIds}`
    : ''

  return `â”â”â” INSTRUCCIONES DE RESPUESTA â”â”â”
Responde en espaÃ±ol. MÃ¡ximo 3â€“4 pÃ¡rrafos cortos o una lista con bullets concretos.
No uses frases genÃ©ricas. Habla como alguien que conoce el historial de Rafael.

${idHint ? idHint + '\n\n' : ''}Si propones cambios concretos al plan, aÃ±ade AL FINAL de tu respuesta (y solo al final) un bloque de acciones con este formato EXACTO:

<actions>
[{"type":"TIPO","sessionId":"ID_CORTO","reason":"motivo conciso"}]
</actions>

Solo incluye <actions> si tienes propuestas reales y concretas que mejorarÃ­an el plan.
Si no, no incluyas el bloque â€” responde solo con texto.

${actionDocs}`
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

function formatMatchMeta(session: Session): string {
  if (session.type !== 'squash' || (session.subtype !== 'match' && session.subtype !== 'competitive')) {
    return ''
  }

  const parts: string[] = []
  if (session.opponent) parts.push(`vs ${session.opponent}`)
  if (session.matchResult) parts.push(session.matchResult === 'win' ? 'gano' : 'perdio')
  if (session.gamesWon != null || session.gamesLost != null) {
    parts.push(`games ${session.gamesWon ?? '?'}-${session.gamesLost ?? '?'}`)
  }
  if (session.location) parts.push(`en ${session.location}`)

  return parts.length > 0 ? ` · ${parts.join(' · ')}` : ''
}


