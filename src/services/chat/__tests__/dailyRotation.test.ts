import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shouldRotateConversation } from '../dailyRotation'

describe('shouldRotateConversation', () => {
  it('does not rotate an empty conversation', () => {
    expect(shouldRotateConversation(null, new Date(2026, 6, 26, 9, 0).getTime())).toBe(false)
  })

  it('does not rotate when the last message is from today', () => {
    const now = new Date(2026, 6, 26, 23, 59).getTime()
    const last = new Date(2026, 6, 26, 0, 1).getTime()
    expect(shouldRotateConversation(last, now)).toBe(false)
  })

  it('rotates when the last message is from a previous calendar day', () => {
    const now = new Date(2026, 6, 26, 0, 5).getTime()
    const last = new Date(2026, 6, 25, 23, 50).getTime()
    expect(shouldRotateConversation(last, now)).toBe(true)
  })

  it('rotates across midnight even when less than 24h elapsed', () => {
    const now = new Date(2026, 6, 26, 0, 10).getTime()
    const last = new Date(2026, 6, 25, 22, 0).getTime()
    expect(shouldRotateConversation(last, now)).toBe(true)
  })

  it('does not rotate within the same day even when more than 20h elapsed', () => {
    const now = new Date(2026, 6, 26, 23, 0).getTime()
    const last = new Date(2026, 6, 26, 1, 0).getTime()
    expect(shouldRotateConversation(last, now)).toBe(false)
  })
})

// Chile cambia de hora el primer domingo de septiembre: el 2026-09-06 el día
// local dura 23 horas. Una ventana fija de 24h se equivoca acá; isSameDay no.
describe('shouldRotateConversation across a real DST shift', () => {
  const originalTz = process.env.TZ

  beforeAll(() => {
    process.env.TZ = 'America/Santiago'
  })

  afterAll(() => {
    if (originalTz == null) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it('keeps a 23-hour DST day as a single day', () => {
    const morning = new Date(2026, 8, 6, 4, 0).getTime()
    const night = new Date(2026, 8, 6, 23, 0).getTime()
    expect(shouldRotateConversation(morning, night)).toBe(false)
  })

  it('rotates from the day before the shift into the shift day', () => {
    const before = new Date(2026, 8, 5, 22, 0).getTime()
    const after = new Date(2026, 8, 6, 3, 0).getTime()
    expect(shouldRotateConversation(before, after)).toBe(true)
  })
})
