import type { Session } from '../../types'
import type { CoachConversationEvent } from '../ai/types'
import { v4 as uuid } from '../../utils/uuid'

export const PENDING_INTENT_TTL_MS = 10 * 60_000

export interface PendingIntent {
  id: string
  kind: 'generation_offer' | 'clarification'
  athleteId: string | null
  conversationId: string
  createdAt: number
  expiresAt: number
  status: 'open' | 'consumed' | 'cancelled'
  route: 'week_creator' | 'plan_builder_redirect' | 'chat_action'
  operation:
    | { type: 'create_week'; targetWeekStart?: string }
    | {
        type: 'move_session' | 'update_session' | 'delete_session' | 'add_session'
        known: Record<string, string | number>
        missing: string[]
        /** Candidatos del turno anterior (p. ej. dos sesiones el lunes); permiten que "PM" baste en el turno siguiente. */
        candidates?: PlannedRef[]
      }
  summary: string
}

export interface PendingIntentScope {
  athleteId: string | null
  conversationId: string
}

export type PendingIntentDecision =
  | { kind: 'consume'; route: PendingIntent['route']; targetWeekStart?: string; operation?: PendingIntent['operation'] }
  | { kind: 'already_consumed' }
  | { kind: 'cancel' }
  /** `operation` es la operación PARCIALMENTE completada: el store la guarda para el turno siguiente. */
  | { kind: 'fill'; missing: string[]; candidates: PlannedRef[]; operation: PendingIntent['operation'] }
  | { kind: 'none' }

export type PlannedRef = Pick<Session, 'id' | 'date' | 'timeBlock' | 'title'>

const CONFIRMATION_PATTERN = /^\s*(si|sí|ok|okay|dale|confirmo|correcto|hazlo|hacelo|procede|adelante|va|listo|de una)\b[\s!.]*$/
const NEGATION_PATTERN = /^\s*(?:(?:no|nop|mejor no|dejalo|olvidalo|todavia no|aun no|cancela)(?:[,\s]+(?:solo )?explicame)?|(?:solo )?explicame)[\s!.]*$/
/** Verbos que hacen a un mensaje COMPATIBLE con la operación pendiente. */
const OPERATION_VERBS: Record<Exclude<PendingIntent['operation'], { type: 'create_week' }>['type'], RegExp> = {
  move_session: /\b(mueve|muevela|muevelo|pasa|pasala|pasalo|cambia(?:la|lo)? de dia|reprograma)\b/,
  update_session: /\b(cambia|cambiala|cambialo|modifica|ajusta|acorta|alarga|baja|sube|reemplaza)\b/,
  delete_session: /\b(borra|borrala|borralo|elimina|eliminala|saca|sacala|quita|quitala)\b/,
  add_session: /\b(agrega|agregala|pon|ponla|ponme|crea|creala|arma|armala|programa)\b/,
}
const WEEKDAY_INDEX: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 }
const MISSING_LABELS: Record<string, string> = { sessionId: 'qué sesión', targetDate: 'qué día', timeBlock: 'qué franja (AM o PM)', newDurationMin: 'cuántos minutos' }

export function describeMissing(missing: string[]): string {
  return missing.map(key => MISSING_LABELS[key] ?? key).join(', ')
}

/**
 * Resuelve el dato faltante a partir de la respuesta del usuario. En A cubre
 * día de la semana, hoy/mañana y franja AM/PM contra las sesiones planificadas.
 * Referencias por título o deporte son B4: devuelven candidatos sin resolver.
 */
function resolveClarificationReply(
  normalizedMessage: string,
  operation: Exclude<PendingIntent['operation'], { type: 'create_week' }>,
  planned: PlannedRef[],
  now: number,
): { operation: typeof operation; candidates: PlannedRef[] } {
  const known = { ...operation.known }
  const missing = [...operation.missing]
  const dayToken = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoy|manana)\b/.exec(normalizedMessage)?.[1]
  const block = /\b(am|pm)\b/.exec(normalizedMessage)?.[1]?.toUpperCase() as 'AM' | 'PM' | undefined
  // Punto de partida: los candidatos que dejó el turno anterior, si los hubo.
  let candidates: PlannedRef[] = operation.candidates ?? []
  if (dayToken) {
    // Tanto un DESTINO ("muévela al viernes") como un REFERENTE ("la del
    // lunes") resuelven el token a UNA fecha absoluta relativa a "ahora"
    // (próxima ocurrencia de ese día). Resolver por día-de-semana contra
    // TODAS las sesiones planificadas está mal para este producto: el
    // horizonte de planificación cubre 2-3 semanas, así que "lunes" nombra
    // 2-3 fechas distintas y un match por día-de-semana puede converger en la
    // sesión de la semana equivocada sin que nada lo delate.
    const date = resolveDateToken(dayToken, now)
    if (missing.includes('targetDate') && date) {
      known.targetDate = date
      missing.splice(missing.indexOf('targetDate'), 1)
    } else if (missing.includes('sessionId')) {
      candidates = planned.filter(s => s.date === date)
    }
  }
  if (missing.includes('sessionId') && candidates.length > 0) {
    // Con o sin día en este turno, la franja acota los candidatos acumulados.
    const narrowed = block ? candidates.filter(s => s.timeBlock === block) : candidates
    if (narrowed.length === 1) {
      known.sessionId = narrowed[0].id
      missing.splice(missing.indexOf('sessionId'), 1)
      candidates = []
    } else {
      candidates = narrowed.length > 0 ? narrowed : candidates
    }
  }
  return { operation: { ...operation, known, missing, ...(candidates.length > 0 ? { candidates } : {}) }, candidates }
}

