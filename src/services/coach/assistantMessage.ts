import type { TriageSignal } from '../athlete/coachRosterTriage'

export const ASSISTANT_MESSAGE_MAX_CHARS = 600

export type AssistantMessageParseResult =
  | { ok: true; body: string }
  | { ok: false; reason: 'invalid' | 'too-long' }

export const ASSISTANT_MESSAGE_SCHEMA = {
  type: 'object',
  properties: {
    body: { type: 'string' },
  },
  required: ['body'],
  additionalProperties: false,
} as const

export interface AssistantMessageInput {
  signals: Array<
    | { kind: 'pain'; days: number }
    | { kind: 'overdue-sessions'; count: number; oldestDaysAgo: number }
    | { kind: 'no-check-in'; days: number }
    | { kind: 'low-adherence'; adherencePct: number }
  >
}

function assertNever(value: never): never {
  throw new Error(`Señal de triaje no soportada: ${JSON.stringify(value)}`)
}

/**
 * Construye el contrato de salida hacia el proveedor campo por campo. No usa
 * spreads de objetos de dominio para que un futuro campo de TriageSignal no se
 * incorpore al prompt por accidente.
 */
export function buildAssistantMessageInput(signals: TriageSignal[]): AssistantMessageInput {
  return {
    signals: signals.map((signal) => {
      switch (signal.kind) {
        case 'pain':
          return { kind: 'pain', days: signal.days }
        case 'overdue-sessions':
          return {
            kind: 'overdue-sessions',
            count: signal.count,
            oldestDaysAgo: signal.oldestDaysAgo,
          }
        case 'no-check-in':
          return { kind: 'no-check-in', days: signal.days }
        case 'low-adherence':
          return { kind: 'low-adherence', adherencePct: signal.adherencePct }
        default:
          return assertNever(signal)
      }
    }),
  }
}

/**
 * El modelo redacta sólo el cuerpo. El nombre permanece local y cualquier
 * borrador requiere revisión del coach antes de copiarse o enviarse fuera de la
 * aplicación.
 */
export const ASSISTANT_SYSTEM_PROMPT = [
  'Eres el asistente de un entrenador. Redacta el CUERPO de un mensaje breve',
  'que el entrenador podría enviar a su alumno. No escribas saludo ni despedida.',
  'Recibes sólo señales estructuradas: no conoces el nombre, el plan ni el historial.',
  'En pain.days, days cuenta fechas de check-in distintas con dolor elevado dentro',
  'de siete días; no implica duración ni días consecutivos.',
  'No dar diagnósticos, no sugerir tratamiento y no proponer cambios de carga',
  'ni de entrenamiento. Ante una señal de dolor, formula únicamente una pregunta',
  'de seguimiento sobre cómo se siente.',
  'Usa un tono cercano, directo y en tuteo. Máximo 600 caracteres.',
  'Responde SOLAMENTE con un objeto JSON {"body": string}.',
].join(' ')

export function parseAssistantMessageResult(raw: string): AssistantMessageParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid' }
  }

  const keys = Object.keys(parsed)
  if (keys.length !== 1 || keys[0] !== 'body') return { ok: false, reason: 'invalid' }

  const body = (parsed as { body: unknown }).body
  if (typeof body !== 'string') return { ok: false, reason: 'invalid' }

  const trimmed = body.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'invalid' }
  if (trimmed.length > ASSISTANT_MESSAGE_MAX_CHARS) {
    return { ok: false, reason: 'too-long' }
  }

  return { ok: true, body: trimmed }
}
