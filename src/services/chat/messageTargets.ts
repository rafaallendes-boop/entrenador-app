import type { ChatContext, Session, SessionType, TimeBlock } from '../../types'
import { v4 as uuid } from '../../utils/uuid'
import { PENDING_INTENT_TTL_MS, type PendingIntent, type PendingIntentScope, type PlannedRef } from './pendingIntent'

/**
 * B4: identifica las sesiones que nombra el mensaje sobre el contexto de
 * DOMINIO completo. Determinista. Combina criterios en vez de elegir el
 * primero que aparece, y respeta la cantidad pedida: nunca amplía ni recorta
 * un pedido en silencio; si no sabe cuáles, lo pregunta.
 */

/** I13c */
export const MAX_TARGETS_PER_OPERATION = 12
/** Mismo TTL que una intención pendiente: un referente viejo no se adivina. */
export const REFERENT_TTL_MS = PENDING_INTENT_TTL_MS

export type MessageTargetReason = 'id_prefix' | 'explicit_date' | 'named_session' | 'anaphora'

export interface MessageTarget {
  sessionId: string
  date: string
  timeBlock: TimeBlock
  reason: MessageTargetReason
}

export type TargetCardinality = { kind: 'singular' } | { kind: 'plural'; count?: number } | { kind: 'unspecified' }

type ClarifyReason = 'ambiguous_referent' | 'missing_referent' | 'count_mismatch' | 'too_many_requested' | 'invalid_date'

export type MessageTargetResolution =
  | { kind: 'none' }
  | { kind: 'resolved'; targets: MessageTarget[]; overflow: MessageTarget[]; dates: string[]; requestedCount?: number }
  | { kind: 'clarify'; reason: ClarifyReason; candidates: PlannedRef[]; dates: string[]; cardinality: TargetCardinality; requestedCount?: number }

export interface ResolveMessageTargetsInput {
  message: string
  context: ChatContext
  pendingIntent: PendingIntent | null | undefined
  scope: PendingIntentScope
  recentMessages: ReadonlyArray<{ role: 'user' | 'coach'; content: string; timestamp?: number }>
  now: number
}