function resolveDateToken(token: string, now: number): string | undefined {
  const base = new Date(now)
  const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (token === 'hoy') return toIso(base)
  if (token === 'manana') { base.setDate(base.getDate() + 1); return toIso(base) }
  const target = WEEKDAY_INDEX[token]
  if (target == null) return undefined
  // Próxima ocurrencia del día nombrado, contando hoy.
  const delta = (target - base.getDay() + 7) % 7
  base.setDate(base.getDate() + delta)
  return toIso(base)
}

/** La primera oferta o aclaración gana; una respuesta con varias no abre varias intenciones. */
export function pendingIntentFromEvents(
  events: CoachConversationEvent[] | undefined,
  scope: PendingIntentScope,
  now: number,
): PendingIntent | null {
  const event = events?.[0]
  if (!event) return null
  const base = { id: uuid(), athleteId: scope.athleteId, conversationId: scope.conversationId, createdAt: now, expiresAt: now + PENDING_INTENT_TTL_MS, status: 'open' as const, summary: event.summary }
  if (event.kind === 'offer_generation') {
    return { ...base, kind: 'generation_offer', route: event.route, operation: { type: 'create_week', targetWeekStart: event.targetWeekStart } }
  }
  return { ...base, kind: 'clarification', route: 'chat_action', operation: { type: event.operation, known: event.known, missing: event.missing } }
}

function belongsTo(intent: PendingIntent, scope: PendingIntentScope): boolean {
  return intent.athleteId === scope.athleteId && intent.conversationId === scope.conversationId
}

export function resolvePendingIntentDecision(
  normalizedMessage: string,
  intent: PendingIntent | null | undefined,
  scope: PendingIntentScope,
  now: number,
  plannedSessions: PlannedRef[] = [],
): PendingIntentDecision {
  if (!intent || !belongsTo(intent, scope)) return { kind: 'none' }
  if (intent.status === 'cancelled' || now > intent.expiresAt) return { kind: 'none' }
  const confirms = CONFIRMATION_PATTERN.test(normalizedMessage)
  if (intent.status === 'consumed') return confirms ? { kind: 'already_consumed' } : { kind: 'none' }
  if (NEGATION_PATTERN.test(normalizedMessage)) return { kind: 'cancel' }
  if (intent.operation.type === 'create_week') {
    return confirms
      ? { kind: 'consume', route: intent.route, ...(intent.operation.targetWeekStart ? { targetWeekStart: intent.operation.targetWeekStart } : {}) }
      : { kind: 'none' }
  }
  // Solo una respuesta breve de referente o una instrucción de la misma
  // operación completa la aclaración. Preguntas nuevas siguen al coach.
  const referenceReply = /^(?:(?:la|el)\s+(?:sesion\s+)?(?:del?\s+)?|al?\s+)?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoy|manana)(?:\s+(?:por la\s+)?(?:am|pm))?[\s!.]*$|^(?:la\s+)?(?:am|pm)[\s!.]*$/
  const compatible = confirms || referenceReply.test(normalizedMessage.trim())
    || OPERATION_VERBS[intent.operation.type].test(normalizedMessage)
  if (!compatible) return { kind: 'none' }
  // Aclaración: primero intentar completar el dato con la respuesta.
  const resolved = resolveClarificationReply(normalizedMessage, intent.operation, plannedSessions, now)
  if (resolved.operation.missing.length > 0) {
    // Se devuelve la operación parcial (con lo que sí se resolvió y los
    // candidatos) para que el store la guarde y el turno siguiente parta de ahí.
    return { kind: 'fill', missing: resolved.operation.missing, candidates: resolved.candidates, operation: resolved.operation }
  }
  // Completa: se consume sólo ante una respuesta COMPATIBLE (confirmación, el
  // dato que faltaba, o el verbo de la operación). Una pregunta nueva no la
  // dispara; la intención queda abierta y el mensaje sigue su ruta normal.
  return compatible
    ? { kind: 'consume', route: 'chat_action', operation: resolved.operation }
    : { kind: 'none' }
}
