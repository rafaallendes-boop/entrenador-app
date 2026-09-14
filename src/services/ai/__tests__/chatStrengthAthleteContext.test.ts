import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext, DayLog, PlanWizardConfig, Session } from '../../../types'
import { buildStrengthSelectionContextForAction } from '../actionPostProcessor'
import { getStrengthSelectionContext } from '../promptModules/strengthPrompt'
import { captureSources } from '../../training/slotContext'
import { STRENGTH_CONTEXT_ATHLETE_FIELDS } from '../../training/strengthAthleteContext'
import { buildInsightsStrengthContext } from '../../progressionInsights'
import { resolveCapturedStrengthAthleteContext } from '../chatSourceCapture'

function strength(id: string, date: string, exerciseId: string): Session {
  return {
    id, date, weekStartDate: date, timeBlock: 'AM', type: 'strength', status: 'completed', title: id, durationMin: 60,
    createdAt: 0, updatedAt: 0,
    exercises: [{ id: `${id}-e`, name: exerciseId, sets: 3, reps: 8, completed: true, libraryRef: { source: 'strength_exercise', id: exerciseId } }],
  } as Session
}
const painLog: DayLog = { id: 'log-today', date: '2026-09-16', painLevel: 7, updatedAt: 0 }

function chatContext(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [strength('prev', '2026-09-14', 'goblet_squat')],
    dayLog: painLog,
    weekDayLogs: [painLog],
    athleteProfile: {
      id: 'ath_a', updatedAt: 0, age: 41,
      strengthProfile: { squat1RM: 100 },
      // I6/I7: declarado ayer → fatiga vigente; `fit` → sin retorno.
      planWizardConfig: { currentFatigue: 'loaded', currentFitnessLevel: 'fit', updatedAt: '2026-09-15T12:00:00.000Z' } as PlanWizardConfig,
    },
    ...overrides,
  }
}

function athleteFields(context: object) {
  return Object.fromEntries(STRENGTH_CONTEXT_ATHLETE_FIELDS.map((key) => [key, (context as Record<string, unknown>)[key]]))
}

describe('chat — campos de atleta desde el resolver B1', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 16, 10, 0)) })
  afterEach(() => { vi.useRealTimers() })

  it('la acción deja de usar fatiga 5 e intermedio fijos (F11)', () => {
    const context = buildStrengthSelectionContextForAction(chatContext(), 60, 'fuerza', [], { date: '2026-09-17', timeBlock: 'AM' })
    expect(context).toMatchObject({
      fatigueLevel: 8,
      requireExtraRecovery: true,
      experienceLevel: 'beginner',
      available1RM: ['squat'],
      rpeAdjustment: -1,
    })
    expect(context.recentExercises).toContain('goblet_squat')
  })

  it('sin señales agudas manda la fatiga declarada vigente del perfil (I7)', () => {
    const context = buildStrengthSelectionContextForAction(chatContext({ dayLog: undefined, weekDayLogs: [] }), 60, 'fuerza', [], { date: '2026-09-17', timeBlock: 'AM' })
    expect(context.fatigueLevel).toBe(6)
  })

  it('una fatiga declarada vencida ya no condiciona el chat (I7)', () => {
    const base = chatContext({ dayLog: undefined, weekDayLogs: [] })
    const expired = chatContext({
      dayLog: undefined, weekDayLogs: [],
      athleteProfile: { ...base.athleteProfile!, planWizardConfig: { currentFatigue: 'loaded', updatedAt: '2026-09-01T12:00:00.000Z' } as PlanWizardConfig },
    })
    expect(buildStrengthSelectionContextForAction(expired, 60, 'fuerza', [], { date: '2026-09-17', timeBlock: 'AM' }).fatigueLevel).toBe(4)
  })

  it('el chat aplica el retorno declarado con la misma regla de 14 días (I6)', () => {
    const base = chatContext({ dayLog: undefined, weekDayLogs: [] })
    const returning = chatContext({
      dayLog: undefined, weekDayLogs: [],
      athleteProfile: { ...base.athleteProfile!, planWizardConfig: { currentFatigue: 'normal', currentFitnessLevel: 'returning', updatedAt: '2026-09-10T12:00:00.000Z' } as PlanWizardConfig },
    })
    expect(buildStrengthSelectionContextForAction(returning, 60, 'fuerza', [], { date: '2026-09-17', timeBlock: 'AM' }))
      .toMatchObject({ returningFromBreak: true, rpeAdjustment: -1 })
  })

  it('prompt y acción coinciden para el mismo slot', () => {
    const context = chatContext()
    const prompt = getStrengthSelectionContext(context)
    const action = buildStrengthSelectionContextForAction(context, 60, 'fuerza', [], { date: '2026-09-16', timeBlock: 'PM' })
    expect(athleteFields(prompt)).toEqual(athleteFields(action))
  })

  it('una proyección recortada nunca decide: manda la captura adjunta del dominio', () => {
    const domainCapture = captureSources({
      scope: { athleteId: 'ath_a', epoch: 0, requestId: 'r' }, now: Date.now(), profile: chatContext().athleteProfile,
      sessions: [strength('prev', '2026-09-14', 'goblet_squat'), strength('older', '2026-09-10', 'romanian_deadlift')], dayLogs: [],
    })
    const projected = chatContext({ historicalSessions: [], sourceCapture: domainCapture })
    expect(getStrengthSelectionContext(projected).historicalSessions?.map((s) => s.id)).toEqual(['prev', 'older'])
  })

  it('progression insights usa el mismo resolver', () => {
    const capture = captureSources({ scope: { athleteId: null, epoch: 0, requestId: 'insights' }, now: Date.now(), profile: chatContext().athleteProfile, sessions: [strength('prev', '2026-09-14', 'goblet_squat')], dayLogs: [painLog] })
    const insights = buildInsightsStrengthContext(capture.profile, capture, { acuteLoad: 0, chronicLoad: 0, ratio: 0, status: 'insufficient_data', baselineWeeks: 0 } as never, undefined)
    const expected = resolveCapturedStrengthAthleteContext(capture, { date: '2026-09-16', timeBlock: 'PM' })
    expect(athleteFields(insights)).toMatchObject({ fatigueLevel: expected.fatigueLevel, experienceLevel: expected.experienceLevel, requireExtraRecovery: expected.requireExtraRecovery })
  })
})
