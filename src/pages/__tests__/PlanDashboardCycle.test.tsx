// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../../db/db'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import type { AthleteProfile, WeekSummary } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

const mocks = vi.hoisted(() => ({
  profile: null as AthleteProfile | null,
  summaries: [] as WeekSummary[],
  navigate: vi.fn(),
  loadMemory: vi.fn(async () => {}),
  loadAllSummaries: vi.fn(async () => {}),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}))
vi.mock('../../store/useCoachMemoryStore', () => ({
  useCoachMemoryStore: () => ({
    athleteProfile: mocks.profile,
    loadMemory: mocks.loadMemory,
  }),
}))
vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: () => ({
    allWeekSummaries: mocks.summaries,
    loadAllSummaries: mocks.loadAllSummaries,
  }),
}))
vi.mock('../../components/planBuilder/CycleHistory', () => ({
  CycleHistory: ({ weekSummaries }: { weekSummaries: WeekSummary[] }) => (
    <section aria-label="Ciclos anteriores" data-summary-count={weekSummaries.length} />
  ),
}))

import PlanDashboard from '../PlanDashboard'

const TODAY = '2026-07-23'
const PAST = '2026-07-20'
const FUTURE = '2026-08-20'

function profile(eventDate: string, eventId = 'event-1', eventEndDate?: string): AthleteProfile {
  return {
    id: 'ath_self',
    athleteId: 'ath_self',
    updatedAt: 1,
    goalEvents: [{
      id: eventId,
      title: 'Nacional de Squash',
      date: eventDate,
      endDate: eventEndDate,
      sport: 'squash',
      priority: 'primary',
      eventType: 'tournament',
    }],
  }
}

function generatedPlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  const eventDate = overrides.endDate ?? PAST
  const goalEventId = overrides.goalEventId ?? 'event-1'
  return {
    id: 'plan-1',
    athleteId: 'ath_self',
    goalEventId,
    status: 'active',
    generationState: 'complete',
    title: 'Nacional de Squash',
    startDate: '2026-07-06',
    endDate: eventDate,
    totalWeeks: 2,
    phases: [],
    wizardConfig: { goalEventId, complementarySports: [] } as never,
    macroSnapshot: {
      goalEventId,
      goalEventDate: eventDate,
      currentPhase: eventDate < TODAY ? 'transition' : 'base',
      weeksRemaining: eventDate < TODAY ? -1 : 4,
      timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary' }],
    } as never,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function planWeek(
  planId: string,
  weekIndex: number,
  weekStartDate: string,
  athleteId = 'ath_self',
): TrainingPlanWeek {
  return {
    id: `${planId}-pw-${weekIndex}`,
    athleteId,
    planId,
    weekIndex,
    weekStartDate,
    phase: weekIndex === 0 ? 'base' : 'race',
    status: 'accepted',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 1 },
    createdAt: 1,
    updatedAt: 1,
  }
}

function summary(weekStartDate: string, adherencePct: number): WeekSummary {
  return {
    id: `ws-${weekStartDate}`,
    athleteId: 'ath_self',
    weekStartDate,
    totalSessions: 4,
    totalMinutes: 240,
    plannedSessions: 4,
    completedSessions: 3,
    plannedMinutes: 240,
    completedMinutes: 180,
    adherencePct,
    squashSessions: 3,
    runningSessions: 0,
    strengthSessions: 0,
  }
}

async function renderDashboard(input: {
  eventDate: string
  eventEndDate?: string
  plan?: TrainingPlan | null
  weekSummaries?: WeekSummary[]
  onNewCycle?: (goalEventId: string) => void
}) {
  mocks.profile = profile(input.eventDate, 'event-1', input.eventEndDate)
  mocks.summaries = input.weekSummaries ?? []
  if (input.plan) {
    await db.trainingPlans.put(input.plan)
    await db.trainingPlanWeeks.bulkPut([
      planWeek(input.plan.id, 0, '2026-07-06', input.plan.athleteId),
      planWeek(input.plan.id, 1, '2026-07-13', input.plan.athleteId),
    ])
  }
  return render(
    <PlanDashboard
      onEdit={vi.fn()}
      onNewCycle={input.onNewCycle ?? vi.fn()}
    />,
  )
}

