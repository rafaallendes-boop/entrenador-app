/**
 * Mock provider — keyword-based responses for development/offline use.
 * No API key needed. Active when VITE_AI_PROVIDER is not set or is 'mock'.
 */

import type { AIProvider, AIRequest, AIRawResponse } from '../types'
import type { ChatContext } from '../../../types'

export class MockProvider implements AIProvider {
  readonly name = 'mock' as const

  async call(request: AIRequest): Promise<AIRawResponse> {
    // Simulate network latency
    await new Promise(r => setTimeout(r, 500 + Math.random() * 400))
    const text = mockReply(request.userMessage, request.systemPrompt)
    return { text, provider: 'mock', model: 'mock-v1' }
  }
}

// ─── Keyword-based reply logic (ported from aiCoach.ts) ───────────────────────

function mockReply(userMessage: string, _systemPrompt: string): string {
  const lower = userMessage.toLowerCase()

  if (lower.includes('bajar') && lower.includes('carga')) {
    return 'Entendido. Te propongo reducir el volumen esta semana un 20%: elimina el segundo entrenamiento de squash y acorta el rodaje a 30 min fácil. El partido de liga sigue igual — ese es el objetivo principal. Prioriza sueño 8h+ esta semana.'
  }

  if (lower.includes('squash') && (lower.includes('priorizar') || lower.includes('foco'))) {
    return 'Foco squash activado. Recomiendo: doble sesión (técnico AM + sparring PM) el martes, control técnico el jueves y partido el viernes. Running solo como recuperación activa. Fuerza solo 1 sesión upper el miércoles.'
  }

  if (lower.includes('running') && lower.includes('priorizar')) {
    return 'Para priorizar running: sesión larga el domingo (60–70 min Z2), tempo el martes (4×8 min umbral) y un fácil de 30 min el jueves. Squash solo una sesión de control técnico el miércoles — sin partido esta semana si quieres rendir bien en running.'
  }

  if (lower.includes('nutrici')) {
    return 'Esta semana de carga media-alta: carbohidratos 4–5 g/kg en días de squash, proteína 1.8–2 g/kg diario (150–160 g), hidratos reducidos el día de descanso. Post-partido: carbos + proteína en los primeros 30 min. Hidratación 2.5–3 L/día.'
  }

  if (lower.includes('canso') || lower.includes('fatigado') || lower.includes('pesado')) {
    return 'Si te sientes cansado, es una señal importante. Hoy: movilidad suave 20 min. Mañana: rodaje muy fácil 25 min si el cuerpo responde. Pospone fuerza a pasado mañana. Prioriza sueño 9h esta noche. ¿Cómo tienes la sensación de piernas específicamente?'
  }

  if (lower.includes('reorden') || lower.includes('ajustar semana')) {
    return 'Para reordenar la semana necesito saber tu disponibilidad. En general: L-X-V fuerza/técnica, Ma-Ju squash de calidad, S partido/intenso, D descanso o movilidad. ¿Hay algún día con restricción horaria esta semana?'
  }

  if (lower.includes('partido') || lower.includes('liga')) {
    return 'Para el partido: 48h antes reduce intensidad con activación corta (15 min squash suave). El día antes: movilidad + mucha hidratación. Pre-partido: carbos 3h antes, nada pesado. En cancha: arranca controlado los primeros puntos, no te apresures. ¿Cómo ves al rival?'
  }

  // Context-aware fallback
  const summary = extractContextSummary(_systemPrompt)
  if (summary) {
    return `Recibido. ${summary} ¿En qué aspecto concreto quieres que me enfoque? Puedo ajustar carga, afinar técnica, planificar nutrición o preparar el próximo partido.`
  }

  return 'Hola. Estoy listo para ayudarte a optimizar tu entrenamiento. Puedo ajustar tu semana, analizar tu carga, darte pautas nutricionales o prepararte para el próximo partido. ¿Qué necesitas hoy?'
}

function extractContextSummary(systemPrompt: string): string {
  // Pull adherence line from system prompt if present
  const match = systemPrompt.match(/Adherencia global:\s*(\d+)%/)
  if (match) {
    return `Veo que llevas un ${match[1]}% de adherencia esta semana.`
  }
  return ''
}

// ─── Legacy adapter — keeps aiCoach.ts working unchanged ──────────────────────

export function mockCoachResponseLegacy(
  userMessage: string,
  context: ChatContext,
): { message: string } {
  const recentCompleted = context.recentSessions.filter(s => s.status === 'completed')
  const lastType = recentCompleted[recentCompleted.length - 1]?.type
  const contextHint = lastType
    ? `SEMANA ACTUAL. Última sesión completada: ${lastType}.`
    : ''
  const reply = mockReply(userMessage, contextHint)
  return { message: reply }
}
