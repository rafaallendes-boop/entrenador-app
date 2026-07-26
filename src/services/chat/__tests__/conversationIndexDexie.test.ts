import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import type { ChatMessage } from '../../../types'
import {
  setActiveAthleteId,
  setSelfAthleteId,
} from '../../athlete/activeAthlete'
import {
  listConversations,
  searchConversations,
} from '../conversationIndex'

function msg(over: Partial<ChatMessage> & { id: string; timestamp: number }): ChatMessage {
  return { role: 'user', content: 'texto', chatSessionId: 's1', ...over } as ChatMessage
}

async function resetDatabase(): Promise<void> {
  db.close()
  await db.delete()
  await db.open()
  setSelfAthleteId('ath_self')
  setActiveAthleteId('ath_self')
}

describe('listConversations', () => {
  beforeEach(resetDatabase)

  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('groups the active athlete messages into conversations', async () => {
    await db.chatMessages.bulkAdd([
      msg({
        id: 'a',
        timestamp: 100,
        athleteId: 'ath_self',
        chatSessionId: 's1',
        content: 'Quiero ajustar la semana',
      }),
      msg({
        id: 'b',
        timestamp: 200,
        athleteId: 'ath_self',
        chatSessionId: 's1',
        role: 'coach',
        content: 'Dale',
      }),
      msg({
        id: 'c',
        timestamp: 300,
        athleteId: 'ath_self',
        chatSessionId: 's2',
        content: 'Me duele el hombro',
      }),
    ])

    const result = await listConversations()

    expect(result.map(r => r.sessionId)).toEqual(['s2', 's1'])
    expect(result[1].messageCount).toBe(2)
  })

  it('never leaks another athlete conversations', async () => {
    await db.chatMessages.bulkAdd([
      msg({ id: 'a', timestamp: 100, athleteId: 'ath_self', chatSessionId: 'mine' }),
      msg({ id: 'b', timestamp: 200, athleteId: 'ath_other', chatSessionId: 'theirs' }),
    ])

    setActiveAthleteId('ath_other')

    expect((await listConversations()).map(r => r.sessionId)).toEqual(['theirs'])
  })

  it('does not merge another athlete rows even when the session id collides', async () => {
    await db.chatMessages.bulkAdd([
      msg({
        id: 'mine',
        timestamp: 100,
        athleteId: 'ath_self',
        chatSessionId: 'shared',
        content: 'Mi conversación',
      }),
      msg({
        id: 'theirs',
        timestamp: 200,
        athleteId: 'ath_other',
        chatSessionId: 'shared',
        content: 'Conversación ajena',
      }),
    ])

    const result = await listConversations()

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      title: 'Mi conversación',
      lastMessageAt: 100,
      messageCount: 1,
    })
  })

  it('gives legacy rows without athleteId to the self only', async () => {
    await db.chatMessages.bulkAdd([
      msg({
        id: 'legacy',
        timestamp: 100,
        athleteId: undefined,
        chatSessionId: 'legacy-thread',
      }),
    ])

    setActiveAthleteId('ath_self')
    expect((await listConversations()).map(r => r.sessionId)).toEqual(['legacy-thread'])

    setActiveAthleteId('ath_managed')
    expect(await listConversations()).toEqual([])
  })
})

describe('searchConversations', () => {
  beforeEach(async () => {
    await resetDatabase()
    await db.chatMessages.bulkAdd([
      msg({
        id: 'a',
        timestamp: 100,
        athleteId: 'ath_self',
        chatSessionId: 's1',
        content: 'Me duele el hombro derecho',
      }),
      msg({
        id: 'b',
        timestamp: 200,
        athleteId: 'ath_self',
        chatSessionId: 's1',
        role: 'coach',
        content: 'Cuidemos ese hombro',
      }),
      msg({
        id: 'c',
        timestamp: 300,
        athleteId: 'ath_self',
        chatSessionId: 's2',
        content: 'Quiero correr más',
      }),
    ])
  })

  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('matches content ignoring case and diacritics', async () => {
    const result = await searchConversations('HOMBRÓ')

    expect(result).toHaveLength(1)
    expect(result[0].sessionId).toBe('s1')
  })

  it('counts every matching message but points at the earliest one', async () => {
    const result = await searchConversations('hombro')

    expect(result[0].matchCount).toBe(2)
    expect(result[0].matchedMessageId).toBe('a')
    expect(result[0].snippet).toContain('hombro')
  })

  it('uses the message id as a deterministic tiebreak for matches at the same time', async () => {
    await db.chatMessages.bulkAdd([
      msg({
        id: 'tie-z',
        timestamp: 400,
        athleteId: 'ath_self',
        chatSessionId: 'tie',
        content: 'hombro z',
      }),
      msg({
        id: 'tie-a',
        timestamp: 400,
        athleteId: 'ath_self',
        chatSessionId: 'tie',
        content: 'hombro a',
      }),
    ])

    const result = await searchConversations('hombro')
    const tiedConversation = result.find(item => item.sessionId === 'tie')

    expect(tiedConversation?.matchedMessageId).toBe('tie-a')
    expect(tiedConversation?.snippet).toBe('hombro a')
    expect(tiedConversation?.matchCount).toBe(2)
  })

  it('returns the full list with neutral match fields for an empty query', async () => {
    const result = await searchConversations('   ')

    expect(result.map(r => r.sessionId)).toEqual(['s2', 's1'])
    expect(result.every(r => (
      r.snippet === ''
      && r.matchCount === 0
      && r.matchedMessageId === null
    ))).toBe(true)
  })

  it('uses the same scope as the listing', async () => {
    setActiveAthleteId('ath_managed')

    expect(await searchConversations('hombro')).toEqual([])
  })
})
