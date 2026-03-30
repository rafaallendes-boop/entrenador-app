import type { ChatContext } from '../types'

export interface CoachRequest {
  userMessage: string
  context: ChatContext
}

export interface CoachResponse {
  message: string
  suggestedActions?: string[]
}

// ─── Entry point ──────────────────────────────────────────────────────────────
// Set VITE_AI_PROVIDER=claude (and VITE_AI_API_KEY) in .env to enable real AI.

export async function askCoach(request: CoachRequest): Promise<CoachResponse> {
  const provider = import.meta.env.VITE_AI_PROVIDER

  if (provider === 'claude') {
    return callClaudeAPI(request)
  }

  // Default: mock responses for MVP
  return mockCoachResponse(request)
}

// ─── Mock responses ───────────────────────────────────────────────────────────

function mockCoachResponse(req: CoachRequest): CoachResponse {
  const msg = req.userMessage
  const lower = msg.toLowerCase()

  if (lower.includes('bajar') && lower.includes('carga')) {
    return {
      message: 'Entendido. Te propongo reducir el volumen esta semana un 20%: elimina el segundo entrenamiento de squash y acorta el rodaje a 30 min fácil. El partido de liga sigue igual — ese es el objetivo principal. Prioriza sueño 8h+ esta semana.',
      suggestedActions: ['Ver semana ajustada'],
    }
  }

  if (lower.includes('squash') && (lower.includes('priorizar') || lower.includes('foco'))) {
    return {
      message: 'Foco squash activado. Recomiendo: doble sesión de squash (técnico AM + sparring PM) el martes, control técnico el jueves y partido el viernes. Running solo como recuperación activa. Fuerza solo 1 sesión upper el miércoles.',
      suggestedActions: ['Ajustar semana'],
    }
  }

  if (lower.includes('running') && lower.includes('priorizar')) {
    return {
      message: 'Para priorizar running esta semana: sesión larga el domingo (60-70 min Z2), tempo el martes (4x8min umbral) y un fácil de 30 min el jueves. Squash solo una sesión de control técnico el miércoles — sin partido esta semana si quieres rendir bien en running.',
    }
  }

  if (lower.includes('nutrici')) {
    return {
      message: 'Esta semana de carga media-alta te recomiendo: carbohidratos en torno a 4-5g/kg en días de squash, proteína 1.8-2g/kg diario (150-160g), hidratos reducidos el domingo de descanso. Post-partido: carbos + proteína en los primeros 30 min. Hidratación 2.5-3L/día.',
    }
  }

  if (lower.includes('canso') || lower.includes('fatigado') || lower.includes('pesado')) {
    return {
      message: 'Si te sientes cansado, es una señal importante. Sugiero: hoy movilidad suave (20 min), mañana rodaje muy fácil 25 min si el cuerpo responde bien, y posponer el entrenamiento de fuerza a pasado mañana. Prioriza sueño 9h esta noche. ¿Cómo tienes la sensación de piernas específicamente?',
    }
  }

  if (lower.includes('reorden') || lower.includes('ajustar semana')) {
    return {
      message: 'Para reordenar la semana necesito saber tu disponibilidad. En general te propongo: L-X-V fuerza/técnica, Ma-Ju squash de calidad, S partido/intenso, D descanso o movilidad. ¿Hay algún día con restricción horaria esta semana?',
    }
  }

  if (lower.includes('partido') || lower.includes('liga')) {
    return {
      message: 'Para el partido: 48h antes reduce intensidad pero mantén activación con algo corto (15 min squash a baja intensidad). El día antes: movilidad y mucha hidratación. Pre-partido: carbos 3h antes, nada muy pesado. En cancha: arranca controlado los primeros puntos, no te apresures. ¿Cómo ves al rival?',
    }
  }

  // Default contextual response
  const recentCompleted = req.context.recentSessions.filter(s => s.status === 'completed')
  if (recentCompleted.length > 0) {
    const lastType = recentCompleted[recentCompleted.length - 1].type
    const typeLabels: Record<string, string> = {
      squash: 'squash', running: 'running', strength: 'fuerza',
      mobility: 'movilidad', recovery: 'recuperación', nutrition: 'nutrición',
    }
    return {
      message: `Recibido. Veo que tu última sesión fue de ${typeLabels[lastType] ?? lastType}. Basándome en tu historial reciente y la carga acumulada, ¿en qué aspecto concreto de tu entrenamiento quieres que me enfoque? Puedo ayudarte a ajustar carga, afinar técnica, planificar nutrición o preparar el próximo partido.`,
    }
  }

  return {
    message: 'Hola. Estoy listo para ayudarte a optimizar tu entrenamiento. Puedo ajustar tu semana, analizar tu carga, darte pautas nutricionales o prepararte para el próximo partido. ¿Qué necesitas hoy?',
  }
}

// ─── Claude API (Phase 2) ─────────────────────────────────────────────────────

async function callClaudeAPI(request: CoachRequest): Promise<CoachResponse> {
  const apiKey = import.meta.env.VITE_AI_API_KEY
  if (!apiKey) throw new Error('VITE_AI_API_KEY not set')

  const systemPrompt = buildSystemPrompt(request.context)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: request.userMessage }],
    }),
  })

  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const data = await res.json()
  return { message: data.content[0].text }
}

function buildSystemPrompt(ctx: ChatContext): string {
  const recentSummary = ctx.recentSessions
    .slice(-7)
    .map(s => `- ${s.date} ${s.timeBlock}: ${s.type} "${s.title}" ${s.durationMin}min RPE${s.rpe ?? '?'} ${s.status === 'completed' ? '✓' : `(${s.status})`}`)
    .join('\n')

  return `Eres un coach deportivo de alto rendimiento personal. Entrenas a Rafael, jugador de squash avanzado (exseleccionado nacional), que también hace running, fuerza y movilidad.

Sesiones recientes:
${recentSummary}

${ctx.currentWeekSummary ? `Resumen semana actual: ${ctx.currentWeekSummary.completedSessions}/${ctx.currentWeekSummary.plannedSessions} sesiones completadas, ${ctx.currentWeekSummary.completedMinutes}/${ctx.currentWeekSummary.plannedMinutes} min, adherencia ${ctx.currentWeekSummary.adherencePct ?? 'N/A'}%, RPE real promedio ${ctx.currentWeekSummary.avgActualRpe?.toFixed(1) ?? 'N/A'}` : ''}

${ctx.dayLog ? `Estado hoy: sueño ${ctx.dayLog.sleepHours ?? '?'}h, energía ${ctx.dayLog.energyLevel ?? '?'}/10${ctx.dayLog.painNotes ? ', molestias: ' + ctx.dayLog.painNotes : ''}` : ''}

Responde en español, de forma concisa y práctica. Eres directo, no verbose. Proporciona recomendaciones específicas y accionables. Nunca des consejos genéricos.`
}
