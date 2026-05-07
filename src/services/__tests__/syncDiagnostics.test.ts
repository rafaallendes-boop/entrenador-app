import { describe, expect, it } from 'vitest'

import { computeTierHealthMap } from '../syncDiagnostics'

describe('syncDiagnostics', () => {
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
