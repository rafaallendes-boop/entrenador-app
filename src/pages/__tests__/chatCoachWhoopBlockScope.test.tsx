// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext } from '../../types'

const h = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  athleteId: null as string | null,
  switchEpoch: 0,
  loadWhoopWorkoutBlock: vi.fn(),
  getSessionsForDateRange: vi.fn(),
}))

/**
 * Los holders son variables vivas, no un guion de valores por llamada: otros
 * efectos de la página también leen `getActiveAthleteId`, así que una cola
 * consumible se vaciaría antes de llegar al envío y el test pasaría en falso.
 * El cambio de scope se simula mutándolas DENTRO de `loadWhoopWorkoutBlock`,
 * que es exactamente el await que corre entre las dos lecturas del guard.
 */
vi.mock('../../services/athlete/activeAthlete', () => ({
  getActiveAthleteId: () => h.athleteId,
  getSwitchEpoch: () => h.switchEpoch,
}))

vi.mock('../../services/readiness/whoopWorkoutBlock', () => ({
  loadWhoopWorkoutBlock: (...args: unknown[]) => h.loadWhoopWorkoutBlock(...args),
}))

vi.mock('../../db/queries', () => ({
  getSessionsForDateRange: (...args: unknown[]) => h.getSessionsForDateRange(...args),
}))

vi.mock('../../services/readiness/localReadiness', () => ({
  getLocalReadinessForDate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../services/readiness/pullReadiness', () => ({
  pullReadiness: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../components/chat/ConversationDrawer', () => ({ default: () => null }))

vi.mock('../../store/useChatStore', () => {
  const useChatStore = () => ({
    messages: [],
    isLoading: false,
    streamingText: '',
    responsePhase: 'idle',
    error: null,
    loadHistory: vi.fn(),
    sendMessage: h.sendMessage,
    newSession: vi.fn(),
    deleteCurrentSession: vi.fn(),
    openConversation: vi.fn(),
  })
  useChatStore.getState = () => ({ currentSessionId: 's1', error: null, messages: [] })
  return { useChatStore }
})

vi.mock('../../store/useCoachActionsStore', () => ({
  useCoachActionsStore: () => ({
    proposals: [],
    loadProposals: vi.fn(),
    acceptProposal: vi.fn(),
    rejectProposal: vi.fn(),
  }),
}))

vi.mock('../../store/useCoachMemoryStore', () => ({
  useCoachMemoryStore: () => ({ coachMemory: '', athleteProfile: null, loadMemory: vi.fn() }),
}))

vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: () => ({
    sessions: [],
    currentWeekSummary: null,
    dayLogs: {},
    loadWeek: vi.fn(),
  }),
}))

vi.mock('../../store/useAuthStore', () => {
  const authState = {
    activeAthleteId: null,
    user: null,
    syncDetails: { lastErrorEntity: null, pendingTables: [], consecutiveFailures: 0 },
    setSyncDetails: vi.fn(),
    setSyncStatus: vi.fn(),
  }
  const useAuthStore = (selector: (state: typeof authState) => unknown) => selector(authState)
  useAuthStore.getState = () => authState
  return { useAuthStore }
})

vi.mock('../../hooks/useWeeklySnapshot', () => ({ useLoadAnalytics: () => null }))
vi.mock('../../hooks/useWeeklyLaunchIntent', () => ({
  useWeeklyLaunchIntent: () => ({ launchIntent: null, launchId: 0 }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ key: 'test', pathname: '/chat', search: '', state: null }),
}))

const BLOCK = 'Carga objetiva registrada por Whoop (ultimos 7 dias):'

