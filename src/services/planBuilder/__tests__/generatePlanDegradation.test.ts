import { describe, expect, it, vi } from 'vitest'
import { generatePlanWeeks } from '../generatePlan'
import type { AIProvider } from '../../ai/types'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'

function makeWizard(): PlanWizardConfig {
  return {
    goalEventId: 'e1',
    trainingDays: ['monday','tuesday','wednesday','thursday','friday','saturday'],
    doubleSessionDays: [],
    sessionsPerWeek: 4,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['running','strength'],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    createdAt: '', updatedAt: '',
  } as PlanWizardConfig
}

function makePlan(): TrainingPlan {
  return {
    id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'shell',
    title: 'Test', startDate: '2026-06-01', endDate: '2026-06-14', totalWeeks: 2,
    phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 1, blockFocus: '', intentBySport: {} }],
    wizardConfig: makeWizard(),
    macroSnapshot: {
      goalEventId: 'e1', goalEventDate: '2026-06-14', currentPhase: 'build', weeksRemaining: 2,
      blockFocus: '', headline: '', timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
      secondaryEvents: [], computedAt: 0,
    },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlan
}

function makeWeek(weekStart: string, idx: number): TrainingPlanWeek {
  return {
    id: `w${idx}`, planId: 'p1', weekIndex: idx, weekStartDate: weekStart,
    phase: 'build', status: 'pending', sessions: [],
    weekObjectives: [{ goal: 'g' }],
    targetLoadBySport: { squash: 50, running: 25, strength: 25, mobility: 25 },
    validationIssues: [], generationMeta: { attempts: 0, provider: '', model: '' },
    createdAt: 0, updatedAt: 0,
  } as TrainingPlanWeek
}

function makeProfile(): AthleteProfile {
  return { id: 'default', updatedAt: 0, name: 'Test' } as AthleteProfile
}

function createWeekActionText(targetDate: string, titlePrefix: string): string {
  const days = [0, 1, 2, 3]
  const sessions = days.map((offset) => {
    const day = targetDate === '2026-06-01'
      ? `2026-06-${String(1 + offset).padStart(2, '0')}`
      : `2026-06-${String(8 + offset).padStart(2, '0')}`
    return {
      date: day,
      timeBlock: 'AM',
      sessionType: 'squash',
      title: `${titlePrefix}-${offset + 1}`,
      durationMin: 60,
    }
  })
  return JSON.stringify({
    type: 'create_week',
    targetDate,
    reason: 'ok',
    sessions,
    weekObjectives: [],
  })
}

