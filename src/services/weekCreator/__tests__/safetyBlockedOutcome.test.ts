import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('safety-blocked terminal outcome contract', () => {
  it('records safety_blocked in every outcome union owned by this boundary', () => {
    expect(readFileSync('src/services/ai/stageLogger.ts', 'utf8')).toContain("'safety_blocked'")
    expect(readFileSync('src/types/index.ts', 'utf8')).toContain("'safety_blocked'")
    expect(readFileSync('src/services/weekCreator/WeekCreatorFailurePolicy.ts', 'utf8')).toContain("'safety_blocked'")
  })

  it('keeps safe_decline distinct from retry and fallback', () => {
    const source = readFileSync('src/services/weekCreator/WeekCreatorFailurePolicy.ts', 'utf8')
    expect(source).toContain("| 'local_fallback'")
    expect(source).toContain("| 'targeted_model_repair'")
    expect(source).toContain("| 'provider_retry'")
    expect(source).toContain("| 'safe_decline'")
    expect(readFileSync('src/types/index.ts', 'utf8')).toContain("'safe_decline'")
  })
})
