import { describe, expect, it } from 'vitest'

import type { AthleteProfile, CoachSessionProposal, PlanWizardConfig } from '../../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'
import { buildDeterministicWeek } from '../fallbackWeek'
import {
  EVENT_WINDOW_SUPPORT_CAPS,
  isSquashCompetitionSession,
  resolveEventWindowSupportKind,
  resolvePlanEventWindow,
} from '../eventWindowRules'
import { repairGeneratedWeek } from '../repairWeek'
import { reviewPlanQuality } from '../qualityReview'
import { validatePlanWeek } from '../validator'
import { buildWeekUserPrompt } from '../../week/prompts/weekPrompt'

function wizard(): PlanWizardConfig {
  return {
    goalEventId: 'event-window',
    trainingDays: ['monday', 'tuesday', 'thursday', 'friday'],
    sessionsPerWeek: 2,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: ['strength', 'running', 'cycling'],
    currentFitnessLevel: 'fit',
    currentFatigue: 'fresh',
    partnerAvailability: 'either',
    createdAt: '',
    updatedAt: '',
  }
}

function plan(): TrainingPlan {
  const wizardConfig = wizard()
  return {
    id: 'plan-window',
    athleteId: 'athlete-window',
    goalEventId: 'event-window',
    status: 'draft',
    generationState: 'shell',
    title: 'Campeonato multijornada',
    startDate: '2026-08-31',
    endDate: '2026-09-11',
    totalWeeks: 2,
    phases: [{
      phase: 'race',
      startWeekIndex: 0,
      endWeekIndex: 1,
      blockFocus: 'Competir y recuperar',
      intentBySport: {},
    }],
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'event-window',
      goalEventDate: '2026-09-05',
      goalEventEndDate: '2026-09-11',
      goalEventKeyDate: '2026-09-09',
      currentPhase: 'race',
      weeksRemaining: 0,
      blockFocus: 'Competir y recuperar',
      headline: '',
      timeline: [],
      sportDetails: [{
        sport: 'squash',
        role: 'primary',
        phaseFocus: '',
        weeklyIntent: '',
        volumeBias: 'minimal',
        intensityBias: 'minimal',
        notes: '',
      }],
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 0,
    updatedAt: 0,
  }
}

function week(weekIndex: number): TrainingPlanWeek {
  return {
    id: `week-window-${weekIndex}`,
    planId: 'plan-window',
    weekIndex,
    weekStartDate: weekIndex === 0 ? '2026-08-31' : '2026-09-07',
    phase: 'race',
    status: 'draft',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: { squash: 20, mobility: 10 },
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 0,
    updatedAt: 0,
  }
}

function profile(): AthleteProfile {
  return {
    id: 'athlete-window',
    updatedAt: 0,
    primarySport: 'squash',
    mainGoal: 'Competir fresco durante todo el campeonato',
    sportContext: {
      primarySport: 'squash',
      enabledSports: ['squash', 'strength', 'running', 'cycling', 'mobility'],
      secondarySports: ['strength', 'running', 'cycling', 'mobility'],
      trainingPriority: 'performance',
    },
    goalEvents: [{
      id: 'event-window',
      title: 'Campeonato multijornada',
      date: '2026-09-05',
      endDate: '2026-09-11',
      keyDate: '2026-09-09',
      sport: 'squash',
      priority: 'primary',
    }],
  }
}

function expectValidSupport(session: CoachSessionProposal): void {
  const kind = resolveEventWindowSupportKind(session)
  expect(kind).toBeDefined()
  const caps = EVENT_WINDOW_SUPPORT_CAPS[kind!]
  expect(session.durationMin).toBeGreaterThanOrEqual(caps.minDurationMin)
  expect(session.durationMin).toBeLessThanOrEqual(caps.maxDurationMin)
  expect(session.rpe).toBeGreaterThanOrEqual(caps.minRpe)
  expect(session.rpe).toBeLessThanOrEqual(caps.maxRpe)
}

