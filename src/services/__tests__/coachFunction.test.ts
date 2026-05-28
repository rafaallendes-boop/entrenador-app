import { describe, expect, it, vi } from 'vitest'

vi.mock('@netlify/functions', () => ({
  stream: <T>(handler: T) => handler,
}))

import { getAIRequestPolicy } from '../ai/requestPolicy'
import { shouldUseDeterministicBypass, trimConversationHistory, tryDeterministicBypass, type ConversationMessage } from '../../../netlify/functions/coach'

describe('trimConversationHistory', () => {
  it('returns empty array when conversation is undefined or empty', () => {
    expect(trimConversationHistory(undefined)).toEqual([])
    expect(trimConversationHistory([])).toEqual([])
  })

  it('keeps last N messages (even number)', () => {
    const conversation: ConversationMessage[] = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }))

    const trimmed = trimConversationHistory(conversation, 8)
    // maxMessages = 8, which is even, so it should keep 8 messages.
    expect(trimmed.length).toBe(8)
    expect(trimmed[0].content).toBe('Message 7')
    expect(trimmed[7].content).toBe('Message 14')
  })

  it('truncates messages exceeding character limit', () => {
    const conversation: ConversationMessage[] = [
      { role: 'user', content: 'Short message' },
      { role: 'assistant', content: 'Very '.repeat(2000) + 'long message' }, // ~10000 chars
      { role: 'user', content: 'Next message' },
      { role: 'assistant', content: 'Final message' },
    ]

    const trimmed = trimConversationHistory(conversation, 8, 2000)
    // Characters limit is 2000.
    // The very long message won't fit, so it should be truncated, keeping only the messages after it.
    expect(trimmed.length).toBe(2)
    expect(trimmed[0].content).toBe('Next message')
    expect(trimmed[1].content).toBe('Final message')
  })
})

describe('tryDeterministicBypass', () => {
  it('returns null for non-bypassable messages', () => {
    expect(tryDeterministicBypass('Hola coach, ¿cómo estás?')).toBeNull()
    expect(commentMatches('Necesito un plan de entrenamiento para correr 10k')).toBeNull()
  })

  it('returns insert_recovery action for rest commands', () => {
    const match1 = tryDeterministicBypass('pon descanso el lunes')
    expect(match1).not.toBeNull()
    expect(match1?.[0]).toMatchObject({
      type: 'insert_recovery',
      reason: 'Solicitado por el usuario mediante atajo directo de descanso.',
    })
    expect(match1?.[0].targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const match2 = tryDeterministicBypass('descanso manana')
    expect(match2).not.toBeNull()
    expect(match2?.[0].type).toBe('insert_recovery')
  })

  it('returns delete_session action for delete commands', () => {
    const match1 = tryDeterministicBypass('borra el entreno del jueves')
    expect(match1).not.toBeNull()
    expect(match1?.[0]).toMatchObject({
      type: 'delete_session',
      reason: 'Eliminación directa solicitada por el usuario.',
      sessionId: 'placeholder-id',
    })
    expect(match1?.[0].targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('plan builder request policy', () => {
  it('keeps client-side caps aligned with the coach proxy caps', () => {
    expect(getAIRequestPolicy('plan_builder_week')).toMatchObject({
      maxTokens: 3500,
      timeoutMs: 30000,
    })
    expect(getAIRequestPolicy('plan_builder_pair')).toMatchObject({
      maxTokens: 5500,
      timeoutMs: 45000,
    })
  })
})

describe('shouldUseDeterministicBypass', () => {
  it('only allows local regex shortcuts for chat_action requests', () => {
    expect(shouldUseDeterministicBypass('chat_action')).toBe(true)
    expect(shouldUseDeterministicBypass('chat_general')).toBe(false)
    expect(shouldUseDeterministicBypass('plan_builder_week')).toBe(false)
    expect(shouldUseDeterministicBypass('plan_builder_pair')).toBe(false)
  })
})

function commentMatches(msg: string) {
  return tryDeterministicBypass(msg)
}
