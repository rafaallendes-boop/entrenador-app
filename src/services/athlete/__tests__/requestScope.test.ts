import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ athleteId: null as string | null, epoch: 0, selfId: 'ath_a' as string | null }))
vi.mock('../activeAthlete', () => ({
  getActiveAthleteId: () => h.athleteId,
  getSelfAthleteId: () => h.selfId,
  getSwitchEpoch: () => h.epoch,
}))

import { captureRequestScope, isRequestScopeCurrent } from '../requestScope'

describe('requestScope', () => {
  beforeEach(() => { h.athleteId = 'ath_a'; h.epoch = 3 })

  it('captura atleta, epoch, conversación y un requestId único', () => {
    const a = captureRequestScope('conv-1')
    const b = captureRequestScope('conv-1')
    expect(a).toMatchObject({ athleteId: 'ath_a', epoch: 3, conversationId: 'conv-1' })
    expect(a.requestId).not.toBe(b.requestId)
  })

  it('deja de ser vigente si cambia la identidad aunque el epoch no se mueva', () => {
    const scope = captureRequestScope()
    h.athleteId = 'ath_b'
    expect(isRequestScopeCurrent(scope)).toBe(false)
  })

  it('deja de ser vigente si cambia el epoch', () => {
    const scope = captureRequestScope()
    h.epoch = 4
    expect(isRequestScopeCurrent(scope)).toBe(false)
  })

  it('la hidratación inicial null → self no cuenta como cambio', () => {
    h.athleteId = null
    h.selfId = 'ath_a'
    const scope = captureRequestScope()
    h.athleteId = 'ath_a'
    expect(isRequestScopeCurrent(scope)).toBe(true)
  })

  it('null → un atleta que NO es el self sí cuenta como cambio', () => {
    h.athleteId = null
    h.selfId = 'ath_a'
    const scope = captureRequestScope()
    h.athleteId = 'ath_managed'
    expect(isRequestScopeCurrent(scope)).toBe(false)
  })
})