describe('generatePlanWeeks pair → single degradation', () => {
  it('preserves the same batchId across generating and resolved states', async () => {
    const weeks = [makeWeek('2026-06-01', 0), makeWeek('2026-06-08', 1)]
    const callSpy = vi.fn(async () => ({
      text: JSON.stringify({
        actions: [
          JSON.parse(createWeekActionText(weeks[0]!.weekStartDate, 'pair-a')),
          JSON.parse(createWeekActionText(weeks[1]!.weekStartDate, 'pair-b')),
        ],
      }),
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      durationMs: 1000,
      traceId: 'pair-trace',
    }))
    const provider = { name: 'gemini', call: callSpy } as unknown as AIProvider

    const updates: Record<number, string[]> = {}

    await generatePlanWeeks({
      plan: makePlan(),
      weeks,
      profile: makeProfile(),
      wizardConfig: makeWizard(),
      provider,
      deterministicPrimary: false,
      strategy: 'pairs',
      onWeekUpdate: (week) => {
        if (!week.generationMeta.batchId) return
        updates[week.weekIndex] = [...(updates[week.weekIndex] ?? []), week.generationMeta.batchId]
      },
    })

    expect(new Set(updates[0]).size).toBe(1)
    expect(new Set(updates[1]).size).toBe(1)
    expect(updates[0]?.[0]).toBe(updates[1]?.[0])
  })

  it('when pair returns only week A, retries week B as single before fallback', async () => {
    let callIndex = 0
    const callSpy = vi.fn(async (request: { requestClass: string }) => {
      void request
      callIndex += 1
      if (callIndex === 1) {
        // First call: pair — devuelve solo la semana A
        return {
          text: `<actions>[${createWeekActionText('2026-06-01', 'pair-a')}]</actions>`,
          provider: 'gemini', model: 'gemini-2.5-flash', durationMs: 1000, traceId: 't1',
        }
      }
      // Second call: single for week B
      return {
        text: `<actions>[${createWeekActionText('2026-06-08', 'single-b')}]</actions>`,
        provider: 'gemini', model: 'gemini-2.5-flash', durationMs: 1000, traceId: 't2',
      }
    })
    const provider = { name: 'gemini', call: callSpy } as unknown as AIProvider


    const results = await generatePlanWeeks({
      plan: makePlan(),
      weeks: [makeWeek('2026-06-01', 0), makeWeek('2026-06-08', 1)],
      profile: makeProfile(),
      wizardConfig: makeWizard(),
      provider,
      deterministicPrimary: false,
      strategy: 'pairs',
    })

    expect(callSpy).toHaveBeenCalledTimes(2)
    const firstCall = callSpy.mock.calls[0]?.[0]
    const secondCall = callSpy.mock.calls[1]?.[0]
    if (!firstCall || !secondCall) throw new Error('Expected pair and single provider calls')
    expect(firstCall.requestClass).toBe('plan_builder_pair')
    expect(secondCall.requestClass).toBe('plan_builder_week')
    expect(results).toHaveLength(2)
    expect(results[0]!.sessions.length).toBeGreaterThan(0)
    expect(results[1]!.sessions.length).toBeGreaterThan(0)
    expect(results[1]!.generationMeta.fallbackUsed).not.toBe(true)
  })

  it('salvages a complete streamed pair action when the final batch JSON is truncated', async () => {
    let callIndex = 0
    const weekA = createWeekActionText('2026-06-01', 'A')
    const weekB = createWeekActionText('2026-06-08', 'B')
    const callSpy = vi.fn(async (request: { onChunk?: (chunk: string) => void }) => {
      callIndex += 1
      if (callIndex === 1) {
        const truncated = `{"actions":[${weekA},{"type":"create_week","targetDate":"2026-06-08","reason":"cut","sessions":[`
        request.onChunk?.(truncated)
        return {
          text: truncated,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          durationMs: 1000,
          traceId: 't1',
          finishReason: 'MAX_TOKENS',
        }
      }
      return {
        text: `<actions>[${weekB}]</actions>`,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        durationMs: 1000,
        traceId: 't2',
      }
    })
    const provider = { name: 'gemini', call: callSpy } as unknown as AIProvider


    const results = await generatePlanWeeks({
      plan: makePlan(),
      weeks: [makeWeek('2026-06-01', 0), makeWeek('2026-06-08', 1)],
      profile: makeProfile(),
      wizardConfig: makeWizard(),
      provider,
      deterministicPrimary: false,
      strategy: 'pairs',
    })

    expect(callSpy).toHaveBeenCalledTimes(2)
    expect(results[0]!.status).toBe('draft')
    expect(results[0]!.generationMeta.requestClass).toBe('plan_builder_pair')
    expect(results[0]!.generationMeta.fallbackUsed).not.toBe(true)
    expect(results[1]!.status).toBe('draft')
    expect(results[1]!.generationMeta.requestClass).toBe('plan_builder_week')
    expect(results[1]!.generationMeta.fallbackUsed).not.toBe(true)
  })

  it('when the pair request fails entirely, retries both weeks as single before fallback', async () => {
    let callIndex = 0
    const callSpy = vi.fn(async (request: { requestClass: string }) => {
      callIndex += 1
      if (callIndex === 1) {
        throw new Error('batch timeout')
      }
      const targetDate = request.requestClass === 'plan_builder_week' && callIndex === 2
        ? '2026-06-01'
        : '2026-06-08'
      return {
        text: `<actions>[${createWeekActionText(targetDate, `single-${callIndex}`)}]</actions>`,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        durationMs: 1000,
        traceId: `single-${callIndex}`,
      }
    })
    const provider = { name: 'gemini', call: callSpy } as unknown as AIProvider


    const results = await generatePlanWeeks({
      plan: makePlan(),
      weeks: [makeWeek('2026-06-01', 0), makeWeek('2026-06-08', 1)],
      profile: makeProfile(),
      wizardConfig: makeWizard(),
      provider,
      deterministicPrimary: false,
      strategy: 'pairs',
    })

    expect(callSpy).toHaveBeenCalledTimes(3)
    expect(callSpy.mock.calls.map((call) => call[0]?.requestClass)).toEqual([
      'plan_builder_pair',
      'plan_builder_week',
      'plan_builder_week',
    ])
    expect(results).toHaveLength(2)
    expect(results.every((week) => week.status === 'draft')).toBe(true)
    expect(results.every((week) => week.generationMeta.fallbackUsed !== true)).toBe(true)
  })

  it('when pair returns nothing and single also returns nothing, falls back to local for both weeks', async () => {
    const callSpy = vi.fn(async () => ({
      text: '<actions>[]</actions>',
      provider: 'gemini', model: 'gemini-2.5-flash', durationMs: 1000, traceId: 't',
    }))
    const provider = { name: 'gemini', call: callSpy } as unknown as AIProvider


    const results = await generatePlanWeeks({
      plan: makePlan(),
      weeks: [makeWeek('2026-06-01', 0), makeWeek('2026-06-08', 1)],
      profile: makeProfile(),
      wizardConfig: makeWizard(),
      provider,
      deterministicPrimary: false,
      strategy: 'pairs',
    })

    expect(results.every((week) => week.generationMeta.fallbackUsed === true)).toBe(true)
  })
})
