import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { db } from '../../db/db'
import type { ChatMessage } from '../../types'
import { isRowInActiveScope } from '../athlete/activeScopeFilter'

const TITLE_MAX = 80

/**
 * Lista acotada y explícita: se prefiere un título crudo a un recorte
 * equivocado. El orden descendente garantiza que "buenas tardes" gane sobre
 * "buenas" y "holaa" sobre "hola".
 */
const GREETINGS = [
  'buenas tardes',
  'buenas noches',
  'buenos dias',
  'buen dia',
  'holaaa',
  'holaa',
  'que tal',
  'buenas',
  'hola',
  'hey',
].sort((a, b) => b.length - a.length)

/** Un saludo inicial solo se recorta si termina en puntuación, espacio o fin. */
const BOUNDARY = /^[\s,.;:!?¡¿-]/u

export interface ConversationSummary {
  sessionId: string
  title: string
  lastMessageAt: number
  firstMessageAt: number
  messageCount: number
}

export interface ConversationAccumulator {
  sessionId: string
  firstMessageAt: number
  lastMessageAt: number
  messageCount: number
  earliestUser: { id: string; content: string; timestamp: number } | null
  earliestSignificantUser: { id: string; content: string; timestamp: number } | null
}

export type ConversationSearchResult = ConversationSummary & {
  snippet: string
  matchCount: number
  matchedMessageId: string | null
}

export function normalizeForMatch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function stripEdgePunctuation(value: string): string {
  return value.replace(/^[\s,.;:!?¡¿-]+|[\s,.;:!?¡¿-]+$/gu, '')
}

/** Indica si el mensaje completo es uno de los saludos reconocidos. */
export function isIsolatedGreeting(content: string): boolean {
  const normalized = stripEdgePunctuation(collapseWhitespace(normalizeForMatch(content)))
  return GREETINGS.includes(normalized)
}

/** Quita un saludo inicial únicamente cuando queda contenido significativo. */
export function stripGreetingPrefix(content: string): string | null {
  const collapsed = collapseWhitespace(content)
  const normalized = normalizeForMatch(collapsed)

  // Solo mapeamos índices normalizados a la cadena original si sus longitudes
  // coinciden. Ante un caso Unicode excepcional, conservar el título es seguro.
  if (normalized.length !== collapsed.length) return null

  for (const greeting of GREETINGS) {
    if (!normalized.startsWith(greeting)) continue

    const tail = collapsed.slice(greeting.length)
    if (tail.length > 0 && !BOUNDARY.test(tail)) continue

    const rest = stripEdgePunctuation(tail)
    if (rest.length === 0) return null
    return rest.charAt(0).toUpperCase() + rest.slice(1)
  }

  return null
}

function truncateTitle(value: string): string {
  const collapsed = collapseWhitespace(value)
  if (collapsed.length <= TITLE_MAX) return collapsed

  // La elipsis forma parte del límite: el título completo nunca supera 80.
  const window = collapsed.slice(0, TITLE_MAX - 1)
  const lastSpace = window.lastIndexOf(' ')
  if (lastSpace <= 0) return `${window}…`
  return `${stripEdgePunctuation(window.slice(0, lastSpace))}…`
}

export function deriveConversationTitle(input: {
  earliestUserContent: string | null
  earliestSignificantUserContent: string | null
  firstMessageAt: number
}): string {
  const significant = input.earliestSignificantUserContent
  if (significant) return truncateTitle(stripGreetingPrefix(significant) ?? significant)
  if (input.earliestUserContent) return truncateTitle(input.earliestUserContent)

  return `Conversación del ${format(new Date(input.firstMessageAt), 'd MMM', { locale: es })}`
}

function comesBefore(
  message: Pick<ChatMessage, 'id' | 'timestamp'>,
  current: { id: string; timestamp: number } | null,
): boolean {
  return (
    current == null
    || message.timestamp < current.timestamp
    || (message.timestamp === current.timestamp && message.id < current.id)
  )
}

/**
 * Acumulador compartido por el camino streaming de Dexie y el camino en
 * memoria. No asume ningún orden de entrada; ante timestamps iguales usa el id
 * como desempate determinista.
 */
export function accumulateConversation(
  map: Map<string, ConversationAccumulator>,
  message: ChatMessage,
): void {
  const sessionId = message.chatSessionId
  if (!sessionId) return

  let entry = map.get(sessionId)
  if (!entry) {
    entry = {
      sessionId,
      firstMessageAt: message.timestamp,
      lastMessageAt: message.timestamp,
      messageCount: 0,
      earliestUser: null,
      earliestSignificantUser: null,
    }
    map.set(sessionId, entry)
  }

  entry.messageCount += 1
  if (message.timestamp < entry.firstMessageAt) entry.firstMessageAt = message.timestamp
  if (message.timestamp > entry.lastMessageAt) entry.lastMessageAt = message.timestamp

  if (message.role !== 'user') return
  const content = message.content?.trim() ?? ''
  if (content.length === 0) return

  if (comesBefore(message, entry.earliestUser)) {
    entry.earliestUser = { id: message.id, content, timestamp: message.timestamp }
  }

  if (isIsolatedGreeting(content)) return
  if (comesBefore(message, entry.earliestSignificantUser)) {
    entry.earliestSignificantUser = {
      id: message.id,
      content,
      timestamp: message.timestamp,
    }
  }
}

