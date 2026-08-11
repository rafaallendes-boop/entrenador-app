import { describe, expect, it } from 'vitest'

import type { AthleteProfile, GoalEvent, PlanWizardConfig } from '../../../types'
import { buildPlanShell, getCompetitionPlanWeekCount } from '../buildPlanShell'

/**
 * Task B3 — el shell termina en el término de la ventana y toda semana que la
 * intersecta es `race`, incluso cuando el campeonato cruza dos semanas
 * calendario. Un evento de un día debe comportarse exactamente como antes.
 */
function makeProfile(event: GoalEvent): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: 1,
    sportContext: { enabledSports: ['squash'], primarySport: 'squash' },
    goalEvents: [event],
  }
}

function makeWizardConfig(): PlanWizardConfig {
  return {
    goalEventId: 'evt-1',
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'saturday'],
    sessionsPerWeek: 5,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: [],
    currentFitnessLevel: 'normal',
    currentFatigue: 'fresh',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

function event(partial: Partial<GoalEvent> = {}): GoalEvent {
  return {
    id: 'evt-1',
    title: 'Nacional',
    date: '2026-09-12',
    sport: 'squash',
    priority: 'primary',
    ...partial,
  }
}

function shellFor(goalEvent: GoalEvent, now = new Date('2026-08-10T09:00:00')) {
  const profile = makeProfile(goalEvent)
  return buildPlanShell({
    athleteId: profile.id,
    profile,
    wizardConfig: makeWizardConfig(),
    goalEvent,
    now,
  })
}

describe('buildPlanShell con ventana de evento', () => {
  it('un evento de un día conserva el término del plan en la fecha del evento', () => {
    const { plan } = shellFor(event())
    expect(plan.endDate).toBe('2026-09-12')
  })

  it('el plan termina en el término del evento, no en su inicio', () => {
    // Sábado a martes: la ventana cruza dos semanas calendario.
    const { plan } = shellFor(event({ date: '2026-09-12', endDate: '2026-09-15' }))
    expect(plan.endDate).toBe('2026-09-15')
  })

  it('cubre la semana del término, no sólo la del inicio', () => {
    const single = shellFor(event({ date: '2026-09-12' }))
    const crossing = shellFor(event({ date: '2026-09-12', endDate: '2026-09-15' }))
    expect(crossing.plan.totalWeeks).toBe(single.plan.totalWeeks + 1)
  })

  it('el tope de 12 semanas se ancla hacia atrás desde la semana del término', () => {
    const { plan, weeks } = shellFor(
      event({ date: '2026-09-12', endDate: '2026-09-15' }),
      new Date('2026-01-05T09:00:00'),
    )

    expect(plan.totalWeeks).toBe(12)
    expect(plan.startDate).toBe('2026-06-29')
    expect(weeks.at(-1)?.weekStartDate).toBe('2026-09-14')
    expect(weeks.at(-1)?.phase).toBe('race')
  })

  it('toda semana que intersecta la ventana es race', () => {
    const { weeks } = shellFor(event({ date: '2026-09-12', endDate: '2026-09-15' }))
    const lastTwo = weeks.slice(-2)
    expect(lastTwo.map((week) => week.phase)).toEqual(['race', 'race'])
  })

  it('el preview cuenta las mismas semanas que el shell', () => {
    const goalEvent = event({ date: '2026-09-12', endDate: '2026-09-15' })
    const now = new Date('2026-08-10T09:00:00')
    expect(getCompetitionPlanWeekCount(goalEvent, makeWizardConfig().trainingDays, now))
      .toBe(shellFor(goalEvent, now).plan.totalWeeks)
  })

  it('no agrega una semana vacía si el primer día habilitado cae después del inicio', () => {
    // Domingo 9, evento lunes→martes y sólo martes habilitado: la búsqueda de
    // la primera sesión debe llegar hasta el término, no cortarse el lunes.
    const goalEvent = event({ date: '2026-08-10', endDate: '2026-08-11' })
    const now = new Date('2026-08-09T10:00:00')
    const wizardConfig = { ...makeWizardConfig(), trainingDays: ['tuesday'] as const }
    const profile = makeProfile(goalEvent)
    const result = buildPlanShell({
      athleteId: profile.id,
      profile,
      wizardConfig,
      goalEvent,
      now,
    })

    expect(getCompetitionPlanWeekCount(goalEvent, wizardConfig.trainingDays, now)).toBe(1)
    expect(result.plan.totalWeeks).toBe(1)
    expect(result.weeks[0]?.weekStartDate).toBe('2026-08-10')
  })

  it('una ventana inválida se trata como evento de un día', () => {
    const { plan } = shellFor(event({ date: '2026-09-12', endDate: '2026-09-01' }))
    expect(plan.endDate).toBe('2026-09-12')
  })
})
