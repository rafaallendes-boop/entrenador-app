import { describe, expect, it, vi } from 'vitest'
import { createStreamingActionsParser } from '../streamingActionsParser'

describe('createStreamingActionsParser', () => {
  it('emits a parsed action as soon as one complete create_week object closes', () => {
    const onAction = vi.fn()
    const parser = createStreamingActionsParser({ onAction })

    parser.push('{"actions":[{"type":"create_week","targetDate":"2026-06-01","reason":"r","sessions":[],"weekObjectives":[]')
    expect(onAction).not.toHaveBeenCalled()

    parser.push('}]}')
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0]?.[0]).toMatchObject({
      type: 'create_week',
      targetDate: '2026-06-01',
    })
  })

  it('emits second action when batch continues with comma and a second object', () => {
    const onAction = vi.fn()
    const parser = createStreamingActionsParser({ onAction })

    parser.push('{"actions":[{"type":"create_week","targetDate":"2026-06-01","reason":"r","sessions":[],"weekObjectives":[]},{"type":"create_week","targetDate":"2026-06-08","reason":"r","sessions":[],"weekObjectives":[]}]}')

    expect(onAction).toHaveBeenCalledTimes(2)
    expect(onAction.mock.calls[0]?.[0].targetDate).toBe('2026-06-01')
    expect(onAction.mock.calls[1]?.[0].targetDate).toBe('2026-06-08')
  })

  it('handles wrapper <actions> markup too', () => {
    const onAction = vi.fn()
    const parser = createStreamingActionsParser({ onAction })

    parser.push('<actions>[{"type":"create_week","targetDate":"2026-06-01","reason":"r","sessions":[],"weekObjectives":[]}]</actions>')

    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('returns partial actions on flush even if stream was cut mid-second-object', () => {
    const onAction = vi.fn()
    const parser = createStreamingActionsParser({ onAction })

    parser.push('{"actions":[{"type":"create_week","targetDate":"2026-06-01","reason":"r","sessions":[],"weekObjectives":[]},{"type":"create_w')
    const result = parser.flush()

    expect(result.completeActions).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('does not mistake nested session arrays for the actions array', () => {
    const onAction = vi.fn()
    const parser = createStreamingActionsParser({ onAction })

    parser.push('{"meta":[{"type":"create_week","targetDate":"ignore"}],"actions":[{"type":"create_week","targetDate":"2026-06-01","reason":"r","sessions":[{"date":"2026-06-01","timeBlock":"AM","sessionType":"squash","title":"Drive {control}","durationMin":45}],"weekObjectives":[]}]}')

    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0]?.[0].targetDate).toBe('2026-06-01')
  })
})
