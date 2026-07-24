// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../../db/db'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import { CycleHistory } from './CycleHistory'
import type { WeekSummary } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

const mocks = vi.hoisted(() => ({ deletePlanCycle: vi.fn() }))
const authMocks = vi.hoisted(() => ({
  syncDetails: {
    lastSuccessfulSyncAt: null as number | null,
    syncAttemptInFlight: false,
  },
}))

vi.mock('../../services/planBuilder/deletePlanCycle', () => ({
  deletePlanCycle: mocks.deletePlanCycle,
}))
vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    syncDetails: authMocks.syncDetails,
  }),
}))

const plan = (over: Partial<TrainingPlan>): TrainingPlan => ({
  id: 'p1',
  athleteId: 'ath_self',
  goalEventId: 'ev1',
  status: 'archived',
  generationState: 'complete',
  title: 'Nacional de Squash',
  startDate: '2026-06-01',
  endDate: '2026-08-15',
  totalWeeks: 2,
  phases: [],
  wizardConfig: {} as never,
  macroSnapshot: { goalEventDate: '2026-08-15' } as never,
  createdAt: 1,
  updatedAt: 1,
  ...over,
} as TrainingPlan)

const planWeek = (weekIndex: number, weekStartDate: string): TrainingPlanWeek => ({
  id: `pw-${weekIndex}`,
  athleteId: 'ath_self',
  planId: 'p1',
  weekIndex,
  weekStartDate,
  phase: weekIndex === 0 ? 'base' : 'build',
  status: 'accepted',
  sessions: [],
  weekObjectives: [],
  targetLoadBySport: {},
  validationIssues: [],
  generationMeta: { attempts: 1 },
  createdAt: 1,
  updatedAt: 1,
})

const summary = (weekStartDate: string, adherencePct: number): WeekSummary => ({
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
})

