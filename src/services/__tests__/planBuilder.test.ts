import { describe, expect, it } from 'vitest'
import type { AthleteProfile, GoalEvent, PlanWizardConfig } from '../../types'
import { buildPlanShell } from '../planBuilder/buildPlanShell'
import { generatePlanWeeks } from '../planBuilder/generatePlan'
import { buildWeekUserPrompt } from '../planBuilder/prompts/weekPrompt'
import { validatePlan } from '../planBuilder/validator'

function makeProfile(eventDate: string): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: Date.now(),
    name: 'Test',
    sportContext: {
      enabledSports: ['squash', 'running', 'strength'],
      primarySport: 'squash',
    },
    goalEvents: [
      {
        id: 'evt-1',
        title: 'Regional',
        date: eventDate,
        sport: 'squash',
        priority: 'primary',
      },
    ],
  }
}

function makeWizardConfig(): PlanWizardConfig {
  return {
    goalEventId: 'evt-1',
    trainingDays: ['monday', 'tuesday', 'thursday', 'saturday'],
    sessionsPerWeek: 5,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['running', 'strength'],
    currentFitnessLevel: 'normal',
    currentFatigue: 'fresh',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function eventNWeeksFromNow(weeks: number): string {
  const d = new Date()
  d.setDate(d.getDate() + weeks * 7)
  return d.toISOString().slice(0, 10)
}

describe('planBuilder', () => {
  it('buildPlanShell creates one week per calendar week until event', () => {
    const profile = makeProfile(eventNWeeksFromNow(8))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })
    expect(plan.totalWeeks).toBeGreaterThanOrEqual(8)
    expect(plan.totalWeeks).toBeLessThanOrEqual(10)
    expect(weeks).toHaveLength(plan.totalWeeks)
    expect(weeks[0].weekIndex).toBe(0)
    expect(weeks[weeks.length - 1].weekIndex).toBe(plan.totalWeeks - 1)
    expect(plan.phases.length).toBeGreaterThan(0)
  })

  it('buildPlanShell caps at 20 weeks for far events', () => {
    const profile = makeProfile(eventNWeeksFromNow(40))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })
    expect(plan.totalWeeks).toBe(20)
    expect(weeks).toHaveLength(20)
  })

  it('validatePlan reports empty weeks as warnings without erroring', () => {
    const profile = makeProfile(eventNWeeksFromNow(6))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })
    // Mark one as draft with zero sessions to trigger warning branch
    weeks[0].status = 'draft'
    const issues = validatePlan({ plan, weeks })
    expect(issues.some((i) => i.code === 'week.sessions.empty')).toBe(true)
    expect(issues.every((i) => i.severity !== 'error' || i.code !== 'plan.structure.weeks_mismatch')).toBe(true)
  })

  it('validatePlan detects day+timeBlock collisions within a week', () => {
    const profile = makeProfile(eventNWeeksFromNow(6))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })
    const date = weeks[0].weekStartDate
    weeks[0].status = 'draft'
    weeks[0].sessions = [
      { date, timeBlock: 'AM', sessionType: 'squash', title: 'A', durationMin: 60 },
      { date, timeBlock: 'AM', sessionType: 'running', title: 'B', durationMin: 45 },
    ]
    const issues = validatePlan({ plan, weeks })
    expect(issues.some((i) => i.code === 'week.sessions.collision')).toBe(true)
  })

  it('validatePlan rejects squash weeks without any squash sessions', () => {
    const profile = makeProfile(eventNWeeksFromNow(6))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })
    weeks[0].status = 'draft'
    weeks[0].sessions = [
      { date: weeks[0].weekStartDate, timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 60 },
      { date: weeks[0].weekStartDate, timeBlock: 'PM', sessionType: 'running', title: 'Rodaje', durationMin: 40 },
    ]

    const issues = validatePlan({ plan, weeks })
    expect(issues.some((i) => i.code === 'week.primary_sport.missing' && i.severity === 'error')).toBe(true)
  })

  it('week prompt explicitly requires the primary sport to appear', () => {
    const profile = makeProfile(eventNWeeksFromNow(6))
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = makeWizardConfig()
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
    })

    const prompt = buildWeekUserPrompt({
      plan,
      week: weeks[0],
      profile,
      wizardConfig,
    })

    expect(prompt).toContain('Deporte principal del objetivo: squash')
    expect(prompt).toContain('incluye al menos')
    expect(prompt).toContain('sesión')
  })

  it('retries a failed week with stricter context and still continues the pipeline', async () => {
    const profile = makeProfile(eventNWeeksFromNow(2))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })

    const prompts: string[] = []
    const provider = {
      name: 'mock' as const,
      call: async (request: { userMessage: string }) => {
        prompts.push(request.userMessage)
        if (prompts.length === 1) {
          return {
            provider: 'mock' as const,
            text: '<actions>[{"type":"create_week","reason":"x","targetDate":"' + weeks[0].weekStartDate + '","sessions":[{"date":"2099-01-01","timeBlock":"AM","sessionType":"running","title":"bad","durationMin":30}]}]</actions>',
          }
        }
        return {
          provider: 'mock' as const,
          text: '<actions>[{"type":"create_week","reason":"ok","targetDate":"' + weeks[0].weekStartDate + '","sessions":[{"date":"' + weeks[0].weekStartDate + '","timeBlock":"AM","sessionType":"running","title":"good","durationMin":30}]}]</actions>',
        }
      },
    }

    const result = await generatePlanWeeks({
      plan: { ...plan, totalWeeks: 2 },
      weeks: weeks.slice(0, 1),
      profile,
      wizardConfig: makeWizardConfig(),
      provider,
    })

    expect(result[0]?.status).toBe('draft')
    expect(result[0]?.generationMeta.attempts).toBe(2)
    expect(prompts[1]).toContain('Corrección del intento anterior')
  })

  it('falls back from pair generation to single-week generation when only one week resolves from the batch', async () => {
    const profile = makeProfile(eventNWeeksFromNow(8))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })

    let callCount = 0
    const provider = {
      name: 'mock' as const,
      call: async () => {
        callCount += 1
        if (callCount === 1) {
          return {
            provider: 'mock' as const,
            text: `<actions>[{"type":"create_week","reason":"batch","targetDate":"${weeks[0].weekStartDate}","sessions":[{"date":"${weeks[0].weekStartDate}","timeBlock":"AM","sessionType":"running","title":"w1","durationMin":30}]}]</actions>`,
          }
        }
        return {
          provider: 'mock' as const,
          text: `<actions>[{"type":"create_week","reason":"single","targetDate":"${weeks[1].weekStartDate}","sessions":[{"date":"${weeks[1].weekStartDate}","timeBlock":"AM","sessionType":"strength","title":"w2","durationMin":45}]}]</actions>`,
        }
      },
    }

    const result = await generatePlanWeeks({
      plan,
      weeks: weeks.slice(0, 2),
      profile,
      wizardConfig: makeWizardConfig(),
      provider,
      strategy: 'pairs',
    })

    expect(callCount).toBe(2)
    expect(result[0]?.status).toBe('draft')
    expect(result[1]?.status).toBe('draft')
    expect(result[0]?.generationMeta.strategy).toBe('pairs')
    expect(result[1]?.generationMeta.strategy).toBe('single')
  })

  it('streams chunks through the plan generator callback', async () => {
    const profile = makeProfile(eventNWeeksFromNow(2))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })

    const chunks: string[] = []
    const provider = {
      name: 'mock' as const,
      call: async (request: { onChunk?: (chunk: string) => void }) => {
        request.onChunk?.('uno')
        request.onChunk?.('dos')
        return {
          provider: 'mock' as const,
          durationMs: 12,
          text: `<actions>[{"type":"create_week","reason":"ok","targetDate":"${weeks[0].weekStartDate}","sessions":[{"date":"${weeks[0].weekStartDate}","timeBlock":"AM","sessionType":"running","title":"stream","durationMin":40}]}]</actions>`,
        }
      },
    }

    const result = await generatePlanWeeks({
      plan,
      weeks: weeks.slice(0, 1),
      profile,
      wizardConfig: makeWizardConfig(),
      provider,
      onChunk: (_weekIndex, chunk) => chunks.push(chunk),
    })

    expect(chunks).toEqual(['uno', 'dos'])
    expect(result[0]?.generationMeta.chunkCount).toBe(2)
  })

  it('routes pair-batch streaming chunks to the matching week index', async () => {
    const profile = makeProfile(eventNWeeksFromNow(8))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })

    const streamedByWeekIndex: Record<number, string> = {}
    const provider = {
      name: 'mock' as const,
      call: async (request: { onChunk?: (chunk: string) => void }) => {
        request.onChunk?.('<actions>[{"type":"create_week","reason":"batch-1",')
        request.onChunk?.(`"targetDate":"${weeks[0].weekStartDate}","sessions":[{"date":"${weeks[0].weekStartDate}","timeBlock":"AM","sessionType":"running","title":"w1","durationMin":30}]},`)
        request.onChunk?.('{"type":"create_week","reason":"batch-2",')
        request.onChunk?.(`"targetDate":"${weeks[1].weekStartDate}","sessions":[{"date":"${weeks[1].weekStartDate}","timeBlock":"AM","sessionType":"strength","title":"w2","durationMin":45}]}]</actions>`)
        return {
          provider: 'mock' as const,
          durationMs: 15,
          text: `<actions>[{"type":"create_week","reason":"batch-1","targetDate":"${weeks[0].weekStartDate}","sessions":[{"date":"${weeks[0].weekStartDate}","timeBlock":"AM","sessionType":"running","title":"w1","durationMin":30}]},{"type":"create_week","reason":"batch-2","targetDate":"${weeks[1].weekStartDate}","sessions":[{"date":"${weeks[1].weekStartDate}","timeBlock":"AM","sessionType":"strength","title":"w2","durationMin":45}]}]</actions>`,
        }
      },
    }

    const result = await generatePlanWeeks({
      plan,
      weeks: weeks.slice(0, 2),
      profile,
      wizardConfig: makeWizardConfig(),
      provider,
      strategy: 'pairs',
      onChunk: (weekIndex, chunk) => {
        streamedByWeekIndex[weekIndex] = (streamedByWeekIndex[weekIndex] ?? '') + chunk
      },
    })

    expect(streamedByWeekIndex[weeks[0].weekIndex]).toContain(`"targetDate":"${weeks[0].weekStartDate}"`)
    expect(streamedByWeekIndex[weeks[0].weekIndex]).not.toContain(`"targetDate":"${weeks[1].weekStartDate}"`)
    expect(streamedByWeekIndex[weeks[1].weekIndex]).toContain(`"targetDate":"${weeks[1].weekStartDate}"`)
    expect(result[0]?.status).toBe('draft')
    expect(result[1]?.status).toBe('draft')
  })
})
