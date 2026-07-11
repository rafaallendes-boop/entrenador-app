import { beforeEach, describe, expect, it } from 'vitest'
import { capturePendingClaimTokenFromUrl, clearPendingClaimToken, getPendingClaimToken, isClaimPending } from '../claimGate'

describe('claimGate', () => {
  beforeEach(clearPendingClaimToken)

  it('persists a claim token until explicitly cleared', () => {
    capturePendingClaimTokenFromUrl('https://app.example/claim?claim=tok_1')
    capturePendingClaimTokenFromUrl('https://app.example/')
    expect(getPendingClaimToken()).toBe('tok_1')
    expect(isClaimPending()).toBe(true)
    clearPendingClaimToken()
    expect(isClaimPending()).toBe(false)
  })
})
