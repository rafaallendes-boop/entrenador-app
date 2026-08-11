import { describe, expect, it } from 'vitest'

import {
  parseWeekCreatorSkeletonResponse,
  validateWeekCreatorSkeleton,
} from '../parseWeekCreatorSkeletonResponse'

function makeSkeleton(): Record<string, unknown> {
  return {
    type: 'create_week',
    reason: 'Coordinar carga y recuperación.',
    targetDate: '2026-07-20',
    weekObjectives: ['Consolidar control de la T'],
    sessions: [{
      date: '2026-07-20',
      timeBlock: 'AM',
      sessionType: 'squash',
      durationMin: 60,
      rpe: 7,
      focusKey: 'squash_control',
      title: 'Control de la T',
      objective: 'Sostener precisión bajo fatiga moderada.',
      squashKind: 'control',
      subtype: 'control',
    }],
  }
}

describe('parseWeekCreatorSkeletonResponse', () => {
  it('preserves focusKey for local hydration before generic normalization', () => {
    const result = parseWeekCreatorSkeletonResponse(JSON.stringify(makeSkeleton()))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skeleton.sessions[0]?.focusKey).toBe('squash_control')
    expect(result.skeleton.sessions[0]?.subtype).toBe('control')
  })

  it('accepts the legacy single-action wrapper during rollout', () => {
    const wrapped = `<actions>${JSON.stringify([makeSkeleton()])}</actions>`
    const result = parseWeekCreatorSkeletonResponse(wrapped)

    expect(result).toMatchObject({
      ok: true,
      skeleton: { type: 'create_week', targetDate: '2026-07-20' },
    })
  })

  it('reports invalid JSON without throwing', () => {
    expect(parseWeekCreatorSkeletonResponse('{')).toEqual({
      ok: false,
      issues: [{ path: '$', code: 'invalid_json' }],
    })
  })

  it('reports an impossible date without throwing', () => {
    const skeleton = makeSkeleton()
    skeleton.targetDate = '9999-99-99'

    expect(validateWeekCreatorSkeleton(skeleton)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([{ path: 'targetDate', code: 'invalid_value' }]),
    })
  })

  it('rejects an empty weekly skeleton', () => {
    const skeleton = makeSkeleton()
    skeleton.sessions = []

    expect(validateWeekCreatorSkeleton(skeleton)).toEqual({
      ok: false,
      issues: [{ path: 'sessions', code: 'invalid_value' }],
    })
  })

  it('returns path-addressable issues for fields the hydrator requires', () => {
    const skeleton = makeSkeleton()
    skeleton.targetDate = '2026-02-31'
    skeleton.sessions = [{
      date: '2026-07-20',
      timeBlock: 'noon',
      sessionType: 'squash',
      durationMin: 4,
      rpe: 11,
      title: 'Sin foco',
      objective: 'Inválida',
    }]

    const result = validateWeekCreatorSkeleton(skeleton)

    expect(result).toEqual({
      ok: false,
      issues: expect.arrayContaining([
        { path: 'targetDate', code: 'invalid_value' },
        { path: 'sessions[0].timeBlock', code: 'invalid_value' },
        { path: 'sessions[0].durationMin', code: 'invalid_value' },
        { path: 'sessions[0].rpe', code: 'invalid_value' },
        { path: 'sessions[0].focusKey', code: 'missing_field' },
      ]),
    })
  })
})
