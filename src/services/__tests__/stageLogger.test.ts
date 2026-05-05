import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStageTracker, trackStage } from '../ai/stageLogger'

describe('stageLogger', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    infoSpy.mockRestore()
  })

  it('captures sequential stage timings', () => {
    const tracker = createStageTracker('trace-1', 'week_creator')
    tracker.stage('prompt_build').end({ ok: true })
    tracker.stage('provider_call').end({ ok: true })
    tracker.stage('validate').end({ ok: false, error: 'count_mismatch' })
    const timings = tracker.timings()
    expect(timings.map((t) => t.stage)).toEqual(['prompt_build', 'provider_call', 'validate'])
    expect(timings[2]).toMatchObject({ ok: false, error: 'count_mismatch' })
  })

  it('flush emits a single structured log', () => {
    const tracker = createStageTracker('trace-2', 'chat_action')
    tracker.stage('prompt_build').end({ ok: true })
    tracker.flush('ok', { foo: 'bar' })
    tracker.flush('ok') // second flush is a no-op
    expect(infoSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(infoSpy.mock.calls[0][0] as string)
    expect(payload).toMatchObject({
      event: 'coach.request',
      traceId: 'trace-2',
      requestClass: 'chat_action',
      outcome: 'ok',
      foo: 'bar',
    })
    expect(Array.isArray(payload.stages)).toBe(true)
  })

  it('trackStage records errors and rethrows', async () => {
    const tracker = createStageTracker('trace-3', 'plan_builder_week')
    await expect(
      trackStage(tracker, 'provider_call', () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    const timings = tracker.timings()
    expect(timings).toHaveLength(1)
    expect(timings[0]).toMatchObject({ stage: 'provider_call', ok: false, error: 'boom' })
  })
})
