import { describe, expect, it } from 'vitest'
import type { WeekSummary } from '../../../types'
import type { TrainingPlan } from '../../../types/planBuilder'
import {
  comparePlanCanonicalRecency,
  resolvePlanCycleState,
  summarizeCycle,
} from '../planCycle'

const week = (weekStartDate: string, fields: Partial<WeekSummary> = {}): WeekSummary => ({
  id: `w-${weekStartDate}`,
  weekStartDate,
  totalSessions: 4,
  totalMinutes: 240,
  plannedSessions: 4,
  completedSessions: 4,
  plannedMinutes: 240,
  completedMinutes: 240,
  squashSessions: 2,
  runningSessions: 1,
  strengthSessions: 1,
  ...fields,
})

const plan = (fields: Partial<TrainingPlan>): TrainingPlan => ({
  id: 'p',
  athleteId: 'ath_self',
  goalEventId: 'event-1',
  status: 'active',
  generationState: 'complete',
  title: 'Plan',
  startDate: '2026-06-01',
  endDate: '2026-08-15',
  totalWeeks: 2,
  phases: [],
  wizardConfig: {} as never,
  macroSnapshot: {} as never,
  createdAt: 10,
  updatedAt: 20,
  ...fields,
})

describe('resolvePlanCycleState', () => {
  it('mantiene el día del evento dentro del ciclo', () => {
    expect(resolvePlanCycleState({
      event: { date: '2026-08-15' },
      todayISO: '2026-08-15',
    })).toBe('upcoming')
  })

  it('entra en post_event el día siguiente', () => {
    expect(resolvePlanCycleState({
      event: { date: '2026-08-15' },
      todayISO: '2026-08-16',
    })).toBe('post_event')
  })

  it('mantiene el orden calendario al cruzar DST', () => {
    expect(resolvePlanCycleState({
      event: { date: '2026-09-07' },
      todayISO: '2026-09-05',
    })).toBe('upcoming')
  })
})

describe('summarizeCycle', () => {
  it('resume sólo las fechas reales del plan', () => {
    expect(summarizeCycle({
      weekStartDates: ['2026-06-01', '2026-06-08'],
      weekSummaries: [
        week('2026-06-01', { completedSessions: 3, adherencePct: 80 }),
        week('2026-06-08', { completedSessions: 0, adherencePct: 60 }),
        week('2026-05-25', { completedSessions: 4, adherencePct: 10 }),
      ],
    })).toEqual({ weeksTrained: 1, avgAdherence: 70 })
  })

  it('ignora adherencia ausente y devuelve null cuando no hay muestras', () => {
    expect(summarizeCycle({
      weekStartDates: ['2026-06-01'],
      weekSummaries: [week('2026-06-01', { adherencePct: undefined })],
    })).toEqual({ weeksTrained: 1, avgAdherence: null })
  })

  it('un ciclo sin semanas devuelve 0 y null', () => {
    expect(summarizeCycle({ weekStartDates: [], weekSummaries: [] }))
      .toEqual({ weeksTrained: 0, avgAdherence: null })
  })
})

describe('comparePlanCanonicalRecency', () => {
  it('ordena por updatedAt, acceptedAt, createdAt e id', () => {
    const rows = [
      plan({ id: 'z', updatedAt: 20, acceptedAt: 30, createdAt: 40 }),
      plan({ id: 'b', updatedAt: 20, acceptedAt: 31, createdAt: 39 }),
      plan({ id: 'a', updatedAt: 20, acceptedAt: 31, createdAt: 39 }),
      plan({ id: 'newest', updatedAt: 21, acceptedAt: undefined, createdAt: 1 }),
      plan({ id: 'no-accept', updatedAt: 20, acceptedAt: undefined, createdAt: 100 }),
    ]

    expect(rows.sort(comparePlanCanonicalRecency).map((row) => row.id))
      .toEqual(['newest', 'a', 'b', 'z', 'no-accept'])
  })
})

describe('resolvePlanCycleState con evento multijornada', () => {
  const window = { date: '2026-09-07', endDate: '2026-09-13' }

  it('sigue en curso mientras el campeonato no termina', () => {
    for (const today of ['2026-09-07', '2026-09-10', '2026-09-13']) {
      expect(resolvePlanCycleState({ event: window, todayISO: today })).toBe('upcoming')
    }
  })

  it('pasa a post-evento recién después del término', () => {
    expect(resolvePlanCycleState({ event: window, todayISO: '2026-09-14' })).toBe('post_event')
  })

  it('un evento de un día conserva su comportamiento', () => {
    const single = { date: '2026-09-07' }
    expect(resolvePlanCycleState({ event: single, todayISO: '2026-09-07' })).toBe('upcoming')
    expect(resolvePlanCycleState({ event: single, todayISO: '2026-09-08' })).toBe('post_event')
  })
})