describe('PlanDashboard: cierre de ciclo', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(`${TODAY}T12:00:00-04:00`))
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    mocks.profile = null
    mocks.summaries = []
    mocks.navigate.mockReset()
    mocks.loadMemory.mockClear()
    mocks.loadAllSummaries.mockClear()
  })

  afterEach(() => {
    cleanup()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
    vi.useRealTimers()
  })

  it('con evento futuro muestra el countdown, KPIs y cinco tarjetas de fase', async () => {
    await renderDashboard({ eventDate: FUTURE })
    expect(await screen.findByText(/días restantes/i)).toBeTruthy()
    expect(screen.getByTestId('dashboard-kpis')).toBeTruthy()
    expect(screen.getAllByTestId('phase-card')).toHaveLength(5)
  })

  it('durante un evento multijornada muestra el ciclo en curso hasta el término', async () => {
    await renderDashboard({ eventDate: '2026-07-20', eventEndDate: '2026-07-25' })

    expect((await screen.findAllByText('En curso')).length).toBeGreaterThan(0)
    expect(screen.getByText(/2 días para el término/i)).toBeTruthy()
    expect(screen.queryByText(/evento completado/i)).toBeNull()
    expect(screen.queryByText(/días restantes/i)).toBeNull()
  })

  it('recupera la ventana completa desde el snapshot cuando el perfil no la trae', async () => {
    mocks.profile = { id: 'ath_self', athleteId: 'ath_self', updatedAt: 1 }
    const activePlan = generatedPlan({ endDate: '2026-07-25' })
    activePlan.macroSnapshot = {
      ...activePlan.macroSnapshot,
      goalEventDate: '2026-07-20',
      goalEventEndDate: '2026-07-25',
      goalEventKeyDate: '2026-07-23',
      currentPhase: 'race',
      weeksRemaining: 0,
    }
    await db.trainingPlans.put(activePlan)

    render(<PlanDashboard onEdit={vi.fn()} onNewCycle={vi.fn()} />)

    expect((await screen.findAllByText('En curso')).length).toBeGreaterThan(0)
    expect(screen.getByText(/20–25 jul 2026/i)).toBeTruthy()
    expect(screen.getByText(/Día clave: 23 jul/i)).toBeTruthy()
  })

  it('post-evento muestra cinco fases completadas y Transición en curso', async () => {
    await renderDashboard({ eventDate: PAST, plan: generatedPlan() })
    expect(await screen.findByText(/evento completado/i)).toBeTruthy()
    expect(screen.queryByText(/días restantes/i)).toBeNull()
    expect(screen.getAllByTestId('phase-card')).toHaveLength(6)
    expect(screen.getAllByText('Completada')).toHaveLength(5)
    expect(screen.getAllByText('Transición')).toHaveLength(2)
    expect(screen.getByText('En curso')).toBeTruthy()
  })

  it('post-evento fuerza Transición aunque el snapshot haya quedado en race', async () => {
    const stalePlan = generatedPlan()
    stalePlan.macroSnapshot = { ...stalePlan.macroSnapshot, currentPhase: 'race' }
    mocks.profile = { id: 'ath_self', athleteId: 'ath_self', updatedAt: 1 }
    await db.trainingPlans.put(stalePlan)

    render(<PlanDashboard onEdit={vi.fn()} onNewCycle={vi.fn()} />)

    expect(await screen.findByText(/evento completado/i)).toBeTruthy()
    expect(screen.getAllByText('Completada')).toHaveLength(5)
    expect(screen.getAllByText('Transición')).toHaveLength(2)
    expect(screen.getByText('En curso')).toBeTruthy()
  })

  it('el CTA post-evento entrega el goalEventId del ciclo mostrado', async () => {
    const onNewCycle = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderDashboard({ eventDate: PAST, onNewCycle })
    await user.click(await screen.findByRole('button', { name: /planificar próximo evento/i }))
    expect(onNewCycle).toHaveBeenCalledWith('event-1')
  })

  it('post-evento muestra semanas entrenadas y adherencia del ciclo', async () => {
    await renderDashboard({
      eventDate: PAST,
      plan: generatedPlan(),
      weekSummaries: [
        summary('2026-07-06', 80),
        summary('2026-07-13', 60),
      ],
    })
    await waitFor(() => {
      const metrics = screen.getByTestId('cycle-metrics')
      expect(within(metrics).getByText('70%')).toBeTruthy()
      expect(within(metrics).getByText('2')).toBeTruthy()
    })
  })

  it('post-evento oculta los KPIs generales y las semanas recientes', async () => {
    await renderDashboard({
      eventDate: PAST,
      plan: generatedPlan(),
      weekSummaries: [summary('2026-07-13', 75)],
    })
    expect(await screen.findByText(/evento completado/i)).toBeTruthy()
    expect(screen.queryByTestId('dashboard-kpis')).toBeNull()
    expect(screen.queryByTestId('recent-weeks')).toBeNull()
  })

  it('post-evento sin plan generado usa la variante reducida sin métricas', async () => {
    await renderDashboard({ eventDate: PAST, plan: null })
    expect(await screen.findByText(/evento completado/i)).toBeTruthy()
    expect(screen.queryByTestId('cycle-metrics')).toBeNull()
    expect(screen.getByRole('button', { name: /planificar próximo evento/i })).toBeTruthy()
  })

  it('elige el plan que coincide con el evento del perfil aunque otro active sea más nuevo', async () => {
    mocks.profile = profile(PAST, 'event-profile')
    mocks.summaries = [
      summary('2026-07-06', 80),
      summary('2026-07-13', 60),
      summary('2026-06-01', 10),
    ]
    const matching = generatedPlan({
      id: 'matching',
      goalEventId: 'event-profile',
      updatedAt: 10,
    })
    const unrelated = generatedPlan({
      id: 'unrelated',
      goalEventId: 'event-other',
      updatedAt: 50,
    })
    await db.trainingPlans.bulkPut([matching, unrelated])
    await db.trainingPlanWeeks.bulkPut([
      planWeek('matching', 0, '2026-07-06'),
      planWeek('matching', 1, '2026-07-13'),
      planWeek('unrelated', 0, '2026-06-01'),
    ])

    render(<PlanDashboard onEdit={vi.fn()} onNewCycle={vi.fn()} />)

    await waitFor(() => {
      const metrics = screen.getByTestId('cycle-metrics')
      expect(within(metrics).getByText('70%')).toBeTruthy()
      expect(within(metrics).getByText('2')).toBeTruthy()
    })
  })

  it('sin evento de perfil usa como fallback el plan scoped canónico', async () => {
    setActiveAthleteId('ath_managed')
    mocks.profile = { id: 'ath_managed', athleteId: 'ath_managed', updatedAt: 1 }
    await db.trainingPlans.bulkPut([
      generatedPlan({ id: 'self-newer', title: 'Plan del self', updatedAt: 30 }),
      generatedPlan({
        id: 'managed',
        athleteId: 'ath_managed',
        title: 'Plan gestionado',
        updatedAt: 20,
      }),
    ])

    render(<PlanDashboard onEdit={vi.fn()} onNewCycle={vi.fn()} />)

    expect(await screen.findByText('Plan gestionado')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Plan del self')).toBeNull())
  })

  it('mantiene el botón Editar post-evento', async () => {
    await renderDashboard({ eventDate: PAST })
    expect(await screen.findByRole('button', { name: /editar/i })).toBeTruthy()
  })

  it('monta el historial con los summaries cargados', async () => {
    await renderDashboard({
      eventDate: FUTURE,
      weekSummaries: [summary('2026-07-13', 75)],
    })
    const history = await screen.findByRole('region', { name: 'Ciclos anteriores' })
    expect(history.getAttribute('data-summary-count')).toBe('1')
  })
})
