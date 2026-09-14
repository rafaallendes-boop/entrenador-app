// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext } from '../../types'

const h = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  showEntitlementOffer: vi.fn(),
  athleteId: null as string | null,
  switchEpoch: 0,
  loadWhoopWorkoutBlock: vi.fn(),
  getSessionsForDateRange: vi.fn(),
  chatActionAllowed: true,
  entitlementPending: false,
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
  getSelfAthleteId: () => h.athleteId ?? 'ath_a',
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

vi.mock('../../hooks/useEntitlement', () => ({
  useEntitlement: () => ({
    canUse: () => true,
    decide: (requestClass: string) => ({
      allowed: !['chat_action', 'week_creator'].includes(requestClass) || h.chatActionAllowed,
    }),
    pending: h.entitlementPending,
  }),
}))

vi.mock('../../store/useChatStore', () => {
  const useChatStore = () => ({
    messages: [],
    isLoading: false,
    streamingText: '',
    responsePhase: 'idle',
    error: null,
    entitlementOffer: null,
    showEntitlementOffer: h.showEntitlementOffer,
    loadHistory: vi.fn(),
    sendMessage: h.sendMessage,
    newSession: vi.fn(),
    deleteCurrentSession: vi.fn(),
    openConversation: vi.fn(),
  })
  useChatStore.getState = () => ({ currentSessionId: 's1', error: null, messages: [], pendingIntent: null })
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
  h.showEntitlementOffer.mockReset()
  h.loadWhoopWorkoutBlock.mockReset()
  h.loadWhoopWorkoutBlock.mockResolvedValue(BLOCK)
  h.getSessionsForDateRange.mockReset()
  h.getSessionsForDateRange.mockResolvedValue([])
  h.athleteId = 'ath_self'
  h.switchEpoch = 0
  h.chatActionAllowed = true
  h.entitlementPending = false
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
  it('intercepta una chat_action no permitida antes de consultar o enviar', async () => {
    h.chatActionAllowed = false

    await send('ajusta mi sesión de running de mañana')

    expect(h.showEntitlementOffer).toHaveBeenCalledWith('chat_action')
    expect(h.getSessionsForDateRange).not.toHaveBeenCalled()
    expect(h.loadWhoopWorkoutBlock).not.toHaveBeenCalled()
    expect(h.sendMessage).not.toHaveBeenCalled()
  })

  it('deja pasar una chat_action permitida', async () => {
    await send('ajusta mi sesión de running de mañana')

    expect(h.showEntitlementOffer).not.toHaveBeenCalled()
    expect(h.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('adjunta el bloque cuando el scope no se movió', async () => {
    await send('hola')

    expect(h.sendMessage).toHaveBeenCalledTimes(1)
    expect(sentContext().whoopWorkoutBlock).toBe(BLOCK)
    const scopeArg = h.sendMessage.mock.calls[0][2]
    expect(scopeArg).toMatchObject({ athleteId: h.athleteId, epoch: h.switchEpoch })
    expect(typeof scopeArg.requestId).toBe('string')
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

  it('no envía y conserva el borrador si el atleta capturado pasa por null antes de enviar', async () => {
    // Variante con atleta presente al arrancar: la re-hidratación republica el
    // MISMO id pero pasando por null, y `getActiveAthleteId` puede leerse en ese
    // instante. El epoch nunca se mueve. A diferencia de la hidratación inicial
    // `null → self` (que sí se tolera), acá se capturó un atleta CONCRETO y
    // ahora se lee `null`: `isRequestScopeCurrent` no puede distinguir un
    // transitorio de una salida real, así que trata cualquier divergencia desde
    // una identidad concreta como cambio real y no envía nada.
    h.loadWhoopWorkoutBlock.mockImplementation(async () => {
      h.athleteId = null
      return BLOCK
    })

    await send('hola')

    expect(h.sendMessage).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('Cambió el atleta activo')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('hola')
  })

  it('no envía y conserva el borrador si el atleta cambia durante las lecturas', async () => {
    h.loadWhoopWorkoutBlock.mockImplementation(async () => {
      h.athleteId = 'ath_managed'
      h.switchEpoch = 1
      return BLOCK
    })

    await send('hola')

    expect(h.sendMessage).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('Cambió el atleta activo')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('hola')
  })

  it('bloquea Crear semana con la misma política del gate de acciones', async () => {
    h.chatActionAllowed = false
    await send('creame una semana')
    expect(h.showEntitlementOffer).toHaveBeenCalledWith('week_creator')
    expect(h.sendMessage).not.toHaveBeenCalled()
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

  it('captura 28 días de historial y 20 de planificación en el dominio', async () => {
    const today = new Date()
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const shift = (days: number) => { const d = new Date(today); d.setDate(d.getDate() + days); return iso(d) }
    h.getSessionsForDateRange.mockResolvedValue([{
      id: 'past', date: shift(-10), weekStartDate: shift(-10), timeBlock: 'AM', type: 'squash', status: 'completed', title: 'Hace diez días', durationMin: 60, createdAt: 0, updatedAt: 0,
    }])

    await send('hola')

    expect(h.getSessionsForDateRange).toHaveBeenCalledWith(shift(-28), shift(20))
    expect(sentContext().historicalSessions?.map((s) => s.id)).toContain('past')
  })
})
