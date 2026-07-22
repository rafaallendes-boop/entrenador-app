import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  AI_REQUEST_POLICIES,
  WEEK_CREATOR_DETAILED_MAX_TOKENS,
  resolveWeekCreatorMaxTokens,
} from '../requestPolicy'

const COACH_PATH = 'netlify/functions/coach.ts'

/** Reads the proxy ceiling the coach function enforces for week_creator. */
function readProxyWeekCreatorCeiling(): number {
  const src = readFileSync(COACH_PATH, 'utf8')
  const block = src.match(/REQUEST_MAX_TOKENS[^{]*\{([\s\S]*?)\}/)
  if (!block) throw new Error('REQUEST_MAX_TOKENS not found in coach.ts')
  const match = block[1].match(/week_creator:\s*(\d+)/)
  if (!match) throw new Error('week_creator ceiling not found in REQUEST_MAX_TOKENS')
  return Number(match[1])
}

describe('week creator max tokens by contract', () => {
  it('keeps the validated skeleton cap for the skeleton contract', () => {
    expect(resolveWeekCreatorMaxTokens(true)).toBe(AI_REQUEST_POLICIES.week_creator.maxTokens)
    expect(resolveWeekCreatorMaxTokens(true)).toBe(2500)
  })

  it('gives the detailed (medical) contract headroom above the skeleton cap so it does not truncate', () => {
    const detailed = resolveWeekCreatorMaxTokens(false)
    expect(detailed).toBe(WEEK_CREATOR_DETAILED_MAX_TOKENS)
    expect(detailed).toBeGreaterThan(resolveWeekCreatorMaxTokens(true))
    // The observed truncation hit exactly 2500 tokens; the detailed cap must clear it.
    expect(detailed).toBeGreaterThan(2500)
  })

  it('never asks for more than the proxy will accept for week_creator', () => {
    const ceiling = readProxyWeekCreatorCeiling()
    expect(resolveWeekCreatorMaxTokens(false)).toBeLessThanOrEqual(ceiling)
    expect(resolveWeekCreatorMaxTokens(true)).toBeLessThanOrEqual(ceiling)
  })
})
