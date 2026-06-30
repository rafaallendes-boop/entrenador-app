import { describe, expect, it } from 'vitest'

import { computeTierHealthMap } from '../syncDiagnostics'

describe('syncDiagnostics', () => {
  it('treats athletes as tier A diagnostics', () => {
    expect(computeTierHealthMap({
      pendingTables: ['athletes'],
      lastErrorEntity: null,
    })).toMatchObject({
      A: 'degraded',
      B: 'healthy',
      C: 'healthy',
    })
  })

  it('marks the last blocked tier even when the non-retriable op left the queue', () => {
    expect(computeTierHealthMap({
      pendingTables: [],
      lastErrorEntity: 'training_plans',
    })).toMatchObject({
      A: 'blocked',
      B: 'healthy',
      C: 'healthy',
    })
  })
})
