import { describe, expect, it } from 'vitest'
import { addDays } from 'date-fns'
import type { AthleteProfile, GoalEvent, PlanWizardConfig } from '../../types'
import { buildPlanShell } from '../planBuilder/buildPlanShell'
import { generatePlanWeeks } from '../planBuilder/generatePlan'
import { buildWeekUserPrompt } from '../planBuilder/prompts/weekPrompt'
import { validatePlan } from '../planBuilder/validator'
import { fromISO, getWeekStart, toISO } from '../../utils/date'

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
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'saturday'],
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

function addDaysIso(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
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

  it('buildPlanShell caps at 12 weeks for far events and anchors the plan to the event block', () => {
    const profile = makeProfile(eventNWeeksFromNow(40))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })
    const expectedStartDate = toISO(addDays(getWeekStart(fromISO(event.date)), -(11 * 7)))
    const expectedEndDate = toISO(addDays(getWeekStart(fromISO(event.date)), 6))

    expect(plan.totalWeeks).toBe(12)
    expect(weeks).toHaveLength(12)
    expect(plan.startDate).toBe(expectedStartDate)
    expect(plan.endDate).toBe(expectedEndDate)
  })

  it('buildPlanShell keeps the goal-event primary sport in target loads even if the profile context omits it', () => {
    const profile = makeProfile(eventNWeeksFromNow(6))
    profile.sportContext = {
      enabledSports: ['running', 'strength'],
      primarySport: 'running',
    }
    profile.primarySport = 'running'

    const event = profile.goalEvents![0] as GoalEvent
    const { weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: {
        ...makeWizardConfig(),
        complementarySports: ['strength'],
      },
      goalEvent: event,
    })

    expect(weeks[0]?.targetLoadBySport.squash).toBeTypeOf('number')
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

  it('validatePlan rejects double sessions when the wizard disables them', () => {
    const profile = makeProfile(eventNWeeksFromNow(6))
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = {
      ...makeWizardConfig(),
      sessionsPerWeek: 2,
      trainingDays: ['monday', 'tuesday'] as PlanWizardConfig['trainingDays'],
      allowDoubleSession: false,
    }
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
    })

    weeks[0].status = 'draft'
    weeks[0].sessions = [
      { date: weeks[0].weekStartDate, timeBlock: 'AM', sessionType: 'squash', title: 'AM squash', durationMin: 60, squashDetails: { trainingFocus: 'technical', sessionMode: 'drill_session', drills: [] } },
      { date: weeks[0].weekStartDate, timeBlock: 'PM', sessionType: 'running', title: 'PM running', durationMin: 45 },
    ]

    const issues = validatePlan({ plan, weeks })
    expect(issues.some((i) => i.code === 'week.sessions.double_session_not_allowed' && i.severity === 'error')).toBe(true)
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
    expect(prompt).toContain('Como doble sesión NO está permitido')
  })

  it('retries a failed week with stricter context and still continues the pipeline', async () => {
    const profile = makeProfile(eventNWeeksFromNow(2))
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = {
      ...makeWizardConfig(),
      trainingDays: ['monday', 'tuesday'] as PlanWizardConfig['trainingDays'],
      sessionsPerWeek: 2,
    }
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
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
          text: '<actions>[{"type":"create_week","reason":"ok","targetDate":"' + weeks[0].weekStartDate + '","sessions":[{"date":"' + weeks[0].weekStartDate + '","timeBlock":"AM","sessionType":"squash","title":"good-1","durationMin":30,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive cruzado","durationMin":10}]}},{"date":"' + addDaysIso(weeks[0].weekStartDate, 1) + '","timeBlock":"PM","sessionType":"squash","title":"good-2","durationMin":35,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"control","drills":[{"name":"Drop al box","durationMin":10}]}}]}]</actions>',
        }
      },
    }

    const result = await generatePlanWeeks({
      plan: { ...plan, totalWeeks: 2 },
      weeks: weeks.slice(0, 1),
      profile,
      wizardConfig,
      provider,
    })

    expect(result[0]?.status).toBe('draft')
    expect(result[0]?.generationMeta.attempts).toBe(2)
    expect(prompts[1]).toContain('Corrección del intento anterior')
  })

  it('retries when the model returns fewer sessions than the wizard requires', async () => {
    const profile = makeProfile(eventNWeeksFromNow(2))
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = makeWizardConfig()
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
    })

    const prompts: string[] = []
    const provider = {
      name: 'mock' as const,
      call: async (request: { userMessage: string }) => {
        prompts.push(request.userMessage)
        const monday = weeks[0].weekStartDate
        const tuesday = addDaysIso(monday, 1)
        const wednesday = addDaysIso(monday, 2)
        const thursday = addDaysIso(monday, 3)
        const saturday = addDaysIso(monday, 5)
        if (prompts.length === 1) {
          return {
            provider: 'mock' as const,
            text: `<actions>[{"type":"create_week","reason":"corta","targetDate":"${monday}","sessions":[{"date":"${monday}","timeBlock":"AM","sessionType":"squash","title":"S1","durationMin":60,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${tuesday}","timeBlock":"PM","sessionType":"strength","title":"S2","durationMin":45},{"date":"${thursday}","timeBlock":"AM","sessionType":"running","title":"S3","durationMin":30}]}]</actions>`,
          }
        }

        return {
          provider: 'mock' as const,
          text: `<actions>[{"type":"create_week","reason":"ok","targetDate":"${monday}","sessions":[{"date":"${monday}","timeBlock":"AM","sessionType":"squash","title":"S1","durationMin":60,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${wednesday}","timeBlock":"PM","sessionType":"strength","title":"S2","durationMin":45},{"date":"${tuesday}","timeBlock":"AM","sessionType":"squash","title":"S3","durationMin":30,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Boast","durationMin":10}]}},{"date":"${thursday}","timeBlock":"PM","sessionType":"squash","title":"S4","durationMin":50,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"control","drills":[{"name":"Drops al box","durationMin":10}]}},{"date":"${saturday}","timeBlock":"AM","sessionType":"running","title":"S5","durationMin":40}]}]</actions>`,
        }
      },
    }

    const result = await generatePlanWeeks({
      plan: { ...plan, totalWeeks: 2 },
      weeks: weeks.slice(0, 1),
      profile,
      wizardConfig,
      provider,
    })

    expect(result[0]?.status).toBe('draft')
    expect(result[0]?.generationMeta.attempts).toBe(2)
    expect(prompts[1]).toContain('exactamente el número de sesiones')
  })

  it('surfaces dropped invalid sessions as a stronger retry instruction', async () => {
    const profile = makeProfile(eventNWeeksFromNow(2))
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = makeWizardConfig()
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
    })

    const prompts: string[] = []
    const monday = weeks[0].weekStartDate
    const tuesday = addDaysIso(monday, 1)
    const wednesday = addDaysIso(monday, 2)
    const thursday = addDaysIso(monday, 3)
    const saturday = addDaysIso(monday, 5)
    const provider = {
      name: 'mock' as const,
      call: async (request: { userMessage: string }) => {
        prompts.push(request.userMessage)
        if (prompts.length === 1) {
          return {
            provider: 'mock' as const,
            text: `<actions>[{"type":"create_week","reason":"parcial","targetDate":"${monday}","sessions":[{"date":"${monday}","timeBlock":"AM","sessionType":"squash","title":"S1","durationMin":60,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${tuesday}","timeBlock":"PM","sessionType":"strength","title":"S2","durationMin":45},{"date":"${wednesday}","timeBlock":"AM","sessionType":"squash","title":"S3","durationMin":30,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Boast","durationMin":10}]}},{"date":"invalid-date","timeBlock":"AM","sessionType":"running","title":"rota-1","durationMin":30},{"date":"${thursday}","timeBlock":"AM","sessionType":"squash","title":"rota-2","durationMin":45}]}]</actions>`,
          }
        }

        return {
          provider: 'mock' as const,
          text: `<actions>[{"type":"create_week","reason":"ok","targetDate":"${monday}","sessions":[{"date":"${monday}","timeBlock":"AM","sessionType":"squash","title":"S1","durationMin":60,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${wednesday}","timeBlock":"PM","sessionType":"strength","title":"S2","durationMin":45},{"date":"${tuesday}","timeBlock":"AM","sessionType":"squash","title":"S3","durationMin":30,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Boast","durationMin":10}]}},{"date":"${thursday}","timeBlock":"PM","sessionType":"squash","title":"S4","durationMin":50,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"control","drills":[{"name":"Drops al box","durationMin":10}]}},{"date":"${saturday}","timeBlock":"AM","sessionType":"running","title":"S5","durationMin":40}]}]</actions>`,
        }
      },
    }

    const result = await generatePlanWeeks({
      plan: { ...plan, totalWeeks: 2 },
      weeks: weeks.slice(0, 1),
      profile,
      wizardConfig,
      provider,
    })

    expect(result[0]?.status).toBe('draft')
    expect(prompts[1]).toContain('sesiones válidas completas')
  })

  it('buildPlanShell starts in transition when the goal event already passed earlier this same week', () => {
    const profile = makeProfile('2026-04-14')
    const event = profile.goalEvents![0] as GoalEvent
    const { weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
      now: new Date('2026-04-18T10:00:00'),
    })

    expect(weeks[0]?.phase).toBe('transition')
  })

  it('falls back from pair generation to single-week generation when only one week resolves from the batch', async () => {
    const profile = makeProfile(eventNWeeksFromNow(8))
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = {
      ...makeWizardConfig(),
      trainingDays: ['monday', 'tuesday'] as PlanWizardConfig['trainingDays'],
      sessionsPerWeek: 2,
    }
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
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
            text: `<actions>[{"type":"create_week","reason":"batch","targetDate":"${weeks[0].weekStartDate}","sessions":[{"date":"${weeks[0].weekStartDate}","timeBlock":"AM","sessionType":"squash","title":"w1-a","durationMin":30,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${addDaysIso(weeks[0].weekStartDate, 1)}","timeBlock":"PM","sessionType":"squash","title":"w1-b","durationMin":35,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"control","drills":[{"name":"Drop","durationMin":10}]}}]}]</actions>`,
          }
        }
        return {
          provider: 'mock' as const,
          text: `<actions>[{"type":"create_week","reason":"single","targetDate":"${weeks[1].weekStartDate}","sessions":[{"date":"${weeks[1].weekStartDate}","timeBlock":"AM","sessionType":"squash","title":"w2-a","durationMin":45,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${addDaysIso(weeks[1].weekStartDate, 1)}","timeBlock":"PM","sessionType":"squash","title":"w2-b","durationMin":35,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"control","drills":[{"name":"Drop","durationMin":10}]}}]}]</actions>`,
        }
      },
    }

    const result = await generatePlanWeeks({
      plan,
      weeks: weeks.slice(0, 2),
      profile,
      wizardConfig,
      provider,
      strategy: 'pairs',
    })

    expect(callCount).toBe(2)
    expect(result[0]?.status).toBe('draft')
    expect(result[1]?.status).toBe('draft')
    expect(result[0]?.generationMeta.strategy).toBe('pairs')
    expect(result[1]?.generationMeta.strategy).toBe('single')
  })

  it('degrades the remaining pipeline to single-week generation after a malformed pair batch', async () => {
    const profile = makeProfile(eventNWeeksFromNow(8))
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = makeWizardConfig()
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
    })

    let callCount = 0
    const provider = {
      name: 'mock' as const,
      call: async () => {
        callCount += 1
        const week1Monday = weeks[0].weekStartDate
        const week2Monday = weeks[1].weekStartDate
        const week3Monday = weeks[2].weekStartDate
        const week4Monday = weeks[3].weekStartDate
        if (callCount === 1) {
          return {
            provider: 'mock' as const,
            text: `<actions>[{"type":"create_week","reason":"batch-1","targetDate":"${week1Monday}","sessions":[{"date":"${week1Monday}","timeBlock":"AM","sessionType":"squash","title":"w1-a","durationMin":40,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${addDaysIso(week1Monday, 1)}","timeBlock":"PM","sessionType":"strength","title":"w1-b","durationMin":45},{"date":"${addDaysIso(week1Monday, 2)}","timeBlock":"AM","sessionType":"running","title":"w1-c","durationMin":35}]},{"type":"create_week","reason":"batch-2","targetDate":"${week2Monday}","sessions":[{"date":"${week2Monday}","timeBlock":"AM","sessionType":"squash","title":"w2-a","durationMin":40,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${addDaysIso(week2Monday, 1)}","timeBlock":"PM","sessionType":"strength","title":"w2-b","durationMin":45},{"date":"${addDaysIso(week2Monday, 2)}","timeBlock":"AM","sessionType":"running","title":"w2-c","durationMin":35}]}]</actions>`,
          }
        }
        const monday = callCount === 2 ? week1Monday : callCount === 3 ? week2Monday : callCount === 4 ? week3Monday : week4Monday
        return {
          provider: 'mock' as const,
          text: `<actions>[{"type":"create_week","reason":"single-ok","targetDate":"${monday}","sessions":[{"date":"${monday}","timeBlock":"AM","sessionType":"squash","title":"a","durationMin":60,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${addDaysIso(monday, 1)}","timeBlock":"PM","sessionType":"strength","title":"b","durationMin":45},{"date":"${addDaysIso(monday, 2)}","timeBlock":"AM","sessionType":"squash","title":"c","durationMin":30,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Boast","durationMin":10}]}},{"date":"${addDaysIso(monday, 3)}","timeBlock":"PM","sessionType":"squash","title":"d","durationMin":50,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"control","drills":[{"name":"Drops","durationMin":10}]}},{"date":"${addDaysIso(monday, 5)}","timeBlock":"AM","sessionType":"running","title":"e","durationMin":40}]}]</actions>`,
        }
      },
    }

    const result = await generatePlanWeeks({
      plan,
      weeks: weeks.slice(0, 4),
      profile,
      wizardConfig,
      provider,
      strategy: 'pairs',
    })

    expect(callCount).toBe(5)
    expect(result.every((week) => week.status === 'draft')).toBe(true)
    expect(result[0]?.generationMeta.strategy).toBe('single')
    expect(result[2]?.generationMeta.strategy).toBe('single')
    expect(result[0]?.generationMeta.degradedFromPairs).toBe(true)
  })

  it('streams chunks through the plan generator callback', async () => {
    const profile = makeProfile(eventNWeeksFromNow(2))
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = {
      ...makeWizardConfig(),
      trainingDays: ['monday', 'tuesday'] as PlanWizardConfig['trainingDays'],
      sessionsPerWeek: 2,
    }
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
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
          text: `<actions>[{"type":"create_week","reason":"ok","targetDate":"${weeks[0].weekStartDate}","sessions":[{"date":"${weeks[0].weekStartDate}","timeBlock":"AM","sessionType":"squash","title":"stream-a","durationMin":40,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${addDaysIso(weeks[0].weekStartDate, 1)}","timeBlock":"PM","sessionType":"squash","title":"stream-b","durationMin":35,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"control","drills":[{"name":"Drop","durationMin":10}]}}]}]</actions>`,
        }
      },
    }

    const result = await generatePlanWeeks({
      plan,
      weeks: weeks.slice(0, 1),
      profile,
      wizardConfig,
      provider,
      onChunk: (_weekIndex, chunk) => chunks.push(chunk),
    })

    expect(chunks).toEqual(['uno', 'dos'])
    expect(result[0]?.generationMeta.chunkCount).toBe(2)
  })

  it('routes pair-batch streaming chunks to the matching week index', async () => {
    const profile = makeProfile(eventNWeeksFromNow(8))
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = {
      ...makeWizardConfig(),
      trainingDays: ['monday', 'tuesday'] as PlanWizardConfig['trainingDays'],
      sessionsPerWeek: 2,
    }
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
    })

    const streamedByWeekIndex: Record<number, string> = {}
    const provider = {
      name: 'mock' as const,
      call: async (request: { onChunk?: (chunk: string) => void }) => {
        request.onChunk?.('<actions>[{"type":"create_week","reason":"batch-1",')
        request.onChunk?.(`"targetDate":"${weeks[0].weekStartDate}","sessions":[{"date":"${weeks[0].weekStartDate}","timeBlock":"AM","sessionType":"squash","title":"w1-a","durationMin":30,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${addDaysIso(weeks[0].weekStartDate, 1)}","timeBlock":"PM","sessionType":"squash","title":"w1-b","durationMin":35,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"control","drills":[{"name":"Drop","durationMin":10}]}}]},`)
        request.onChunk?.('{"type":"create_week","reason":"batch-2",')
        request.onChunk?.(`"targetDate":"${weeks[1].weekStartDate}","sessions":[{"date":"${weeks[1].weekStartDate}","timeBlock":"AM","sessionType":"squash","title":"w2-a","durationMin":45,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${addDaysIso(weeks[1].weekStartDate, 1)}","timeBlock":"PM","sessionType":"squash","title":"w2-b","durationMin":35,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"control","drills":[{"name":"Drop","durationMin":10}]}}]}]</actions>`)
        return {
          provider: 'mock' as const,
          durationMs: 15,
          text: `<actions>[{"type":"create_week","reason":"batch-1","targetDate":"${weeks[0].weekStartDate}","sessions":[{"date":"${weeks[0].weekStartDate}","timeBlock":"AM","sessionType":"squash","title":"w1-a","durationMin":30,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${addDaysIso(weeks[0].weekStartDate, 1)}","timeBlock":"PM","sessionType":"squash","title":"w1-b","durationMin":35,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"control","drills":[{"name":"Drop","durationMin":10}]}}]},{"type":"create_week","reason":"batch-2","targetDate":"${weeks[1].weekStartDate}","sessions":[{"date":"${weeks[1].weekStartDate}","timeBlock":"AM","sessionType":"squash","title":"w2-a","durationMin":45,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${addDaysIso(weeks[1].weekStartDate, 1)}","timeBlock":"PM","sessionType":"squash","title":"w2-b","durationMin":35,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"control","drills":[{"name":"Drop","durationMin":10}]}}]}]</actions>`,
        }
      },
    }

    const result = await generatePlanWeeks({
      plan,
      weeks: weeks.slice(0, 2),
      profile,
      wizardConfig,
      provider,
      strategy: 'pairs',
      onChunk: (weekIndex, chunk) => {
        streamedByWeekIndex[weekIndex] = (streamedByWeekIndex[weekIndex] ?? '') + chunk
      },
    })

    expect(streamedByWeekIndex[weeks[0].weekIndex]).toContain(`"targetDate":"${weeks[0].weekStartDate}"`)
    expect(streamedByWeekIndex[weeks[1].weekIndex]).toContain(`"targetDate":"${weeks[1].weekStartDate}"`)
    expect(result[0]?.status).toBe('draft')
    expect(result[1]?.status).toBe('draft')
  })
})