describe('CycleHistory', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    mocks.deletePlanCycle.mockReset().mockResolvedValue('deleted')
    authMocks.syncDetails.lastSuccessfulSyncAt = null
    authMocks.syncDetails.syncAttemptInFlight = false
  })

  afterEach(() => {
    cleanup()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('no renderiza nada sin ciclos archivados', async () => {
    const { container } = render(<CycleHistory weekSummaries={[]} />)
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })

  it('muestra una fila por ciclo archivado', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    render(<CycleHistory weekSummaries={[]} />)
    expect(await screen.findByText('Nacional de Squash')).toBeTruthy()
  })

  it('no muestra planes active ni superseded', async () => {
    await db.trainingPlans.put(plan({ id: 'a', status: 'active', title: 'Activo' }))
    await db.trainingPlans.put(plan({ id: 's', status: 'superseded', title: 'Superseded' }))
    await db.trainingPlans.put(plan({ id: 'h', title: 'Archivado' }))
    render(<CycleHistory weekSummaries={[]} />)
    expect(await screen.findByText('Archivado')).toBeTruthy()
    expect(screen.queryByText('Activo')).toBeNull()
    expect(screen.queryByText('Superseded')).toBeNull()
  })

  it('un atleta gestionado no ve los ciclos del self ni los legacy', async () => {
    await db.trainingPlans.put(plan({ id: 'self', title: 'Del self' }))
    await db.trainingPlans.put(plan({
      id: 'legacy',
      athleteId: undefined as never,
      title: 'Legacy',
    }))
    setActiveAthleteId('ath_gestionado')
    const { container } = render(<CycleHistory weekSummaries={[]} />)
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })

  it('deduplica defensivamente por evento y conserva el canónico determinista', async () => {
    await db.trainingPlans.put(plan({
      id: 'old',
      goalEventId: 'ev1',
      title: 'Versión anterior',
      updatedAt: 10,
      acceptedAt: 10,
      createdAt: 10,
    }))
    await db.trainingPlans.put(plan({
      id: 'canonical',
      goalEventId: 'ev1',
      title: 'Versión canónica',
      updatedAt: 20,
      acceptedAt: 20,
      createdAt: 20,
    }))

    render(<CycleHistory weekSummaries={[]} />)

    expect(await screen.findByText('Versión canónica')).toBeTruthy()
    expect(screen.queryByText('Versión anterior')).toBeNull()
  })

  it('eliminar pide confirmación y llama a deletePlanCycle', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    const user = userEvent.setup()
    render(<CycleHistory weekSummaries={[]} />)
    await user.click(await screen.findByRole('button', { name: /eliminar ciclo/i }))
    await user.click(await screen.findByRole('button', { name: /^eliminar$/i }))
    await waitFor(() => expect(mocks.deletePlanCycle).toHaveBeenCalledWith('p1'))
  })

  it('con pending_sync avisa que se completará al sincronizar y mantiene la fila', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    mocks.deletePlanCycle.mockResolvedValue('pending_sync')
    const user = userEvent.setup()
    render(<CycleHistory weekSummaries={[]} />)
    await user.click(await screen.findByRole('button', { name: /eliminar ciclo/i }))
    await user.click(await screen.findByRole('button', { name: /^eliminar$/i }))
    expect(await screen.findByText(/se completará al sincronizar/i)).toBeTruthy()
    expect(screen.getByText('Nacional de Squash')).toBeTruthy()
  })

  it('con failed avisa el error y mantiene la fila', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    mocks.deletePlanCycle.mockResolvedValue('failed')
    const user = userEvent.setup()
    render(<CycleHistory weekSummaries={[]} />)
    await user.click(await screen.findByRole('button', { name: /eliminar ciclo/i }))
    await user.click(await screen.findByRole('button', { name: /^eliminar$/i }))
    expect(await screen.findByText(/no se pudo eliminar/i)).toBeTruthy()
    expect(screen.getByText('Nacional de Squash')).toBeTruthy()
  })

  it('muestra las métricas calculadas con las semanas reales del plan', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    await db.trainingPlanWeeks.bulkPut([
      planWeek(0, '2026-06-01'),
      planWeek(1, '2026-06-08'),
    ])
    render(<CycleHistory weekSummaries={[
      summary('2026-06-01', 80),
      summary('2026-06-08', 60),
    ]} />)

    expect(await screen.findByText('2 sem')).toBeTruthy()
    expect(screen.getByText('70%')).toBeTruthy()
  })

  it('al expandir ordena las semanas y muestra fase y adherencia por semana', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    await db.trainingPlanWeeks.bulkPut([
      planWeek(1, '2026-06-08'),
      planWeek(0, '2026-06-01'),
    ])
    const user = userEvent.setup()
    render(<CycleHistory weekSummaries={[
      summary('2026-06-01', 80),
      summary('2026-06-08', 60),
    ]} />)

    await user.click(await screen.findByRole('button', { name: /expandir ciclo/i }))
    const weekLabels = screen.getAllByTestId('history-week-label').map((node) => node.textContent)
    expect(weekLabels).toEqual(['S1', 'S2'])
    expect(screen.getByText('Base')).toBeTruthy()
    expect(screen.getByText('Construcción')).toBeTruthy()
    expect(screen.getByText('80%')).toBeTruthy()
    expect(screen.getByText('60%')).toBeTruthy()
  })

  it('recarga después de un sync exitoso y retira una fila borrada por el merge', async () => {
    const summaries: WeekSummary[] = []
    await db.trainingPlans.put(plan({ id: 'p1' }))
    const view = render(<CycleHistory weekSummaries={summaries} />)
    expect(await screen.findByText('Nacional de Squash')).toBeTruthy()

    await db.trainingPlans.delete('p1')
    authMocks.syncDetails.lastSuccessfulSyncAt = 100
    view.rerender(<CycleHistory weekSummaries={summaries} />)

    await waitFor(() => expect(screen.queryByText('Nacional de Squash')).toBeNull())
  })

  it('recarga al terminar un sync degradado aunque lastSuccessfulSyncAt no cambie', async () => {
    const summaries: WeekSummary[] = []
    authMocks.syncDetails.syncAttemptInFlight = true
    await db.trainingPlans.put(plan({ id: 'p1' }))
    const view = render(<CycleHistory weekSummaries={summaries} />)
    expect(await screen.findByText('Nacional de Squash')).toBeTruthy()

    await db.trainingPlans.delete('p1')
    authMocks.syncDetails.syncAttemptInFlight = false
    view.rerender(<CycleHistory weekSummaries={summaries} />)

    await waitFor(() => expect(screen.queryByText('Nacional de Squash')).toBeNull())
  })
})