const DAY_WORDS = 'anteayer|antes de ayer|ayer|hoy|pasado manana|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo'
const WEEKDAYS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 }
const MORNING_PHRASE = /\b(?:por|en|de) la manana\b/g
const MORNING = /\b(?:por|en|de) la manana\b|\bam\b/
const AFTERNOON = /\b(?:por|en|de) la tarde\b|\bpm\b/
const NUMERIC_DATE_SOURCE = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}(?:/\d{4})?)`
const DATE_SOURCE = `(?:${NUMERIC_DATE_SOURCE}|${DAY_WORDS})`
// Destino y su franja no restringen la sesión origen. Grupo 1 = fecha destino.
const DESTINATION = new RegExp(String.raw`\b(?:a|al|a la|para|para el|para la|hacia el)\s+(${DATE_SOURCE})\b(?:\s+(?:por la manana|por la tarde|am|pm))?`, 'g')
const DAY_TOKEN = new RegExp(String.raw`\b(${DATE_SOURCE})\b`, 'g')
const PAST_QUESTION = /\b(fue|estuvo|salio|anduvo|rindio|resulto|hice|entrene|jugue|corri)\b/
const SPORT_WORDS: Array<[RegExp, SessionType]> = [
  [/\bsquash\b/, 'squash'],
  [/\b(fuerza|pesas|gym|gimnasio)\b/, 'strength'],
  [/\b(running|correr|trote|rodaje)\b/, 'running'],
  [/\b(bici|ciclismo|cycling)\b/, 'cycling'],
  [/\bmovilidad\b/, 'mobility'],
]
const COUNT_WORDS = 'dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince'
const NUMBER_WORDS: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15 }
const PLURAL_NOUN = new RegExp(`\\b(?:(\\d{1,2}|${COUNT_WORDS})\\s+)?(?:sesiones|entrenos|entrenamientos)\\b`)
const PLURAL_CLITIC = /\b(?:mueve|pasa|cambia|borra|elimina|quita|saca)(?:las|los)\b/
const SINGULAR_REFERENCE = /\b(?:la|el|esa|ese|esta|este|una|un)\s+(?:sesion|entreno|entrenamiento)\b|\b(?:la|el) del\b|\b(?:mueve|pasa|cambia|borra|elimina|quita|saca|acorta|alarga|reprograma)(?:la|lo)\b/
const DEMONSTRATIVE = /\b(?:esa|ese|esta|este|esas|esos|estas|estos)\s+(?:\S+\s+)?(?:sesion|sesiones|entreno|entrenos|entrenamiento|entrenamientos)\b|\b(?:mueve|pasa|cambia|borra|elimina|quita|saca|acorta|alarga|reprograma)(?:la|lo|las|los)\b/

export function resolveMessageTargets(input: ResolveMessageTargetsInput): MessageTargetResolution {
  const text = normalizeTargetText(input.message)
  const referenceText = text.replace(DESTINATION, ' ')
  const sessions = contextSessions(input.context)

  const byPrefix = sessions.filter((session) => /^[0-9a-f]{8}/.test(session.id) && referenceText.includes(session.id.slice(0, 8)))
  const dates = resolveReferenceDates(referenceText.replace(MORNING_PHRASE, ' '), input.now)
  // El título se busca sobre el texto ORIGINAL, no sobre `referenceText`: si el
  // título de la sesión tiene forma de destino ("Camino al viernes"), stripear
  // el destino ahí destruiría el propio título de la sesión que se busca.
  const titled = sessions.filter((session) => {
    const title = normalizeTargetText(session.title)
    return title.length >= 6 && text.includes(title)
  })
  const sport = SPORT_WORDS.find(([pattern]) => pattern.test(referenceText))?.[1]
  const block: TimeBlock | undefined = MORNING.test(referenceText) ? 'AM' : AFTERNOON.test(referenceText) ? 'PM' : undefined
  const cardinality = resolveCardinality(referenceText, titled.length > 0)
  const dateTokens = [...text.replace(MORNING_PHRASE, ' ').matchAll(DAY_TOKEN)].map((match) => match[1])
  if (dateTokens.some((token) => parseTargetDate(token, input.now, PAST_QUESTION.test(text)) == null)) {
    return clarify('invalid_date', titled, [], cardinality)
  }

  if (byPrefix.length > 0 || dates.length > 0 || titled.length > 0) {
    let candidates = byPrefix.length > 0 ? byPrefix : sessions
    if (dates.length > 0) candidates = candidates.filter((session) => dates.includes(session.date))
    if (titled.length > 0) candidates = candidates.filter((session) => titled.includes(session))
    if (sport) candidates = candidates.filter((session) => session.type === sport)
    if (block) candidates = candidates.filter((session) => session.timeBlock === block)
    if (candidates.length === 0 && titled.length > 0) {
      // El título y la fecha/franja se contradicen: no se elige ninguno.
      return clarify('ambiguous_referent', titled, dates, cardinality)
    }
    const reason: MessageTargetReason = byPrefix.length > 0 ? 'id_prefix' : titled.length > 0 ? 'named_session' : 'explicit_date'
    return applyCardinality(candidates, cardinality, reason, dates)
  }

  // Un pronombre/clítico ("cámbiala") se resuelve SIEMPRE por sus propios
  // referentes (intención pendiente, propuesta, mensaje del coach) — nunca
  // por una búsqueda ciega de todo el contexto — aunque el mensaje también
  // traiga deporte/franja: esos acotan los referentes, no los reemplazan.
  if (DEMONSTRATIVE.test(referenceText)) {
    let referents = resolveReferents(input, sessions)
    // Deporte/franja también acotan una anáfora: "cámbiala por la tarde" con
    // dos candidatas del mismo día (AM/PM) no debe seguir siendo ambigua.
    if (sport) referents = referents.filter((session) => session.type === sport)
    if (block) referents = referents.filter((session) => session.timeBlock === block)
    if (referents.length === 0) return clarify('missing_referent', [], [], cardinality)
    return applyCardinality(referents, cardinality, 'anaphora', [])
  }

  // Sin pronombre y sin id/fecha/título: deporte o franja solos son criterio
  // de primer nivel igual que los anteriores (I13 regla 1 — ningún criterio
  // está estructuralmente privilegiado), y buscan sobre TODO el contexto.
  if (sport != null || block != null) {
    let candidates = sessions
    if (sport) candidates = candidates.filter((session) => session.type === sport)
    if (block) candidates = candidates.filter((session) => session.timeBlock === block)
    return applyCardinality(candidates, cardinality, 'explicit_date', dates)
  }

  return { kind: 'none' }
}

export function describeTargetClarification(resolution: Extract<MessageTargetResolution, { kind: 'clarify' }>): string {
  const options = resolution.candidates.slice(0, MAX_TARGETS_PER_OPERATION)
    .map((candidate) => `${candidate.title} (${candidate.date} ${candidate.timeBlock})`).join(', ')
  switch (resolution.reason) {
    case 'invalid_date':
      return 'La fecha indicada no es válida. Dime una fecha como 17/09/2026.'
    case 'too_many_requested':
      return `Pediste ${resolution.requestedCount} sesiones. El máximo por operación es ${MAX_TARGETS_PER_OPERATION}; dime un grupo de hasta ${MAX_TARGETS_PER_OPERATION}.`
    case 'count_mismatch':
      return `Pediste ${resolution.requestedCount} sesiones y encontré ${resolution.candidates.length} posibles${options ? `: ${options}` : ''}. Dime exactamente cuáles.`
    case 'ambiguous_referent':
      return `¿A cuál sesión te refieres? ${options}.`
    case 'missing_referent':
      return 'No tengo claro a qué sesión te refieres. Dime el día (y AM o PM si tienes dos) o el nombre de la sesión.'
  }
}

/** Sólo singular con fecha válida abre aclaración tipada (A4.4). Cualquier aclaración plural/no especificada sólo pregunta: A4.4 no tipa operaciones de varias sesiones. */
export function buildTargetClarificationIntent(
  message: string,
  resolution: Extract<MessageTargetResolution, { kind: 'clarify' }>,
  scope: PendingIntentScope,
  now: number,
): PendingIntent | null {
  if (resolution.cardinality.kind !== 'singular' || resolution.reason === 'invalid_date') return null
  const text = normalizeTargetText(message)
  const type = /\b(muev|pasa|reprogram)/.test(text) ? 'move_session'
    : /\b(borr|elimin|quit|saca)/.test(text) ? 'delete_session'
      : 'update_session'
  const destination = new RegExp(DESTINATION.source).exec(text)?.[1]
  const targetDate = type === 'move_session' && destination ? parseTargetDate(destination, now, false) : undefined
  return {
    id: uuid(),
    kind: 'clarification',
    athleteId: scope.athleteId,
    conversationId: scope.conversationId,
    createdAt: now,
    expiresAt: now + PENDING_INTENT_TTL_MS,
    status: 'open',
    route: 'chat_action',
    operation: {
      type,
      known: targetDate ? { targetDate } : {},
      missing: type === 'move_session' && !targetDate ? ['sessionId', 'targetDate'] : ['sessionId'],
      ...(resolution.candidates.length > 0 ? { candidates: resolution.candidates } : {}),
    },
    summary: type === 'move_session' ? 'Mover una sesión' : type === 'delete_session' ? 'Borrar una sesión' : 'Ajustar una sesión',
  }
}

/** I13d: en chat general las candidatas entran como referencia de lectura; no se interrumpe la conversación. */
export function readOnlyTargetsFromClarification(resolution: Extract<MessageTargetResolution, { kind: 'clarify' }>): MessageTargetResolution {
  return resolved(
    resolution.candidates.map((candidate) => ({ sessionId: candidate.id, date: candidate.date, timeBlock: candidate.timeBlock, reason: 'anaphora' as const })),
    resolution.dates,
  )
}

export function withTargetOverflowNotice<T extends { message: string }>(
  response: T,
  overflow: ReadonlyArray<{ title: string; date: string; timeBlock: TimeBlock }> | undefined,
): T {
  if (!overflow || overflow.length === 0) return response
  const list = overflow.map((target) => `${target.title} (${target.date} ${target.timeBlock})`).join(', ')
  return {
    ...response,
    message: `${response.message}\n\nEste pedido tenía más de ${MAX_TARGETS_PER_OPERATION} sesiones: procesé las primeras ${MAX_TARGETS_PER_OPERATION} y quedaron fuera ${overflow.length}: ${list}. Pídemelas en otro mensaje.`,
  }
}

export function normalizeTargetText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;:"()[\]]/g, ' ').replace(/\s+/g, ' ').trim()
}

function resolveCardinality(text: string, namesTitle: boolean): TargetCardinality {
  const plural = PLURAL_NOUN.exec(text)
  if (plural || PLURAL_CLITIC.test(text) || /\b(todas|todos)\b/.test(text)) {
    const token = plural?.[1]
    const count = token ? Number(token) || NUMBER_WORDS[token] : undefined
    return count ? { kind: 'plural', count } : { kind: 'plural' }
  }
  if (SINGULAR_REFERENCE.test(text) || namesTitle) return { kind: 'singular' }
  return { kind: 'unspecified' }
}

function applyCardinality(
  candidates: Session[],
  cardinality: TargetCardinality,
  reason: MessageTargetReason,
  dates: string[],
): MessageTargetResolution {
  if (cardinality.kind === 'plural' && cardinality.count != null && cardinality.count > MAX_TARGETS_PER_OPERATION) {
    return clarify('too_many_requested', candidates, dates, cardinality)
  }
  if (cardinality.kind === 'singular') {
    if (candidates.length === 1) return resolved([toTarget(candidates[0], reason)], dates)
    return clarify(candidates.length === 0 ? 'missing_referent' : 'ambiguous_referent', candidates, dates, cardinality)
  }
  if (cardinality.kind === 'plural' && cardinality.count != null && candidates.length !== cardinality.count) {
    return clarify('count_mismatch', candidates, dates, cardinality)
  }
  const requestedCount = cardinality.kind === 'plural' ? cardinality.count : undefined
  return resolved(candidates.map((session) => toTarget(session, reason)), dates, requestedCount)
}

function clarify(reason: ClarifyReason, candidates: Session[], dates: string[], cardinality: TargetCardinality): MessageTargetResolution {
  return {
    kind: 'clarify',
    reason,
    cardinality,
    candidates: sortSessions(candidates).map(toPlannedRef),
    dates,
    ...(cardinality.kind === 'plural' && cardinality.count != null ? { requestedCount: cardinality.count } : {}),
  }
}

function resolveReferents(input: ResolveMessageTargetsInput, sessions: Session[]): Session[] {
  const intent = input.pendingIntent
  if (
    intent
    && intent.status === 'open'
    && input.now <= intent.expiresAt
    && intent.athleteId === input.scope.athleteId
    && intent.conversationId === input.scope.conversationId
    && intent.operation.type !== 'create_week'
  ) {
    const known = intent.operation.known.sessionId
    const bySessionId = typeof known === 'string' ? findByIdOrPrefix(known, sessions) : undefined
    if (bySessionId) return [bySessionId]
    const candidates = (intent.operation.candidates ?? [])
      .map((candidate) => findByIdOrPrefix(candidate.id, sessions))
      .filter((session): session is Session => session != null)
    if (candidates.length > 0) return candidates
  }

  const proposal = [...(input.context.recentProposals ?? [])].sort((a, b) => b.createdAt - a.createdAt)[0]
  if (proposal && input.now - proposal.createdAt <= REFERENT_TTL_MS) {
    const found = [...new Set(proposal.actions.map((action) => action.sessionId).filter((id): id is string => typeof id === 'string'))]
      .map((id) => findByIdOrPrefix(id, sessions))
      .filter((session): session is Session => session != null)
    if (found.length > 0) return found
  }

  const lastCoach = [...input.recentMessages].reverse().find((message) => message.role === 'coach')
  if (lastCoach?.timestamp != null && input.now - lastCoach.timestamp <= REFERENT_TTL_MS) {
    const coachText = normalizeTargetText(lastCoach.content)
    return sessions.filter((session) => {
      const title = normalizeTargetText(session.title)
      return title.length >= 6 && coachText.includes(title)
    })
  }
  return []
}

function resolveReferenceDates(text: string, now: number): string[] {
  const past = PAST_QUESTION.test(text)
  return [...new Set([...text.matchAll(DAY_TOKEN)].map((match) => parseTargetDate(match[1], now, past)).filter((date): date is string => date != null))]
}

/** DD/MM sin año usa el año local de now; nunca salta de año por heurística. */
function parseTargetDate(token: string, now: number, past: boolean): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token)
  const short = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(token)
  if (!iso && !short) return resolveDay(token, now, past)
  const year = iso ? Number(iso[1]) : short![3] ? Number(short![3]) : new Date(now).getFullYear()
  const month = Number(iso ? iso[2] : short![2])
  const day = Number(iso ? iso[3] : short![1])
  const candidate = new Date(0)
  candidate.setUTCFullYear(year, month - 1, day)
  candidate.setUTCHours(12, 0, 0, 0)
  if (year < 1000 || candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return undefined
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function resolveDay(token: string, now: number, past: boolean): string {
  const base = new Date(now)
  const shift = (days: number) => { base.setDate(base.getDate() + days); return toLocalIso(base) }
  switch (token) {
    case 'hoy': return toLocalIso(base)
    case 'ayer': return shift(-1)
    case 'anteayer':
    case 'antes de ayer': return shift(-2)
    case 'manana': return shift(1)
    case 'pasado manana': return shift(2)
    default: {
      const target = WEEKDAYS[token]
      const today = base.getDay()
      return past ? shift(-(((today - target + 7) % 7) || 7)) : shift((target - today + 7) % 7)
    }
  }
}

function resolved(targets: MessageTarget[], dates: string[] = [], requestedCount?: number): MessageTargetResolution {
  const sorted = [...targets].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
  return {
    kind: 'resolved',
    targets: sorted.slice(0, MAX_TARGETS_PER_OPERATION),
    overflow: sorted.slice(MAX_TARGETS_PER_OPERATION),
    dates,
    ...(requestedCount ? { requestedCount } : {}),
  }
}

function contextSessions(context: ChatContext): Session[] {
  const byId = new Map<string, Session>()
  for (const session of [...(context.recentSessions ?? []), ...(context.plannedSessions ?? []), ...(context.historicalSessions ?? [])]) {
    byId.set(session.id, session)
  }
  return [...byId.values()]
}

function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

function findByIdOrPrefix(id: string, sessions: Session[]): Session | undefined {
  const exact = sessions.find((session) => session.id === id)
  if (exact) return exact
  const matches = sessions.filter((session) => session.id.startsWith(id))
  return matches.length === 1 ? matches[0] : undefined
}

function toTarget(session: Session, reason: MessageTargetReason): MessageTarget {
  return { sessionId: session.id, date: session.date, timeBlock: session.timeBlock, reason }
}

function toPlannedRef(session: Session): PlannedRef {
  return { id: session.id, date: session.date, timeBlock: session.timeBlock, title: session.title }
}

function toLocalIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