describe('B4 — generación dentro de una ventana competitiva', () => {
  it('usa el inicio como única ancla cuando no hay keyDate', () => {
    const trainingPlan = plan()
    trainingPlan.macroSnapshot.goalEventKeyDate = undefined

    expect(resolvePlanEventWindow(trainingPlan).anchorDate).toBe('2026-09-05')
  })

  it('el fallback determinista crea una sola ancla aunque el evento cruce semanas', () => {
    const trainingPlan = plan()
    const weeks = [week(0), week(1)]
    const generated = weeks.map((targetWeek, index) => buildDeterministicWeek({
      plan: trainingPlan,
      week: targetWeek,
      previousWeek: index > 0 ? { ...weeks[index - 1]!, sessions: [] } : undefined,
      planWeekDescriptors: weeks.map((item) => ({ weekIndex: item.weekIndex, phase: item.phase })),
      profile: profile(),
      wizardConfig: trainingPlan.wizardConfig,
    }).sessions)

    const allSessions = generated.flat()
    const anchors = allSessions.filter(isSquashCompetitionSession)
    expect(anchors).toHaveLength(1)
    expect(anchors[0]).toMatchObject({ date: '2026-09-09', sessionType: 'squash', subtype: 'competitive' })
    expect(generated[0]!.filter(isSquashCompetitionSession)).toHaveLength(0)
    expect(generated[0]).toHaveLength(2)
    expect(generated[1]).toHaveLength(2)

    for (const sessions of generated) {
      for (const session of sessions.filter((item) => !isSquashCompetitionSession(item))) {
        expectValidSupport(session)
      }
    }

    const readyWeeks = weeks.map((item, index) => ({ ...item, sessions: generated[index]! }))
    expect(readyWeeks.flatMap((item) => validatePlanWeek(trainingPlan, item)).filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('repair convierte cargas y partidos extra, y reserva el día clave', () => {
    const trainingPlan = plan()
    const targetWeek = week(1)
    const raw: CoachSessionProposal[] = [
      { date: '2026-09-07', timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza máxima', durationMin: 70, rpe: 9, objective: 'Carga pesada' },
      { date: '2026-09-08', timeBlock: 'PM', sessionType: 'squash', squashKind: 'match', subtype: 'match', title: 'Match extra', durationMin: 60, rpe: 8, objective: 'Jugar otro partido' },
      { date: '2026-09-09', timeBlock: 'PM', sessionType: 'squash', squashKind: 'match', subtype: 'competitive', title: 'Día clave', durationMin: 75, rpe: 9, objective: 'Competir' },
      { date: '2026-09-09', timeBlock: 'AM', sessionType: 'mobility', title: 'Movilidad extra', durationMin: 45, rpe: 4, objective: 'Soltar' },
    ]

    const result = repairGeneratedWeek(raw, {
      plan: trainingPlan,
      week: targetWeek,
      profile: profile(),
      wizardConfig: trainingPlan.wizardConfig,
      planWeekDescriptors: [{ weekIndex: 0, phase: 'race' }, { weekIndex: 1, phase: 'race' }],
    })

    expect(result.sessions.filter(isSquashCompetitionSession)).toHaveLength(1)
    expect(result.sessions.find(isSquashCompetitionSession)?.date).toBe('2026-09-09')
    expect(result.sessions.filter((session) => session.date === '2026-09-09')).toHaveLength(1)
    expect(result.sessions.some((session) => session.sessionType === 'strength')).toBe(false)
    for (const session of result.sessions.filter((item) => !isSquashCompetitionSession(item))) {
      expectValidSupport(session)
    }
  })

  it('repair materializa el ancla aunque el proveedor devuelva cero sesiones', () => {
    const trainingPlan = plan()
    const result = repairGeneratedWeek([], {
      plan: trainingPlan,
      week: week(1),
      profile: profile(),
      wizardConfig: trainingPlan.wizardConfig,
      planWeekDescriptors: [{ weekIndex: 0, phase: 'race' }, { weekIndex: 1, phase: 'race' }],
    })

    expect(result.sessions).toHaveLength(2)
    expect(result.sessions.filter(isSquashCompetitionSession)).toHaveLength(1)
    expect(result.sessions.find(isSquashCompetitionSession)?.date).toBe('2026-09-09')
  })

  it('validator detecta ancla ausente, match extra y apoyo incompatible', () => {
    const trainingPlan = plan()
    const invalidWeek = {
      ...week(1),
      sessions: [
        { date: '2026-09-08', timeBlock: 'PM', sessionType: 'squash', squashKind: 'match', subtype: 'match', title: 'Match extra', durationMin: 60, rpe: 8, objective: 'Partido' },
        { date: '2026-09-10', timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza pesada', durationMin: 60, rpe: 8, objective: 'Cargar' },
      ] as CoachSessionProposal[],
    }

    const codes = validatePlanWeek(trainingPlan, invalidWeek).map((issue) => issue.code)
    expect(codes).toContain('squash.event_window.anchor_count')
    expect(codes).toContain('squash.event_window.extra_match')
    expect(codes).toContain('squash.event_window.incompatible_support')
  })

  it('validator exige el ancla aunque la semana race llegue vacía', () => {
    const codes = validatePlanWeek(plan(), week(1)).map((issue) => issue.code)

    expect(codes).toContain('squash.event_window.anchor_count')
  })

  it('prompt diferencia la semana del ancla de la segunda semana race', () => {
    const trainingPlan = plan()
    const firstPrompt = buildWeekUserPrompt({
      plan: trainingPlan,
      week: week(0),
      profile: profile(),
      wizardConfig: trainingPlan.wizardConfig,
      outputFormat: 'json',
    })
    const anchorPrompt = buildWeekUserPrompt({
      plan: trainingPlan,
      week: week(1),
      profile: profile(),
      wizardConfig: trainingPlan.wizardConfig,
      outputFormat: 'json',
    })

    expect(firstPrompt).toContain('2026-09-05 a 2026-09-11')
    expect(firstPrompt).toContain('cae en otra semana')
    expect(firstPrompt).toContain('NO inventes match/competencia')
    expect(anchorPrompt).toContain('Inserta UNA sola ancla')
    expect(anchorPrompt).toContain('activación 10-20min RPE 2-4')
    expect(anchorPrompt).toContain('match-play extra')
  })

  it('quality review no trata la duración de la competencia como apoyo taper largo', () => {
    const trainingPlan = plan()
    const targetWeek = {
      ...week(1),
      sessions: [{
        date: '2026-09-09',
        timeBlock: 'PM',
        sessionType: 'squash',
        squashKind: 'match',
        subtype: 'competitive',
        title: 'Squash - Competencia Objetivo',
        durationMin: 90,
        rpe: 9,
        objective: 'Competir',
        squashDetails: {
          trainingFocus: 'conditioned_games',
          sessionKind: 'match',
          sessionMode: 'competition_match',
          drills: [{ name: 'Partido de entrenamiento al mejor de 5 juegos', durationMin: 60 }],
          blocks: [{ kind: 'match', durationMin: 60, drills: [{ name: 'Partido de entrenamiento al mejor de 5 juegos', durationMin: 60 }] }],
        },
      }],
    } satisfies TrainingPlanWeek

    const review = reviewPlanQuality(trainingPlan, [targetWeek])
    expect(review.issues.map((issue) => issue.code)).not.toContain('quality.taper.session_too_long')
  })
})
