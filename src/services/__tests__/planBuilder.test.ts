import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDays } from 'date-fns'
import type { AthleteProfile, GoalEvent, PlanWizardConfig } from '../../types'
import { buildPlanShell } from '../planBuilder/buildPlanShell'
import { generatePlanWeeks } from '../planBuilder/generatePlan'
import { repairGeneratedWeek } from '../planBuilder/repairWeek'
import {
  buildWeekBatchSystemPrompt,
  buildWeekSystemPrompt,
  buildWeekUserPrompt,
} from '../week/prompts/weekPrompt'
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

function createWeekActionText(weekStartDate: string, reason = 'ok'): string {
  return `{"type":"create_week","reason":"${reason}","targetDate":"${weekStartDate}","sessions":[{"date":"${weekStartDate}","timeBlock":"AM","sessionType":"squash","title":"S1","durationMin":60,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${addDaysIso(weekStartDate, 1)}","timeBlock":"PM","sessionType":"squash","title":"S2","durationMin":45,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Boast","durationMin":10}]}}]}`
}

describe('planBuilder', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('buildPlanShell creates one week per calendar week until event', () => {
    const profile = makeProfile(eventNWeeksFromNow(8))
    const event = profile.goalEvents![0] as GoalEvent
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig: makeWizardConfig(),
      goalEvent: event,
    })
    expect(plan.generationState).toBe('shell')
    expect(plan.totalWeeks).toBeGreaterThanOrEqual(8)
    expect(plan.totalWeeks).toBeLessThanOrEqual(10)
    expect(weeks).toHaveLength(plan.totalWeeks)
    expect(weeks[0].weekIndex).toBe(0)
    expect(weeks[weeks.length - 1].weekIndex).toBe(plan.totalWeeks - 1)
    expect(plan.phases.length).toBeGreaterThan(0)
  })

  it('buildPlanShell starts training from the request date and skips past calendar days', () => {
    const profile = makeProfile('2026-07-20')
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = makeWizardConfig()
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
      now: new Date('2026-05-17T10:00:00'),
    })

    expect(plan.startDate).toBe('2026-05-17')
    expect(plan.endDate).toBe('2026-07-20')
    expect(plan.totalWeeks).toBe(10)
    expect(weeks[0]?.weekStartDate).toBe('2026-05-18')
    expect(weeks[weeks.length - 1]?.weekStartDate).toBe('2026-07-20')
  })

  it('week prompt and validation respect a partial first-week range', () => {
    const profile = makeProfile('2026-07-20')
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = {
      ...makeWizardConfig(),
      trainingDays: ['thursday', 'saturday'] as PlanWizardConfig['trainingDays'],
      sessionsPerWeek: 2,
    }
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
      now: new Date('2026-05-13T10:00:00'),
    })
    const week = weeks[0]
    const prompt = buildWeekUserPrompt({ plan, week, profile, wizardConfig })

    expect(week.weekStartDate).toBe('2026-05-11')
    expect(prompt).toContain('Rango válido para sesiones de esta semana: 2026-05-13 a 2026-05-17')

    const issues = validatePlan({
      plan,
      weeks: [{
        ...week,
        status: 'draft',
        sessions: [
          { date: '2026-05-11', timeBlock: 'AM', sessionType: 'squash', title: 'Past', durationMin: 45 },
          { date: '2026-05-14', timeBlock: 'AM', sessionType: 'squash', title: 'Valid', durationMin: 45 },
        ],
      }],
    })

    expect(issues.some((issue) => issue.code === 'week.sessions.out_of_week')).toBe(true)
  })

  it('repairGeneratedWeek moves first-week sessions that fall before the request date', () => {
    const profile = makeProfile('2026-07-20')
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = {
      ...makeWizardConfig(),
      trainingDays: ['thursday', 'saturday'] as PlanWizardConfig['trainingDays'],
      sessionsPerWeek: 2,
    }
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
      now: new Date('2026-05-13T10:00:00'),
    })

    const result = repairGeneratedWeek([
      { date: '2026-05-11', timeBlock: 'AM', sessionType: 'squash', title: 'Past', durationMin: 45 },
      { date: '2026-05-16', timeBlock: 'AM', sessionType: 'squash', title: 'Valid', durationMin: 45 },
    ], {
      plan,
      week: weeks[0],
      profile,
      wizardConfig,
    })

    expect(result.sessions.map((session) => session.date)).not.toContain('2026-05-11')
    expect(result.sessions.every((session) => session.date >= '2026-05-13')).toBe(true)
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

    expect(plan.totalWeeks).toBe(12)
    expect(weeks).toHaveLength(12)
    expect(plan.startDate).toBe(expectedStartDate)
    expect(plan.endDate).toBe(event.date)
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
      now: new Date('2026-05-17T10:00:00'),
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
      now: new Date('2026-05-17T10:00:00'),
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

  it('week prompt requires a squash majority in build/peak weeks with four sessions', () => {
    const profile = makeProfile(eventNWeeksFromNow(6))
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = {
      ...makeWizardConfig(),
      sessionsPerWeek: 4,
      complementarySports: ['strength', 'mobility'] as PlanWizardConfig['complementarySports'],
    }
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
      now: new Date('2026-05-17T10:00:00'),
    })
    const week = { ...weeks[0], phase: 'peak' as const }

    const prompt = buildWeekUserPrompt({
      plan,
      week,
      profile,
      wizardConfig,
    })

    expect(prompt).toContain('al menos 3 sesiones de squash')
    expect(prompt).toContain('mínimo 3 sesiones squash')
    expect(prompt).toContain('máximo 1 accesorias')
  })

  it('week prompt prefers one double-session day when double sessions are enabled with enough volume', () => {
    const profile = makeProfile(eventNWeeksFromNow(6))
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = {
      ...makeWizardConfig(),
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as PlanWizardConfig['trainingDays'],
      sessionsPerWeek: 6,
      allowDoubleSession: true,
    }
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
    })
    const week = { ...weeks[0], phase: 'build' as const }

    const prompt = buildWeekUserPrompt({
      plan,
      week,
      profile,
      wizardConfig,
    })

    expect(prompt).toContain('usa al menos 1 dia doble AM/PM')
    expect(prompt).toContain('deja 1 dia permitido libre como descarga')
    expect(prompt).toContain('Evita juntar dos estimulos duros')
  })

  it('buildWeekSystemPrompt preserves the literal session schema block', () => {
    const prompt = buildWeekSystemPrompt()

    expect(prompt).toContain('═══ ESQUEMA DE SESIÓN (OBLIGATORIO SEGUIR LITERAL) ═══')
    expect(prompt).toContain('sessionType: "squash" | "running" | "cycling" | "strength" | "mobility" | "recovery" | "nutrition"')
    expect(prompt).toContain('drills[] debe tener al menos un elemento')
    expect(prompt).toContain('cyclingDetails es OBLIGATORIO')
    expect(prompt).toContain('mobilityDetails es OBLIGATORIO')
    expect(prompt).toContain('exercises es OBLIGATORIO')
    expect(prompt).toContain('warmup y cooldown son opcionales')
  })

  it('buildWeekSystemPrompt keeps squash and running guardrails from the schema block', () => {
    const prompt = buildWeekSystemPrompt()

    expect(prompt).toContain('sessionMode="practice_match"')
    expect(prompt).toContain('"competition_match"')
    expect(prompt).toContain('sessionKind="match"')
    expect(prompt).toContain('Si sessionKind="mixed", añade blocks[]')
    expect(prompt).toContain('trainingFocus NO acepta "control" ni "shadows"')
    expect(prompt).toContain('Si runningType="intervals" o "tempo", añade intervalStructure')
    expect(prompt).toContain('Si una sesión no cumple, corrígela — no la descartes.')
  })

  it('buildWeekBatchSystemPrompt omits the schema block and keeps batch-specific constraints', () => {
    const prompt = buildWeekBatchSystemPrompt()

    expect(prompt).toContain('EXACTAMENTE DOS acciones create_week')
    expect(prompt).toContain('Nunca mezcles sesiones de una semana dentro de la otra.')
    expect(prompt).not.toContain('═══ ESQUEMA DE SESIÓN (OBLIGATORIO SEGUIR LITERAL) ═══')
    expect(prompt).not.toContain('cyclingDetails es OBLIGATORIO')
    expect(prompt).not.toContain('mobilityDetails es OBLIGATORIO')
    expect(prompt.match(/ESQUEMA DE SESIÓN \(OBLIGATORIO SEGUIR LITERAL\)/g)).toBeNull()
  })

  it('repairs an out-of-week sparse response without retrying when fallback can complete it', async () => {
    const profile = makeProfile('2026-07-20')
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
      now: new Date('2026-05-17T10:00:00'),
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
    expect(result[0]?.generationMeta.attempts).toBe(1)
    expect(result[0]?.generationMeta.movedSessionCount).toBe(1)
    expect(result[0]?.generationMeta.addedFallbackCount).toBe(1)
    expect(prompts).toHaveLength(1)
  })

  it('adds fallbacks when the model returns fewer sessions than the wizard requires', async () => {
    const profile = makeProfile('2026-07-20')
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = makeWizardConfig()
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
      now: new Date('2026-05-17T10:00:00'),
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
    expect(result[0]?.generationMeta.attempts).toBe(1)
    expect(result[0]?.generationMeta.addedFallbackCount).toBe(2)
    expect(prompts).toHaveLength(1)
  })

  it('uses a local fallback week after invalid Gemini-style responses exhaust retries', async () => {
    const profile = makeProfile('2026-07-20')
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = makeWizardConfig()
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
      now: new Date('2026-05-17T10:00:00'),
    })
    const peakWeek = { ...weeks[0], phase: 'peak' as const }

    let callCount = 0
    const provider = {
      name: 'gemini' as const,
      call: async () => {
        callCount += 1
        return {
          provider: 'gemini' as const,
          model: 'gemini-2.5-flash',
          text: '<actions>[{"type":"noop","reason":"sin create_week valido"}]</actions>',
        }
      },
    }

    const result = await generatePlanWeeks({
      plan: { ...plan, totalWeeks: 1 },
      weeks: [peakWeek],
      profile,
      wizardConfig,
      provider,
      strategy: 'single',
    })

    const sessions = result[0]?.sessions ?? []
    const counts = sessions.reduce<Record<string, number>>((acc, session) => {
      acc[session.sessionType] = (acc[session.sessionType] ?? 0) + 1
      return acc
    }, {})

    expect(callCount).toBe(2)
    expect(result[0]?.status).toBe('draft')
    expect(result[0]?.generationMeta.fallbackUsed).toBe(true)
    expect(result[0]?.generationMeta.errorClass).toBe('local_plan_fallback')
    expect(result[0]?.generationMeta.attempts).toBe(2)
    expect(sessions).toHaveLength(5)
    expect(counts.squash).toBe(3)
    expect(counts.running).toBe(1)
    expect(counts.strength).toBe(1)
    expect(sessions.find((session) => session.sessionType === 'running')?.intervalStructure?.blocks?.length).toBeGreaterThan(0)
  })

  it('spreads local fallback sessions across available days before using double sessions', async () => {
    const profile = makeProfile('2026-07-20')
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig: PlanWizardConfig = {
      ...makeWizardConfig(),
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      doubleSessionDays: ['monday', 'wednesday', 'friday'],
      sessionsPerWeek: 6,
      allowDoubleSession: true,
    }
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
      now: new Date('2026-05-17T10:00:00'),
    })
    const peakWeek = { ...weeks[0], phase: 'peak' as const }

    const provider = {
      name: 'gemini' as const,
      call: async () => ({
        provider: 'gemini' as const,
        model: 'gemini-2.5-flash',
        text: '<actions>[{"type":"noop","reason":"sin create_week valido"}]</actions>',
      }),
    }

    const result = await generatePlanWeeks({
      plan: { ...plan, totalWeeks: 1, wizardConfig },
      weeks: [peakWeek],
      profile,
      wizardConfig,
      provider,
      strategy: 'single',
    })

    const sessions = result[0]?.sessions ?? []
    const dates = sessions.map((session) => session.date)
    const counts = sessions.reduce<Record<string, number>>((acc, session) => {
      acc[session.sessionType] = (acc[session.sessionType] ?? 0) + 1
      return acc
    }, {})

    expect(sessions).toHaveLength(6)
    expect(new Set(dates).size).toBe(6)
    expect(sessions.every((session) => session.timeBlock === 'AM')).toBe(true)
    expect(counts.squash).toBe(4)
    expect(counts.running).toBe(1)
    expect(counts.strength).toBe(1)
  })

  it('surfaces dropped invalid sessions as a stronger retry instruction', async () => {
    const profile = makeProfile('2026-07-20')
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = makeWizardConfig()
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
      now: new Date('2026-05-17T10:00:00'),
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
    expect(result[0]?.generationMeta.droppedSessionCount).toBeGreaterThanOrEqual(1)
    expect(result[0]?.generationMeta.addedFallbackCount).toBe(1)
    expect(prompts).toHaveLength(1)
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

  it('degrades a missing pair week to single before local fallback', async () => {
    const profile = makeProfile('2026-07-20')
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
      now: new Date('2026-05-17T10:00:00'),
    })

    let callCount = 0
    const provider = {
      name: 'mock' as const,
      call: async () => {
        callCount += 1
        return {
          provider: 'mock' as const,
          text: `<actions>[{"type":"create_week","reason":"batch","targetDate":"${weeks[0].weekStartDate}","sessions":[{"date":"${weeks[0].weekStartDate}","timeBlock":"AM","sessionType":"squash","title":"w1-a","durationMin":30,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"technical","drills":[{"name":"Drive","durationMin":10}]}},{"date":"${addDaysIso(weeks[0].weekStartDate, 1)}","timeBlock":"PM","sessionType":"squash","title":"w1-b","durationMin":35,"squashDetails":{"trainingFocus":"technical","sessionMode":"drill_session","sessionKind":"control","drills":[{"name":"Drop","durationMin":10}]}}]}]</actions>`,
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

    expect(callCount).toBe(3)
    expect(result[0]?.status).toBe('draft')
    expect(result[1]?.status).toBe('draft')
    expect(result[0]?.generationMeta.strategy).toBe('pairs')
    expect(result[1]?.generationMeta.strategy).toBe('single')
    expect(result[1]?.generationMeta.requestClass).toBe('plan_builder_week')
    expect(result[1]?.generationMeta.fallbackUsed).toBe(true)
  })

  it('disables pair generation after malformed pair weeks and continues as single', async () => {
    const profile = makeProfile('2026-07-20')
    const event = profile.goalEvents![0] as GoalEvent
    const wizardConfig = makeWizardConfig()
    const { plan, weeks } = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent: event,
      now: new Date('2026-05-17T10:00:00'),
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
            text: `<actions>[{"type":"noop","reason":"malformed pair for ${week1Monday} and ${week2Monday}"}]</actions>`,
          }
        }
        return {
          provider: 'mock' as const,
          text: `<actions>[${createWeekActionText(week3Monday, 'pair-3')},${createWeekActionText(week4Monday, 'pair-4')}]</actions>`,
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

    expect(callCount).toBe(7)
    expect(result.every((week) => week.status === 'draft')).toBe(true)
    expect(result[0]?.generationMeta.strategy).toBe('single')
    expect(result[1]?.generationMeta.fallbackUsed).toBe(true)
    expect(result[2]?.generationMeta.strategy).toBe('single')
    expect(result[0]?.generationMeta.requestClass).toBe('plan_builder_week')
  })

  it('does not stream chunks for single-week structured JSON generation', async () => {
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
    let receivedOnChunk = false
    const provider = {
      name: 'mock' as const,
      call: async (request: { onChunk?: (chunk: string) => void }) => {
        receivedOnChunk = typeof request.onChunk === 'function'
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

    expect(receivedOnChunk).toBe(false)
    expect(chunks).toEqual([])
    expect(result[0]?.generationMeta.chunkCount).toBe(0)
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

  it('uses single generation by default for long plans', async () => {
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

    const requestClasses: string[] = []
    const provider = {
      name: 'mock' as const,
      call: async (request: { requestClass: string }) => {
        requestClasses.push(request.requestClass)
        return {
          provider: 'mock' as const,
          text: `<actions>[${createWeekActionText(weeks[0].weekStartDate, 'default-1')},${createWeekActionText(weeks[1].weekStartDate, 'default-2')}]</actions>`,
        }
      },
    }

    const result = await generatePlanWeeks({
      plan,
      weeks: weeks.slice(0, 2),
      profile,
      wizardConfig,
      provider,
    })

    expect(result.every((week) => week.status === 'draft')).toBe(true)
    expect(requestClasses).toEqual(['plan_builder_week', 'plan_builder_week'])
  })

  it('uses pair generation only when configured explicitly as pairs', async () => {
    vi.stubEnv('VITE_PLAN_BUILDER_GENERATION_STRATEGY', 'pairs')
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

    const requestClasses: string[] = []
    const provider = {
      name: 'mock' as const,
      call: async (request: { requestClass: string }) => {
        requestClasses.push(request.requestClass)
        return {
          provider: 'mock' as const,
          text: `<actions>[${createWeekActionText(weeks[0].weekStartDate, 'pair-1')},${createWeekActionText(weeks[1].weekStartDate, 'pair-2')}]</actions>`,
        }
      },
    }

    const result = await generatePlanWeeks({
      plan,
      weeks: weeks.slice(0, 2),
      profile,
      wizardConfig,
      provider,
    })

    expect(result.every((week) => week.status === 'draft')).toBe(true)
    expect(requestClasses[0]).toBe('plan_builder_pair')
  })

  it('treats auto strategy as single for long plans', async () => {
    vi.stubEnv('VITE_PLAN_BUILDER_GENERATION_STRATEGY', 'auto')
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

    const requestClasses: string[] = []
    const provider = {
      name: 'mock' as const,
      call: async (request: { requestClass: string }) => {
        requestClasses.push(request.requestClass)
        return {
          provider: 'mock' as const,
          text: `<actions>[${createWeekActionText(weeks[0].weekStartDate, 'auto-1')},${createWeekActionText(weeks[1].weekStartDate, 'auto-2')}]</actions>`,
        }
      },
    }

    const result = await generatePlanWeeks({
      plan,
      weeks: weeks.slice(0, 2),
      profile,
      wizardConfig,
      provider,
    })

    expect(result.every((week) => week.status === 'draft')).toBe(true)
    expect(requestClasses).toEqual(['plan_builder_week', 'plan_builder_week'])
  })
})
