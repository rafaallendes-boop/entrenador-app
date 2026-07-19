import { describe, expect, it } from 'vitest'
import { canonicalJson, jsonStructurallyEqual } from '../canonicalJson'

describe('canonicalJson', () => {
  it('is insensitive to key order, as jsonb round-trips are', () => {
    expect(jsonStructurallyEqual(
      { type: 'squash', title: 'Drills', durationMin: 60 },
      { durationMin: 60, title: 'Drills', type: 'squash' },
    )).toBe(true)
  })

  it('treats an absent property and an explicit undefined as equal', () => {
    expect(jsonStructurallyEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
  })

  it('normalizes key order at every depth', () => {
    expect(jsonStructurallyEqual(
      { outer: { inner: { x: 1, y: 2 } } },
      { outer: { inner: { y: 2, x: 1 } } },
    )).toBe(true)
  })

  it('keeps array order significant', () => {
    expect(jsonStructurallyEqual([1, 2], [2, 1])).toBe(false)
    expect(jsonStructurallyEqual(
      [{ name: 'a' }, { name: 'b' }],
      [{ name: 'b' }, { name: 'a' }],
    )).toBe(false)
  })

  it('still separates genuinely different values', () => {
    expect(jsonStructurallyEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(jsonStructurallyEqual({ a: 1 }, { a: '1' })).toBe(false)
    expect(jsonStructurallyEqual({ a: null }, { a: undefined })).toBe(false)
  })

  it('sorts keys deterministically regardless of host locale', () => {
    const sorted = canonicalJson({ b: 1, A: 2, a: 3 }) as Record<string, unknown>
    // Codepoint order: uppercase sorts before lowercase.
    expect(Object.keys(sorted)).toEqual(['A', 'a', 'b'])
  })
})