beforeEach(() => {
  h.sendMessage.mockReset()
  h.sendMessage.mockResolvedValue({ route: 'chat' })
  h.loadWhoopWorkoutBlock.mockReset()
  h.loadWhoopWorkoutBlock.mockResolvedValue(BLOCK)
  h.getSessionsForDateRange.mockReset()
  h.getSessionsForDateRange.mockResolvedValue([])
  h.athleteId = 'ath_self'
  h.switchEpoch = 0
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function send(message: string) {
  const { default: ChatCoach } = await import('../ChatCoach')
  render(<ChatCoach />)
  await userEvent.type(screen.getByPlaceholderText(/Escríbele a RallyIQ/i), `${message}{Enter}`)
}

function sentContext(): ChatContext {
  return h.sendMessage.mock.calls[0][1] as ChatContext
}

describe('ChatCoach — scope del bloque de Whoop', () => {
  it('adjunta el bloque cuando el scope no se movió', async () => {
    await send('hola')

    expect(h.sendMessage).toHaveBeenCalledTimes(1)
    expect(sentContext().whoopWorkoutBlock).toBe(BLOCK)
  })

  it('manda igual el mensaje cuando la hidratación resuelve el atleta a mitad del envío', async () => {
    // `hydrateActiveAthlete` publica el atleta con `setActiveAthleteId` y NO
    // toca el epoch, así que un arranque `null → ath_self` llega al guard con la
    // identidad cambiada y el epoch intacto. Abortar acá perdería el mensaje sin
    // dejar rastro: `ChatInput` limpia el textarea antes de llamar a `onSend`.
    h.athleteId = null
    // La hidratación aterriza mientras corre la consulta de planificación, que
    // es el primer await del envío.
    h.getSessionsForDateRange.mockImplementation(async () => {
      h.athleteId = 'ath_self'
      return []
    })

    await send('hola')

    // Sin atleta al arrancar no hubo consulta de workouts, así que tampoco hay
    // bloque; lo que importa es que el mensaje del usuario no se pierda.
    expect(h.loadWhoopWorkoutBlock).not.toHaveBeenCalled()
    expect(h.sendMessage).toHaveBeenCalledTimes(1)
    expect(h.sendMessage.mock.calls[0][0]).toBe('hola')
    expect(sentContext().whoopWorkoutBlock).toBeUndefined()
  })

  it('manda igual el mensaje cuando la hidratación se resuelve con el bloque ya leído', async () => {
    // Variante con atleta presente al arrancar: la re-hidratación republica el
    // MISMO id pero pasando por null, y `getActiveAthleteId` puede leerse en ese
    // instante. El epoch nunca se mueve.
    h.loadWhoopWorkoutBlock.mockImplementation(async () => {
      h.athleteId = null
      return BLOCK
    })

    await send('hola')

    expect(h.sendMessage).toHaveBeenCalledTimes(1)
    expect(h.sendMessage.mock.calls[0][0]).toBe('hola')
    expect(sentContext().whoopWorkoutBlock).toBeUndefined()
  })

  it('descarta el bloque —no el mensaje— cuando el atleta cambia durante las consultas', async () => {
    h.loadWhoopWorkoutBlock.mockImplementation(async () => {
      h.athleteId = 'ath_managed'
      h.switchEpoch = 1
      return BLOCK
    })

    await send('hola')

    expect(h.sendMessage).toHaveBeenCalledTimes(1)
    expect(sentContext().whoopWorkoutBlock).toBeUndefined()
  })

  it('no consulta workouts sin atleta resuelto y manda el mensaje igual', async () => {
    h.athleteId = null

    await send('hola')

    expect(h.loadWhoopWorkoutBlock).not.toHaveBeenCalled()
    expect(h.sendMessage).toHaveBeenCalledTimes(1)
    expect(sentContext().whoopWorkoutBlock).toBeUndefined()
  })

  it('manda el mensaje aunque la lectura local del bloque falle', async () => {
    h.loadWhoopWorkoutBlock.mockRejectedValue(new Error('dexie caído'))

    await send('hola')

    expect(h.sendMessage).toHaveBeenCalledTimes(1)
    expect(sentContext().whoopWorkoutBlock).toBeUndefined()
  })
})
