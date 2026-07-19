import { describe, expect, it } from 'vitest'
import {
  isSessionTemplatePayloadV1,
  isSupportedSessionTemplate,
  type StoredSessionTemplate,
} from '../sessionTemplate'

describe('session template runtime validation', () => {
  it('acepta el payload v1 mínimo', () => {
    expect(isSessionTemplatePayloadV1({
      type: 'squash', timeBlock: 'AM', title: 'Drills', durationMin: 60,
    })).toBe(true)
  })

  it('rechaza discriminantes conocidos con payload ilegible', () => {
    const row = {
      id: 't1', name: 'Rota', kind: 'session', payloadVersion: 1,
      payload: {}, createdAt: 1, updatedAt: 1,
    } as StoredSessionTemplate
    expect(isSupportedSessionTemplate(row)).toBe(false)
  })

  it('rechaza contenedores que romperían el form o materializador', () => {
    expect(isSessionTemplatePayloadV1({
      type: 'running', timeBlock: 'AM', title: 'Series', durationMin: 45,
      runningDetails: { runningType: 'intervals', intervalStructure: { blocks: null } },
    })).toBe(false)
    expect(isSessionTemplatePayloadV1({
      type: 'strength', timeBlock: 'PM', title: 'Fuerza', durationMin: 45,
      exercises: [{ name: 'Press', sets: 'tres', reps: 8 }],
    })).toBe(false)
  })
})
