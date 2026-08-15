// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import type { AthleteProfile, WeekSummary } from '../../types'
import { currentWeekStartISO } from '../../utils/date'

const WEEK_START = currentWeekStartISO()

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  profile: null as AthleteProfile | null,
  weekSummary: null as WeekSummary | null,
  locationState: null as unknown,
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/week', state: mocks.locationState, search: '', hash: '', key: 'test' }),
}))
// WeeklyView desestructura el store entero, pero useMacroWeekCoherence lo llama con
// selector. El mock tiene que soportar las dos formas.
vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      sessions: [],
      currentWeekSummary: mocks.weekSummary,
      dayLogs: {},
      isLoading: false,
      loadedWeekStart: WEEK_START,
      requestedWeekStart: WEEK_START,
      loadWeek: vi.fn(async () => {}),
      generateCoachNote: vi.fn(async () => {}),
      deleteSession: vi.fn(async () => {}),
    }
    return selector ? selector(state) : state
  },
}))
vi.mock('../../store/useCoachActionsStore', () => ({
  useCoachActionsStore: () => ({
    addProposal: vi.fn(),
    acceptProposal: vi.fn(),
    rejectProposal: vi.fn(),
  }),
}))
vi.mock('../../store/useCoachMemoryStore', () => ({
  useCoachMemoryStore: (selector?: (state: unknown) => unknown) => {
    const state = { athleteProfile: mocks.profile }
    return selector ? selector(state) : state
  },
}))
vi.mock('../../store/useUIStore', () => ({
  useUIStore: () => ({
    currentWeekStart: WEEK_START,
    selectedDate: WEEK_START,
    setSelectedDate: vi.fn(),
    setCurrentWeekStart: vi.fn(),
  }),
}))
// El centro de acciones y el check-in son lazy y traen su propio árbol de datos;
// acá solo importa que las dos cards bajo prueba coexistan.
vi.mock('../../components/week/WeeklyHrZonesCard', () => ({ default: () => null }))
vi.mock('../../components/dashboard/DailyCheckInCard', () => ({ default: () => null }))
vi.mock('../../components/week/WeeklyActionCenterCard', () => ({ default: () => null }))

import WeeklyView from '../WeeklyView'

function makeWeekSummary(): WeekSummary {
  return {
    weekStartDate: WEEK_START,
    plannedSessions: 5,
    completedSessions: 3,
    adherencePct: 60,
    totalLoad: 1400,
  } as WeekSummary
}

afterEach(() => {
  cleanup()
  mocks.profile = null
  mocks.weekSummary = null
  mocks.locationState = null
  mocks.navigate.mockClear()
})

describe('WeeklyView sin macroplan', () => {
  it('colapsa la card de macroplan pero conserva el resumen de la semana', async () => {
    // Perfil sin evento objetivo primario: computeMacroPlan devuelve undefined.
    mocks.profile = { id: 'default', updatedAt: 1, primarySport: 'squash', goalEvents: [] } as unknown as AthleteProfile
    mocks.weekSummary = makeWeekSummary()

    render(<WeeklyView />)

    expect(await screen.findByText('Sin plan de competencia')).toBeTruthy()
    expect(screen.queryByText(/Fase actual/)).toBeNull()
    expect(screen.queryByText(/Objetivo del bloque/)).toBeNull()

    // La carga real de la semana no depende del plan y debe seguir visible.
    expect(screen.getByText('60% adherencia')).toBeTruthy()
    expect(screen.getByText('3/5 planificadas realizadas')).toBeTruthy()
  })

  it('sin resumen semanal sigue mostrando la invitación a crear plan', async () => {
    mocks.profile = { id: 'default', updatedAt: 1, primarySport: 'squash', goalEvents: [] } as unknown as AthleteProfile
    mocks.weekSummary = null

    render(<WeeklyView />)

    expect(await screen.findByText('Sin plan de competencia')).toBeTruthy()
    expect(screen.queryByText('60% adherencia')).toBeNull()
  })

  it('muestra una vez el aviso estructurado del commit y conserva otro navigation state', async () => {
    mocks.locationState = {
      planCommitNotice: { kind: 'lifecycle_sessions_removed', removedSessionCount: 3 },
      unrelated: 'preserve-me',
    }

    render(<WeeklyView />)

    expect((await screen.findByRole('status')).textContent).toContain(
      'Se retiraron 3 sesiones futuras planificadas del ciclo anterior.',
    )
    expect(mocks.navigate).toHaveBeenCalledWith('/week', {
      replace: true,
      state: { unrelated: 'preserve-me' },
    })
  })
})
