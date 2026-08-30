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
  'que el entrenador podría enviar a su alumno. El cliente antepone su propio saludo:',
  'empieza directamente con el contenido y no escribas saludo ni despedida.',
  'Recibes sólo señales estructuradas: no conoces el nombre, el plan ni el historial.',
  'En pain.days, days cuenta fechas de check-in distintas con dolor elevado dentro',
  'de siete días; no implica duración ni días consecutivos.',
  'La señal no-check-in significa que faltó el feedback diario del alumno;',
  'no significa que dejó de registrar entrenamientos ni que no entrenó.',
  'No dar diagnósticos, no sugerir tratamiento y no proponer cambios de carga',
  'ni de entrenamiento. Ante una señal de dolor, formula únicamente una pregunta',
  'de seguimiento sobre cómo se siente.',
  'Usa un tono cercano, directo y en tuteo. Máximo 600 caracteres.',
  'Responde SOLAMENTE con un objeto JSON {"body": string}.',
].join(' ')

/**
 * El saludo visible lo compone el cliente con el nombre local del atleta.
 * Aunque el prompt lo prohíbe, los modelos pueden anteponer uno igualmente;
 * quitar una salutación genérica al inicio evita pagar un segundo intento o
 * mostrar "Hola <nombre>, ¡Hola!".
 */
function stripLeadingGreeting(body: string): string {
  return body.replace(
    /^\s*(?:¡\s*)?(?:hola|buenos días|buenas tardes|buenas noches)\b\s*(?:[!.,;:…—–-]+\s*)*/iu,
    '',
  ).trim()
}

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

  const normalized = stripLeadingGreeting(body)
  if (normalized.length === 0) return { ok: false, reason: 'invalid' }
  if (normalized.length > ASSISTANT_MESSAGE_MAX_CHARS) {
    return { ok: false, reason: 'too-long' }
  }

  return { ok: true, body: normalized }
}
