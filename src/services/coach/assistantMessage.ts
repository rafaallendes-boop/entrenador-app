import type { TriageSignal } from '../athlete/coachRosterTriage'

export const ASSISTANT_MESSAGE_MAX_CHARS = 600
/**
 * Las únicas palabras españolas de una sola letra son `a`, `e`, `o`, `u` e `y`.
 *
 * La corrupción observada reemplaza un carácter multibyte por un hueco, así que
 * parte la palabra y deja un fragmento suelto: `días`→`d ias`, `algún`→`alg n`,
 * `más`→`m s`, `sesión`→`sesi n`, `cómo`→`C mo`. Fijar los dos literales que el
 * smoke alcanzó a ver dejaba pasar el resto de una familia abierta, y todos son
 * más frecuentes en un mensaje real que `algún`.
 *
 * Alcance honesto: no detecta el caso en que el fragmento suelto resulta ser
 * una palabra válida de una letra (`energía` → `energ a`). Es defensa en
 * profundidad detrás del transporte ASCII-safe, no un sustituto de él.
 */
const SPANISH_SINGLE_LETTER_WORDS = new Set(['a', 'e', 'o', 'u', 'y'])
/** Toda palabra española tiene vocal; estas abreviaturas de unidad no. */
const VOWELLESS_ABBREVIATIONS = new Set(['km', 'kg', 'hr', 'cm', 'mm', 'ml', 'pm', 'am'])

function isCorruptFragment(token: string): boolean {
  // Un token con dígitos es notación, no prosa: `3x8`, `5k`, `Z2`. Reducirlo a
  // sus letras produciría un falso positivo sobre contenido legítimo.
  if (/\p{N}/u.test(token)) return false
  const letters = token.replace(/[^\p{L}]/gu, '')
  if (letters.length === 0) return false
  const normalized = letters.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // Fragmento de una letra que no es palabra: `días`→`d ias`, `más`→`m s`.
  if (normalized.length === 1) return !SPANISH_SINGLE_LETTER_WORDS.has(normalized)

  // Fragmento sin vocal: `próxima`→`pr xima`. Las unidades quedan exentas.
  if (VOWELLESS_ABBREVIATIONS.has(normalized)) return false
  return !/[aeiouy]/.test(normalized)
}

function hasEncodingArtifact(body: string): boolean {
  if (body.includes('\uFFFD')) return true
  return body.split(/\s+/).some(isCorruptFragment)
}

export type AssistantMessageParseResult =
  | { ok: true; body: string }
  | { ok: false; reason: 'invalid-json' | 'invalid-shape' | 'invalid-encoding' | 'too-long' }

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
    return { ok: false, reason: 'invalid-json' }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid-shape' }
  }

  const keys = Object.keys(parsed)
  if (keys.length !== 1 || keys[0] !== 'body') return { ok: false, reason: 'invalid-shape' }

  const body = (parsed as { body: unknown }).body
  if (typeof body !== 'string') return { ok: false, reason: 'invalid-shape' }
  // U+FFFD prueba que algún borde de transporte ya reemplazó bytes inválidos.
  // Los otros dos patrones son las corrupciones literales observadas en el
  // smoke (`d ias`/`d ías`, `alg n`). Fallar cerrado evita ofrecerle al coach
  // texto dañado si una capa vieja o un intermediario elude el fix de transporte.
  const normalized = stripLeadingGreeting(body.normalize('NFC'))
  if (normalized.length === 0) return { ok: false, reason: 'invalid-shape' }
  // El tope va antes que la detección de corrupción para conservar el motivo
  // más específico: un body desbordado se reporta como `too-long` aunque su
  // relleno sintético no parezca español.
  if (normalized.length > ASSISTANT_MESSAGE_MAX_CHARS) {
    return { ok: false, reason: 'too-long' }
  }
  if (hasEncodingArtifact(normalized)) {
    return { ok: false, reason: 'invalid-encoding' }
  }

  return { ok: true, body: normalized }
}
