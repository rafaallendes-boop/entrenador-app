import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { AIRequestClass } from '../../../types'
import { getAIRequestPolicy } from '../requestPolicy'

const COACH_PATH = 'netlify/functions/coach.ts'
const CLASSES: AIRequestClass[] = [
  'chat_general',
  'chat_action',
  'weekly_summary',
  'week_creator',
  'plan_builder_week',
  'plan_builder_pair',
  'import_extract',
]

function readMaxWallclockFromCoach(): number {
  const src = readFileSync(COACH_PATH, 'utf8')
  const match = src.match(/MAX_FUNCTION_WALLCLOCK_MS\s*=\s*(\d+)/)
  if (!match) throw new Error('MAX_FUNCTION_WALLCLOCK_MS not found in coach.ts')
  return Number(match[1])
}

describe('requestPolicy timeout consistency', () => {
  const wallclock = readMaxWallclockFromCoach()

  it.each(CLASSES)('client timeoutMs for %s does not exceed proxy wallclock', (requestClass) => {
    expect(getAIRequestPolicy(requestClass).timeoutMs).toBeLessThanOrEqual(wallclock)
  })

  it('wallclock leaves enough room for at least one provider attempt', () => {
    expect(wallclock).toBeGreaterThanOrEqual(8000)
  })

  it('plan_builder_pair has more room than plan_builder_week', () => {
    expect(getAIRequestPolicy('plan_builder_pair').timeoutMs).toBeGreaterThan(getAIRequestPolicy('plan_builder_week').timeoutMs)
  })
})
