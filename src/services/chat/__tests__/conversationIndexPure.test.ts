import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../types'
import {
  buildConversationSummaries,
  deriveConversationTitle,
  isIsolatedGreeting,
  normalizeForMatch,
} from '../conversationIndex'

const AT = new Date(2026, 6, 22, 10, 0).getTime()

function title(content: string, significant: string | null = content): string {
  return deriveConversationTitle({
    earliestUserContent: content,
    earliestSignificantUserContent: significant,
    firstMessageAt: AT,
  })
}

function msg(over: Partial<ChatMessage> & { id: string; timestamp: number }): ChatMessage {
  return { role: 'user', content: 'texto', chatSessionId: 's1', ...over } as ChatMessage
}

describe('normalizeForMatch', () => {
  it('strips diacritics and lowercases', () => {
    expect(normalizeForMatch('Molestía en la RODÍLLA')).toBe('molestia en la rodilla')
  })

  it('preserves length so index math on the original stays valid', () => {
    const original = 'Café con leche'
    expect(normalizeForMatch(original)).toHaveLength(original.length)
  })
})

describe('isIsolatedGreeting', () => {
  it('detects a bare greeting with punctuation', () => {
    expect(isIsolatedGreeting('¡Hola!')).toBe(true)
    expect(isIsolatedGreeting('buenos días')).toBe(true)
  })

  it('does not treat a greeting plus content as isolated', () => {
    expect(isIsolatedGreeting('Hola, quiero ajustar la semana')).toBe(false)
  })
})

describe('deriveConversationTitle', () => {
  it('uses the significant message when there is one', () => {
    expect(title('Quiero ajustar la semana')).toBe('Quiero ajustar la semana')
  })

  it('strips a leading greeting and restores capitalisation', () => {
    expect(title('Hola, quiero ajustar la semana')).toBe('Quiero ajustar la semana')
  })

  it('strips the LONGEST matching greeting, not the first one', () => {
    expect(title('Buenas tardes, necesito mover el jueves'))
      .toBe('Necesito mover el jueves')
  })

  it('strips "holaa" rather than leaving a dangling letter', () => {
    expect(title('Holaa, cambiemos la carga')).toBe('Cambiemos la carga')
  })

  it('does not strip a greeting that is only a prefix of a real word', () => {
    expect(title('Holanda me queda lejos')).toBe('Holanda me queda lejos')
  })

  it('falls back to the raw message when every user message is a greeting', () => {
    expect(title('Hola', null)).toBe('Hola')
  })

  it('falls back to the date when there is no user message', () => {
    expect(deriveConversationTitle({
      earliestUserContent: null,
      earliestSignificantUserContent: null,
      firstMessageAt: AT,
    })).toBe('Conversación del 22 jul')
  })

  it('collapses inner whitespace and truncates at a word boundary', () => {
    const long = 'Necesito   que revisemos con calma toda la planificación de la próxima semana porque tengo torneo'
    expect(title(long))
      .toBe('Necesito que revisemos con calma toda la planificación de la próxima semana…')
  })

  it('hard-cuts a single word longer than the cap', () => {
    const url = `https://example.com/${'a'.repeat(120)}`
    expect(title(url)).toHaveLength(80)
    expect(title(url).endsWith('…')).toBe(true)
  })
})

describe('buildConversationSummaries', () => {
  it('ignores messages without chatSessionId instead of inventing a session', () => {
    const result = buildConversationSummaries([
      msg({ id: 'a', timestamp: 1, chatSessionId: undefined }),
      msg({ id: 'b', timestamp: 2, chatSessionId: 's1' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].sessionId).toBe('s1')
    expect(result[0].messageCount).toBe(1)
  })

  it('is correct with unordered input', () => {
    const result = buildConversationSummaries([
      msg({ id: 'b', timestamp: 300, content: 'segundo' }),
      msg({ id: 'a', timestamp: 100, content: 'Quiero ajustar la semana' }),
    ])
    expect(result[0].firstMessageAt).toBe(100)
    expect(result[0].lastMessageAt).toBe(300)
    expect(result[0].title).toBe('Quiero ajustar la semana')
  })

  it('uses the message id as a deterministic tiebreak for equal timestamps', () => {
    const messages = [
      msg({ id: 'b', timestamp: 100, content: 'Título B' }),
      msg({ id: 'a', timestamp: 100, content: 'Título A' }),
    ]

    expect(buildConversationSummaries(messages)[0].title).toBe('Título A')
    expect(buildConversationSummaries([...messages].reverse())[0].title).toBe('Título A')
  })

  it('titles from the earliest significant user message', () => {
    const result = buildConversationSummaries([
      msg({ id: 'a', timestamp: 100, content: 'Hola' }),
      msg({ id: 'b', timestamp: 200, content: 'Me duele el hombro' }),
    ])
    expect(result[0].title).toBe('Me duele el hombro')
  })

  it('ignores coach messages for the title but counts them', () => {
    const result = buildConversationSummaries([
      msg({ id: 'a', timestamp: 100, role: 'coach', content: 'Hola, soy tu coach' }),
      msg({ id: 'b', timestamp: 200, role: 'user', content: 'Necesito descansar' }),
    ])
    expect(result[0].title).toBe('Necesito descansar')
    expect(result[0].messageCount).toBe(2)
  })

  it('sorts by lastMessageAt desc with a stable sessionId tiebreak', () => {
    const result = buildConversationSummaries([
      msg({ id: 'a', timestamp: 500, chatSessionId: 'sB' }),
      msg({ id: 'b', timestamp: 500, chatSessionId: 'sA' }),
      msg({ id: 'c', timestamp: 900, chatSessionId: 'sC' }),
    ])
    expect(result.map(r => r.sessionId)).toEqual(['sC', 'sA', 'sB'])
  })

  it('skips whitespace-only user messages when picking the title', () => {
    const result = buildConversationSummaries([
      msg({ id: 'a', timestamp: 100, content: '   ' }),
      msg({ id: 'b', timestamp: 200, content: 'Cambiemos el jueves' }),
    ])
    expect(result[0].title).toBe('Cambiemos el jueves')
  })
})