export function finalizeConversations(
  map: Map<string, ConversationAccumulator>,
): ConversationSummary[] {
  return [...map.values()]
    .map((entry) => ({
      sessionId: entry.sessionId,
      title: deriveConversationTitle({
        earliestUserContent: entry.earliestUser?.content ?? null,
        earliestSignificantUserContent: entry.earliestSignificantUser?.content ?? null,
        firstMessageAt: entry.firstMessageAt,
      }),
      lastMessageAt: entry.lastMessageAt,
      firstMessageAt: entry.firstMessageAt,
      messageCount: entry.messageCount,
    }))
    .sort((a, b) => (
      b.lastMessageAt - a.lastMessageAt
      || a.sessionId.localeCompare(b.sessionId)
    ))
}

/** Derivación pura en memoria que usa exactamente el acumulador de producción. */
export function buildConversationSummaries(messages: ChatMessage[]): ConversationSummary[] {
  const map = new Map<string, ConversationAccumulator>()
  for (const message of messages) accumulateConversation(map, message)
  return finalizeConversations(map)
}

/**
 * Única lectura Dexie del índice. Como no hay un índice compuesto por atleta y
 * timestamp, mantener el orden temporal requiere recorrer todos los mensajes de
 * la cuenta y aplicar el scope sobre cada fila antes de derivar conversaciones.
 *
 * `chatSessionId` no es una frontera de seguridad: nunca se agrupa mediante
 * claves únicas del índice de sesión.
 */
async function visitScopedChatMessages(
  visit: (message: ChatMessage) => void,
): Promise<void> {
  await db.chatMessages.orderBy('timestamp').each((message) => {
    if (!isRowInActiveScope(message.athleteId)) return
    visit(message)
  })
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const map = new Map<string, ConversationAccumulator>()
  await visitScopedChatMessages((message) => accumulateConversation(map, message))
  return finalizeConversations(map)
}

const SNIPPET_RADIUS = 40

function buildSnippet(content: string, matchIndex: number, needleLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS)
  const end = Math.min(content.length, matchIndex + needleLength + SNIPPET_RADIUS)
  const core = content.slice(start, end).replace(/\s+/gu, ' ').trim()
  return `${start > 0 ? '…' : ''}${core}${end < content.length ? '…' : ''}`
}

interface MatchEntry {
  matchCount: number
  earliestTimestamp: number
  matchedMessageId: string
  snippet: string
}

export async function searchConversations(
  query: string,
): Promise<ConversationSearchResult[]> {
  const needle = normalizeForMatch(query.trim())
  if (needle.length === 0) {
    const summaries = await listConversations()
    return summaries.map((summary) => ({
      ...summary,
      snippet: '',
      matchCount: 0,
      matchedMessageId: null,
    }))
  }

  const conversations = new Map<string, ConversationAccumulator>()
  const matches = new Map<string, MatchEntry>()

  await visitScopedChatMessages((message) => {
    accumulateConversation(conversations, message)

    const sessionId = message.chatSessionId
    if (!sessionId) return

    const content = message.content ?? ''
    const normalized = normalizeForMatch(content)
    const matchIndex = normalized.indexOf(needle)
    if (matchIndex < 0) return

    const existing = matches.get(sessionId)
    const nextCount = (existing?.matchCount ?? 0) + 1
    const safeIndex = normalized.length === content.length ? matchIndex : 0

    const precedesExisting = (
      existing == null
      || message.timestamp < existing.earliestTimestamp
      || (
        message.timestamp === existing.earliestTimestamp
        && message.id < existing.matchedMessageId
      )
    )

    if (precedesExisting) {
      matches.set(sessionId, {
        matchCount: nextCount,
        earliestTimestamp: message.timestamp,
        matchedMessageId: message.id,
        snippet: buildSnippet(content, safeIndex, needle.length),
      })
      return
    }

    existing.matchCount = nextCount
  })

  return finalizeConversations(conversations)
    .filter((summary) => matches.has(summary.sessionId))
    .map((summary) => {
      const match = matches.get(summary.sessionId)!
      return {
        ...summary,
        snippet: match.snippet,
        matchCount: match.matchCount,
        matchedMessageId: match.matchedMessageId,
      }
    })
}
